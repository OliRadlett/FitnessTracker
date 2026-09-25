"""Tests for segment-intelligence fixes (audit issues G + RMI-11).

Pure (no DB) — exercises ``app/integrations/segment_intelligence.py``
directly.

G: the no-history fallback and the history-based path must use the same
   0-100 difficulty scale (gradient/length/gain weighted identically), so a
   segment's score doesn't jump when it gains its first similar effort.
RMI-11: efforts are weighted by true feature similarity (not flat 0.5), and
   unclustered segments predict from nearest-neighbor efforts (not only
   their own).
"""

import pytest

from app.integrations.segment_intelligence import (
    _predict_segment_effort,
    analyze_segments,
)


def _segment():
    return {
        "avg_gradient_pct": 8.0,
        "distance_m": 2000,
        "elevation_gain_m": 160,
    }


def test_fallback_difficulty_matches_main_scale():
    result = _predict_segment_effort(_segment(), [], {"ctl": 50, "atl": 30})
    # min(100, 8*4 + 2000/50 + 160/10) = min(100, 88)
    assert result["difficulty_score"] == pytest.approx(88.0)
    assert result["confidence"] == 0.2
    assert result["similar_efforts_used"] == 0


def test_history_path_uses_same_scale():
    efforts = [
        {"effort_vam": 900.0, "avg_power_watts": 250.0, "similarity": 0.9},
        {"effort_vam": 950.0, "avg_power_watts": 260.0, "similarity": 0.8},
    ]
    result = _predict_segment_effort(_segment(), efforts, {"ctl": 50, "atl": 30})
    assert result["difficulty_score"] == pytest.approx(88.0)
    assert result["similar_efforts_used"] == 2
    assert result["predicted_power_watts"] is not None


def test_similarity_weights_efforts():
    # Near-identical similarities must track the high-similarity effort.
    efforts = [
        {"effort_vam": 600.0, "avg_power_watts": 200.0, "similarity": 0.95},
        {"effort_vam": 1200.0, "avg_power_watts": 300.0, "similarity": 0.1},
    ]
    result = _predict_segment_effort(_segment(), efforts, {"ctl": 50, "atl": 30})
    assert result["predicted_vam"] == pytest.approx(600.0, abs=80.0)


def _seg(sid, grad, dist, gain):
    return {
        "id": sid,
        "route_id": "route-1",
        "distance_m": dist,
        "elevation_gain_m": gain,
        "avg_gradient_pct": grad,
        "max_gradient_pct": grad + 2,
        "start_lat": 51.0,
        "start_lng": -0.1,
        "end_lat": 51.01,
        "end_lng": -0.1,
    }


def test_unclustered_segment_uses_neighbors():
    # Three segments: two near-twins, one far away with NO efforts of its
    # own. The far segment must predict from its nearest neighbors'
    # efforts (VAM ~600), not the generic 800/1000/1200 fallback.
    a1 = _seg("a1", 8.0, 2000, 160)
    a2 = _seg("a2", 8.2, 2100, 170)
    b1 = _seg("b1", 4.0, 5000, 200)
    efforts = [
        {"segment_id": "a1", "elapsed_seconds": 600, "avg_power_watts": 250.0, "effort_vam": 600.0},
        {"segment_id": "a2", "elapsed_seconds": 620, "avg_power_watts": 255.0, "effort_vam": 620.0},
    ]
    result = analyze_segments(
        [a1, a2, b1], efforts, {"ctl": 50, "atl": 30},
        eps=0.35, min_cluster_size=3,
    )
    pred = result["difficulty_predictions"]["b1"]
    # b1 has no efforts of its own and (min size 3) no cluster: the
    # prediction must come from its two nearest neighbors (VAM ~610),
    # not the generic no-history fallback (VAM 800 for its gradient).
    assert pred["similar_efforts_used"] == 2
    assert pred["predicted_vam"] == pytest.approx(610.0, abs=30.0)
