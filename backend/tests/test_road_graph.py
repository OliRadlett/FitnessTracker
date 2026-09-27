"""Unit tests for the pure road-graph map-matching engine (no DB, no OSM)."""

import math

from app.services.road_graph import (
    RoadEdge,
    RoadGraph,
    edge_jaccard,
    snap_polyline,
)

_LAT0 = 55.0
_COS = math.cos(math.radians(_LAT0))
_EDGE_DEG = 100.0 / (111_320.0 * _COS)  # 100 m in longitude


def _row(row_idx: int, lat: float, n_edges: int, name: str = "Test Road") -> list[RoadEdge]:
    edges = []
    for i in range(n_edges):
        a = (lat, i * _EDGE_DEG)
        b = (lat, (i + 1) * _EDGE_DEG)
        edges.append(
            RoadEdge(
                key=f"r{row_idx}_{i}",
                u=f"r{row_idx}_{i}",
                v=f"r{row_idx}_{i + 1}",
                polyline=[a, b],
                length_m=100.0,
                name=name,
                highway="residential",
            )
        )
    return edges


def _route_along_row(lat: float, start_edge: float, end_edge: float, step: float = 20.0):
    """Points along row ``lat`` from x=start_edge*100m to x=end_edge*100m."""
    pts = []
    x = start_edge * _EDGE_DEG
    stop = end_edge * _EDGE_DEG
    while x <= stop + 1e-12:
        pts.append((lat, x))
        x += step / (111_320.0 * _COS)
    return pts


def _graph_two_rows() -> RoadGraph:
    edges = _row(0, _LAT0, 10) + _row(1, _LAT0 + 500.0 / 110_540.0, 10)
    return RoadGraph(edges, index_cell_m=40.0)


# ── Snapping ─────────────────────────────────────────────────────────────────


def test_snap_identical_route_full_coverage_and_edges():
    graph = _graph_two_rows()
    route = _route_along_row(_LAT0, 0, 8)
    match = snap_polyline(route, graph)
    assert match.coverage > 0.99
    assert match.edge_set == [f"r0_{i}" for i in range(8)]


def test_snap_picks_correct_parallel_road():
    graph = _graph_two_rows()
    route = _route_along_row(_LAT0 + 500.0 / 110_540.0, 0, 8)
    match = snap_polyline(route, graph)
    assert all(k.startswith("r1_") for k in match.edge_set)


def test_route_far_from_graph_has_zero_coverage():
    graph = _graph_two_rows()
    far = [(x, _LAT0 + 1.0) for x, _ in _route_along_row(_LAT0, 0, 8)]
    match = snap_polyline(far, graph)
    assert match.coverage == 0.0
    assert match.edge_set == []


# ── Comparison semantics ─────────────────────────────────────────────────────


def test_same_road_jaccard_is_one():
    graph = _graph_two_rows()
    route = _route_along_row(_LAT0, 0, 8)
    a = snap_polyline(route, graph)
    b = snap_polyline(route, graph)
    assert edge_jaccard(a.edge_set, b.edge_set) == 1.0


def test_parallel_roads_have_near_zero_jaccard():
    graph = _graph_two_rows()
    a = snap_polyline(_route_along_row(_LAT0, 0, 8), graph)
    b = snap_polyline(_route_along_row(_LAT0 + 500.0 / 110_540.0, 0, 8), graph)
    assert edge_jaccard(a.edge_set, b.edge_set) == 0.0


def test_sub_section_has_low_jaccard():
    graph = _graph_two_rows()
    long_route = snap_polyline(_route_along_row(_LAT0, 0, 10), graph)
    short_route = snap_polyline(_route_along_row(_LAT0, 0, 3), graph)
    j = edge_jaccard(long_route.edge_set, short_route.edge_set)
    assert 0.2 < j < 0.5


def test_laps_share_the_same_edge_set():
    graph = _graph_two_rows()
    base = _route_along_row(_LAT0, 0, 5)
    three = base + base[1:] + base[1:]
    five = base + base[1:] + base[1:] + base[1:] + base[1:]
    a = snap_polyline(three, graph)
    b = snap_polyline(five, graph)
    assert edge_jaccard(a.edge_set, b.edge_set) > 0.95


def test_detour_keeps_high_jaccard():
    graph = _graph_two_rows()
    base = snap_polyline(_route_along_row(_LAT0, 0, 10), graph)
    # A short detour onto the parallel road mid-route.
    detour = (
        _route_along_row(_LAT0, 0, 4)
        + _route_along_row(_LAT0 + 500.0 / 110_540.0, 4, 5)
        + _route_along_row(_LAT0, 5, 10)
    )
    variant = snap_polyline(detour, graph)
    assert edge_jaccard(base.edge_set, variant.edge_set) > 0.7


def test_jaccard_empty_is_zero():
    assert edge_jaccard([], ["a"]) == 0.0


def test_roads_from_geojson_roundtrip_and_snapping():
    from app.services.road_graph import roads_from_geojson

    coords = [[i * _EDGE_DEG / 10, _LAT0] for i in range(11)]  # lng, lat
    gj = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"way_id": 42, "name": "High Street", "highway": "residential"},
                "geometry": {"type": "LineString", "coordinates": coords},
            }
        ],
    }
    edges = roads_from_geojson(gj)
    assert len(edges) == 10
    assert edges[0].key == "42:0"
    assert edges[0].name == "High Street"

    graph = RoadGraph(edges)
    route = _route_along_row(_LAT0, 0, 1)
    match = snap_polyline(route, graph)
    assert match.coverage > 0.99
    assert match.names == ["High Street"]

