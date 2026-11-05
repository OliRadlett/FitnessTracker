"""OSM surface tags survive the graph and become a surface profile."""

from app.services.road_graph import (
    RoadEdge,
    RoadGraph,
    edges_from_tuples,
    roads_from_geojson,
    snap_polyline,
)
from app.services.surface_types import clean_surface_type, surface_mix_to_profile


def test_pbf_tuples_convert_without_dropping_surface():
    # The Modal PBF path used to unpack six fields; the seventh (surface) broke
    # every match in production with "too many values to unpack".
    edges = edges_from_tuples(
        [
            (
                "10:1",
                "1",
                "2",
                [(51.5, -0.1), (51.5, -0.099)],
                "Way 10",
                "cycleway",
                "asphalt",
            )
        ]
    )

    assert len(edges) == 1
    assert edges[0].surface == "asphalt"
    assert edges[0].length_m > 0


def _feature(surface: str | None, coords: list[list[float]], way_id: int = 1):
    return {
        "type": "Feature",
        "properties": {"way_id": way_id, "name": f"Way {way_id}", "highway": "cycleway", "surface": surface},
        "geometry": {"type": "LineString", "coordinates": coords},
    }


def test_geojson_features_keep_the_surface_tag():
    edges = roads_from_geojson(
        {
            "type": "FeatureCollection",
            "features": [_feature("asphalt", [[-0.1, 51.5], [-0.099, 51.5]])],
        }
    )

    assert len(edges) == 1
    assert edges[0].surface == "asphalt"


def test_snap_polyline_reports_surface_by_matched_length():
    # Two collinear segments: 100 m asphalt then 100 m gravel (roughly).
    asphalt = RoadEdge(
        key="1:0", u="1:0", v="1:1", polyline=[(51.5, -0.1), (51.5, -0.099)],
        length_m=70.0, surface="asphalt",
    )
    gravel = RoadEdge(
        key="2:0", u="1:1", v="2:1", polyline=[(51.5, -0.099), (51.5, -0.098)],
        length_m=30.0, surface="gravel",
    )
    graph = RoadGraph([asphalt, gravel])

    match = snap_polyline([(51.5, -0.1), (51.5, -0.099), (51.5, -0.098)], graph)

    assert match.surface_mix == {"asphalt": 0.7, "gravel": 0.3}


def test_unknown_surface_is_reported_and_dropped_on_conversion():
    edge = RoadEdge(
        key="1:0", u="1:0", v="1:1", polyline=[(51.5, -0.1), (51.5, -0.099)],
        length_m=100.0, surface=None,
    )
    match = snap_polyline([(51.5, -0.1), (51.5, -0.099)], RoadGraph([edge]))

    assert match.surface_mix == {"unknown": 1.0}
    assert surface_mix_to_profile(match.surface_mix) is None


def test_surface_mix_maps_onto_the_app_vocabulary():
    assert surface_mix_to_profile({"asphalt": 60, "compacted": 40}) == {
        "paved": 0.6,
        "compacted_gravel": 0.4,
    }
    assert clean_surface_type("sb#asphalt") == "paved"
    assert clean_surface_type("wt#cycleway") is None


def test_osm_paving_names_collapse_onto_the_vocabulary():
    assert clean_surface_type("paving_stones") == "paved"
    assert clean_surface_type("brick") == "paved"
    assert clean_surface_type("flexipave") == "paved"
    assert clean_surface_type("stone") == "cobblestone"
    assert clean_surface_type("unhewn_cobblestone") == "cobblestone"
    # Unknown-but-real names survive rather than being mislabelled.
    assert clean_surface_type("wood") == "wood"
