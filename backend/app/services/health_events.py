"""User-marked health event CRUD and alert-overlap validation.

These labels are self-reported. They are used to measure whether the shipped
alerts fired inside a period the athlete actually called illness/injury; they
do not auto-tune any score.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.health_alert import HealthAlert
from app.models.health_event import HealthEvent
from app.schemas.health_event import HealthEventCreate, HealthEventUpdate

MATCH_TOLERANCE_DAYS = 3


async def list_health_events(
    db: AsyncSession, user_id: uuid.UUID, days: int = 365
) -> list[HealthEvent]:
    cutoff = date.today() - timedelta(days=days)
    result = await db.execute(
        select(HealthEvent)
        .where(
            HealthEvent.user_id == user_id,
            (HealthEvent.end_date.is_(None)) | (HealthEvent.end_date >= cutoff),
        )
        .order_by(HealthEvent.start_date.desc())
    )
    return list(result.scalars().all())


async def create_health_event(
    db: AsyncSession, user_id: uuid.UUID, payload: HealthEventCreate
) -> HealthEvent:
    event = HealthEvent(user_id=user_id, **payload.model_dump())
    db.add(event)
    await db.flush()
    await db.refresh(event)
    return event


async def update_health_event(
    db: AsyncSession,
    user_id: uuid.UUID,
    event_id: uuid.UUID,
    payload: HealthEventUpdate,
) -> HealthEvent | None:
    result = await db.execute(
        select(HealthEvent).where(
            HealthEvent.id == event_id, HealthEvent.user_id == user_id
        )
    )
    event = result.scalar_one_or_none()
    if event is None:
        return None
    for field in payload.model_fields_set:
        value = getattr(payload, field)
        if value is None and field in {"event_type", "start_date", "severity"}:
            raise ValueError(f"{field} cannot be null")
        setattr(event, field, value)
    if event.end_date is not None and event.end_date < event.start_date:
        raise ValueError("end_date must be on or after start_date")
    await db.flush()
    await db.refresh(event)
    return event


async def delete_health_event(
    db: AsyncSession, user_id: uuid.UUID, event_id: uuid.UUID
) -> bool:
    result = await db.execute(
        select(HealthEvent).where(
            HealthEvent.id == event_id, HealthEvent.user_id == user_id
        )
    )
    event = result.scalar_one_or_none()
    if event is None:
        return False
    await db.delete(event)
    await db.flush()
    return True


async def validate_health_alerts(
    db: AsyncSession, user_id: uuid.UUID, days: int = 365
) -> dict:
    """Overlap persisted alerts with self-reported health-event periods."""
    cutoff = date.today() - timedelta(days=days)
    events = await list_health_events(db, user_id, days)
    result = await db.execute(
        select(HealthAlert.detected_date).where(
            HealthAlert.user_id == user_id,
            HealthAlert.detected_date >= cutoff,
        )
    )
    alert_dates = [row[0] for row in result.all()]

    matched = 0
    covered = 0
    for event in events:
        event_end = event.end_date or date.today()
        has_alert = False
        for alert_date in alert_dates:
            if (
                event.start_date - timedelta(days=MATCH_TOLERANCE_DAYS)
                <= alert_date
                <= event_end + timedelta(days=MATCH_TOLERANCE_DAYS)
            ):
                has_alert = True
                break
        covered += int(has_alert)

    for alert_date in alert_dates:
        if any(
            event.start_date - timedelta(days=MATCH_TOLERANCE_DAYS)
            <= alert_date
            <= (event.end_date or date.today())
            + timedelta(days=MATCH_TOLERANCE_DAYS)
            for event in events
        ):
            matched += 1

    return {
        "window_days": days,
        "events": len(events),
        "alerts": len(alert_dates),
        "matched_alerts": matched,
        "alert_precision": round(matched / len(alert_dates), 3)
        if alert_dates
        else None,
        "covered_events": covered,
        "event_coverage": round(covered / len(events), 3) if events else None,
    }
