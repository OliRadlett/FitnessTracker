"""Tests for route-intelligence fixes (audit issues H + I).

Pure (no DB) — exercises ``app/integrations/route_intelligence.py`` directly.

H: whole-route duration must be predicted from neighbor *pace* scaled to the
   route distance — never by averaging climb-segment elapsed times (a 2 km
   climb's 600 s says nothing about an 80 km route's duration).
I: ``_compute_frechet_distance`` iterated ``range(a)`` over a list
   (TypeError); identical polylines must score 1.0.
"""

import pytest

from app.integrations.route_intelligence import (
    _compute_frechet_distance,
    _predict_route_effort,
)


def _terrain():
    return {
        "avg_gradient_pct": 2.0,
        "max_gradient_pct": 8.0,
        "climb_count": 1,
        "rolling_index": 1.0,
        "terrain_type": "rolling",
    }


def _neighbors():
    return [
        {
            "distance_m": 2000,
            "gain_m": 100,
            "avg_gradient_pct": 5.0,
            "efforts": [{"elapsed_s": 600, "avg_power_watts": 250.0, "avg_vam": 600.0}],
        },
        {
            "distance_m": 1000,
            "gain_m": 60,
            "avg_gradient_pct": 6.0,
            "efforts": [{"elapsed_s": 200, "avg_power_watts": 260.0, "avg_vam": 700.0}],
        },
    ]


def test_route_duration_scales_with_distance():
    # Neighbor paces: 2000m/600s = 3.33 m/s, 1000m/200s = 5 m/s.
    short = _predict_route_effort(20000, 400, _terrain(), _neighbors())
    long = _predict_route_effort(40000, 800, _terrain(), _neighbors())
    assert short["method"] == "segment_knn"
    # Doubling the route (near-)doubles the prediction (pace-based scaling).
    # The gain change shifts neighbor weights slightly, so allow a few
    # percent — the old code returned IDENTICAL durations (segment-time
    # averaging ignores route distance entirely).
    assert long["predicted_duration_s"] == pytest.approx(
        short["predicted_duration_s"] * 2, rel=0.05
    )
    # Sane cycling magnitude for 20 km (not a climb-segment time < 600 s).
    assert 2000 < short["predicted_duration_s"] < 20000


def test_route_duration_matches_weighted_pace():
    result = _predict_route_effort(20000, 400, _terrain(), _neighbors())
    # Neighbor feature distances differ, so recompute the expected pace from
    # the same weighting the implementation uses (inverse feature distance).
    # At minimum the prediction must equal distance / some average of the
    # neighbor paces (3.33–5 m/s), i.e. within [4000, 6000] s.
    assert 4000 <= result["predicted_duration_s"] <= 6000


def test_invalid_efforts_skipped():
    neighbors = [
        {
            "distance_m": 0,
            "gain_m": 0,
            "avg_gradient_pct": 5.0,
            "efforts": [{"elapsed_s": 600}],
        }
    ]
    result = _predict_route_effort(20000, 400, _terrain(), neighbors)
    assert result["method"] == "zero_weight"
    assert result["predicted_duration_s"] is None


def test_frechet_identical_polylines():
    line = [(51.5, -0.1), (51.51, -0.09), (51.52, -0.08)]
    assert _compute_frechet_distance(line, line) == pytest.approx(0.0, abs=1e-6)


def test_frechet_distant_polylines():
    a = [(51.5, -0.1), (51.51, -0.09)]
    b = [(52.5, -1.1), (52.51, -1.09)]
    assert _compute_frechet_distance(a, b) > 50000  # ~tens of km apart


def test_compute_frechet_score_regression():
    from app.integrations.route_intelligence import compute_frechet_score
    from app.services.polyline_utils import encode_polyline

    line = [(51.5, -0.1), (51.51, -0.09), (51.52, -0.08)]
    enc = encode_polyline(line)
    assert compute_frechet_score(enc, enc) == pytest.approx(1.0)
