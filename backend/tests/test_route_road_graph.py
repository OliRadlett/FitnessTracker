"""Regression tests for the OSM bootstrap URL/path helpers.

The deployment bug: ``bootstrap_osm_region_on_modal`` passed the *destination
filename* as the Geofabrik path, producing
``…/great-britain-latest.osm.pbf-latest.osm.pbf`` (502). These helpers keep the
two concepts separate.
"""

from app.integrations.route_road_graph import _dest_path, _geofabrik_url


def test_geofabrik_url_uses_the_path_slug():
    assert (
        _geofabrik_url("europe/united-kingdom")
        == "https://download.geofabrik.de/europe/united-kingdom-latest.osm.pbf"
    )


def test_default_geofabrik_path_is_nested_under_europe():
    # A top-level `great-britain` returns a 9 KB HTML error page; the real
    # extract lives under `europe/`.
    from app.integrations.route_road_graph import _DEFAULT_GEOFABRIK_PATH

    assert _DEFAULT_GEOFABRIK_PATH.startswith("europe/")


def test_geofabrik_url_strips_surrounding_slashes():
    assert (
        _geofabrik_url("/europe/united-kingdom/")
        == "https://download.geofabrik.de/europe/united-kingdom-latest.osm.pbf"
    )


def test_dest_path_is_region_keyed():
    assert _dest_path("great-britain") == "/osm/great-britain-latest.osm.pbf"
    assert _dest_path("great-britain", "/osm/") == "/osm/great-britain-latest.osm.pbf"


def test_pbf_is_preferred_over_geojson(tmp_path):
    """The bbox-filtered PBF parse must win over the whole-GeoJSON path.

    Loading the whole GeoJSON into memory is what made the Modal worker time
    out — the PBF path filters by bbox at parse time, so it is preferred.
    """
    import json
    import os

    from app.integrations import route_road_graph as mod

    region = "unit-test"
    with open(os.path.join(tmp_path, f"{region}-roads.geojson"), "w") as fh:
        json.dump({"type": "FeatureCollection", "features": []}, fh)
    # A PBF path that must be chosen; stub the parser to prove it is used.
    with open(os.path.join(tmp_path, f"{region}-roads.osm.pbf"), "wb") as fh:
        fh.write(b"not-a-real-pbf")

    calls = {"n": 0}

    def _stub(_pbf, bbox):
        calls["n"] += 1
        return [("w1:0", "w1:0", "w1:1", [(55.0, -1.0), (55.0, -0.998)], "Test St", "residential")]

    original = mod._build_edges_from_pbf
    mod._build_edges_from_pbf = _stub
    try:
        result = mod._match_routes_road_modal(
            json.dumps([{"id": "r1", "polyline": [[55.0, -1.0], [55.0, -0.998]]}]),
            region,
            40.0,
            60.0,
            osm_dir=str(tmp_path),
        )
    finally:
        mod._build_edges_from_pbf = original

    assert calls["n"] == 1
    assert result["r1"]["coverage"] > 0.9
    assert result["r1"]["edge_set"]


def test_bbox_arg_parsing_rejects_malformed():
    import pytest

    from app.scripts.osm_bootstrap import _bbox_from_arg

    with pytest.raises(SystemExit):
        _bbox_from_arg("1,2,3")

    assert _bbox_from_arg("1,2,3,4") == (1.0, 2.0, 3.0, 4.0)


def test_two_pass_pbf_parse_only_resolves_wanted_nodes(monkeypatch):
    """The two-pass parse must not build a global location index.

    Pass 1 collects highway-way node refs; pass 2 resolves coordinates for those
    ids only. Out-of-bbox coordinates are dropped when assembling edges.
    """
    import sys
    import types

    # Fake osmium: a SimpleHandler whose apply_file dispatches by handler type.
    way_calls = {"n": 0}
    node_calls = {"n": 0}

    class _FakeSimpleHandler:
        def apply_file(self, _path, locations=False, idx=None):
            # A subclass defines either `way` or `node`.
            if type(self).__name__ == "_WayCollector":
                way_calls["n"] += 1
                # Two highways: one in-bbox, one far away; plus a non-highway.
                w = types.SimpleNamespace(
                    id=10, tags={"highway": "residential", "name": "In Box"}
                )
                w.nodes = [
                    types.SimpleNamespace(ref=1),
                    types.SimpleNamespace(ref=2),
                ]
                self.way(w)
                far = types.SimpleNamespace(
                    id=11, tags={"highway": "residential", "name": "Far"}
                )
                far.nodes = [
                    types.SimpleNamespace(ref=3),
                    types.SimpleNamespace(ref=4),
                ]
                self.way(far)
                skip = types.SimpleNamespace(id=12, tags={"building": "yes"})
                skip.nodes = [types.SimpleNamespace(ref=5)]
                self.way(skip)
            elif type(self).__name__ == "_NodeCollector":
                node_calls["n"] += 1
                coords = {
                    1: (55.0, -1.0),
                    2: (55.0, -0.99),
                    3: (80.0, 10.0),  # far outside any bbox
                    4: (80.0, 10.01),
                    5: (55.0, -1.0),  # referenced only by the non-highway way
                }
                for nid, (lat, lng) in coords.items():
                    loc = types.SimpleNamespace(lat=lat, lon=lng)
                    self.node(types.SimpleNamespace(id=nid, location=loc))

    fake_osmium = types.ModuleType("osmium")
    fake_osmium.SimpleHandler = _FakeSimpleHandler
    monkeypatch.setitem(sys.modules, "osmium", fake_osmium)

    from app.integrations.route_road_graph import _build_edges_from_pbf

    # bbox around the in-box way only.
    edges = _build_edges_from_pbf("ignored.pbf", (54.0, -2.0, 56.0, 0.0))

    assert way_calls["n"] == 1 and node_calls["n"] == 1
    # Only way 10 produced an edge (way 11 is out of bbox, way 12 not a highway).
    assert [e[0] for e in edges] == ["10:1"]
    assert edges[0][4] == "In Box"


def test_pbf_edges_carry_osm_node_ids_for_continuity(monkeypatch):
    """Edge u/v must be OSM node ids so _shares_node fires across ways.

    Two ways sharing node 2 must produce edges whose endpoints match —
    per-way sequence numbers (``way_id:idx``) never match across ways, so
    the snap continuity filter silently never fired at intersections.
    Edge ``key`` stays way-scoped so edge_set/Jaccard keys are unchanged.
    """
    import sys
    import types

    class _FakeSimpleHandler:
        def apply_file(self, _path, locations=False, idx=None):
            if type(self).__name__ == "_WayCollector":
                for wid, refs in ((10, [1, 2]), (11, [2, 3])):
                    w = types.SimpleNamespace(
                        id=wid,
                        tags={"highway": "residential", "name": f"Way {wid}"},
                    )
                    w.nodes = [types.SimpleNamespace(ref=r) for r in refs]
                    self.way(w)
            elif type(self).__name__ == "_NodeCollector":
                for nid, (lat, lng) in {
                    1: (55.0, -1.0),
                    2: (55.0, -0.99),
                    3: (55.0, -0.98),
                }.items():
                    loc = types.SimpleNamespace(lat=lat, lon=lng)
                    self.node(types.SimpleNamespace(id=nid, location=loc))

    fake_osmium = types.ModuleType("osmium")
    fake_osmium.SimpleHandler = _FakeSimpleHandler
    monkeypatch.setitem(sys.modules, "osmium", fake_osmium)

    from app.integrations.route_road_graph import _build_edges_from_pbf
    from app.services.road_graph import RoadEdge, _shares_node

    edges = _build_edges_from_pbf("ignored.pbf", (54.0, -2.0, 56.0, 0.0))

    assert [(e[0], e[1], e[2]) for e in edges] == [
        ("10:1", "1", "2"),
        ("11:1", "2", "3"),
    ]
    built = [
        RoadEdge(key=k, u=u, v=v, polyline=pts, length_m=100.0)
        for k, u, v, pts, _nm, _hw in edges
    ]
    assert _shares_node(built[0], built[1])


