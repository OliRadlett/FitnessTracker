"""The event taper is reversible and idempotent.

Link -> unlink -> link used to taper the already-tapered values (0.4 -> 0.16)
and leave the plan permanently shortened. The stored baseline makes both
operations restore the authored plan.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.models.event import Event
from app.schemas.training_plan import (
    TrainingPlanDayCreate,
    TrainingPlanDayUpdate,
    TrainingPlanUpdate,
)
from app.services.training_plan import (
    link_event_and_apply_taper,
    save_plan_days,
    update_plan,
    update_plan_day,
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


async def test_editing_a_tapered_day_survives_unlink(
    db_session, test_user, test_training_plan
):
    event = await _event(db_session, test_user)
    plan = await link_event_and_apply_taper(
        db_session, test_user.id, test_training_plan, event.id
    )
    target = next(day for day in plan.days if day.day_date == event.event_date)

    await update_plan_day(
        db_session,
        test_user.id,
        plan.id,
        target.id,
        TrainingPlanDayUpdate(planned_tss=77.0),
    )
    restored = await update_plan(
        db_session,
        test_user.id,
        plan.id,
        TrainingPlanUpdate(event_id=None),
    )
    assert next(d for d in restored.days if d.id == target.id).planned_tss == 77.0


async def test_unchanged_full_save_keeps_the_taper_baseline(
    db_session, test_user, test_training_plan
):
    event = await _event(db_session, test_user)
    original = await _tss_by_day(test_training_plan)
    plan = await link_event_and_apply_taper(
        db_session, test_user.id, test_training_plan, event.id
    )

    payload = [
        TrainingPlanDayCreate(
            day_date=day.day_date,
            sport=day.sport,
            planned_type=day.planned_type,
            planned_tss=day.planned_tss,
        )
        for day in plan.days
    ]
    plan = await save_plan_days(db_session, test_user.id, plan.id, payload)
    restored = await update_plan(
        db_session,
        test_user.id,
        plan.id,
        TrainingPlanUpdate(event_id=None),
    )
    assert await _tss_by_day(restored) == original


async def test_unlink_end_date_in_the_same_patch_wins(
    db_session, test_user, test_training_plan
):
    event = await _event(db_session, test_user)
    plan = await link_event_and_apply_taper(
        db_session, test_user.id, test_training_plan, event.id
    )
    requested_end = date.today() + timedelta(days=45)

    restored = await update_plan(
        db_session,
        test_user.id,
        plan.id,
        TrainingPlanUpdate(event_id=None, end_date=requested_end),
    )
    assert restored.end_date == requested_end


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
