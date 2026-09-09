"""Events API — CRUD for race/event planning with auto-calculated taper."""

import uuid
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.event import Event
from app.models.user import User
from app.schemas.event import (
    EventCreate,
    EventResultUpdate,
    EventUpdate,
    EventWithCountdown,
)
from app.services.auth import get_current_user
from app.services.notifications import notify

router = APIRouter()

VALID_EVENT_TYPES = {"race", "ride", "lift", "other"}


def _enrich_event(event: Event) -> EventWithCountdown:
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


@router.get("", response_model=list[EventWithCountdown])
async def list_events(
    upcoming_only: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all events, optionally only upcoming ones."""
    query = (
        select(Event).where(Event.user_id == current_user.id).order_by(Event.event_date)
    )
    if upcoming_only:
        query = query.where(Event.event_date >= date.today())
    result = await db.execute(query)
    events = list(result.scalars().all())
    return [_enrich_event(e) for e in events]


@router.get("/{event_id}", response_model=EventWithCountdown)
async def get_event(
    event_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single event with countdown info."""
    result = await db.execute(
        select(Event).where(Event.id == event_id, Event.user_id == current_user.id)
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return _enrich_event(event)


@router.post("", response_model=EventWithCountdown, status_code=status.HTTP_201_CREATED)
async def create_event(
    data: EventCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new event."""
    if data.event_type not in VALID_EVENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid event_type. Must be one of: {', '.join(VALID_EVENT_TYPES)}",
        )

    event = Event(
        user_id=current_user.id,
        **data.model_dump(),
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return _enrich_event(event)


@router.patch("/{event_id}", response_model=EventWithCountdown)
async def update_event(
    event_id: uuid.UUID,
    data: EventUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update an event."""
    result = await db.execute(
        select(Event).where(Event.id == event_id, Event.user_id == current_user.id)
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    for key, value in data.model_dump(exclude_unset=True).items():
        if key == "event_type" and value not in VALID_EVENT_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid event_type. Must be one of: {', '.join(VALID_EVENT_TYPES)}",
            )
        setattr(event, key, value)

    await db.commit()
    await db.refresh(event)
    return _enrich_event(event)


@router.put("/{event_id}/result", response_model=EventWithCountdown)
async def set_event_result(
    event_id: uuid.UUID,
    data: EventResultUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Record the result of a completed event (race retro)."""
    result = await db.execute(
        select(Event).where(Event.id == event_id, Event.user_id == current_user.id)
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    payload = data.model_dump(exclude_none=True)
    event.result = payload if payload else None
    event.result_updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(event)

    created = await notify(
        db,
        current_user.id,
        "event_result",
        title=f"Result logged — {event.name}",
        body=_format_result_summary(event.name, payload),
        link="/training?tab=races",
        dedup_key=f"event_result:{event.id}",
    )
    if created:
        await db.commit()

    return _enrich_event(event)


@router.delete("/{event_id}/result", response_model=EventWithCountdown)
async def clear_event_result(
    event_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Clear the recorded result for an event."""
    result = await db.execute(
        select(Event).where(Event.id == event_id, Event.user_id == current_user.id)
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    event.result = None
    event.result_updated_at = None
    await db.commit()
    await db.refresh(event)
    return _enrich_event(event)


def _format_result_summary(name: str, result: dict | None) -> str:
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


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(
    event_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete an event."""
    result = await db.execute(
        select(Event).where(Event.id == event_id, Event.user_id == current_user.id)
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    await db.delete(event)
    await db.commit()


# ── Event AI Analysis ───────────────────────────────────────────────────────


@router.post("/{event_id}/ai-analysis")
async def trigger_event_ai_analysis(
    event_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Trigger an on-demand AI analysis for event preparation.

    Compiles event details, current fitness, recent training, and recovery
    data, then sends to Gemini for taper plan, race-day strategy, and
    nutrition advice.
    """
    from app.schemas.llm_analysis import LlmAnalysisRead
    from app.services.llm_analysis import run_event_ai_analysis

    try:
        analysis = await run_event_ai_analysis(db, current_user.id, event_id)
        if analysis is None:
            raise HTTPException(status_code=404, detail="Event not found")
        await db.commit()
        return LlmAnalysisRead.model_validate(analysis)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Event analysis failed: {e!s}")


@router.get("/{event_id}/ai-analysis")
async def get_event_ai_analysis(
    event_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the most recent cached AI analysis for a specific event."""
    from app.models.llm_analysis import LlmAnalysis as LlmAnalysisModel
    from app.schemas.llm_analysis import LlmAnalysisRead

    result = await db.execute(
        select(LlmAnalysisModel)
        .where(
            LlmAnalysisModel.user_id == current_user.id,
            LlmAnalysisModel.event_id == event_id,
            LlmAnalysisModel.analysis_type == "event",
        )
        .order_by(LlmAnalysisModel.created_at.desc())
        .limit(1)
    )
    analysis = result.scalar_one_or_none()
    if not analysis:
        return None
    return LlmAnalysisRead.model_validate(analysis)
