"""Tests for the personalized-VO2max method switch (t4).

Prod case: 26.5 ml/kg/min at CP 229W / 90.4kg / LTHR 152 — a "Poor" label on
a trained rider. Root cause: the FRIEND equation (calibrated on MAXIMAL
power) was applied to regression-extrapolated THRESHOLD power (~195W read
at the HR anchor), understating by ~25% by construction.

The fix: FRIEND on best ~5-min power read from the power-duration curve
(the same maximal input the canonical ``estimate_vo2max`` service uses);
the threshold regression survives only as a fallback gated on R² ≥ 0.5.

Pure (no DB) — exercises ``app/integrations/power_models.py`` directly.
"""

import pytest

from app.integrations.power_models import (
    VO2_R2_MIN,
    _maximal_power_at,
    fit_personalized_vo2max,
)


def _steady_rides():
    # HR = 100 + 0.25 * watts (exact line, R² = 1).
    return [
        {"avg_watts": float(w), "avg_hr": 100.0 + 0.25 * w, "duration_seconds": 1800}
        for w in (180, 200, 220, 240, 260)
    ]


def _noisy_rides():
    # HR uncorrelated with power (R² ~ 0).
    return [
        {"avg_watts": float(w), "avg_hr": hr, "duration_seconds": 1800}
        for w, hr in zip(
            (180, 200, 220, 240, 260), (141.0, 139.0, 142.0, 138.0, 141.0)
        )
    ]


def test_maximal_path_fixes_prod_underestimate():
    """Prod: 26.5 via the threshold read. FRIEND on a 270W maximal 5-min
    effort at 90.4kg gives 10.649 × 270/90.4 + 3.5 = 35.3."""
    result = fit_personalized_vo2max(
        _steady_rides(),
        weight_kg=90.4,
        hr_anchor=152.0,
        durations=[60, 300, 1200],
        best_watts=[400.0, 270.0, 210.0],
    )
    assert result["method"] == "friend_maximal_power"
    assert result["vo2max"] == pytest.approx(10.649 * 270.0 / 90.4 + 3.5, abs=0.1)
    assert result["vo2max"] == pytest.approx(35.3, abs=0.1)
    assert result["maximal_power_watts"] == 270.0
    assert result["maximal_power_source"] == "exact:300s"
    # Regression diagnostics still reported for transparency.
    assert result["r_squared"] == pytest.approx(1.0)
    assert result["data_points_used"] == 5
    assert result["hr_threshold_used"] == 152.0


def test_maximal_path_ignores_weak_regression():
    """A weak regression must not block the maximal number — the maximal
    path does not use the regression at all."""
    result = fit_personalized_vo2max(
        _noisy_rides(),
        weight_kg=90.4,
        hr_anchor=152.0,
        durations=[60, 300, 1200],
        best_watts=[400.0, 270.0, 210.0],
    )
    assert result["method"] == "friend_maximal_power"
    assert result["vo2max"] == pytest.approx(35.3, abs=0.1)
    assert result["r_squared"] < VO2_R2_MIN


def test_fallback_gated_on_weak_regression():
    """No maximal input + noise regression → no number, gated marker with
    diagnostics (previously: a stamped noise number)."""
    result = fit_personalized_vo2max(_noisy_rides(), weight_kg=75.0, hr_anchor=150.0)
    assert result["vo2max"] is None
    assert result["method"] == "weak_regression_gated"
    assert result["r_squared"] < VO2_R2_MIN
    assert result["data_points_used"] == 5
    assert result["hr_threshold_used"] == 150.0


def test_fallback_strong_regression_stamps_legacy_number():
    """No maximal input + strong regression → legacy threshold-read number
    (unchanged math: 10.649 × 2.667 + 3.5 ≈ 31.9)."""
    result = fit_personalized_vo2max(_steady_rides(), weight_kg=75.0, hr_anchor=150.0)
    assert result["method"] == "power_hr_regression"
    assert result["vo2max"] == pytest.approx(10.649 * 2.6667 + 3.5, abs=0.2)
    assert result["maximal_power_watts"] is None


def test_fallback_rejects_implausible_anchor():
    result = fit_personalized_vo2max(_steady_rides(), weight_kg=75.0, hr_anchor=50.0)
    assert result["hr_threshold_used"] == 170.0


def test_maximal_read_exact_bucket():
    watts, source = _maximal_power_at([60, 300, 1200], [400.0, 270.0, 210.0])
    assert watts == 270.0
    assert source == "exact:300s"


def test_maximal_read_interpolates_bracket():
    # Log-linear between (60, 400) and (600, 230) at 300s.
    watts, source = _maximal_power_at([60, 600], [400.0, 230.0])
    assert watts == pytest.approx(281.2, abs=0.2)
    assert source == "interpolated:60-600s"


def test_maximal_read_refuses_extrapolation():
    # All data on one side of 300s: reading 300s would be extrapolation.
    assert _maximal_power_at([600, 1200], [230.0, 210.0]) == (None, None)
    assert _maximal_power_at([5, 60], [900.0, 480.0]) == (None, None)
    assert _maximal_power_at([], []) == (None, None)
    assert _maximal_power_at([300], [0.0]) == (None, None)


def test_maximal_read_tolerates_garbage():
    assert _maximal_power_at([60, None, 300], [400.0, 200.0, 270.0]) == (
        270.0,
        "exact:300s",
    )
    assert _maximal_power_at(["x", 300], [400.0, 270.0]) == (270.0, "exact:300s")


def test_insufficient_data_markers():
    result = fit_personalized_vo2max(
        _steady_rides()[:2], weight_kg=75.0, hr_anchor=150.0
    )
    assert result["vo2max"] is None
    assert result["method"] == "insufficient_data"
    assert result["r_squared"] is None
    assert result["data_points_used"] == 2


def test_degenerate_data_markers():
    rides = [
        {"avg_watts": 200.0, "avg_hr": 140.0 + (i % 2), "duration_seconds": 1800}
        for i in range(4)
    ]
    result = fit_personalized_vo2max(rides, weight_kg=75.0, hr_anchor=150.0)
    assert result["vo2max"] is None
    assert result["method"] == "degenerate_data"


def test_no_weight_assumes_75kg():
    result = fit_personalized_vo2max(
        _steady_rides(),
        weight_kg=None,
        hr_anchor=150.0,
        durations=[300],
        best_watts=[270.0],
    )
    assert result["method"] == "friend_maximal_power"
    assert result["vo2max"] == pytest.approx(10.649 * 270.0 / 75.0 + 3.5, abs=0.1)


def test_maximal_sanity_bounds_gate_absurd_input():
    """A 2000W "5-min best" is a data error, not physiology — no stamp."""
    result = fit_personalized_vo2max(
        _steady_rides(),
        weight_kg=90.4,
        hr_anchor=152.0,
        durations=[300],
        best_watts=[2000.0],
    )
    assert result["vo2max"] is None
    assert result["method"] == "friend_maximal_power"
