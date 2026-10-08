"""Modal integration for Phase-2 OSM road-graph map-matching.

Runs the heavy OSM work in a Modal container:

* a Modal **Volume** caches the OSM data for a region (a Geofabrik ``.osm.pbf``
  and/or a pre-built road GeoJSON),
* a module-global worker parses the OSM ways for the routes' bounding box and
  snaps each route polyline to the graph via the pure ``road_graph`` engine.

All DB I/O stays in the Celery task; this module only moves JSON in and out.
When Modal or the OSM data is unavailable the public function returns ``{}`` so
the caller degrades to Phase-1 geometric matching.

Bootstrap (one-off): ``python -m app.scripts.osm_bootstrap <region>`` (see the
script) or call ``bootstrap_osm_region_on_modal(region)`` from a Python shell
with Modal credentials set.
"""

from __future__ import annotations

import logging
import math

logger = logging.getLogger(__name__)

# Bump when the snapping/bucket logic changes so stale matches are recomputed.
ROAD_MATCH_VERSION = 1

_GEOFABRIK = "https://download.geofabrik.de/{path}-latest.osm.pbf"
_DEFAULT_VOLUME = "fittrack-osm"
# Default Geofabrik slug (note: the UK extract lives under `europe/`; a top-level
# `great-britain` returns a 9 KB HTML error page with HTTP 200).
_DEFAULT_GEOFABRIK_PATH = "europe/united-kingdom"


def _geofabrik_url(geofabrik_path: str) -> str:
    """Build the Geofabrik download URL for a path slug (e.g. ``europe/united-kingdom``)."""
    return _GEOFABRIK.format(path=geofabrik_path.strip("/"))


def _dest_path(region: str, osm_dir: str = "/osm") -> str:
    """Destination filename in the OSM volume for a logical region key."""
    return f"{osm_dir.rstrip('/')}/{region}-latest.osm.pbf"


def _modal_configured() -> bool:
    from app.config import get_settings

    settings = get_settings()
    return bool(settings.modal_token_id and settings.modal_token_secret)


def _volume_name() -> str:
    from app.config import get_settings

    return get_settings().osm_volume_name or _DEFAULT_VOLUME


# ── Modal remote workers (module scope — Modal rejects closures) ─────────────


def _build_edges_from_pbf(pbf_path: str, bbox: tuple[float, float, float, float]):
    """Parse highways from an OSM PBF within ``bbox`` → list of edge tuples.

    ``bbox`` = (min_lat, min_lng, max_lat, max_lng). Returns a list of
    ``(key, u, v, [(lat, lng), ...], name, highway)`` where ``key`` is
    ``{way_id}:{segment_idx}`` and ``u``/``v`` are the OSM node ids of the
    segment endpoints (so the snap continuity filter sees shared nodes
    across ways).

    **Two passes** (this is the important part): resolving way node refs with
    pyosmium's ``locations=True`` builds a node-location index over the *entire*
    extract — including every node outside the bbox — which dominates the cost
    (a whole-UK parse blew a 30 min Modal timeout). Instead:

    1. Pass 1 streams ways (no locations) and collects the node ids referenced
       by highway ways, plus a bbox skip using each way's ``nodes`` refs is not
       possible without coords, so we keep every highway way's node ids (cheap:
       ids are small ints).
    2. Pass 2 streams nodes (no locations) and records coordinates **only** for
       the collected ids.

    Way geometry is then assembled from the resolved coordinates. No global
    location index is built. ``osmium`` file passes are memory-bounded.
    """
    import osmium

    min_lat, min_lng, max_lat, max_lng = bbox

    # ── Pass 1: highway ways + their node refs ──────────────────────────────
    wanted_nodes: set[int] = set()
    ways: list[tuple[int, str | None, str, list[int]]] = []

    class _WayCollector(osmium.SimpleHandler):
        def way(self, w):
            highway = w.tags.get("highway")
            if not highway:
                return
            refs = [n.ref for n in w.nodes]
            if len(refs) < 2:
                return
            ways.append((w.id, w.tags.get("name"), highway, refs))
            wanted_nodes.update(refs)

    _WayCollector().apply_file(pbf_path)

    if not ways:
        return []

    # ── Pass 2: coordinates for the referenced nodes only ───────────────────
    coords: dict[int, tuple[float, float]] = {}

    class _NodeCollector(osmium.SimpleHandler):
        def node(self, n):
            if n.id in wanted_nodes:
                coords[n.id] = (n.location.lat, n.location.lon)

    _NodeCollector().apply_file(pbf_path, locations=False)

    # ── Assemble edges (bbox-filtered) ──────────────────────────────────────
    # u/v carry the real OSM node ids (not per-way sequence numbers) so the
    # snap continuity filter (_shares_node in services/road_graph.py) fires
    # across ways at shared intersections — where continuity matters most.
    # ``key`` stays way-scoped (way_id:idx): edge_set/Jaccard/embedding keys
    # are unchanged.
    out: list[tuple] = []
    for way_id, name, highway, refs in ways:
        prev = None
        prev_ref = None
        idx = 0
        for ref in refs:
            pt = coords.get(ref)
            if pt is None:
                prev = None
                prev_ref = None
                continue
            if not (min_lat <= pt[0] <= max_lat and min_lng <= pt[1] <= max_lng):
                prev = None
                prev_ref = None
                continue
            if prev is not None:
                idx += 1
                out.append(
                    (
                        f"{way_id}:{idx}",
                        str(prev_ref),
                        str(ref),
                        [prev, pt],
                        name,
                        highway,
                    )
                )
            prev = pt
            prev_ref = ref
    return out


def _match_routes_road_modal(
    routes_json: str,
    region: str,
    search_radius_m: float,
    max_snap_m: float,
    osm_dir: str = "/osm",
) -> dict:
    """Modal remote worker: snap routes to the regional OSM road graph.

    Module-global (Modal rejects closures). ``road_graph`` is mounted at
    ``/root``; OSM data lives in a Volume mounted at ``/osm``. Returns
    ``{route_id: road_match_dict}``.
    """
    import json as _json
    import os
    import sys

    sys.path.insert(0, "/root")
    try:
        from road_graph import (  # type: ignore
            RoadEdge,
            RoadGraph,
            haversine_distance,
            snap_polyline,
        )
    except ModuleNotFoundError:  # local / tests: the module lives in the app
        from app.services.road_graph import (  # type: ignore
            RoadEdge,
            RoadGraph,
            haversine_distance,
            snap_polyline,
        )

    routes = _json.loads(routes_json)
    if not routes:
        return {}

    # Union bbox of all routes, padded.
    lats = [p[0] for r in routes for p in r["polyline"] if len(p) >= 2]
    lngs = [p[1] for r in routes for p in r["polyline"] if len(p) >= 2]
    if not lats:
        return {}
    pad = 0.02
    bbox = (min(lats) - pad, min(lngs) - pad, max(lats) + pad, max(lngs) + pad)

    edges: list[RoadEdge] = []
    clipped = os.path.join(osm_dir, f"{region}-roads.osm.pbf")
    full = os.path.join(osm_dir, f"{region}-latest.osm.pbf")
    geojson_path = os.path.join(osm_dir, f"{region}-roads.geojson")
    # Prefer the bbox-clipped PBF; a bare ``{region}-latest.osm.pbf`` may be a
    # bad-slug HTML stub, so only use it if it looks like a real PBF (> 1 MB).
    pbf_path = None
    if os.path.exists(clipped):
        pbf_path = clipped
    elif os.path.exists(full) and os.path.getsize(full) > 1_000_000:
        pbf_path = full

    import time as _time

    t0 = _time.monotonic()
    if pbf_path is not None:
        # bbox-filtered at parse time — much lighter than a whole-cache JSON load.
        raw = _build_edges_from_pbf(pbf_path, bbox)
        edges = [
            RoadEdge(
                key=k,
                u=u,
                v=v,
                polyline=pts,
                length_m=sum(
                    haversine_distance(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])
                    for i in range(1, len(pts))
                ),
                name=nm,
                highway=hw,
            )
            for (k, u, v, pts, nm, hw) in raw
        ]
    elif os.path.exists(geojson_path):
        try:
            from road_graph import roads_from_geojson  # type: ignore
        except ModuleNotFoundError:
            from app.services.road_graph import roads_from_geojson  # type: ignore

        # Streamed + bbox-filtered: never materialise the whole cache.
        edges = roads_from_geojson(path=geojson_path, bbox=bbox)
    else:
        return {}

    t_parse = _time.monotonic() - t0

    # Build the index exactly once and reuse it for every route (it was rebuilt
    # per route — ~72% of the old snap time on a 3.2 M-edge graph).
    graph = RoadGraph(edges)
    graph.build_index()
    t_index = _time.monotonic() - t0 - t_parse

    result: dict = {}
    for r in routes:
        pts = [tuple(p) for p in r["polyline"]]
        if len(pts) < 2:
            continue
        match = snap_polyline(
            pts, graph, search_radius_m=search_radius_m, max_snap_m=max_snap_m
        )
        result[r["id"]] = match.to_dict()
    logger.info(
        f"OSM match timing: edges={len(edges)} parse={t_parse:.1f}s "
        f"index={t_index:.1f}s total={_time.monotonic() - t0:.1f}s routes={len(result)}"
    )
    return result


def _build_road_graph_modal(
    region: str,
    bbox: tuple[float, float, float, float],
    vol_name: str,
    osm_dir: str = "/osm",
) -> dict:
    """Modal worker: parse the region PBF once and cache a trimmed road GeoJSON.

    Module-global (Modal rejects closures). ``vol_name`` is passed as a plain
    string — the worker must NOT import ``app.config`` (pitfall #33). Prefers a
    bbox-clipped ``{region}-roads.osm.pbf`` if present, else parses
    ``{region}-latest.osm.pbf``. Only edge segments whose midpoint is inside the
    (padded) bbox are written, keeping the cache small, then the Volume is
    committed. Returns stats.
    """
    import json as _json
    import os

    clipped = os.path.join(osm_dir, f"{region}-roads.osm.pbf")
    full = os.path.join(osm_dir, f"{region}-latest.osm.pbf")
    pbf = clipped if os.path.exists(clipped) else full
    if not os.path.exists(pbf):
        return {"error": f"no PBF found for region {region}"}

    edges = _build_edges_from_pbf(pbf, bbox)
    if not edges:
        return {"error": "no edges parsed"}

    # Trim to the padded bbox so the cache stays small (the PBF may be a whole
    # country); keep edges near the routes only.
    pad = 0.02
    min_lat, min_lng, max_lat, max_lng = (
        bbox[0] - pad,
        bbox[1] - pad,
        bbox[2] + pad,
        bbox[3] + pad,
    )

    features = []
    for (key, _u, _v, pts, name, highway) in edges:
        lat = (pts[0][0] + pts[1][0]) / 2.0
        lng = (pts[0][1] + pts[1][1]) / 2.0
        if not (min_lat <= lat <= max_lat and min_lng <= lng <= max_lng):
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "way_id": key.split(":")[0],
                    "name": name,
                    "highway": highway,
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[pt[1], pt[0]] for pt in pts],
                },
            }
        )

    dest = os.path.join(osm_dir, f"{region}-roads.geojson")
    with open(dest, "w") as fh:
        _json.dump({"type": "FeatureCollection", "features": features}, fh, separators=(",", ":"))

    # Reclaim space: drop a bare ``{region}-latest.osm.pbf`` (a bad-slug HTML
    # stub is < 1 MB; the matcher only trusts ``-roads.osm.pbf``).
    stale = os.path.join(osm_dir, f"{region}-latest.osm.pbf")
    if os.path.exists(stale) and os.path.getsize(stale) < 1_000_000:
        os.remove(stale)

    import modal

    modal.Volume.from_name(vol_name).commit()
    return {"pbf_used": os.path.basename(pbf), "edges": len(features), "dest": dest}


def _download_osm_region(
    region: str,
    geofabrik_path: str,
    vol_name: str,
    bbox: tuple[float, float, float, float] | None = None,
    osm_dir: str = "/osm",
) -> str:
    """Download a Geofabrik extract into the mounted Volume (one-off bootstrap).

    ``geofabrik_path`` is the Geofabrik slug (e.g. ``europe/united-kingdom``).
    When ``bbox`` is given the full-country download is clipped to that box with
    ``osmium extract`` and only the small ``{region}-roads.osm.pbf`` is kept.
    Validates the response so an HTML error page (Geofabrik returns 200 for some
    bad slugs) fails loudly. ``vol_name`` is a plain string — no ``app.config``
    import inside the Modal image (pitfall #33). Commits the Volume before exit.
    """
    import os
    import subprocess

    import httpx

    os.makedirs(osm_dir, exist_ok=True)
    dest = os.path.join(osm_dir, f"{region}-roads.osm.pbf")
    url = _geofabrik_url(geofabrik_path)
    tmp_full = "/tmp/osm_full.pbf"
    with httpx.stream("GET", url, follow_redirects=True, timeout=1200) as resp:
        ctype = resp.headers.get("content-type", "")
        if resp.status_code != 200 or "html" in ctype:
            raise RuntimeError(
                f"OSM download failed: HTTP {resp.status_code} ({ctype}) for {url} "
                "— check the Geofabrik slug (UK is 'europe/united-kingdom')"
            )
        with open(tmp_full, "wb") as fh:
            fh.writelines(resp.iter_bytes(1 << 20))

    if os.path.getsize(tmp_full) < 1_000_000:
        raise RuntimeError(
            f"OSM download suspiciously small: {os.path.getsize(tmp_full)} bytes"
        )

    if bbox is not None:
        min_lat, min_lng, max_lat, max_lng = bbox
        # osmium extract -b min_lng,min_lat,max_lng,max_lat (note lng first)
        box = f"{min_lng},{min_lat},{max_lng},{max_lat}"
        subprocess.run(
            ["osmium", "extract", "-b", box, "-o", dest, "--overwrite", tmp_full],
            check=True,
        )
        os.remove(tmp_full)
    else:
        os.replace(tmp_full, dest)

    import modal

    modal.Volume.from_name(vol_name).commit()
    return dest


# ── Public API (called from Celery tasks / scripts) ──────────────────────────


def _image(project_root: str):
    import modal

    rm_path = f"{project_root}/app/services/road_graph.py"
    return (
        modal.Image.debian_slim(python_version="3.12")
        .apt_install("osmium-tool")
        .pip_install("osmium", "httpx")
        .add_local_file(rm_path, "/root/road_graph.py")
    )


def match_routes_to_roads_on_modal(
    routes_data: list[dict],
    region: str,
    *,
    search_radius_m: float = 40.0,
    max_snap_m: float = 60.0,
) -> dict:
    """Map-match routes to the regional OSM road graph on Modal.

    ``routes_data`` items: ``{id, polyline: [(lat, lng), ...]}``. Returns
    ``{route_id: road_match}`` or ``{}`` when Modal/OSM data is unavailable.
    """
    import json as _json
    from pathlib import Path

    if not routes_data or not region:
        return {}
    if not _modal_configured():
        return {}

    import modal

    project_root = str(Path(__file__).resolve().parent.parent.parent)
    image = _image(project_root)
    volume = modal.Volume.from_name(_volume_name(), create_if_missing=True)
    app = modal.App("fittrack-route-road-graph", image=image)
    remote = app.function(volumes={"/osm": volume}, timeout=3300, memory=32768)(
        _match_routes_road_modal
    )

    try:
        with app.run():
            return remote.remote(
                _json.dumps(routes_data, default=str),
                region,
                search_radius_m,
                max_snap_m,
            )
    except Exception as e:
        logger.warning(f"Modal road-graph match failed: {e}")
        return {}


def match_activities_to_roads_on_modal(
    activities_data: list[dict],
    region: str,
    *,
    search_radius_m: float = 40.0,
    max_snap_m: float = 60.0,
) -> dict:
    """Map-match activities to the regional OSM road graph on Modal.

    ``activities_data`` items: ``{id, polyline: [(lat, lng), ...]}``. Returns
    ``{activity_id: road_match}`` or ``{}`` when Modal/OSM data is unavailable.

    Reuses the same generic Modal worker (``_match_routes_road_modal``) — it
    accepts any ``{id, polyline}`` payload and returns ``{id: road_match}``,
    so routes and activities share one code path.
    """
    return match_routes_to_roads_on_modal(
        activities_data,
        region,
        search_radius_m=search_radius_m,
        max_snap_m=max_snap_m,
    )


def bootstrap_osm_region_on_modal(region: str, geofabrik_path: str) -> str:
    """Download a Geofabrik extract (``geofabrik_path`` e.g. ``europe/united-kingdom``)
    into the OSM Volume for ``region``. Run once before the weekly task.
    """
    import modal

    if not _modal_configured():
        raise RuntimeError(
            "Modal is not configured — set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET"
        )
    from pathlib import Path

    project_root = str(Path(__file__).resolve().parent.parent.parent)
    image = _image(project_root)
    vol_name = _volume_name()
    volume = modal.Volume.from_name(vol_name, create_if_missing=True)
    app = modal.App("fittrack-route-road-graph", image=image)
    remote = app.function(volumes={"/osm": volume}, timeout=3600, memory=4096)(
        _download_osm_region
    )
    with app.run():
        return remote.remote(region, geofabrik_path, vol_name)


def build_road_graph_on_modal(
    region: str,
    bbox: tuple[float, float, float, float],
    *,
    geofabrik_path: str | None = None,
) -> dict:
    """Parse the region PBF once and cache a road GeoJSON in the OSM Volume.

    ``bbox`` = ``(min_lat, min_lng, max_lat, max_lng)`` — pass the union bbox of
    the user's routes so a pre-clipped extract can be fetched. When Modal/OSM is
    unavailable it returns ``{}``; otherwise it writes ``{region}-roads.geojson``
    (used by subsequent matcher runs) and returns stats. Run once before the
    weekly matcher: ``python -m app.scripts.osm_bootstrap --build``.
    """
    import modal

    if not _modal_configured():
        return {}
    from pathlib import Path

    project_root = str(Path(__file__).resolve().parent.parent.parent)
    image = _image(project_root)
    vol_name = _volume_name()
    volume = modal.Volume.from_name(vol_name, create_if_missing=True)
    app = modal.App("fittrack-route-road-graph", image=image)
    download = app.function(volumes={"/osm": volume}, timeout=3600, memory=4096)(
        _download_osm_region
    )
    build = app.function(volumes={"/osm": volume}, timeout=3600, memory=16384)(
        _build_road_graph_modal
    )

    with app.run():
        if geofabrik_path:
            try:
                download.remote(region, geofabrik_path, vol_name, bbox)
            except Exception as e:
                logger.warning(f"OSM clipped download skipped ({e})")
        return build.remote(region, bbox, vol_name)
