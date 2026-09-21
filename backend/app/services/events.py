"""Event business logic (B-12: extracted from ``app/api/events.py``).

Route handlers own HTTP concerns (status codes, response models); everything
here is plain domain logic + DB work so schedulers and future callers can
reuse it. Service signature convention: ``(db, user_id, ...)``.
"""

import logging
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event
from app.schemas.event import EventWithCountdown

logger = logging.getLogger(__name__)

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


async def compute_retrospective(
    db: AsyncSession, user_id, event: Event
) -> dict:
    """Post-race retrospective (B-21): result vs projection + conformity.

    Links by date proximity (no new tables): race-day activity (same date),
    taper-week load (7d before), pre-race TSB, and the linked training plan's
    target. Everything is observed data — the interpretation is left to the
    reader (and the B-18 explain layer if wired later).
    """
    from app.models.activity import Activity
    from app.models.training_plan import TrainingPlan

    day = event.event_date
    week_ago = day - timedelta(days=7)

    acts = (
        await db.execute(
            select(Activity).where(
                Activity.user_id == user_id,
                Activity.start_date >= week_ago,
                Activity.start_date < day + timedelta(days=1),
            )
        )
    ).scalars().all()

    race_day = [a for a in acts if a.start_date.date() == day]
    taper = [a for a in acts if a.start_date.date() < day]
    taper_tss = round(sum(a.tss or 0 for a in taper), 1)

    pre_tsb: float | None = None
    try:
        from app.services.cycling.training_load import training_load_for_user

        series = await training_load_for_user(db, user_id, day, lookback_days=30)
        for row in series:
            d = row.get("date")
            dd = d.date() if isinstance(d, datetime) else d
            if isinstance(dd, str):
                dd = date.fromisoformat(dd[:10])
            if dd == day - timedelta(days=1) and row.get("tsb") is not None:
                pre_tsb = round(float(row["tsb"]), 1)
                break
    except Exception as e:
        logger.warning(f"Retrospective TSB unavailable (non-fatal): {e}")

    plan_target = None
    plan = (
        await db.execute(
            select(TrainingPlan).where(
                TrainingPlan.user_id == user_id,
                TrainingPlan.event_id == event.id,
            )
        )
    ).scalars().first()
    if plan is not None:
        plan_target = {
            "plan_name": plan.name,
            "target_tss": event.target_tss,
        }

    best = None
    if race_day:
        a = max(race_day, key=lambda x: x.tss or 0)
        best = {
            "id": str(a.id),
            "name": a.name,
            "tss": a.tss,
            "normalized_power": a.normalized_power,
            "sport_type": a.sport_type,
        }

    return {
        "event_id": str(event.id),
        "event_name": event.name,
        "event_date": day.isoformat(),
        "result": event.result,
        "taper_week_tss": taper_tss,
        "taper_sessions": len(taper),
        "race_day_activity": best,
        "pre_race_tsb": pre_tsb,
        "plan": plan_target,
    }
