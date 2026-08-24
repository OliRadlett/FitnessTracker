"""Unit tests for the semantic goal metric registry + goal service helpers.

Pure-logic tests only — resolver DB access is covered by the integration
suite (tests/integration/test_goals_api.py).
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

import pytest

from app.models.goal import Goal
from app.services.goal_metrics import (
    METRIC_REGISTRY,
    list_metrics,
    validate_metric_filters,
)
from app.services.goals import (
    alignment_pct,
    derive_direction,
    update_goal_status,
)

EXPECTED_METRICS = {
    "ftp_watts",
    "body_weight",
    "estimated_1rm",
    "weekly_sessions",
    "monthly_distance_km",
    "weekly_tss",
    "vo2max",
    "squat_bw_ratio",
    "bench_bw_ratio",
    "deadlift_bw_ratio",
    "big3_total",
    "resting_hr",
    "hrv_ms",
}

CREATED = datetime(2026, 8, 1, tzinfo=UTC)
TARGET_DATE = date(2026, 8, 31)  # 30-day span


def make_goal(**overrides) -> Goal:
    defaults = {
        "id": uuid.uuid4(),
        "user_id": uuid.uuid4(),
        "metric": "ftp_watts",
        "target_value": 300.0,
        "starting_value": 250.0,
        "current_value": 260.0,
        "target_date": TARGET_DATE,
        "status": "active",
        "created_at": CREATED,
    }
    defaults.update(overrides)
    return Goal(**defaults)


# ── Registry completeness ────────────────────────────────────────────────────


class TestRegistry:
    def test_all_expected_metrics_present(self):
        assert set(METRIC_REGISTRY.keys()) == EXPECTED_METRICS

    def test_every_entry_has_metadata_and_resolver(self):
        for key, definition in METRIC_REGISTRY.items():
            assert definition.key == key
            assert definition.label
            assert definition.unit
            assert callable(definition.resolver)
            assert definition.default_direction in ("increase", "decrease")

    def test_required_filters_declared(self):
        assert METRIC_REGISTRY["estimated_1rm"].requires_filter == ["exercise"]
        assert METRIC_REGISTRY["ftp_watts"].requires_filter is None

    def test_decrease_direction_defaults(self):
        # Metrics where lower is better
        assert METRIC_REGISTRY["body_weight"].default_direction == "decrease"
        assert METRIC_REGISTRY["resting_hr"].default_direction == "decrease"
        assert METRIC_REGISTRY["ftp_watts"].default_direction == "increase"

    def test_list_metrics_shape(self):
        metrics = list_metrics()
        keys = {m["key"] for m in metrics}
        assert keys == EXPECTED_METRICS
        ftp = next(m for m in metrics if m["key"] == "ftp_watts")
        assert ftp["label"] == "FTP"
        assert ftp["unit"] == "W"

    def test_validate_metric_filters_missing_exercise(self):
        error = validate_metric_filters("estimated_1rm", None)
        assert error is not None and "exercise" in error
        error = validate_metric_filters("estimated_1rm", {"exercise": ""})
        assert error is not None

    def test_validate_metric_filters_ok_and_unknown(self):
        assert validate_metric_filters("estimated_1rm", {"exercise": "squat"}) is None
        error = validate_metric_filters("nope", None)
        assert error is not None and "Unknown metric" in error


# ── Direction derivation ─────────────────────────────────────────────────────


class TestDeriveDirection:
    def test_start_above_target_is_decrease(self):
        goal = make_goal(starting_value=80.0, target_value=75.0)
        assert derive_direction(goal) == "decrease"

    def test_start_below_target_is_increase(self):
        goal = make_goal(starting_value=250.0, target_value=300.0)
        assert derive_direction(goal) == "increase"

    def test_no_starting_value_falls_back_to_registry_default(self):
        goal = make_goal(metric="body_weight", starting_value=None)
        assert derive_direction(goal) == "decrease"
        goal = make_goal(metric="ftp_watts", starting_value=None)
        assert derive_direction(goal) == "increase"

    def test_unknown_metric_without_start_returns_none(self):
        goal = make_goal(metric="bogus", starting_value=None)
        assert derive_direction(goal) is None


# ── Status transitions ───────────────────────────────────────────────────────


class TestUpdateGoalStatus:
    def test_increase_crossing_achieves(self):
        goal = make_goal(target_value=300.0, current_value=300.0)
        update_goal_status(goal, date(2026, 8, 16))
        assert goal.status == "achieved"
        goal = make_goal(current_value=299.9)
        update_goal_status(goal, date(2026, 8, 16))
        assert goal.status == "active"

    def test_decrease_crossing_achieves_weight_loss_case(self):
        # start > target: achieved when current <= target
        goal = make_goal(
            starting_value=80.0, target_value=75.0, current_value=75.0
        )
        update_goal_status(goal, date(2026, 8, 16))
        assert goal.status == "achieved"
        goal = make_goal(
            starting_value=80.0, target_value=75.0, current_value=75.1
        )
        update_goal_status(goal, date(2026, 8, 16))
        assert goal.status == "active"

    def test_expired_when_past_target_date_not_achieved(self):
        goal = make_goal(
            target_date=date(2026, 8, 10), status="active", current_value=260.0
        )
        update_goal_status(goal, date(2026, 8, 16))
        assert goal.status == "expired"

    def test_active_on_target_date_itself(self):
        goal = make_goal(
            target_date=date(2026, 8, 16), status="active", current_value=260.0
        )
        update_goal_status(goal, date(2026, 8, 16))
        assert goal.status == "active"

    def test_abandoned_never_transitions(self):
        for value, day in ((400.0, date(2026, 8, 16)), (100.0, date(2026, 12, 31))):
            goal = make_goal(status="abandoned", current_value=value)
            update_goal_status(goal, day)
            assert goal.status == "abandoned"

    def test_achieved_is_sticky(self):
        goal = make_goal(status="achieved", current_value=200.0)
        update_goal_status(goal, date(2026, 12, 31))
        assert goal.status == "achieved"


# ── Alignment score ──────────────────────────────────────────────────────────


class TestAlignmentPct:
    def test_perfectly_on_track_is_100(self):
        goal = make_goal()
        # Day 15 of a 30-day span; halfway from 250 → 300
        assert alignment_pct(goal, 275.0, date(2026, 8, 16)) == 100.0

    def test_ahead_clamped_to_200(self):
        goal = make_goal()
        # progress 1.2 → raw 240 → clamped to 200
        assert alignment_pct(goal, 310.0, date(2026, 8, 16)) == 200.0

    def test_behind_scores_low(self):
        goal = make_goal()
        # progress 0.2 at half-time → 40%
        assert alignment_pct(goal, 260.0, date(2026, 8, 16)) == 40.0

    def test_regressing_below_start_floored_at_zero(self):
        goal = make_goal()
        # progress -0.2 → raw negative → clamped to 0
        assert alignment_pct(goal, 240.0, date(2026, 8, 16)) == 0.0

    def test_sign_safe_for_decrease_goals(self):
        goal = make_goal(starting_value=80.0, target_value=75.0)
        # Halfway from 80 → 75 (current 77.5) on schedule
        assert alignment_pct(goal, 77.5, date(2026, 8, 16)) == 100.0
        # Ahead: 76 of a 5kg loss = 80% done at 50% elapsed → 160
        assert alignment_pct(goal, 76.0, date(2026, 8, 16)) == 160.0

    def test_none_without_target_date(self):
        goal = make_goal(target_date=None)
        assert alignment_pct(goal, 275.0, date(2026, 8, 16)) is None

    def test_none_without_starting_value(self):
        goal = make_goal(starting_value=None)
        assert alignment_pct(goal, 275.0, date(2026, 8, 16)) is None

    def test_none_when_elapsed_zero_or_negative(self):
        goal = make_goal(created_at=datetime(2026, 8, 20, tzinfo=UTC))
        assert alignment_pct(goal, 275.0, date(2026, 8, 16)) is None
        goal = make_goal(created_at=datetime(2026, 8, 16, tzinfo=UTC))
        assert alignment_pct(goal, 275.0, date(2026, 8, 16)) is None

    def test_none_when_created_after_target_date(self):
        goal = make_goal(created_at=datetime(2026, 9, 1, tzinfo=UTC))
        assert alignment_pct(goal, 275.0, date(2026, 9, 2)) is None

    def test_early_progress_clamped_to_200(self):
        goal = make_goal()
        # Day 1 of a 30-day span with 50% progress → raw 1500% → clamped to 200
        assert alignment_pct(goal, 275.0, date(2026, 8, 2)) == 200.0
