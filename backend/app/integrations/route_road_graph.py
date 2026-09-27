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
    ``(key, u, v, [(lat, lng), ...], name, highway)``. Uses pyosmium's location
    index so way node refs resolve to coordinates.
    """
    import osmium

    min_lat, min_lng, max_lat, max_lng = bbox
    out: list[tuple] = []

    class _Handler(osmium.SimpleHandler):
        def way(self, w):
            highway = w.tags.get("highway")
            if not highway:
                return
            name = w.tags.get("name")
            way_id = w.id
            prev = None
            idx = 0
            for node in w.nodes:
                loc = node.location
                if not loc.valid():
                    prev = None
                    continue
                pt = (loc.lat, loc.lon)
                if not (min_lat <= pt[0] <= max_lat and min_lng <= pt[1] <= max_lng):
                    prev = None
                    continue
                if prev is not None:
                    idx += 1
                    out.append(
                        (
                            f"{way_id}:{idx}",
                            f"{way_id}:{idx - 1}",
                            f"{way_id}:{idx}",
                            [prev, pt],
                            name,
                            highway,
                        )
                    )
                prev = pt

    index = osmium.index.create_map("flex_mem")
    locations = osmium.NodeLocationsForWays(index)
    locations.ignore_errors()
    locations.apply_file(pbf_path)
    handler = _Handler()
    handler.apply_file(pbf_path, locations=True)
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
    from road_graph import RoadEdge, RoadGraph, snap_polyline  # type: ignore

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
    geojson_path = os.path.join(osm_dir, f"{region}-roads.geojson")
    pbf_path = os.path.join(osm_dir, f"{region}-latest.osm.pbf")

    if os.path.exists(geojson_path):
        with open(geojson_path) as fh:
            gj = _json.load(fh)
        from road_graph import roads_from_geojson  # type: ignore

        edges = roads_from_geojson(gj)
    elif os.path.exists(pbf_path):
        raw = _build_edges_from_pbf(pbf_path, bbox)
        edges = [
            RoadEdge(
                key=k,
                u=u,
                v=v,
                polyline=pts,
                length_m=sum(
                    math.dist(pts[i - 1], pts[i]) for i in range(1, len(pts))
                ),
                name=nm,
                highway=hw,
            )
            for (k, u, v, pts, nm, hw) in raw
        ]
    else:
        return {}

    graph = RoadGraph(edges)
    graph.build_index()

    result: dict = {}
    for r in routes:
        pts = [tuple(p) for p in r["polyline"]]
        if len(pts) < 2:
            continue
        match = snap_polyline(
            pts, graph, search_radius_m=search_radius_m, max_snap_m=max_snap_m
        )
        result[r["id"]] = match.to_dict()
    return result


def _download_osm_region(region: str, geofabrik_path: str, osm_dir: str = "/osm") -> str:
    """Download a Geofabrik extract into the mounted Volume (one-off bootstrap).

    ``geofabrik_path`` is the Geofabrik slug (e.g. ``europe/united-kingdom``); the
    file is stored as ``{region}-latest.osm.pbf`` so the matcher can find it by
    the logical region key. Raises a plain ``RuntimeError`` (picklable across the
    Modal boundary) rather than httpx's ``HTTPStatusError``.
    """
    import os

    import httpx

    os.makedirs(osm_dir, exist_ok=True)
    dest = _dest_path(region, osm_dir)
    url = _geofabrik_url(geofabrik_path)
    with httpx.stream("GET", url, follow_redirects=True, timeout=600) as resp:
        if resp.status_code != 200:
            raise RuntimeError(
                f"OSM download failed: HTTP {resp.status_code} for {url}"
            )
        with open(dest, "wb") as fh:
            fh.writelines(resp.iter_bytes(1 << 20))
    return dest


# ── Public API (called from Celery tasks / scripts) ──────────────────────────


def _image(project_root: str):
    import modal

    rm_path = f"{project_root}/app/services/road_graph.py"
    return (
        modal.Image.debian_slim(python_version="3.12")
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
    remote = app.function(volumes={"/osm": volume}, timeout=900, memory=8192)(
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
    volume = modal.Volume.from_name(_volume_name(), create_if_missing=True)
    app = modal.App("fittrack-route-road-graph", image=image)
    remote = app.function(volumes={"/osm": volume}, timeout=3600, memory=4096)(
        _download_osm_region
    )
    with app.run():
        return remote.remote(region, geofabrik_path)
