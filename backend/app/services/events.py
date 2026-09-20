"""Event business logic (B-12: extracted from ``app/api/events.py``).

Route handlers own HTTP concerns (status codes, response models); everything
here is plain domain logic + DB work so schedulers and future callers can
reuse it. Service signature convention: ``(db, user_id, ...)``.
"""

from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event
from app.schemas.event import EventWithCountdown

VALID_EVENT_TYPES = {"race", "ride", "lift", "other"}


def enrich_event(event: Event) -> EventWithCountdown:
    """Add countdown and taper info to an event."""
    today = date.today()
    days_until = (event.event_date - today).days
    taper_start = event.event_date - timedelta(days=event.taper_days)
    days_until_taper = (taper_start - today).days
    is_in_taper = 0 <= days_until <= event.taper_days

    return EventWithCountdown(
        id=event.id,
        user_id=event.user_id,
        name=event.name,
        event_date=event.event_date,
        event_type=event.event_type,
        target_tss=event.target_tss,
        taper_days=event.taper_days,
        notes=event.notes,
        created_at=event.created_at,
        updated_at=event.updated_at,
        days_until=max(0, days_until),
        taper_start_date=taper_start,
        days_until_taper=days_until_taper,
        is_in_taper=is_in_taper,
        result=event.result,
    )


def format_result_summary(name: str, result: dict | None) -> str:
    """One-line human summary of a recorded event result."""
    if not result:
        return f"Result cleared for {name}."
    parts = []
    if result.get("finishing_position"):
        parts.append(f"#{result['finishing_position']} overall")
    if result.get("class_position"):
        parts.append(f"#{result['class_position']} class")
    if result.get("finishing_time"):
        parts.append(result["finishing_time"])
    if result.get("personal_best"):
        parts.append("🏅 personal best")
    if not parts:
        return f"Result logged for {name}."
    return f"{name}: {', '.join(parts)}."


async def get_event_for_user(
    db: AsyncSession, user_id, event_id
) -> Event | None:
    """Fetch one event scoped to its owner (None when missing/foreign)."""
    result = await db.execute(
        select(Event).where(Event.id == event_id, Event.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def record_event_result(
    db: AsyncSession, user_id, event: Event, payload: dict
) -> None:
    """Store a race result on the event and queue the ``event_result``
    notification. Flushes (no commit — the caller's session owns the
    transaction)."""
    from app.services.notifications import notify

    event.result = payload if payload else None
    event.result_updated_at = datetime.now(UTC)
    await db.flush()
    await notify(
        db,
        user_id,
        "event_result",
        title=f"Result logged — {event.name}",
        body=format_result_summary(event.name, payload),
        link="/training?tab=races",
        dedup_key=f"event_result:{event.id}",
    )
