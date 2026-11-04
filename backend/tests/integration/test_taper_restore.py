"""The event taper is reversible and idempotent.

Link -> unlink -> link used to taper the already-tapered values (0.4 -> 0.16)
and leave the plan permanently shortened. The stored baseline makes both
operations restore the authored plan.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.models.event import Event
from app.schemas.training_plan import TrainingPlanUpdate
from app.services.training_plan import (
    link_event_and_apply_taper,
    update_plan,
)

pytestmark = pytest.mark.integration


async def _event(db_session, user) -> Event:
    event = Event(
        user_id=user.id,
        name="Taper Test Race",
        event_date=date.today() + timedelta(days=6),
        event_type="race",
        target_tss=250.0,
        taper_days=3,
    )
    db_session.add(event)
    await db_session.flush()
    return event


async def _tss_by_day(plan) -> dict[date, float | None]:
    return {day.day_date: day.planned_tss for day in plan.days}


async def test_unlink_restores_and_relink_does_not_compound(
    db_session, test_user, test_training_plan
):
    event = await _event(db_session, test_user)
    plan = test_training_plan
    original_tss = await _tss_by_day(plan)
    original_end = plan.end_date

    plan = await link_event_and_apply_taper(
        db_session, test_user.id, plan, event.id
    )
    tapered = await _tss_by_day(plan)
    assert plan.taper_event_id == event.id
    assert plan.end_date == event.event_date
    assert any(tapered[d] != original_tss[d] for d in original_tss)

    restored = await update_plan(
        db_session,
        test_user.id,
        plan.id,
        TrainingPlanUpdate(event_id=None),
    )
    assert restored.taper_event_id is None
    assert restored.end_date == original_end
    assert await _tss_by_day(restored) == original_tss

    relinked = await link_event_and_apply_taper(
        db_session, test_user.id, restored, event.id
    )
    assert await _tss_by_day(relinked) == tapered


async def test_relinking_the_same_event_is_a_noop(
    db_session, test_user, test_training_plan
):
    event = await _event(db_session, test_user)
    plan = await link_event_and_apply_taper(
        db_session, test_user.id, test_training_plan, event.id
    )
    once = await _tss_by_day(plan)

    again = await link_event_and_apply_taper(
        db_session, test_user.id, plan, event.id
    )
    assert await _tss_by_day(again) == once
