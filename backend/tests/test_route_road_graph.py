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


def test_geofabrik_url_strips_surrounding_slashes():
    assert (
        _geofabrik_url("/europe/united-kingdom/")
        == "https://download.geofabrik.de/europe/united-kingdom-latest.osm.pbf"
    )


def test_dest_path_is_region_keyed():
    assert _dest_path("great-britain") == "/osm/great-britain-latest.osm.pbf"
    assert _dest_path("great-britain", "/osm/") == "/osm/great-britain-latest.osm.pbf"
