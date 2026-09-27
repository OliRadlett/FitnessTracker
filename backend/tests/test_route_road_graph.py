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


def test_cached_geojson_is_preferred_over_pbf(tmp_path):
    """When {region}-roads.geojson exists the matcher must not parse the PBF."""
    import json
    import os

    from app.integrations import route_road_graph as mod

    region = "unit-test"
    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"way_id": 1, "name": "Test St", "highway": "residential"},
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-1.0, 55.0], [-0.999, 55.0], [-0.998, 55.0]],
                },
            }
        ],
    }
    with open(os.path.join(tmp_path, f"{region}-roads.geojson"), "w") as fh:
        json.dump(geojson, fh)
    # A PBF path that would be parsed if the GeoJSON were not preferred.
    with open(os.path.join(tmp_path, f"{region}-latest.osm.pbf"), "wb") as fh:
        fh.write(b"not-a-real-pbf")

    calls = {"n": 0}

    def _boom(*_a, **_k):
        calls["n"] += 1
        raise AssertionError("PBF parse must not run when GeoJSON exists")

    original = mod._build_edges_from_pbf
    mod._build_edges_from_pbf = _boom
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

    assert calls["n"] == 0
    assert result["r1"]["coverage"] > 0.9
    assert result["r1"]["edge_set"]


def test_bbox_arg_parsing_rejects_malformed():
    import pytest

    from app.scripts.osm_bootstrap import _bbox_from_arg

    with pytest.raises(SystemExit):
        _bbox_from_arg("1,2,3")

    assert _bbox_from_arg("1,2,3,4") == (1.0, 2.0, 3.0, 4.0)

