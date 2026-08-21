"""Cycling API — Training load and TSS recalculation endpoints."""

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.activity import Activity
from app.models.user import User
from app.schemas.cycling import (
    DailyLoadPoint,
    TrainingLoadResponse,
)
from app.services.auth import get_current_user
from app.services.cycling import (
    auto_compute_tss_for_activity,
    compute_normalized_power,
    compute_training_load,
    get_daily_tss,
    get_or_create_cycling_profile,
)

router = APIRouter()


# ── Training Load (CTL / ATL / TSB) ─────────────────────────────────────────


@router.get("/training-load", response_model=TrainingLoadResponse)
async def get_training_load(
    days: int = Query(90, ge=7, le=365, description="Lookback period in days"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get training load data (CTL, ATL, TSB) over time.

    CTL = Chronic Training Load (fitness) — 42-day EWMA of TSS
    ATL = Acute Training Load (fatigue) — 7-day EWMA of TSS
    TSB = Training Stress Balance (form) = CTL - ATL
    """
    end_date = date.today()
    start_date = end_date - timedelta(days=days + 42)  # extra buffer for CTL ramp-up

    daily_tss = await get_daily_tss(db, current_user.id, start_date, end_date)
    load_data = compute_training_load(daily_tss, end_date, lookback_days=days)

    points = [DailyLoadPoint(**d) for d in load_data]
    current = points[-1] if points else DailyLoadPoint(date=end_date, tss=0, ctl=0, atl=0, tsb=0)

    return TrainingLoadResponse(
        data=points,
        current_ctl=current.ctl,
        current_atl=current.atl,
        current_tsb=current.tsb,
    )


# ── Recalculate TSS ─────────────────────────────────────────────────────────


@router.post("/recalculate-tss")
async def recalculate_tss(
    days: int = Query(365, ge=1, le=3650),
    force: bool = Query(False, description="If true, recalculate all activities even if TSS is already set"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Recalculate TSS for cycling activities.

    Uses FTP from the user's cycling profile.
    By default only updates activities with missing TSS.
    Pass force=true to recalculate all activities (e.g. after FTP change).
    """
    profile = await get_or_create_cycling_profile(db, current_user.id)
    if not profile.ftp_watts:
        raise HTTPException(status_code=400, detail="FTP not set. Set your FTP first.")

    cutoff = date.today() - timedelta(days=days)
    conditions = [
        Activity.user_id == current_user.id,
        Activity.sport_type == "cycling",
        Activity.average_power.isnot(None),
        Activity.start_date >= cutoff,
    ]
    if not force:
        conditions.append(Activity.tss.is_(None))

    result = await db.execute(select(Activity).where(*conditions))
    activities = list(result.scalars().all())

    # Also backfill normalized_power from stream data for activities missing it
    activity_ids = [a.id for a in activities if not a.normalized_power]
    np_map: dict = {}
    if activity_ids:
        from app.models.activity import ActivityStream
        np_result = await db.execute(
            select(ActivityStream)
            .where(
                ActivityStream.activity_id.in_(activity_ids),
                ActivityStream.stream_type == "watts",
            )
        )
        for stream in np_result.scalars().all():
            data = stream.data.get("data", []) if isinstance(stream.data, dict) else []
            if data:
                np_val = compute_normalized_power(data)
                if np_val:
                    np_map[stream.activity_id] = np_val

    updated = 0
    for activity in activities:
        # Backfill normalized_power from stream data
        if not activity.normalized_power and activity.id in np_map:
            activity.normalized_power = np_map[activity.id]

        # Clear existing TSS if forcing recalculation
        if force:
            activity.tss = None
        tss = await auto_compute_tss_for_activity(db, activity, profile.ftp_watts)
        if tss is not None:
            updated += 1

    await db.flush()
    return {"updated": updated, "total_checked": len(activities)}
