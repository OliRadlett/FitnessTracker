"""Tests for projections service — pure functions + integration.

Pure function tests (no DB required):
  - linear_regression: known slopes, r²=1.0 for perfect line, ValueError for n<2
  - project_to_target: increasing/decreasing metrics, wrong direction, zero slope
  - success_badge: n<4, projected before/after target, no target_date cases
  - tsb_projection: CTL/ATL converge toward TSB, rest days push ATL down faster

Integration tests (extend test_goals_api.py or new file):
  - goal projection endpoint returns badge + projection_line
  - metric trend endpoint returns trend info
  - TSB endpoint returns 400 for non-event plan
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.services.projections import (
    linear_regression,
    project_to_target,
    success_badge,
    tsb_projection,
)

# ── linear_regression ────────────────────────────────────────────────────────


class TestLinearRegression:
    def test_known_slope_increasing(self):
        """Points (day0, 10), (day30, 16) → slope ~0.2/day."""
        d0 = date(2026, 1, 1)
        points = [(d0, 10.0), (d0 + timedelta(days=30), 16.0)]
        slope, intercept, r2, n = linear_regression(points)
        assert n == 2
        assert slope == pytest.approx(0.2, abs=1e-6)
        assert intercept == pytest.approx(10.0, abs=1e-6)
        assert r2 == pytest.approx(1.0, abs=1e-6)

    def test_known_slope_decreasing(self):
        """Points (day0, 80), (day20, 70) → slope = -0.5/day."""
        d0 = date(2026, 1, 1)
        points = [(d0, 80.0), (d0 + timedelta(days=20), 70.0)]
        slope, intercept, r2, n = linear_regression(points)
        assert slope == pytest.approx(-0.5, abs=1e-6)
        assert r2 == pytest.approx(1.0, abs=1e-6)

    def test_perfect_line_r_squared_1(self):
        """All points on a perfect line → r² = 1.0."""
        d0 = date(2026, 1, 1)
        points = [(d0 + timedelta(days=i), 10.0 + 0.5 * i) for i in range(10)]
        slope, intercept, r2, n = linear_regression(points)
        assert slope == pytest.approx(0.5, abs=1e-6)
        assert r2 == pytest.approx(1.0, abs=1e-4)
        assert n == 10

    def test_flat_trend_slope_zero(self):
        """All points at the same value → slope ≈ 0."""
        d0 = date(2026, 1, 1)
        points = [(d0 + timedelta(days=i), 50.0) for i in range(5)]
        slope, intercept, r2, n = linear_regression(points)
        assert slope == pytest.approx(0.0, abs=1e-6)
        assert intercept == pytest.approx(50.0, abs=1e-6)

    def test_value_error_for_n_less_than_2(self):
        """Need at least 2 points."""
        with pytest.raises(ValueError, match="at least 2"):
            linear_regression([(date(2026, 1, 1), 10.0)])

    def test_value_error_for_empty_list(self):
        with pytest.raises(ValueError, match="at least 2"):
            linear_regression([])

    def test_many_points(self):
        """Regression on 12 weekly points with slight noise."""
        d0 = date(2026, 1, 1)
        # Perfect weekly increase of 1.0 per week (slope ≈ 1/7 per day)
        points = [(d0 + timedelta(weeks=i), 100.0 + i * 1.0) for i in range(12)]
        slope, intercept, r2, n = linear_regression(points)
        assert slope == pytest.approx(1.0 / 7.0, abs=1e-4)
        assert r2 > 0.99
        assert n == 12


# ── project_to_target ────────────────────────────────────────────────────────


class TestProjectToTarget:
    def test_increasing_metric_hits_target(self):
        """Increasing metric with positive slope → projected date returned."""
        today = date(2026, 8, 25)
        result = project_to_target(
            slope_per_day=0.2,
            intercept=10.0,
            current_date=today,
            current_value=20.0,
            target_value=30.0,
            direction="increase",
        )
        assert result is not None
        assert result["days_remaining"] == 50  # (30-20)/0.2 = 50
        assert result["projected_date"] == today + timedelta(days=50)

    def test_decreasing_metric_hits_target(self):
        """Decreasing metric with negative slope → projected date returned."""
        today = date(2026, 8, 25)
        result = project_to_target(
            slope_per_day=-0.5,
            intercept=80.0,
            current_date=today,
            current_value=75.0,
            target_value=70.0,
            direction="decrease",
        )
        assert result is not None
        assert result["days_remaining"] == 10  # (70-75)/(-0.5) = 10
        assert result["projected_date"] == today + timedelta(days=10)

    def test_wrong_direction_slope_returns_none(self):
        """Positive slope for a decrease goal → None."""
        result = project_to_target(
            slope_per_day=0.2,
            intercept=10.0,
            current_date=date(2026, 8, 25),
            current_value=20.0,
            target_value=15.0,
            direction="decrease",
        )
        assert result is None

    def test_wrong_direction_slope_increase_returns_none(self):
        """Negative slope for an increase goal → None."""
        result = project_to_target(
            slope_per_day=-0.2,
            intercept=10.0,
            current_date=date(2026, 8, 25),
            current_value=20.0,
            target_value=30.0,
            direction="increase",
        )
        assert result is None

    def test_zero_slope_returns_none(self):
        """Zero slope → None."""
        result = project_to_target(
            slope_per_day=0.0,
            intercept=10.0,
            current_date=date(2026, 8, 25),
            current_value=20.0,
            target_value=30.0,
            direction="increase",
        )
        assert result is None

    def test_already_past_target_returns_none(self):
        """Current value already past target → negative remaining → None."""
        result = project_to_target(
            slope_per_day=0.2,
            intercept=10.0,
            current_date=date(2026, 8, 25),
            current_value=35.0,
            target_value=30.0,
            direction="increase",
        )
        assert result is None


# ── success_badge ────────────────────────────────────────────────────────────


class TestSuccessBadge:
    def test_not_enough_data_n_less_than_4(self):
        assert (
            success_badge(0.1, date(2026, 12, 1), date(2026, 12, 15), n_points=3)
            == "Not enough data"
        )
        assert (
            success_badge(0.1, date(2026, 12, 1), date(2026, 12, 15), n_points=1)
            == "Not enough data"
        )
        assert (
            success_badge(0.1, None, date(2026, 12, 15), n_points=2)
            == "Not enough data"
        )

    def test_on_track_projected_before_target(self):
        target = date(2026, 12, 15)
        projected = date(2026, 11, 1)  # before target
        assert success_badge(0.2, projected, target, n_points=8) == "On Track"

    def test_on_track_projected_equals_target(self):
        target = date(2026, 12, 15)
        assert success_badge(0.2, target, target, n_points=8) == "On Track"

    def test_at_risk_within_30_days_of_target(self):
        target = date(2026, 12, 15)
        projected = date(2026, 12, 30)  # 15 days past target
        assert success_badge(0.2, projected, target, n_points=8) == "At Risk"

    def test_at_risk_exactly_30_days_past(self):
        target = date(2026, 12, 15)
        projected = target + timedelta(days=30)
        assert success_badge(0.2, projected, target, n_points=8) == "At Risk"

    def test_unlikely_projected_way_past_target(self):
        target = date(2026, 12, 15)
        projected = date(2027, 6, 1)  # way past
        assert success_badge(0.2, projected, target, n_points=8) == "Unlikely"

    def test_unlikely_projected_none(self):
        """None projected_date (wrong direction slope) → Unlikely."""
        assert success_badge(0.0, None, date(2026, 12, 15), n_points=8) == "Unlikely"

    def test_no_target_date_on_track(self):
        """No target_date + slope heading toward target → On Track."""
        assert success_badge(0.2, date(2027, 1, 1), None, n_points=8) == "On Track"

    def test_no_target_date_unlikely(self):
        """No target_date + projected_date None → Unlikely."""
        assert success_badge(0.0, None, None, n_points=8) == "Unlikely"

    def test_not_enough_data_overrides_everything(self):
        """n < 4 always returns 'Not enough data' regardless of other params."""
        assert (
            success_badge(0.5, date(2026, 9, 1), date(2026, 12, 15), n_points=3)
            == "Not enough data"
        )


# ── tsb_projection ───────────────────────────────────────────────────────────


class TestTsbProjection:
    def test_ctl_atl_converge_toward_tss(self):
        """With constant TSS, CTL and ATL converge toward that value."""
        d0 = date(2026, 1, 1)
        # 100 days of constant TSS = 80
        planned = [(d0 + timedelta(days=i), 80.0) for i in range(100)]
        result = tsb_projection(
            current_ctl=0.0, current_atl=0.0, planned_tss_per_day=planned
        )

        assert len(result) == 100
        # After 100 days, CTL should be close to 80 (time constant 42)
        assert result[-1]["ctl"] > 70  # approaching 80
        # ATL should be very close to 80 (time constant 7)
        assert result[-1]["atl"] == pytest.approx(80.0, abs=1.0)

    def test_tsb_equals_ctl_minus_atl(self):
        """TSB = CTL - ATL at every point."""
        d0 = date(2026, 1, 1)
        planned = [(d0 + timedelta(days=i), 60.0 + i) for i in range(10)]
        result = tsb_projection(
            current_ctl=50.0, current_atl=40.0, planned_tss_per_day=planned
        )

        for point in result:
            assert point["tsb"] == pytest.approx(point["ctl"] - point["atl"], abs=0.11)

    def test_rest_days_push_atl_down_faster(self):
        """ATL drops faster than CTL on rest days (shorter time constant)."""
        d0 = date(2026, 1, 1)
        # Start with CTL=60, ATL=80 (fatigued), then 7 rest days
        planned = [(d0 + timedelta(days=i), 0.0) for i in range(7)]
        result = tsb_projection(
            current_ctl=60.0, current_atl=80.0, planned_tss_per_day=planned
        )

        # ATL should drop more than CTL over 7 rest days
        ctl_drop = 60.0 - result[-1]["ctl"]
        atl_drop = 80.0 - result[-1]["atl"]
        assert atl_drop > ctl_drop

        # TSB should improve (become less negative)
        assert result[-1]["tsb"] > result[0]["tsb"]

    def test_none_tss_treated_as_zero(self):
        """None planned_tss is treated as 0 (rest)."""
        d0 = date(2026, 1, 1)
        planned = [(d0, None), (d0 + timedelta(days=1), 50.0)]
        result = tsb_projection(
            current_ctl=40.0, current_atl=40.0, planned_tss_per_day=planned
        )

        assert len(result) == 2
        # First day (None → 0): ATL should drop, CTL should drop
        assert result[0]["atl"] < 40.0
        assert result[0]["ctl"] < 40.0

    def test_empty_planned_returns_empty(self):
        result = tsb_projection(
            current_ctl=50.0, current_atl=50.0, planned_tss_per_day=[]
        )
        assert result == []

    def test_single_day_projection(self):
        d0 = date(2026, 1, 1)
        result = tsb_projection(
            current_ctl=50.0,
            current_atl=50.0,
            planned_tss_per_day=[(d0, 100.0)],
        )
        assert len(result) == 1
        assert result[0]["date"] == d0
        # CTL moves toward 100 from 50
        assert result[0]["ctl"] > 50.0
        # ATL moves toward 100 from 50
        assert result[0]["atl"] > 50.0
