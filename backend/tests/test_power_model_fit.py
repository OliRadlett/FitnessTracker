"""Tests for the Morton 3-param critical-power fitter.

Pure (no DB) — exercises ``fit_critical_power`` in
``app/integrations/power_models.py`` directly, including the regression that
motivated the 3-param model: the 2-param P(t) = W'/t + CP extrapolation
predicted 3000W+ at 5s when fitted to 60s+ data.
"""

import pytest

from app.integrations.power_models import (
    _morton_3param_power_duration,
    fit_critical_power,
)

# Sprint-anchored power-duration data resembling a real rider curve.
DURATIONS = [5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 2700, 3600, 5400, 7200]
POWERS = [900, 820, 770, 530, 480, 300, 260, 230, 210, 200, 190, 185, 180, 175]


def test_3param_fit_bounds_sprint_prediction():
    result = fit_critical_power(DURATIONS, POWERS)
    assert result["method"] == "morton_3param"
    assert result["cp"] is not None
    assert result["p_max"] is not None
    # The 5s prediction must sit near the observed sprint best, not blow up.
    fitted_5s = result["fitted_curve"]["5"]
    assert fitted_5s == pytest.approx(900, abs=60)
    assert fitted_5s < 1200
    # Pmax ceiling near the observed sprint best.
    assert result["p_max"] == pytest.approx(900, rel=0.25)
    assert result["p_max"] > result["cp"] + 50
    # Long durations asymptote to CP.
    assert result["fitted_curve"]["7200"] == pytest.approx(result["cp"], abs=10)


def test_3param_recovers_synthetic_parameters():
    # Generate exact 3-param data: CP=200, W'=22000, Pmax=1000.
    cp, w_prime, p_max = 200.0, 22000.0, 1000.0
    powers = [_morton_3param_power_duration(t, cp, w_prime, p_max) for t in DURATIONS]
    result = fit_critical_power(DURATIONS, powers)
    assert result["method"] == "morton_3param"
    assert result["cp"] == pytest.approx(cp, rel=0.05)
    assert result["w_prime"] == pytest.approx(w_prime, rel=0.10)
    assert result["p_max"] == pytest.approx(p_max, rel=0.05)
    assert result["model_r_squared"] > 0.99


def test_insufficient_data_needs_four_points():
    # 3 params need at least 4 points.
    result = fit_critical_power([5, 60, 300], [900, 480, 260])
    assert result["method"] == "insufficient_data"
    assert result["cp"] is None
    assert result["p_max"] is None


def test_flat_data_falls_back_to_2param_without_short_durations():
    # No sprint/aerobic separation (flat 200W everywhere): Pmax cannot exceed
    # CP + 50, so the fitter falls back to the 2-param 60s+ curve rather than
    # returning a degenerate 3-param fit.
    powers = [200.0] * len(DURATIONS)
    result = fit_critical_power(DURATIONS, powers)
    assert result["method"] == "morton_2004"
    assert result["p_max"] is None
    assert "5" not in result["fitted_curve"]
    assert "60" in result["fitted_curve"]
