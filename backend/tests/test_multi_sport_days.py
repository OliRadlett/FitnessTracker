"""Unit tests for the multi-sport date rules (no database).

``sports_conflict_on_date`` is the single predicate behind the add / copy /
reschedule / substitute / sport-change guards and the undo restore clash, so it
is tested directly rather than only through the integration suite (which needs
Postgres). The two in-place sport-change paths and the copy guard run against a
stubbed session, so their refusal is pinned here too, as is the rest-swap
action's refusal to target a date that holds more than one session.
"""

from __future__ import annotations

import uuid
from datetime import date
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.training_plan import TrainingPlan, TrainingPlanDay
from app.schemas.training_plan import TrainingPlanDayCreate, TrainingPlanDayUpdate
from app.services.adaptive import _actions_for
from app.services.training_plan import (
    PlanDayConflictError,
    _validate_days,
    copy_plan_day,
    sports_conflict_on_date,
    substitute_plan_day,
    update_plan_day,
)


class TestSportsConflictOnDate:
    @pytest.mark.parametrize(
        ("existing", "arriving"),
        [
            ("cycle", "cycle"),
            ("strength", "strength"),
            ("rest", "rest"),
            ("rest", "cycle"),
            ("rest", "strength"),
            ("cycle", "rest"),
            ("strength", "rest"),
        ],
    )
    def test_conflicts(self, existing: str, arriving: str):
        assert sports_conflict_on_date(existing, arriving) is True

    @pytest.mark.parametrize(
        ("existing", "arriving"),
        [("cycle", "strength"), ("strength", "cycle")],
    )
    def test_distinct_sports_share_a_date(self, existing: str, arriving: str):
        assert sports_conflict_on_date(existing, arriving) is False


class TestValidateDays:
    def test_accepts_two_sports_on_one_date(self):
        _validate_days(
            [
                TrainingPlanDayCreate(
                    day_date=date(2026, 8, 5), sport="cycle", planned_type="easy"
                ),
                TrainingPlanDayCreate(
                    day_date=date(2026, 8, 5), sport="strength", planned_type="moderate"
                ),
            ]
        )

    def test_rejects_the_same_sport_twice_on_one_date(self):
        with pytest.raises(ValueError, match="Duplicate cycle session"):
            _validate_days(
                [
                    TrainingPlanDayCreate(
                        day_date=date(2026, 8, 5), sport="cycle", planned_type="easy"
                    ),
                    TrainingPlanDayCreate(
                        day_date=date(2026, 8, 5), sport="cycle", planned_type="hard"
                    ),
                ]
            )

    def test_accepts_the_same_sport_on_different_dates(self):
        _validate_days(
            [
                TrainingPlanDayCreate(
                    day_date=date(2026, 8, 5), sport="cycle", planned_type="easy"
                ),
                TrainingPlanDayCreate(
                    day_date=date(2026, 8, 6), sport="cycle", planned_type="easy"
                ),
            ]
        )

    def test_rejects_rest_beside_a_session_on_one_date(self):
        # The upsert writes every pair the payload names, so a full-array save
        # could otherwise create the clash the targeted guards refuse.
        with pytest.raises(ValueError, match="Cannot put a rest session beside a cycle"):
            _validate_days(
                [
                    TrainingPlanDayCreate(
                        day_date=date(2026, 8, 5), sport="cycle", planned_type="easy"
                    ),
                    TrainingPlanDayCreate(
                        day_date=date(2026, 8, 5), sport="rest", planned_type="rest"
                    ),
                ]
            )

    def test_rejects_a_session_beside_rest_on_one_date(self):
        with pytest.raises(ValueError, match="Cannot put a cycle session beside a rest"):
            _validate_days(
                [
                    TrainingPlanDayCreate(
                        day_date=date(2026, 8, 5), sport="rest", planned_type="rest"
                    ),
                    TrainingPlanDayCreate(
                        day_date=date(2026, 8, 5), sport="cycle", planned_type="easy"
                    ),
                ]
            )

    def test_accepts_rest_beside_a_session_on_another_date(self):
        _validate_days(
            [
                TrainingPlanDayCreate(
                    day_date=date(2026, 8, 5), sport="cycle", planned_type="easy"
                ),
                TrainingPlanDayCreate(
                    day_date=date(2026, 8, 6), sport="rest", planned_type="rest"
                ),
            ]
        )


# ── A sport change on an existing row ───────────────────────────────────────
#
# ``substitute_plan_day`` and ``update_plan_day`` both change a row's sport in
# place, so both must consult the same date rule as the add / copy / reschedule
# guards. A stub session returns the plan (with its transient rows) so the
# refusal is reachable without Postgres.

DAY = date(2026, 8, 5)


def _plan_with(*rows: tuple[date, str, str]) -> TrainingPlan:
    plan = TrainingPlan(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        name="Sport-change plan",
        start_date=date(2026, 8, 1),
        end_date=date(2026, 9, 30),
        plan_type="custom",
        status="active",
    )
    plan.days = [
        TrainingPlanDay(
            id=uuid.uuid4(),
            plan_id=plan.id,
            day_date=day_date,
            sport=sport,
            planned_type=planned_type,
            completed=False,
        )
        for day_date, sport, planned_type in rows
    ]
    return plan


def _db_returning(plan: TrainingPlan) -> AsyncMock:
    db = AsyncMock()
    # ``AsyncSession.execute`` is awaited but its ``Result`` is not.
    db.execute.return_value.scalar_one_or_none = MagicMock(return_value=plan)
    # ``AsyncSession.add`` is synchronous.
    db.add = MagicMock()
    return db


class TestSubstituteSportChange:
    async def test_refuses_a_sibling_of_the_sport_it_would_set(self):
        plan = _plan_with((DAY, "cycle", "easy"), (DAY, "strength", "moderate"))
        _, lift = plan.days

        with pytest.raises(PlanDayConflictError, match="already holds a cycle"):
            await substitute_plan_day(
                _db_returning(plan), plan.user_id, plan.id, lift.id, "cycle", "easy"
            )

        assert (lift.sport, lift.planned_type) == ("strength", "moderate")

    async def test_refuses_rest_beside_a_session(self):
        plan = _plan_with((DAY, "cycle", "easy"), (DAY, "strength", "moderate"))
        _, lift = plan.days

        with pytest.raises(PlanDayConflictError, match="already holds a cycle"):
            await substitute_plan_day(
                _db_returning(plan), plan.user_id, plan.id, lift.id, "rest", "rest"
            )

        assert lift.sport == "strength"

    async def test_refuses_a_move_off_rest_onto_the_sessions_sport(self):
        # Built directly: the state the rule exists to prevent.
        plan = _plan_with((DAY, "rest", "rest"), (DAY, "cycle", "easy"))
        rest = plan.days[0]

        with pytest.raises(PlanDayConflictError, match="already holds a cycle"):
            await substitute_plan_day(
                _db_returning(plan), plan.user_id, plan.id, rest.id, "cycle", "easy"
            )

        assert rest.sport == "rest"

    async def test_allows_a_sport_that_conflicts_with_nothing(self):
        plan = _plan_with((DAY, "cycle", "hard"), (date(2026, 8, 6), "strength", "moderate"))
        ride = plan.days[0]

        day = await substitute_plan_day(
            _db_returning(plan), plan.user_id, plan.id, ride.id, "strength", "moderate"
        )

        assert (day.sport, day.planned_type) == ("strength", "moderate")

    async def test_allows_rest_on_a_date_holding_only_this_row(self):
        plan = _plan_with((DAY, "cycle", "hard"))
        ride = plan.days[0]

        day = await substitute_plan_day(
            _db_returning(plan), plan.user_id, plan.id, ride.id, "rest", "rest"
        )

        assert day.sport == "rest"


class TestUpdateDaySportChange:
    async def test_refuses_a_sibling_of_the_sport_it_would_set(self):
        plan = _plan_with((DAY, "cycle", "easy"), (DAY, "strength", "moderate"))
        _, lift = plan.days

        with pytest.raises(PlanDayConflictError, match="already holds a cycle"):
            await update_plan_day(
                _db_returning(plan),
                plan.user_id,
                plan.id,
                lift.id,
                TrainingPlanDayUpdate(sport="cycle", planned_tss=50.0),
            )

        assert (lift.sport, lift.planned_tss) == ("strength", None)

    async def test_refuses_rest_beside_a_session(self):
        plan = _plan_with((DAY, "cycle", "easy"), (DAY, "strength", "moderate"))
        _, lift = plan.days

        with pytest.raises(PlanDayConflictError, match="already holds a cycle"):
            await update_plan_day(
                _db_returning(plan),
                plan.user_id,
                plan.id,
                lift.id,
                TrainingPlanDayUpdate(sport="rest", planned_type="rest"),
            )

        assert (lift.sport, lift.planned_type) == ("strength", "moderate")

    async def test_refuses_a_move_off_rest_onto_the_sessions_sport(self):
        plan = _plan_with((DAY, "rest", "rest"), (DAY, "cycle", "easy"))
        rest = plan.days[0]

        with pytest.raises(PlanDayConflictError, match="already holds a cycle"):
            await update_plan_day(
                _db_returning(plan),
                plan.user_id,
                plan.id,
                rest.id,
                TrainingPlanDayUpdate(sport="cycle", planned_type="easy"),
            )

        assert rest.sport == "rest"

    async def test_allows_a_sport_that_conflicts_with_nothing(self):
        plan = _plan_with((DAY, "cycle", "hard"), (date(2026, 8, 6), "strength", "moderate"))
        ride = plan.days[0]

        day = await update_plan_day(
            _db_returning(plan),
            plan.user_id,
            plan.id,
            ride.id,
            TrainingPlanDayUpdate(sport="strength", planned_tss=70.0),
        )

        assert (day.sport, day.planned_tss) == ("strength", 70.0)

    async def test_a_payload_that_restates_the_sport_is_not_a_new_clash(self):
        # Two rows of one sport already on the date (pre-guard data). Restating
        # the sport changes nothing, so the payload is not refused.
        plan = _plan_with((DAY, "cycle", "easy"), (DAY, "cycle", "hard"))
        ride = plan.days[0]

        day = await update_plan_day(
            _db_returning(plan),
            plan.user_id,
            plan.id,
            ride.id,
            TrainingPlanDayUpdate(sport="cycle", planned_tss=95.0),
        )

        assert (day.sport, day.planned_tss) == ("cycle", 95.0)

    async def test_a_payload_without_a_sport_is_untouched(self):
        plan = _plan_with((DAY, "cycle", "easy"), (DAY, "strength", "moderate"))
        _, lift = plan.days

        day = await update_plan_day(
            _db_returning(plan),
            plan.user_id,
            plan.id,
            lift.id,
            TrainingPlanDayUpdate(planned_tss=80.0),
        )

        assert (day.sport, day.planned_tss) == ("strength", 80.0)


# ── Copying onto a date that already holds a session ────────────────────────
#
# ``copy_plan_day`` creates a row rather than moving one, so its clash is the
# same rule as the other four guards and is answered with the same error type —
# one rule, one status (409).

TARGET = date(2026, 8, 20)


class TestCopyOntoASharedDate:
    async def test_refuses_a_target_holding_the_same_sport(self):
        plan = _plan_with((DAY, "cycle", "easy"), (TARGET, "cycle", "moderate"))
        ride = plan.days[0]

        with pytest.raises(PlanDayConflictError, match="already exists at the target"):
            await copy_plan_day(
                _db_returning(plan), plan.user_id, plan.id, ride.id, TARGET
            )

    async def test_refuses_rest_beside_a_target_session(self):
        plan = _plan_with((DAY, "rest", "rest"), (TARGET, "cycle", "moderate"))
        rest = plan.days[0]

        with pytest.raises(PlanDayConflictError, match="already exists at the target"):
            await copy_plan_day(
                _db_returning(plan), plan.user_id, plan.id, rest.id, TARGET
            )

    async def test_allows_a_target_holding_another_sport(self):
        plan = _plan_with((DAY, "cycle", "easy"), (TARGET, "strength", "moderate"))
        ride = plan.days[0]

        copied = await copy_plan_day(
            _db_returning(plan), plan.user_id, plan.id, ride.id, TARGET
        )

        assert (copied.day_date, copied.sport) == (TARGET, "cycle")


# ── The autoregulation rest swap ────────────────────────────────────────────
#
# The action's intent is to rest a *day*, which a date holding two sessions
# cannot express, so no action is offered there. ``plan_day_dates`` carries one
# entry per plan session on the dates in question, which is what tells the two
# apart.


class TestRestSwapActions:
    def test_offers_the_swap_on_a_date_that_holds_one_session(self):
        plan = _plan_with((DAY, "cycle", "easy"))

        actions = _actions_for(
            plan.id, plan.days, "rest", 1.0, force_rest=True, plan_day_dates=[DAY]
        )

        assert actions == [
            {
                "label": f"Rest on {DAY.isoformat()}",
                "plan_id": str(plan.id),
                "day_id": str(plan.days[0].id),
                "fields": {"sport": "rest", "planned_type": "rest"},
            }
        ]

    def test_skips_a_date_that_holds_two_sessions(self):
        other = date(2026, 8, 6)
        plan = _plan_with(
            (DAY, "cycle", "easy"),
            (DAY, "strength", "moderate"),
            (other, "cycle", "easy"),
        )

        actions = _actions_for(
            plan.id,
            plan.days,
            "rest",
            1.0,
            force_rest=True,
            plan_day_dates=[DAY, DAY, other],
        )

        assert [a["day_id"] for a in actions] == [str(plan.days[2].id)]
