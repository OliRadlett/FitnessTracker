"""P2 goal improvements — pure-function tests (no DB required).

Covers: plate-milestone math + BW-ratio/Big-3 template helpers
(services.goal_templates), deload detection (services.goal_deload), the
unified trajectory verdict + due windows + deload-aware alignment
(services.goals). DB-backed paths (templates endpoint, projection wiring,
deadline task, export nesting) are integration tests run in CI.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from app.models.goal import Goal
from app.services.goal_deload import (
    deload_days_in_range,
    detect_deload_weeks,
    monday_of,
)
from app.services.goal_templates import (
    next_milestone_above,
    plate_rationale,
    plates_per_side,
)
from app.services.goals import (
    alignment_pct,
    goal_due_notice,
    trajectory_verdict,
)


def _mondays(n: int, start: date = date(2026, 1, 5)) -> list[date]:
    return [start + timedelta(weeks=i) for i in range(n)]


# ── Plate milestones ───────────────────────────────────────────────────


class TestNextMilestoneAbove:
    def test_picks_next_above_current(self):
        assert next_milestone_above([100.0, 140.0, 180.0], 120.0) == 140.0

    def test_exact_match_moves_up(self):
        """Sitting exactly on a milestone suggests the next one up."""
        assert next_milestone_above([100.0, 140.0], 100.0) == 140.0

    def test_maxed_out_returns_none(self):
        assert next_milestone_above([100.0, 140.0], 140.0) is None
        assert next_milestone_above([100.0, 140.0], 999.0) is None


class TestPlateMath:
    def test_two_plates_per_side(self):
        assert plates_per_side(100.0) == 2.0

    def test_one_plate_bench(self):
        assert plates_per_side(60.0) == 1.0

    def test_five_plates_deadlift(self):
        assert plates_per_side(220.0) == 5.0

    def test_non_round_load_returns_none(self):
        assert plates_per_side(110.0) is None
        assert plates_per_side(20.0) is None

    def test_rationale_wording(self):
        assert plate_rationale(100.0) == "2 plates per side"
        assert plate_rationale(60.0) == "1 plate per side"


# ── Deload detection ───────────────────────────────────────────────────


class TestDetectDeloadWeeks:
    def test_clear_deload_detected(self):
        weeks = _mondays(5)
        loads = [300.0, 300.0, 300.0, 300.0, 100.0]
        assert detect_deload_weeks(list(zip(weeks, loads))) == [weeks[4]]

    def test_steady_training_has_no_deload(self):
        weeks = _mondays(5)
        loads = [300.0, 310.0, 290.0, 305.0, 295.0]
        assert detect_deload_weeks(list(zip(weeks, loads))) == []

    def test_no_history_never_deloads(self):
        """Zero-history users must not read as deloading (fail-open)."""
        weeks = _mondays(5)
        assert detect_deload_weeks(list(zip(weeks, [0.0] * 5))) == []

    def test_rest_after_rest_is_not_deload(self):
        """A quiet week after detraining baselines is rest, not a deload."""
        weeks = _mondays(5)
        loads = [50.0, 50.0, 50.0, 50.0, 10.0]
        assert detect_deload_weeks(list(zip(weeks, loads))) == []

    def test_single_trained_week_insufficient(self):
        weeks = _mondays(5)
        loads = [0.0, 0.0, 0.0, 300.0, 100.0]
        assert detect_deload_weeks(list(zip(weeks, loads))) == []

    def test_ramp_up_is_not_deload(self):
        weeks = _mondays(5)
        loads = [100.0, 100.0, 100.0, 100.0, 400.0]
        assert detect_deload_weeks(list(zip(weeks, loads))) == []


class TestDeloadDaysInRange:
    def test_counts_seven_per_week(self):
        weeks = {date(2026, 1, 5), date(2026, 1, 12)}
        assert deload_days_in_range(weeks, date(2026, 1, 1), date(2026, 1, 31)) == 14

    def test_clips_to_range(self):
        """A 3-day window containing a deload Monday counts 3, not 7."""
        assert (
            deload_days_in_range({date(2026, 1, 5)}, date(2026, 1, 5), date(2026, 1, 7))
            == 3
        )

    def test_empty_and_reversed(self):
        assert deload_days_in_range(set(), date(2026, 1, 1), date(2026, 1, 31)) == 0
        assert (
            deload_days_in_range({date(2026, 1, 5)}, date(2026, 2, 1), date(2026, 1, 1))
            == 0
        )

    def test_monday_of(self):
        assert monday_of(date(2026, 1, 7)) == date(2026, 1, 5)  # Wednesday
        assert monday_of(date(2026, 1, 5)) == date(2026, 1, 5)  # Monday


# ── Trajectory verdict ─────────────────────────────────────────────────


class TestTrajectoryVerdict:
    def test_terminal_statuses_report_themselves(self):
        assert trajectory_verdict("achieved", "Unlikely", 10.0) == "achieved"
        assert trajectory_verdict("abandoned", None, 150.0) == "abandoned"
        assert trajectory_verdict("expired", "On Track", None) == "expired"

    def test_badge_wins_over_alignment(self):
        """Projection answers 'will I hit it' — it outranks schedule math."""
        assert trajectory_verdict("active", "On Track", 5.0) == "on_track"
        assert trajectory_verdict("active", "At Risk", 150.0) == "behind"
        assert trajectory_verdict("active", "Unlikely", 150.0) == "off_track"

    def test_alignment_fallback_cut_points(self):
        assert trajectory_verdict("active", None, 120.0) == "ahead"
        assert trajectory_verdict("active", None, 90.0) == "on_track"
        assert trajectory_verdict("active", None, 50.0) == "behind"
        assert trajectory_verdict("active", None, 0.0) == "off_track"
        assert trajectory_verdict("active", None, -10.0) == "off_track"

    def test_nothing_to_read_is_unknown(self):
        assert trajectory_verdict("active", None, None) == "unknown"
        assert trajectory_verdict("active", "Not enough data", None) == "unknown"


# ── Due windows ────────────────────────────────────────────────────────


class TestGoalDueNotice:
    def test_windows(self):
        assert goal_due_notice(7) == "due in 7 days"
        assert goal_due_notice(1) == "due tomorrow"

    def test_everything_else_silent(self):
        assert goal_due_notice(3) is None
        assert goal_due_notice(0) is None
        assert goal_due_notice(-2) is None
        assert goal_due_notice(30) is None


# ── Deload-aware alignment ─────────────────────────────────────────────


def _goal(starting: float, target: float, created: datetime, target_date: date) -> Goal:
    return Goal(
        starting_value=starting,
        target_value=target,
        target_date=target_date,
        created_at=created,
    )


class TestDeloadAwareAlignment:
    CREATED = datetime(2026, 1, 1, tzinfo=UTC)
    TARGET = date(2026, 4, 11)  # 100-day span
    TODAY = date(2026, 1, 11)  # 10 days elapsed

    def test_baseline_unchanged_without_deload(self):
        goal = self._increasing()
        assert alignment_pct(goal, 110.0, self.TODAY) == 100.0

    def test_deload_days_raise_alignment(self):
        """5 deload days in 10 elapsed → same progress scores double."""
        goal = self._increasing()
        assert alignment_pct(goal, 110.0, self.TODAY, deload_days=5) == 200.0

    def test_all_days_deload_is_none(self):
        goal = self._increasing()
        assert alignment_pct(goal, 110.0, self.TODAY, deload_days=10) is None

    def test_negative_deload_clamped(self):
        goal = self._increasing()
        assert alignment_pct(goal, 110.0, self.TODAY, deload_days=-5) == 100.0

    def _increasing(self) -> Goal:
        return _goal(100.0, 200.0, self.CREATED, self.TARGET)
