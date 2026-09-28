"""Road-graph map-matching — pure geometric snapping of a route polyline onto
an OSM road graph (Phase 2).

Stdlib only at module scope (no numpy, no ``app.*`` imports) so the module can
be imported inside the bare Modal container (AGENTS pitfalls #33/#34). The graph
itself is built from OSM data by ``app.integrations.route_road_graph`` (pyosmium)
and handed here as a list of :class:`RoadEdge`.

The matcher deliberately records the **set** of road edges a route traverses,
not a navigation-grade ordered HMM path: for route *matching*, the edge set is
direction/lap/detour robust and immune to GPS re-snapping, and the Phase-1
geometric engine already covers order and direction.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field

_M_PER_DEG_LAT = 110_540.0
_M_PER_DEG_LNG = 111_320.0


# ── Geometry helpers ─────────────────────────────────────────────────────────


def haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in metres."""
    r = 6_371_000.0
    lat1_r, lng1_r = math.radians(lat1), math.radians(lng1)
    lat2_r, lng2_r = math.radians(lat2), math.radians(lng2)
    dlat = lat2_r - lat1_r
    dlng = lng2_r - lng1_r
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlng / 2) ** 2
    )
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _point_segment_distance_m(
    p: tuple[float, float],
    a: tuple[float, float],
    b: tuple[float, float],
) -> float:
    """Perpendicular distance from point ``p`` to segment ``a``-``b`` (metres)."""
    kx = _M_PER_DEG_LNG * math.cos(math.radians(a[0]))
    ky = _M_PER_DEG_LAT
    dx = (b[1] - a[1]) * kx
    dy = (b[0] - a[0]) * ky
    px = (p[1] - a[1]) * kx
    py = (p[0] - a[0]) * ky
    seg2 = dx * dx + dy * dy
    if seg2 == 0.0:
        return math.hypot(px, py)
    t = max(0.0, min(1.0, (px * dx + py * dy) / seg2))
    return math.hypot(px - t * dx, py - t * dy)


def _point_polyline_distance_m(
    p: tuple[float, float], polyline: list[tuple[float, float]]
) -> float:
    if len(polyline) == 1:
        return haversine_distance(p[0], p[1], polyline[0][0], polyline[0][1])
    best = float("inf")
    for i in range(1, len(polyline)):
        d = _point_segment_distance_m(p, polyline[i - 1], polyline[i])
        best = min(best, d)
    return best


def _densify(
    points: list[tuple[float, float]], max_segment_m: float
) -> list[tuple[float, float]]:
    if len(points) < 2 or max_segment_m <= 0:
        return list(points)
    out = [points[0]]
    for i in range(1, len(points)):
        a, b = points[i - 1], points[i]
        d = haversine_distance(a[0], a[1], b[0], b[1])
        if d <= max_segment_m:
            out.append(b)
            continue
        steps = int(d // max_segment_m) + 1
        for k in range(1, steps + 1):
            f = k / steps
            out.append((a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])))
    return out


# ── Graph model ──────────────────────────────────────────────────────────────


@dataclass
class RoadEdge:
    """One routable road segment (usually one OSM node pair within a way)."""

    key: str
    u: str
    v: str
    polyline: list[tuple[float, float]]
    length_m: float
    name: str | None = None
    highway: str | None = None


@dataclass
class RoadMatch:
    edges: list[str] = field(default_factory=list)  # ordered, consecutive-deduped
    edge_set: list[str] = field(default_factory=list)  # sorted unique
    coverage: float = 0.0  # snapped points / total points
    names: list[str] = field(default_factory=list)
    snapped_points: int = 0
    total_points: int = 0

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> RoadMatch:
        return cls(
            edges=list(data.get("edges", [])),
            edge_set=list(data.get("edge_set", [])),
            coverage=float(data.get("coverage", 0.0)),
            names=list(data.get("names", [])),
            snapped_points=int(data.get("snapped_points", 0)),
            total_points=int(data.get("total_points", 0)),
        )


class RoadGraph:
    """A spatial index over :class:`RoadEdge` rows for nearest-edge queries."""

    def __init__(
        self,
        edges: list[RoadEdge] | None = None,
        index_cell_m: float = 40.0,
        index_segment_m: float = 25.0,
    ) -> None:
        self.edges: list[RoadEdge] = list(edges or [])
        self._cell_deg = max(index_cell_m / _M_PER_DEG_LAT, 1e-6)
        self._index_segment_m = index_segment_m
        self._grid: dict[tuple[int, int], list[int]] = {}
        self._built = False

    def _cell(self, lat: float, lng: float) -> tuple[int, int]:
        return int(math.floor(lat / self._cell_deg)), int(math.floor(lng / self._cell_deg))

    def build_index(self) -> None:
        self._grid = {}
        for idx, edge in enumerate(self.edges):
            for pt in _densify(edge.polyline, self._index_segment_m):
                self._grid.setdefault(self._cell(pt[0], pt[1]), []).append(idx)
        self._built = True

    def nearest_edges(
        self,
        point: tuple[float, float],
        radius_m: float,
        max_candidates: int = 8,
    ) -> list[tuple[int, float]]:
        """Edges within ``radius_m`` of ``point``, nearest first (max N)."""
        if not self._built:
            self.build_index()
        rings = max(1, int(math.ceil(radius_m / (self._cell_deg * _M_PER_DEG_LAT))))
        cy, cx = self._cell(point[0], point[1])
        seen: set[int] = set()
        hits: list[tuple[int, float]] = []
        for dy in range(-rings, rings + 1):
            for dx in range(-rings, rings + 1):
                for idx in self._grid.get((cy + dy, cx + dx), ()):
                    if idx in seen:
                        continue
                    seen.add(idx)
                    d = _point_polyline_distance_m(point, self.edges[idx].polyline)
                    if d <= radius_m:
                        hits.append((idx, d))
        hits.sort(key=lambda x: x[1])
        return hits[:max_candidates]


# ── Snapping ─────────────────────────────────────────────────────────────────


def _shares_node(a: RoadEdge, b: RoadEdge) -> bool:
    return a.u == b.u or a.u == b.v or a.v == b.u or a.v == b.v


def snap_polyline(
    points: list[tuple[float, float]],
    graph: RoadGraph,
    *,
    search_radius_m: float = 40.0,
    max_snap_m: float = 60.0,
    min_move_m: float = 3.0,
) -> RoadMatch:
    """Snap each route point to a road edge, preferring continuity.

    Per point the nearest candidate edge within ``search_radius_m`` that shares
    a node with the previously chosen edge is preferred (light continuity
    filter); otherwise the nearest candidate within ``max_snap_m`` wins. Returns
    the ordered edge list, the unique edge set, coverage and road names.
    """
    if len(points) < 2:
        return RoadMatch(total_points=len(points))

    # Drop stationary jitter points.
    filtered = [points[0]]
    for p in points[1:]:
        if haversine_distance(filtered[-1][0], filtered[-1][1], p[0], p[1]) >= min_move_m:
            filtered.append(p)

    # The index is built lazily by ``nearest_edges`` (guarded on ``_built``), so
    # it is built once per graph and reused across every route — building it
    # eagerly here rebuilt it per call (113 routes × ~12 s ≈ 23 min wasted on a
    # 3.2 M-edge graph).
    ordered: list[int] = []
    snapped = 0
    prev_idx: int | None = None

    for p in filtered:
        candidates = graph.nearest_edges(p, search_radius_m)
        chosen: int | None = None
        if candidates:
            nearest_idx, nearest_d = candidates[0]
            if nearest_d <= max_snap_m:
                chosen = nearest_idx
            if prev_idx is not None:
                prev_edge = graph.edges[prev_idx]
                for idx, d in candidates:
                    if d > max_snap_m:
                        continue
                    if _shares_node(prev_edge, graph.edges[idx]):
                        chosen = idx
                        break
        if chosen is None:
            continue
        snapped += 1
        if not ordered or ordered[-1] != chosen:
            ordered.append(chosen)
        prev_idx = chosen

    edge_keys = [graph.edges[i].key for i in ordered]
    names: list[str] = []
    for i in ordered:
        nm = graph.edges[i].name
        if nm and (not names or names[-1] != nm) and nm not in names:
            names.append(nm)

    return RoadMatch(
        edges=edge_keys,
        edge_set=sorted(set(edge_keys)),
        coverage=round(snapped / len(filtered), 4) if filtered else 0.0,
        names=names,
        snapped_points=snapped,
        total_points=len(filtered),
    )


# ── Comparison ───────────────────────────────────────────────────────────────


def edge_jaccard(a_edges: list[str], b_edges: list[str]) -> float:
    """Jaccard similarity of two edge sets (0.0–1.0)."""
    if not a_edges or not b_edges:
        return 0.0
    a = set(a_edges)
    b = set(b_edges)
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


def _iter_geojson_features(
    path: str, bbox: tuple[float, float, float, float] | None = None
):
    """Stream ``LineString`` features from a GeoJSON file, optionally bbox-filtered.

    Parsing the whole file into memory at once (``json.load``) is what made the
    604 MB UK cache unusable in the Modal worker (3.2 M objects → 1800 s
    timeout). This streams feature-by-feature and skips any feature whose bbox
    does not intersect ``bbox`` = ``(min_lat, min_lng, max_lat, max_lng)``.
    """
    import json

    with open(path) as fh:
        # Advance to the features array without materialising the whole document.
        buf = ""
        while '"features"' not in buf and len(buf) < 4096:
            chunk = fh.read(4096)
            if not chunk:
                return
            buf += chunk
        start = buf.find("[")
        if start == -1:
            return
        tail = buf[start + 1 :]

        # Feed the remaining document through a raw decoder.
        decoder = json.JSONDecoder()
        stream = tail + fh.read()

    pos = 0
    n = len(stream)
    while pos < n:
        # Skip whitespace/commas.
        while pos < n and stream[pos] in " \t\r\n,":
            pos += 1
        if pos >= n or stream[pos] == "]":
            return
        try:
            feature, end = decoder.raw_decode(stream, pos)
        except JSONDecodeError:
            return
        pos = end
        geom = (feature or {}).get("geometry") or {}
        if geom.get("type") != "LineString":
            continue
        coords = geom.get("coordinates") or []
        if len(coords) < 2:
            continue
        if bbox is not None:
            min_lat, min_lng, max_lat, max_lng = bbox
            f_lat = (coords[0][1] + coords[-1][1]) / 2.0
            f_lng = (coords[0][0] + coords[-1][0]) / 2.0
            if not (
                min_lat <= f_lat <= max_lat and min_lng <= f_lng <= max_lng
            ):
                continue
        yield feature


def roads_from_geojson(
    feature_collection: dict | str | None = None,
    *,
    path: str | None = None,
    bbox: tuple[float, float, float, float] | None = None,
) -> list[RoadEdge]:
    """Build :class:`RoadEdge` rows from a GeoJSON ``FeatureCollection``.

    Accepts an in-memory ``feature_collection`` **or** a file ``path`` (streamed,
    recommended for large caches). ``bbox`` = ``(min_lat, min_lng, max_lat,
    max_lng)`` keeps only features whose midpoint falls inside it. Accepts
    ``LineString`` features (OSM-exported or Overpass ``out geom``), splitting
    each into per-node-pair edges so only traversed segments count. Properties
    read: ``way_id``/``id``/``@id``, ``name``, ``highway``.
    """
    if path is not None:
        source = _iter_geojson_features(path, bbox)
    else:
        source = _iter_features_from_dict(feature_collection, bbox)

    edges: list[RoadEdge] = []
    for feature in source:
        geom = feature.get("geometry") or {}
        coords = geom.get("coordinates") or []
        props = feature.get("properties") or {}
        way_id = str(
            props.get("way_id") or props.get("id") or props.get("@id") or len(edges)
        )
        name = props.get("name")
        highway = props.get("highway")
        for i in range(1, len(coords)):
            lng0, lat0 = coords[i - 1][0], coords[i - 1][1]
            lng1, lat1 = coords[i][0], coords[i][1]
            a = (float(lat0), float(lng0))
            b = (float(lat1), float(lng1))
            edges.append(
                RoadEdge(
                    key=f"{way_id}:{i - 1}",
                    u=f"{way_id}:{i - 1}",
                    v=f"{way_id}:{i}",
                    polyline=[a, b],
                    length_m=haversine_distance(a[0], a[1], b[0], b[1]),
                    name=name,
                    highway=highway,
                )
            )
    return edges


def _iter_features_from_dict(
    feature_collection: dict | None,
    bbox: tuple[float, float, float, float] | None = None,
):
    if not feature_collection:
        return
    for feature in feature_collection.get("features", []):
        geom = (feature or {}).get("geometry") or {}
        if geom.get("type") != "LineString":
            continue
        coords = geom.get("coordinates") or []
        if len(coords) < 2:
            continue
        if bbox is not None:
            min_lat, min_lng, max_lat, max_lng = bbox
            f_lat = (coords[0][1] + coords[-1][1]) / 2.0
            f_lng = (coords[0][0] + coords[-1][0]) / 2.0
            if not (min_lat <= f_lat <= max_lat and min_lng <= f_lng <= max_lng):
                continue
        yield feature
