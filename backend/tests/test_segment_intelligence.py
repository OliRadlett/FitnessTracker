"""Tests for segment-intelligence fix (audit issue G).

Pure (no DB) — exercises ``_predict_segment_effort`` in
``app/integrations/segment_intelligence.py`` directly.

G: the no-history fallback and the history-based path must use the same
   0-100 difficulty scale (gradient/length/gain weighted identically), so a
   segment's score doesn't jump when it gains its first similar effort.
"""

import pytest

from app.integrations.segment_intelligence import _predict_segment_effort


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
