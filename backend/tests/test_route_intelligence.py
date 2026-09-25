"""Tests for route terrain classification (RMI-04 and live behavior).

Pure (no DB) — exercises ``_classify_terrain`` / ``classify_route_terrain``
in ``app/integrations/route_intelligence.py`` and the Komoot profile builder
in ``app/services/polyline_utils.py`` directly.

RMI-04: Komoot wrote elevation-only ``{"elevations": [...]}`` profiles that
the classifier could never read (permanent "unknown"). New syncs write the
canonical {"distance", "elevation"} shape; legacy rows align onto the route
polyline when supplied.
"""

import pytest

from app.integrations.route_intelligence import (
    _classify_terrain,
    _normalize_elevation_profile,
    classify_route_terrain,
)
from app.services.polyline_utils import (
    extract_elevation_profile_from_komoot_trackpoints,
)


def _climb_profile():
    # 2 km steady climb at ~8%.
    return {
        "distance": [0, 500, 1000, 1500, 2000],
        "elevation": [100, 140, 180, 220, 260],
    }


def test_canonical_profile_classifies():
    result = _classify_terrain(_climb_profile())
    assert result["terrain_type"] in ("hilly", "mountainous", "rolling", "mixed")
    assert result["terrain_type"] != "unknown"
    assert result["total_climb_m"] == pytest.approx(160.0)
    assert result["climb_count"] >= 1


def test_empty_profile_is_unknown():
    assert _classify_terrain(None)["terrain_type"] == "unknown"
    assert _classify_terrain({})["terrain_type"] == "unknown"
    assert _classify_terrain({"distance": [0], "elevation": [5]})["terrain_type"] == "unknown"


def test_legacy_elevations_shape_needs_polyline():
    legacy = {"elevations": [100, 140, 180, 220, 260]}
    assert _classify_terrain(legacy)["terrain_type"] == "unknown"
    polyline = [(51.0 + i * 0.0045, -0.1) for i in range(5)]
    result = _classify_terrain(legacy, polyline)
    assert result["terrain_type"] != "unknown"
    assert result["total_climb_m"] == pytest.approx(160.0, abs=5.0)


def test_legacy_elevations_interpolated_on_length_mismatch():
    legacy = {"elevations": [100, 260]}  # endpoints only
    polyline = [(51.0 + i * 0.0045, -0.1) for i in range(5)]
    result = _classify_terrain(legacy, polyline)
    assert result["terrain_type"] != "unknown"
    assert result["total_climb_m"] == pytest.approx(160.0, abs=5.0)


def test_none_elevations_tolerated():
    profile = {
        "distance": [0, 500, 1000, 1500, 2000],
        "elevation": [100, None, 180, 220, 260],
    }
    result = _classify_terrain(profile)
    assert result["terrain_type"] != "unknown"


def test_all_none_elevations_is_unknown():
    profile = {"distance": [0, 500, 1000], "elevation": [None, None, None]}
    assert _classify_terrain(profile)["terrain_type"] == "unknown"


def test_classify_route_terrain_passthrough():
    assert classify_route_terrain(None)["terrain_type"] == "unknown"
    assert classify_route_terrain(_climb_profile())["climb_count"] >= 1


def test_normalize_rejects_garbage():
    assert _normalize_elevation_profile({"foo": 1}) is None
    assert _normalize_elevation_profile({"distance": [0], "elevation": [1]}) is None


# ── Komoot profile builder ─────────────────────────────────────────────


def _trackpoints(n=5, alt=100.0, step_alt=40.0):
    return [
        {"lat": 51.0 + i * 0.0045, "lng": -0.1, "alt": alt + i * step_alt}
        for i in range(n)
    ]


def test_komoot_builder_canonical_shape():
    profile = extract_elevation_profile_from_komoot_trackpoints(_trackpoints())
    assert set(profile) == {"distance", "elevation"}
    assert profile["distance"][0] == 0.0
    assert len(profile["distance"]) == len(profile["elevation"]) == 5
    assert profile["elevation"][-1] == pytest.approx(260.0)
    # ~500 m per 0.0045° latitude step
    assert profile["distance"][-1] == pytest.approx(2000.0, rel=0.05)


def test_komoot_builder_skips_incomplete_points():
    tps = _trackpoints(n=5)
    tps[2] = {"lat": None, "lng": None, "alt": None}
    tps[3] = {"lat": 51.0 + 3 * 0.0045, "lng": -0.1}  # no alt
    profile = extract_elevation_profile_from_komoot_trackpoints(tps)
    assert len(profile["distance"]) == 3
    assert len(profile["elevation"]) == 3


def test_komoot_builder_insufficient_data():
    assert extract_elevation_profile_from_komoot_trackpoints([]) is None
    assert extract_elevation_profile_from_komoot_trackpoints(
        [{"lat": 51.0, "lng": -0.1, "alt": 5.0}]
    ) is None
    # Alternate key spellings
    profile = extract_elevation_profile_from_komoot_trackpoints(
        [
            {"latitude": 51.0, "longitude": -0.1, "elevation": 10.0},
            {"latitude": 51.0045, "longitude": -0.1, "elevation": 50.0},
        ]
    )
    assert profile is not None
    assert profile["elevation"] == [10.0, 50.0]


def test_komoot_profile_classifies_end_to_end():
    profile = extract_elevation_profile_from_komoot_trackpoints(_trackpoints())
    result = _classify_terrain(profile)
    assert result["terrain_type"] != "unknown"
    assert result["climb_count"] >= 1
