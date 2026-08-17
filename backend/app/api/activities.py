"""Activity API — list/filter/get activities, calendar, backfill route links."""

import uuid
from datetime import datetime, date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, cast, Date
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.activity import Activity, ActivityStream
from app.models.lifting import LiftingSession, LiftingSet
from app.models.user import User
from app.schemas.activity import ActivityRead, ActivityStreamRead, ActivityCalendarEntry, LinkedLiftingSessionSummary
from app.services.auth import get_current_user

router = APIRouter()


def _build_linked_session_summary(activity: Activity) -> LinkedLiftingSessionSummary | None:
    """Build a linked lifting session summary from the activity's relationship."""
    ls = activity.lifting_session
    if ls is None:
        return None
    return LinkedLiftingSessionSummary(
        id=ls.id,
        session_date=ls.session_date,
        focus=ls.focus,
        set_count=len(ls.sets) if ls.sets else 0,
        total_volume_kg=ls.total_volume_kg,
    )


def _extract_encoded_polyline(activity: Activity) -> str | None:
    """Extract encoded polyline from activity raw_data (Strava map.summary_polyline)."""
    if not activity.raw_data:
        return None
    map_data = activity.raw_data.get("map", {})
    return map_data.get("summary_polyline") or map_data.get("polyline") or None


def _enrich_activity_read(activity: Activity) -> ActivityRead:
    """Build an ActivityRead with computed fields (sources, route_name, polyline, linked session)."""
    read = ActivityRead.model_validate(activity)
    read.linked_lifting_session = _build_linked_session_summary(activity)
    read.encoded_polyline = _extract_encoded_polyline(activity)
    # Populate route_name from the route relationship
    read.route_name = activity.route.name if activity.route else None
    return read


@router.get("", response_model=list[ActivityRead])
async def list_activities(
    sport_type: str | None = Query(None),
    source: str | None = Query(None),
    start_date_after: datetime | None = Query(None),
    start_date_before: datetime | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List activities with optional filters.

    Strava is the single source of truth — standalone Wahoo activities are excluded.
    Wahoo data enriches Strava activities via ActivitySource.
    """
    query = (
        select(Activity)
        .options(
            selectinload(Activity.lifting_session).selectinload(LiftingSession.sets),
            selectinload(Activity.sources),
            selectinload(Activity.route),
        )
        .where(Activity.user_id == current_user.id)
        .where(Activity.source != "wahoo")  # noqa: E501
    )

    if sport_type:
        query = query.where(Activity.sport_type == sport_type)
    if source:
        query = query.where(Activity.source == source)
    if start_date_after:
        query = query.where(Activity.start_date >= start_date_after)
    if start_date_before:
        query = query.where(Activity.start_date <= start_date_before)

    query = query.order_by(Activity.start_date.desc()).limit(limit).offset(offset)
    result = await db.execute(query)
    activities = list(result.scalars().all())

    return [_enrich_activity_read(a) for a in activities]


@router.get("/calendar", response_model=list[ActivityCalendarEntry])
async def get_activities_calendar(
    start_date: date = Query(..., description="Start of month (YYYY-MM-DD)"),
    end_date: date = Query(..., description="End of month (YYYY-MM-DD)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return lightweight activity data for calendar display.

    Only returns the fields needed to render calendar dots/badges,
    avoiding full activity objects including raw_data.
    For strength activities, also returns the linked lifting session focus.
    """
    # Fetch activities with optional linked lifting session focus
    result = await db.execute(
        select(
            Activity.id,
            cast(Activity.start_date, Date).label("date"),
            Activity.sport_type,
            Activity.name,
            Activity.duration_seconds,
            Activity.distance_meters,
            Activity.tss,
            LiftingSession.focus,
        )
        .outerjoin(
            LiftingSession,
            LiftingSession.activity_id == Activity.id,
        )
        .where(
            Activity.user_id == current_user.id,
            Activity.source != "wahoo",
            cast(Activity.start_date, Date) >= start_date,
            cast(Activity.start_date, Date) <= end_date,
        )
        .order_by(Activity.start_date)
    )
    rows = result.all()

    return [
        ActivityCalendarEntry(
            id=r.id,
            date=r.date,
            sport_type=r.sport_type,
            name=r.name,
            duration_seconds=r.duration_seconds,
            distance_meters=r.distance_meters,
            tss=r.tss,
            focus=r.focus,
        )
        for r in rows
    ]


@router.get("/{activity_id}", response_model=ActivityRead)
async def get_activity(
    activity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single activity by ID."""
    result = await db.execute(
        select(Activity)
        .options(
            selectinload(Activity.lifting_session).selectinload(LiftingSession.sets),
            selectinload(Activity.sources),
            selectinload(Activity.route),
        )
        .where(
            Activity.id == activity_id,
            Activity.user_id == current_user.id,
        )
    )
    activity = result.scalar_one_or_none()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    return _enrich_activity_read(activity)


@router.get("/{activity_id}/streams", response_model=list[ActivityStreamRead])
async def get_activity_streams(
    activity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all streams for an activity."""
    # Verify activity belongs to user
    result = await db.execute(
        select(Activity).where(
            Activity.id == activity_id,
            Activity.user_id == current_user.id,
        )
    )
    activity = result.scalar_one_or_none()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    result = await db.execute(
        select(ActivityStream).where(ActivityStream.activity_id == activity_id)
    )
    streams = list(result.scalars().all())
    return [ActivityStreamRead.model_validate(s) for s in streams]


@router.post("/backfill")
async def backfill_activities(
    max_pages: int = Query(50, ge=1, le=200, description="Max Strava API pages to fetch"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Backfill ALL historical Strava activities for the current user.

    Pages through the Strava API to fetch the complete activity history,
    not just the most recent 100.  Uses merge/dedup to avoid duplicates.
    This may take a while for accounts with many activities.
    """
    from app.services.strava import backfill_all_activities

    result = await backfill_all_activities(db, current_user.id, max_pages=max_pages)
    await db.commit()
    return {
        "detail": f"Backfill complete: {result['synced']} synced, {result['skipped']} skipped across {result['pages']} pages",
        **result,
    }


@router.post("/backfill-route-links")
async def backfill_route_links(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Re-run activity↔route linking for all unlinked GPS activities.

    Useful after initial setup or when new routes have been synced.
    """
    from app.services.merge_service import backfill_activity_route_links

    linked_count = await backfill_activity_route_links(db, current_user.id)
    await db.commit()
    return {
        "detail": f"Linked {linked_count} activities to routes",
        "linked_count": linked_count,
    }


