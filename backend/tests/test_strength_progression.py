"""Unit tests for the S1 RPE → %1RM conversion (pure functions, no database).

The conversion inverts ``brzycki_1rm`` with reps-in-reserve, so the two must
agree exactly at RPE 10 — that invariant is the reason there is only one
formula in the app rather than a fitted second curve.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.services.lifting import brzycki_1rm, round_to_plate, rpe_to_pct


class TestRpeToPct:
    def test_rpe10_single_is_full_1rm(self):
        assert rpe_to_pct(1, 10) == pytest.approx(1.00)

    def test_rpe8_five_reps(self):
        """5 reps at RPE 8 → 2 in reserve → 7 effective reps → 30/36."""
        assert rpe_to_pct(5, 8) == pytest.approx(0.8333, abs=0.0001)

    def test_rpe7_eight_reps(self):
        """8 reps at RPE 7 → 3 in reserve → 11 effective reps → 26/36."""
        assert rpe_to_pct(8, 7) == pytest.approx(0.7222, abs=0.0001)

    @pytest.mark.parametrize("reps", [1, 2, 3, 5, 8, 10, 12])
    def test_rpe10_inverts_brzycki_exactly(self, reps: int):
        """At RPE 10 there are no reps in reserve: pct must be weight / e1RM.

        This is the "one formula" guarantee — a prescription can never disagree
        with the e1RM the same set would earn in PRs and charts.
        """
        weight = 100.0
        e1rm = brzycki_1rm(weight, reps)
        assert rpe_to_pct(reps, 10) == pytest.approx(weight / e1rm)

    def test_lower_rpe_gives_lighter_load(self):
        """Monotonic in RPE: more reps in reserve → a smaller fraction."""
        pcts = [rpe_to_pct(5, rpe) for rpe in (10, 9, 8, 7, 6)]
        assert pcts == sorted(pcts, reverse=True)
        assert len(set(pcts)) == len(pcts)

    def test_more_reps_at_same_rpe_is_lighter(self):
        pcts = [rpe_to_pct(reps, 8) for reps in (1, 3, 5, 8, 12)]
        assert pcts == sorted(pcts, reverse=True)

    def test_floor_clamps_low_effort(self):
        """A very high-rep set cannot fall below 30% of e1RM."""
        assert rpe_to_pct(30, 10) == pytest.approx(0.30)
        assert rpe_to_pct(36, 5) == pytest.approx(0.30)

    def test_ceiling_clamps_above_100(self):
        """An RPE above 10 (or nonsense input) cannot exceed 100%."""
        assert rpe_to_pct(1, 20) == pytest.approx(1.00)
        assert rpe_to_pct(1, 10) == pytest.approx(1.00)

    def test_reps_below_one_raises(self):
        with pytest.raises(ValueError, match="reps must be >= 1"):
            rpe_to_pct(0, 8)

    def test_reps_above_pr_range_still_computes(self):
        """The >12 guard belongs to the caller (skipped_reason), not here.

        The number is computed for any rep count so the function stays total;
        it is simply never *presented* as trustworthy past 12 reps.
        """
        assert 0.30 <= rpe_to_pct(15, 8) <= 1.00


class TestRoundToPlate:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            (149.9, 150.0),
            (150.0, 150.0),
            (101.2, 101.0),
            (101.3, 101.5),
            (102.75, 103.0),
            (0.5, 0.5),
        ],
    )
    def test_rounds_to_half_kilo(self, raw: float, expected: float):
        assert round_to_plate(raw) == pytest.approx(expected)

    def test_zero_increment_is_identity(self):
        assert round_to_plate(101.234, increment=0) == pytest.approx(101.234)


# ── Rule resolution (week numbering · ramp · deload) ──────────────────────
#
# These helpers are pure (they take the plan/day objects only for their
# attributes), so the ramp arithmetic is testable without a database — which
# matters because the deload rule is the part most easily got wrong.


def _plan(start: date, end: date):
    from types import SimpleNamespace

    return SimpleNamespace(start_date=start, end_date=end)


def _day(plan, day_date: date, exercises: list[dict] | None = None):
    from types import SimpleNamespace

    return SimpleNamespace(
        day_date=day_date, sport="strength", planned_exercises=exercises or []
    )


class TestWeekNumbering:
    def test_week_one_starts_on_the_monday_of_the_start_week(self):
        from app.services.training_plan import _week_number_for

        monday = date(2026, 10, 5)  # a Monday
        plan = _plan(monday, monday + timedelta(weeks=7))
        assert _week_number_for(plan, monday) == 1
        assert _week_number_for(plan, monday + timedelta(days=6)) == 1
        assert _week_number_for(plan, monday + timedelta(days=7)) == 2
        assert _week_number_for(plan, monday + timedelta(days=27)) == 4
        assert _week_number_for(plan, monday + timedelta(days=28)) == 5

    def test_mid_week_start_still_belongs_to_week_one(self):
        from app.services.training_plan import _week_number_for

        wednesday = date(2026, 10, 7)
        plan = _plan(wednesday, wednesday + timedelta(weeks=4))
        assert _week_number_for(plan, wednesday) == 1
        assert _week_number_for(plan, wednesday - timedelta(days=2)) == 1  # Monday


class TestRuleTargets:
    def test_ramp_applies_weekly_deltas(self):
        from app.services.training_plan import _rule_targets

        rule = {
            "exercise": "Back Squat",
            "mode": "rpe",
            "start": {"sets": 5, "reps": 5, "rpe": 7},
            "weekly": {"rpe_delta": 0.5},
        }
        assert _rule_targets(rule, 1) == (5, 5, 7.0, False)
        assert _rule_targets(rule, 2) == (5, 5, 7.5, False)
        assert _rule_targets(rule, 3) == (5, 5, 8.0, False)

    def test_sets_and_reps_deltas(self):
        from app.services.training_plan import _rule_targets

        rule = {
            "start": {"sets": 3, "reps": 5, "rpe": 8},
            "weekly": {"sets_delta": 1, "reps_delta": 1},
        }
        assert _rule_targets(rule, 1) == (3, 5, 8.0, False)
        assert _rule_targets(rule, 3) == (5, 7, 8.0, False)

    def test_deload_week_suppresses_the_increment_and_drops_an_rpe(self):
        """Every 4th week: the ramp does not advance and the RPE drops by 1."""
        from app.services.training_plan import _rule_targets

        rule = {
            "start": {"sets": 5, "reps": 5, "rpe": 7},
            "weekly": {"rpe_delta": 0.5},
            "deload_every": 4,
        }
        assert _rule_targets(rule, 3) == (5, 5, 8.0, False)
        # Week 4 would ramp to 8.5; suppressed to week 3's 8.0, then −1 RPE.
        assert _rule_targets(rule, 4) == (5, 5, 7.0, True)
        # The ramp resumes its own trajectory afterwards.
        assert _rule_targets(rule, 5) == (5, 5, 9.0, False)

    def test_rpe_never_leaves_the_1_to_10_range(self):
        from app.services.training_plan import _rule_targets

        rule = {"start": {"rpe": 1.0}, "weekly": {"rpe_delta": -1}, "deload_every": 2}
        _, _, rpe, is_deload = _rule_targets(rule, 2)
        assert is_deload is True
        assert rpe == 1.0

    def test_empty_rule_returns_nothing(self):
        from app.services.training_plan import _rule_targets

        assert _rule_targets({}, 3) == (None, None, None, False)


class TestRulesByExercise:
    def test_rules_are_keyed_by_normalised_name(self):
        from app.services.training_plan import _rules_by_exercise

        rules = _rules_by_exercise(
            [{"exercise": "back squat", "mode": "load"}, {"exercise": "Bench Press"}]
        )
        assert set(rules) == {"Back Squat", "Bench Press"}
        assert rules["Back Squat"]["mode"] == "load"

    def test_malformed_rules_are_ignored_not_raised(self):
        """Rules are raw JSONB: a bad row means "no rule", never a 500."""
        from app.services.training_plan import _rules_by_exercise

        assert _rules_by_exercise(None) == {}
        assert _rules_by_exercise(["nope", {}, {"exercise": "   "}]) == {}


class TestPrescribedLoadsByWeek:
    def test_later_day_in_the_week_wins(self):
        from app.services.training_plan import _prescribed_loads_by_week

        monday = date(2026, 10, 5)
        plan = _plan(monday, monday + timedelta(weeks=3))
        plan.days = [
            _day(
                plan,
                monday,
                [{"exercise": "Back Squat", "sets": 5, "reps": 5, "weight_kg": 100.0}],
            ),
            _day(
                plan,
                monday + timedelta(days=3),
                [{"exercise": "Back Squat", "sets": 5, "reps": 5, "weight_kg": 102.5}],
            ),
            _day(
                plan,
                monday + timedelta(days=7),
                [{"exercise": "Back Squat", "sets": 5, "reps": 5, "weight_kg": 105.0}],
            ),
        ]
        loads = _prescribed_loads_by_week(plan)
        assert loads[("Back Squat", 1)] == 102.5
        assert loads[("Back Squat", 2)] == 105.0

    def test_entries_without_a_weight_are_not_chained_from(self):
        from app.services.training_plan import _prescribed_loads_by_week

        monday = date(2026, 10, 5)
        plan = _plan(monday, monday + timedelta(weeks=3))
        plan.days = [
            _day(
                plan,
                monday,
                [{"exercise": "Back Squat", "sets": 5, "reps": 5, "weight_kg": None}],
            )
        ]
        assert _prescribed_loads_by_week(plan) == {}

