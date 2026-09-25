"""Tests for cross-domain alignment fixes (audit issues A + B).

Pure (no DB) — exercises ``analyze_sleep_performance`` in
``app/integrations/cross_domain.py`` directly.

A: sleep features with missing values must stay aligned with performance
   (ragged per-feature lists sliced positionally against perf values
   produced wrong R²/slopes and bogus insights).
B: HRV↔power lag correlation must use date-aligned daily series (zipping
   per-night HRV against per-activity power positionally correlated
   unrelated days).
"""

from datetime import date, timedelta

import pytest

from app.integrations.cross_domain import analyze_sleep_performance


def _dates(start: str, n: int) -> list[str]:
    d0 = date.fromisoformat(start)
    return [(d0 + timedelta(days=i)).isoformat() for i in range(n)]


def _linear_sleep_perf(missing_idx: int = 3):
    """Sleep nights + next-day power with exact linear relationships.

    Totals are deliberately NON-uniform: power = 200 + 10 * total, and every
    other field is an exact linear function of total. Night ``missing_idx``
    lacks hrv_ms and deep_sleep_hours (the ragged case that used to
    misalign). With non-uniform data, positional shifting measurably breaks
    R²; with uniform progressions a shift would stay spuriously linear.
    """
    totals = [
        6.0,
        7.5,
        6.5,
        8.0,
        7.0,
        6.2,
        7.8,
        6.8,
        7.2,
        6.4,
        7.6,
        6.6,
        7.4,
        6.1,
        7.1,
        6.9,
    ]
    nights = _dates("2026-01-01", len(totals))
    sleep_data = []
    performance_data = []
    for i, (night, total) in enumerate(zip(nights, totals)):
        missing = i == missing_idx
        sleep_data.append(
            {
                "date": night,
                "total_sleep_hours": total,
                "deep_sleep_hours": None if missing else round(total * 0.3, 2),
                "rem_sleep_hours": round(total * 0.2, 2),
                "sleep_efficiency": 90.0,
                "hrv_ms": None if missing else 2.0 * total + 38.0,
                "recovery_score": 70.0 + total,
            }
        )
        perf_date = (date.fromisoformat(night) + timedelta(days=1)).isoformat()
        performance_data.append(
            {
                "date": perf_date,
                "avg_watts": 200 + 10 * total,
                "normalized_power": 200 + 10 * total,
                "tss": 80.0,
            }
        )
    return sleep_data, performance_data


def test_missing_values_stay_aligned():
    sleep_data, performance_data = _linear_sleep_perf()
    result = analyze_sleep_performance(sleep_data, performance_data)

    assert result["data_quality"]["sufficient"] is True
    corrs = result["correlations"]

    # total_sleep_hours is complete: exact fit, all 16 pairs.
    assert corrs["total_sleep_hours"]["r_squared"] == pytest.approx(1.0, abs=1e-6)
    assert corrs["total_sleep_hours"]["slope"] == pytest.approx(10.0, rel=1e-3)
    assert corrs["total_sleep_hours"]["n_points"] == 16

    # deep_sleep_hours misses one night: the remaining 15 pairs must still
    # be aligned (exact linear relation preserved), not positionally shifted.
    # (r² is rounded to 4 dp by the analyzer; misalignment would read ~0.9.)
    assert corrs["deep_sleep_hours"]["n_points"] == 15
    assert corrs["deep_sleep_hours"]["r_squared"] == pytest.approx(1.0, abs=1e-3)

    # hrv misses the same night: aligned pairs keep the exact relation.
    assert corrs["hrv_ms"]["n_points"] == 15
    assert corrs["hrv_ms"]["r_squared"] == pytest.approx(1.0, abs=1e-3)


def test_lag_correlation_uses_common_dates():
    # 20 nights of HRV rising with the day index; rides on 16 of those days
    # (every day except a 4-day gap) with daily-mean power tracking the same
    # index, plus a doubled activity on one day. Positional zipping would mix
    # nights with unrelated activities; date alignment must recover lag-0 ≈ 1.
    nights = _dates("2026-02-01", 20)
    sleep_data = [
        {
            "date": night,
            "total_sleep_hours": 7.5,
            "deep_sleep_hours": 1.8,
            "rem_sleep_hours": 1.5,
            "sleep_efficiency": 90.0,
            "hrv_ms": 40.0 + i,
            "recovery_score": 70.0,
        }
        for i, night in enumerate(nights)
    ]
    ride_days = [d for i, d in enumerate(nights) if i not in (4, 5, 6, 7)]
    performance_data = []
    for day in ride_days:
        i = nights.index(day)
        performance_data.append({"date": day, "avg_watts": 100 + 5 * i, "tss": 80.0})
    # Second activity same day (daily mean must absorb it, not shift series).
    performance_data.append({"date": ride_days[0], "avg_watts": 110.0, "tss": 40.0})

    result = analyze_sleep_performance(sleep_data, performance_data)
    assert result["data_quality"]["sufficient"] is True

    lags = {row["lag"]: row for row in result["lag_correlations"]}
    assert lags, "expected lag correlations over 16 common dates"
    # Every lag window draws from the aligned daily series only.
    assert all(row["n_points"] <= 16 for row in lags.values())
    assert lags[0]["correlation"] == pytest.approx(1.0, abs=0.05)


def test_insufficient_data_unchanged():
    result = analyze_sleep_performance([{"date": "2026-01-01"}], [])
    assert result["data_quality"] == {"sufficient": False}
    assert result["insights"] == []
    assert result["optimal_sleep_profile"] is None
