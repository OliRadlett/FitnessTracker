"""Integration: ``extend_plan`` against real Postgres.

The unit suite pins the rules against a stubbed session; this proves the parts a
stub cannot — that the rows actually flush, that ``end_date`` persists, that the
date range arithmetic survives real ``date`` columns, and that a second call
finds the dates occupied and creates nothing.

The case is the owner's real plan: content stopping mid-plan inside a 20-week
range. That is the state the page's primary action exists for.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training_plan import TrainingPlan, TrainingPlanDay
from app.models.user import User
from app.services.training_plan import extend_plan

PLAN_START = date(2026, 8, 24)  # a Monday


async def _make_plan(
    db: AsyncSession, user: User, *, weeks: int, end: date
) -> TrainingPlan:
    """A plan with `weeks` authored weeks, one strength day Mon + a rest Sun."""
    plan = TrainingPlan(
        id=uuid.uuid4(),
        user_id=user.id,
        name="Extend integration plan",
        start_date=PLAN_START,
        end_date=end,
        plan_type="custom",
        status="active",
    )
    db.add(plan)
    await db.flush()

    for week in range(weeks):
        monday = PLAN_START + timedelta(days=week * 7)
        db.add(
            TrainingPlanDay(
                plan_id=plan.id,
                day_date=monday,
                sport="strength",
                planned_type="moderate",
                planned_tss=80,
                workout_description=f"Week {week + 1} squat",
            )
        )
        db.add(
            TrainingPlanDay(
                plan_id=plan.id,
                day_date=monday + timedelta(days=6),
                sport="rest",
                planned_type="rest",
            )
        )
    await db.commit()
    await db.refresh(plan)
    return plan


async def _days(db: AsyncSession, plan_id: uuid.UUID) -> list[TrainingPlanDay]:
    result = await db.execute(
        select(TrainingPlanDay)
        .where(TrainingPlanDay.plan_id == plan_id)
        .order_by(TrainingPlanDay.day_date)
    )
    return list(result.scalars().all())


class TestExtendPlanIntegration:
    async def test_fills_forward_and_persists(self, db_session: AsyncSession, test_user: User):
        plan = await _make_plan(db_session, test_user, weeks=2, end=PLAN_START + timedelta(days=60))
        # Week 3 is empty; fill it and the week after.
        until = PLAN_START + timedelta(days=27)  # Sunday of week 4

        result = await extend_plan(db_session, test_user.id, plan.id, until)
        await db_session.commit()

        assert result["created"] == 4  # two empty weeks × (Mon strength + Sun rest)
        days = await _days(db_session, plan.id)
        assert len(days) == 4 * 7 - (4 * 5)  # only Mon + Sun per week are authored

        # The pattern carried: every new Monday is strength, every Sunday is rest.
        mondays = [d for d in days if d.day_date.weekday() == 0]
        sundays = [d for d in days if d.day_date.weekday() == 6]
        assert all(d.sport == "strength" for d in mondays)
        assert all(d.sport == "rest" for d in sundays)
        assert {d.planned_tss for d in mondays} == {80}
        # The pattern is the *last written* week's — two authored weeks differ, so
        # the created ones all carry week 2's description.
        created_mondays = [d for d in mondays if d.day_date >= PLAN_START + timedelta(days=14)]
        assert created_mondays
        assert {d.workout_description for d in created_mondays} == {"Week 2 squat"}

        # Nothing landed on a weekday the source week did not use.
        assert not [
            d for d in days if d.day_date.weekday() not in (0, 6)
        ]

    async def test_second_call_creates_nothing(self, db_session: AsyncSession, test_user: User):
        plan = await _make_plan(db_session, test_user, weeks=1, end=PLAN_START + timedelta(days=60))
        until = PLAN_START + timedelta(days=13)

        first = await extend_plan(db_session, test_user.id, plan.id, until)
        await db_session.commit()
        before = len(await _days(db_session, plan.id))

        second = await extend_plan(db_session, test_user.id, plan.id, until)
        await db_session.commit()
        after = len(await _days(db_session, plan.id))

        assert first["created"] > 0
        assert second["created"] == 0
        assert after == before

    async def test_raises_the_range_so_created_days_are_inside_it(
        self, db_session: AsyncSession, test_user: User
    ):
        plan = await _make_plan(db_session, test_user, weeks=1, end=PLAN_START + timedelta(days=6))
        until = PLAN_START + timedelta(days=40)

        await extend_plan(db_session, test_user.id, plan.id, until)
        await db_session.commit()

        refreshed = await db_session.get(TrainingPlan, plan.id)
        assert refreshed is not None
        assert refreshed.end_date == until
        days = await _days(db_session, plan.id)
        assert max(d.day_date for d in days) <= refreshed.end_date

    async def test_never_touches_an_authored_day(self, db_session: AsyncSession, test_user: User):
        plan = await _make_plan(db_session, test_user, weeks=1, end=PLAN_START + timedelta(days=60))
        authored = next(
            d for d in await _days(db_session, plan.id) if d.day_date == PLAN_START
        )
        authored_id = authored.id
        authored.completed = True
        await db_session.commit()

        await extend_plan(db_session, test_user.id, plan.id, PLAN_START + timedelta(days=20))
        await db_session.commit()

        days = await _days(db_session, plan.id)
        same = [d for d in days if d.day_date == PLAN_START]
        assert len(same) == 1
        assert same[0].id == authored_id
        assert same[0].completed is True
