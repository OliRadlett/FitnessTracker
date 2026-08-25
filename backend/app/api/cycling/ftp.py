"""Cycling API — FTP history, estimation, backfill, and stream backfill endpoints."""

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.activity import Activity
from app.models.cycling import FtpHistory
from app.models.user import User
from app.schemas.cycling import (
    FtpEstimateDetail,
    FtpEstimateResponse,
    FtpHistoryCreate,
    FtpHistoryRead,
)
from app.services.auth import get_current_user
from app.services.cycling import (
    backfill_ftp_estimates,
    compute_normalized_power,
    compute_power_curve_from_streams,
    estimate_ftp_from_power_curve_detailed,
    get_or_create_cycling_profile,
)

router = APIRouter()


# ── FTP History ──────────────────────────────────────────────────────────────


@router.get("/ftp-history", response_model=list[FtpHistoryRead])
async def get_ftp_history(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the user's FTP history."""
    result = await db.execute(
        select(FtpHistory)
        .where(FtpHistory.user_id == current_user.id)
        .order_by(FtpHistory.effective_date.desc())
    )
    entries = result.scalars().all()
    return [FtpHistoryRead.model_validate(e) for e in entries]


@router.post("/ftp-history", response_model=FtpHistoryRead)
async def create_ftp_history_entry(
    payload: FtpHistoryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Manually add an FTP history entry."""
    entry = FtpHistory(
        user_id=current_user.id,
        ftp_watts=payload.ftp_watts,
        effective_date=payload.effective_date,
        source=payload.source,
        notes=payload.notes,
    )
    db.add(entry)

    # Also update the cycling profile if this is the latest FTP
    profile = await get_or_create_cycling_profile(db, current_user.id)
    if not profile.ftp_watts or payload.effective_date >= date.today():
        profile.ftp_watts = payload.ftp_watts

    await db.flush()
    return FtpHistoryRead.model_validate(entry)


# ── FTP Estimation ───────────────────────────────────────────────────────────


@router.post("/estimate-ftp", response_model=FtpEstimateResponse)
async def estimate_ftp(
    days: int = Query(90, ge=30, le=365),
    accept: bool = Query(
        False, description="If true, automatically save the estimate as the user's FTP"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Estimate FTP from best power data and optionally save it.

    Uses a weighted multi-method approach:
    - 20-min × 0.95 (gold standard, confidence 1.0)
    - 30-min × 0.95, 8-min × 0.855, 10-min × 0.92 (well-established)
    - 5-min × 0.95 (rough estimate)
    - Riegel extrapolation from shorter efforts (lower confidence)
    """
    best_power = await compute_power_curve_from_streams(db, current_user.id, days)
    if not best_power:
        raise HTTPException(
            status_code=400,
            detail="No power stream data available. Sync activities with power data from Strava first.",
        )

    detailed = estimate_ftp_from_power_curve_detailed(best_power)
    if not detailed:
        raise HTTPException(
            status_code=400,
            detail="Insufficient data for FTP estimation. Need at least a 5-min all-out effort with power data.",
        )

    # Human-readable source method
    source_method = f"{detailed.method}: {detailed.source_duration}s power → FTP (confidence: {detailed.confidence:.0%})"

    result = FtpEstimateResponse(
        estimated_ftp=detailed.ftp,
        confidence=detailed.confidence,
        method=detailed.method,
        source_duration=detailed.source_duration,
        all_estimates=[FtpEstimateDetail(**e) for e in detailed.all_estimates],
        source_method=source_method,
        best_power_available={
            "5s": best_power.get(5),
            "1min": best_power.get(60),
            "5min": best_power.get(300),
            "8min": best_power.get(480),
            "10min": best_power.get(600),
            "20min": best_power.get(1200),
            "30min": best_power.get(1800),
            "60min": best_power.get(3600),
        },
        days_analyzed=days,
        accepted=False,
    )

    if accept:
        profile = await get_or_create_cycling_profile(db, current_user.id)
        old_ftp = profile.ftp_watts
        profile.ftp_watts = detailed.ftp

        # Record in FTP history
        ftp_entry = FtpHistory(
            user_id=current_user.id,
            ftp_watts=detailed.ftp,
            effective_date=date.today(),
            source="estimated",
            notes=f"Auto-estimated: {source_method}",
        )
        db.add(ftp_entry)
        await db.flush()
        await db.refresh(profile)
        result.accepted = True
        result.previous_ftp = old_ftp

    return result


# ── Backfill Streams ─────────────────────────────────────────────────────────


@router.post("/backfill-streams")
async def backfill_streams(
    days: int = Query(
        3650,
        ge=7,
        le=3650,
        description="Lookback period in days (default: 10 years = all)",
    ),
    limit: int = Query(
        500, ge=1, le=1000, description="Max activities to process per call"
    ),
    force: bool = Query(
        False, description="Delete existing streams and re-fetch at high resolution"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Fetch streams for ALL existing cycling activities that are missing them.

    This is useful for backfilling stream data for activities that were synced
    before the stream-fetching feature was added.
    Use force=true to delete existing low-res streams and re-fetch at high resolution.
    """
    from app.integrations.strava_client import strava_client
    from app.models.activity import ActivityStream
    from app.services.cache import redis_lock
    from app.services.strava import get_strava_connection, refresh_if_needed

    try:
        async with redis_lock(f"streams-backfill:{current_user.id}", ttl=1800):
            cutoff = date.today() - timedelta(days=days)

            # Find ALL cycling activities from Strava (not just those with power)
            result = await db.execute(
                select(Activity.id, Activity.provider_activity_id)
                .where(
                    Activity.user_id == current_user.id,
                    Activity.sport_type == "cycling",
                    Activity.source == "strava",
                    Activity.start_date >= cutoff,
                    Activity.provider_activity_id.isnot(None),
                )
                .order_by(Activity.start_date.desc())
                .limit(limit)
            )
            all_activities = result.all()

            activity_ids = [row[0] for row in all_activities]
            if not activity_ids:
                return {
                    "backfilled": 0,
                    "total_checked": 0,
                    "message": "No cycling activities found.",
                }

            if force:
                # Force mode: re-fetch all activities (delete old streams per-activity after success)
                need_streams = [(row[0], row[1]) for row in all_activities]
            else:
                # Filter to those without any stream data
                result = await db.execute(
                    select(ActivityStream.activity_id)
                    .where(
                        ActivityStream.activity_id.in_(activity_ids),
                    )
                    .distinct()
                )
                already_have_streams = set(result.scalars().all())

                need_streams = [
                    (row[0], row[1])
                    for row in all_activities
                    if row[0] not in already_have_streams
                ]

                if not need_streams:
                    return {
                        "backfilled": 0,
                        "total_checked": len(all_activities),
                        "message": "All activities already have stream data.",
                    }

            # Get Strava connection
            connection = await get_strava_connection(db, current_user.id)
            if not connection:
                raise HTTPException(status_code=400, detail="No Strava connection found.")
            connection = await refresh_if_needed(db, connection)

            backfilled = 0
            for activity_id, provider_id in need_streams:
                try:
                    streams = await strava_client.get_activity_streams(
                        connection.access_token, int(provider_id)
                    )
                    if not streams:
                        continue
                    # In force mode, delete old streams for this activity before inserting new ones
                    if force:
                        await db.execute(
                            ActivityStream.__table__.delete().where(
                                ActivityStream.activity_id == activity_id
                            )
                        )
                    for stream_type, stream_data in streams.items():
                        if "data" in stream_data:
                            # Strava may return resolution as "high"/"low" strings — convert to int or None
                            raw_res = stream_data.get("resolution")
                            resolution = None
                            if isinstance(raw_res, int):
                                resolution = raw_res
                            elif isinstance(raw_res, str) and raw_res.isdigit():
                                resolution = int(raw_res)

                            stream = ActivityStream(
                                activity_id=activity_id,
                                stream_type=stream_type,
                                data={"data": stream_data["data"]},
                                resolution=resolution,
                            )
                            db.add(stream)
                    backfilled += 1
                except Exception as e:
                    import logging

                    logging.getLogger(__name__).warning(
                        f"Stream backfill failed for activity {provider_id}: {e}"
                    )
                    continue  # Skip activities that fail

            await db.flush()

            return {
                "backfilled": backfilled,
                "total_checked": len(all_activities),
                "remaining": len(need_streams) - backfilled,
            }
    except RuntimeError:
        raise HTTPException(
            status_code=409, detail="A streams backfill is already in progress"
        )


# ── Backfill FTP History ────────────────────────────────────────────────────


@router.post("/backfill-ftp-history")
async def backfill_ftp_history_endpoint(
    months: int = Query(12, ge=3, le=24, description="Number of months to backfill"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Estimate FTP for historical monthly periods and create FTP history entries.

    Goes back `months` months, computes the best power curve for each 90-day
    window, estimates FTP, and creates FtpHistory entries with source="estimated".
    Skips months that already have an FTP history entry.
    """
    entries = await backfill_ftp_estimates(db, current_user.id, months=months)

    # Update the user's cycling profile FTP if we created entries and current
    # profile doesn't have an FTP set (or use the latest backfilled value)
    if entries:
        profile = await get_or_create_cycling_profile(db, current_user.id)
        latest = max(entries, key=lambda e: e["effective_date"])
        if not profile.ftp_watts:
            profile.ftp_watts = latest["ftp_watts"]
            await db.flush()

    return {
        "created": len(entries),
        "entries": entries,
        "months_analyzed": months,
    }
