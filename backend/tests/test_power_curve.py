"""Tests for the §5.4 power-curve rolling-average helper.

These exercise the pure `best_power_rolling_average` (prefix-sum, shared by the
read path and the monthly FTP backfill) so the two can never diverge. They are
pure (no DB) — the DB-touching callers (`compute_power_curve_from_streams`,
`backfill_ftp_estimates`) are covered by `tests/integration/test_cycling_api.py`.
"""

import pytest

from app.services.cycling import (
    POWER_DURATION_BUCKETS,
    best_power_rolling_average,
    personalized_power_curve,
)


def naive_best(data, d):
    if d > len(data) or d <= 0:
        return None
    best = 0.0
    for i in range(len(data) - d + 1):
        w = sum(data[i : i + d]) / d
        best = max(best, w)
    return round(best, 1)


@pytest.mark.parametrize("duration", [5, 10, 15, 30, 60, 120, 300, 600])
def test_constant_power(duration):
    data = [300.0] * duration
    assert best_power_rolling_average(data, duration) == 300.0


def test_best_window_not_at_start():
    # peak effort in the middle of the ride
    data = [100.0] * 20 + [350.0] * 20 + [100.0] * 20
    assert best_power_rolling_average(data, 20) == 350.0


def test_matches_naive_reference_across_buckets():
    data = [
        120.0,
        90.0,
        310.0,
        300.0,
        320.0,
        280.0,
        400.0,
        390.0,
        410.0,
        380.0,
        100.0,
        110.0,
        120.0,
        130.0,
        140.0,
        150.0,
        160.0,
        170.0,
        180.0,
        190.0,
        200.0,
        210.0,
        220.0,
        230.0,
        240.0,
        250.0,
        260.0,
        270.0,
        280.0,
        290.0,
    ]
    for d, _ in POWER_DURATION_BUCKETS:
        if d > len(data):
            continue
        assert best_power_rolling_average(data, d) == naive_best(data, d), (
            f"duration {d}"
        )


def test_duration_longer_than_data_returns_none():
    assert best_power_rolling_average([100.0, 200.0], 60) is None


def test_short_and_empty():
    assert best_power_rolling_average([], 5) is None
    assert best_power_rolling_average([100.0], 5) is None
    # exactly fills the window
    assert best_power_rolling_average([250.0, 250.0, 250.0], 3) == 250.0


def test_rounding_to_one_decimal():
    # 100 + 101 + 100 = 301 / 3 = 100.333... -> 100.3
    assert best_power_rolling_average([100.0, 101.0, 100.0], 3) == 100.3


def test_personalized_power_curve_morton():
    # Legacy 2-param P(t) = W'/t + CP with CP=250 W, W'=20000 J.
    # Short-duration predictions are omitted (the hyperbola diverges as
    # t → 0) — only >= 60s buckets are returned.
    curve = personalized_power_curve(250, 20000)
    assert set(curve) == {d for d, _ in POWER_DURATION_BUCKETS if d >= 60}
    assert 5 not in curve
    assert curve[60] == 583.3
    assert curve[3600] == 255.6
    # hyperbola: longer durations asymptote to CP
    assert curve[60] > curve[3600] >= 250


def test_personalized_power_curve_3param_bounded():
    # 3-param P(t) = W'/(t + k) + CP stays bounded at sprint durations and
    # covers the full bucket range.
    curve = personalized_power_curve(182, 22012, 1062)
    assert set(curve) == {d for d, _ in POWER_DURATION_BUCKETS}
    # P(5s) near the Pmax ceiling, not the 3000W+ 2-param blow-up
    assert curve[5] == pytest.approx(915.7, abs=1.0)
    assert curve[5] <= 1062
    assert curve[5] > curve[60] > curve[3600] >= 182


def test_personalized_power_curve_zero_w_prime():
    # w_prime=0 (e.g. profile has CP but no W') -> flat line at CP
    curve = personalized_power_curve(250, 0)
    assert all(v == 250.0 for v in curve.values())
