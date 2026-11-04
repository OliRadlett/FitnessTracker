"""Unit tests for ``extend_plan`` — the "write the plan forward" primitive.

No database: the service is exercised against a stubbed session, so the rules
that matter are pinned without Postgres — the pattern source, the fill-only-empty
guarantee, the range extension, and the idempotency of a retry.

The case that motivated the endpoint is the owner's real plan: content stopping
mid-week 8 of a 20-week range, which the page reported as "96% complete".
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.training_plan import TrainingPlan, TrainingPlanDay
from app.services.training_plan import extend_plan

PLAN_START = date(2026, 8, 24)  # a Monday
PLAN_END = date(2027, 1, 10)  # 20 weeks


def _day(plan_id, d: date, sport: str, *, tss: float | None = None) -> TrainingPlanDay:
    day = TrainingPlanDay(plan_id=plan_id, day_date=d, sport=sport, planned_type="easy")
    day.planned_tss = tss
    day.completed = False
    return day


def _plan(days: list[TrainingPlanDay]) -> TrainingPlan:
    plan = TrainingPlan(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        name="Post summer strength",
        start_date=PLAN_START,
        end_date=PLAN_END,
        plan_type="custom",
        status="active",
    )
    plan.days = days
    return plan


def _db_returning(plan: TrainingPlan) -> tuple[AsyncMock, list[TrainingPlanDay]]:
    """A stubbed session that records the rows the service adds."""
    db = AsyncMock()
    db.execute.return_value.scalar_one_or_none = MagicMock(return_value=plan)
    added: list[TrainingPlanDay] = []
    db.add = MagicMock(side_effect=added.append)
    return db, added


def _week(days: list[TrainingPlanDay], start: date) -> list[TrainingPlanDay]:
    return [d for d in days if start <= d.day_date < start + timedelta(days=7)]


class TestExtendPlan:
    async def test_fills_only_dates_that_are_empty(self):
        # Two written weeks; the third is empty and must be filled from week 2.
        plan_id = uuid.uuid4()
        days = []
        for offset in range(14):
            days.append(
                _day(plan_id, PLAN_START + timedelta(days=offset), "strength", tss=60)
            )
        plan = _plan(days)
        db, added = _db_returning(plan)

        # Week 3 starts on day 14; extend to the end of week 3 (day 20).
        target = PLAN_START + timedelta(days=20)
        result = await extend_plan(db, plan.user_id, plan.id, target)

        assert result["created"] == 7
        assert result["source_week"] == 2
        # Every created date is inside the empty week and mirrors its weekday.
        created_dates = sorted(d.day_date for d in added)
        assert created_dates[0] == PLAN_START + timedelta(days=14)
        assert created_dates[-1] == target
        for d in added:
            assert d.sport == "strength"
            assert d.planned_tss == 60
            # Server-owned columns are never copied onto a new day. `completed`
            # is None on an unflushed row (the column default lands at flush),
            # which is exactly why the copy must not carry it.
            assert not d.completed
            assert d.activity_id is None

    async def test_is_idempotent_on_a_retry(self):
        """A second call finds every date occupied and creates nothing."""
        plan_id = uuid.uuid4()
        days = [_day(plan_id, PLAN_START + timedelta(days=i), "cycle") for i in range(7)]
        plan = _plan(days)
        target = PLAN_START + timedelta(days=13)

        db, added = _db_returning(plan)
        first = await extend_plan(db, plan.user_id, plan.id, target)
        assert first["created"] == 7

        # The session now holds those days, exactly as a real plan refresh would.
        plan.days = days + added
        db2, added2 = _db_returning(plan)
        second = await extend_plan(db2, plan.user_id, plan.id, target)
        assert second["created"] == 0
        assert added2 == []

    async def test_extends_the_claimed_range(self):
        plan_id = uuid.uuid4()
        plan = _plan([_day(plan_id, PLAN_START, "strength")])
        plan.end_date = PLAN_START + timedelta(days=6)
        db, _ = _db_returning(plan)

        target = PLAN_START + timedelta(days=30)
        result = await extend_plan(db, plan.user_id, plan.id, target)

        assert plan.end_date == target
        assert result["end_date"] == target

    async def test_copies_the_requested_source_week(self):
        plan_id = uuid.uuid4()
        days = [
            _day(plan_id, PLAN_START + timedelta(days=i), "cycle", tss=40)
            for i in range(7)
        ] + [
            _day(plan_id, PLAN_START + timedelta(days=7 + i), "strength", tss=90)
            for i in range(7)
        ]
        plan = _plan(days)
        db, added = _db_returning(plan)

        target = PLAN_START + timedelta(days=20)
        result = await extend_plan(db, plan.user_id, plan.id, target, source_week=1)

        assert result["source_week"] == 1
        assert {d.sport for d in added} == {"cycle"}
        assert {d.planned_tss for d in added} == {40}

    async def test_refuses_a_plan_with_nothing_to_copy(self):
        plan = _plan([])
        db, _ = _db_returning(plan)
        with pytest.raises(ValueError, match="no days to copy"):
            await extend_plan(db, plan.user_id, plan.id, PLAN_START + timedelta(days=7))

    async def test_refuses_an_unknown_source_week(self):
        plan_id = uuid.uuid4()
        plan = _plan([_day(plan_id, PLAN_START, "strength")])
        db, _ = _db_returning(plan)
        with pytest.raises(ValueError, match="Week 9 has no days"):
            await extend_plan(
                db, plan.user_id, plan.id, PLAN_START + timedelta(days=7), source_week=9
            )

    async def test_refuses_an_until_before_the_plan_starts(self):
        plan_id = uuid.uuid4()
        plan = _plan([_day(plan_id, PLAN_START, "strength")])
        db, _ = _db_returning(plan)
        with pytest.raises(ValueError, match="before the plan start"):
            await extend_plan(db, plan.user_id, plan.id, PLAN_START - timedelta(days=1))

    async def test_rest_days_are_part_of_the_pattern(self):
        """A rest day is a plan decision; the copy keeps the week's shape."""
        plan_id = uuid.uuid4()
        days = [
            _day(plan_id, PLAN_START + timedelta(days=0), "rest"),
            _day(plan_id, PLAN_START + timedelta(days=1), "strength", tss=70),
        ]
        plan = _plan(days)
        db, added = _returning_and_added(plan)

        target = PLAN_START + timedelta(days=13)
        await extend_plan(db, plan.user_id, plan.id, target)

        weekdays = sorted(d.day_date for d in added)
        assert weekdays == [
            PLAN_START + timedelta(days=7),
            PLAN_START + timedelta(days=8),
        ]
        assert {d.sport for d in added} == {"rest", "strength"}


def _returning_and_added(plan: TrainingPlan):
    return _db_returning(plan)
