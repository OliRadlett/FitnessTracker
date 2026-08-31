"""Activity API — list/filter/get activities, calendar, backfill route links, merge analysis, file import."""

import json
import logging
import uuid
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import Date, asc, case, cast, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.activity import Activity, ActivityStream
from app.models.daily_metric import DailyMetric
from app.models.lifting import LiftingSession, PersonalRecord
from app.models.sleep import SleepLog
from app.models.training_plan import TrainingPlan, TrainingPlanDay
from app.models.user import User
from app.schemas.activity import (
    ActivityCalendarEntry,
    ActivityContextRead,
    ActivityDetailRead,
    ActivityRead,
    ActivityStreamRead,
    ActivitySummary,
    CalendarDayData,
    DailyMetricSummary,
    LinkedLiftingSessionSummary,
    RideAnalysisResponse,
    SleepLogSummary,
)
from app.services.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter()


def _build_linked_session_summary(
    activity: Activity,
) -> LinkedLiftingSessionSummary | None:
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


ACTIVITY_SORT_FIELDS = {
    "start_date": Activity.start_date,
    "distance": Activity.distance_meters,
    "duration": Activity.duration_seconds,
    "tss": Activity.tss,
    "average_power": Activity.average_power,
}


@router.get("")
async def list_activities(
    sport_type: str | None = Query(None),
    source: str | None = Query(None),
    start_date_after: datetime | None = Query(None),
    start_date_before: datetime | None = Query(None),
    q: str | None = Query(None, description="Search activity name (case-insensitive)"),
    min_distance: float | None = Query(None, ge=0),
    max_distance: float | None = Query(None, ge=0),
    min_duration: int | None = Query(None, ge=0),
    max_duration: int | None = Query(None, ge=0),
    min_tss: float | None = Query(None, ge=0),
    max_tss: float | None = Query(None, ge=0),
    sort_by: str | None = Query(
        None,
        description="Sort field: start_date, distance, duration, tss, average_power",
    ),
    sort_order: str | None = Query(
        "desc", pattern="^(asc|desc)$", description="Sort direction"
    ),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List activities with optional filters.

    Strava is the single source of truth — standalone Wahoo activities are excluded.
    Wahoo data enriches Strava activities via ActivitySource.

    Returns the activity list with an X-Total-Count response header.
    """
    # Validate sort_by
    if sort_by is not None and sort_by not in ACTIVITY_SORT_FIELDS:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid sort_by: '{sort_by}'. Must be one of: {', '.join(ACTIVITY_SORT_FIELDS)}",
        )

    # Validate min/max pairs
    if (
        min_distance is not None
        and max_distance is not None
        and min_distance > max_distance
    ):
        raise HTTPException(
            status_code=422, detail="min_distance must be <= max_distance"
        )
    if (
        min_duration is not None
        and max_duration is not None
        and min_duration > max_duration
    ):
        raise HTTPException(
            status_code=422, detail="min_duration must be <= max_duration"
        )
    if min_tss is not None and max_tss is not None and min_tss > max_tss:
        raise HTTPException(status_code=422, detail="min_tss must be <= max_tss")

    # Build base filter conditions (shared between count and data queries)
    base_filters = [
        Activity.user_id == current_user.id,
        Activity.source != "wahoo",
    ]
    if sport_type:
        base_filters.append(Activity.sport_type == sport_type)
    if source:
        base_filters.append(Activity.source == source)
    if start_date_after:
        base_filters.append(Activity.start_date >= start_date_after)
    if start_date_before:
        base_filters.append(Activity.start_date <= start_date_before)
    if q:
        base_filters.append(Activity.name.ilike(f"%{q}%"))
    if min_distance is not None:
        base_filters.append(Activity.distance_meters >= min_distance)
    if max_distance is not None:
        base_filters.append(Activity.distance_meters <= max_distance)
    if min_duration is not None:
        base_filters.append(Activity.duration_seconds >= min_duration)
    if max_duration is not None:
        base_filters.append(Activity.duration_seconds <= max_duration)
    if min_tss is not None:
        base_filters.append(Activity.tss >= min_tss)
    if max_tss is not None:
        base_filters.append(Activity.tss <= max_tss)

    # Get total count
    count_result = await db.execute(
        select(func.count(Activity.id)).where(*base_filters)
    )
    total_count = int(count_result.scalar() or 0)

    # Determine sort order
    sort_col = ACTIVITY_SORT_FIELDS.get(sort_by or "start_date", Activity.start_date)
    order_clause = desc(sort_col) if (sort_order or "desc") == "desc" else asc(sort_col)

    # Fetch page of activities
    query = (
        select(Activity)
        .options(
            selectinload(Activity.lifting_session).selectinload(LiftingSession.sets),
            selectinload(Activity.sources),
            selectinload(Activity.route),
        )
        .where(*base_filters)
        .order_by(order_clause)
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(query)
    activities = list(result.scalars().all())

    enriched = [_enrich_activity_read(a) for a in activities]
    return JSONResponse(
        content=[a.model_dump(mode="json") for a in enriched],
        headers={"X-Total-Count": str(total_count)},
    )


STRENGTH_SPORT_TYPES = ("weighttraining", "workout", "crossfit", "strength_training")


@router.get("/summary", response_model=ActivitySummary)
async def get_activity_summary(
    sport_type: str | None = Query(None),
    source: str | None = Query(None),
    start_date_after: datetime | None = Query(None),
    start_date_before: datetime | None = Query(None),
    q: str | None = Query(None, description="Search activity name (case-insensitive)"),
    min_distance: float | None = Query(None, ge=0),
    max_distance: float | None = Query(None, ge=0),
    min_duration: int | None = Query(None, ge=0),
    max_duration: int | None = Query(None, ge=0),
    min_tss: float | None = Query(None, ge=0),
    max_tss: float | None = Query(None, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get aggregate totals for all activities matching the filter criteria.

    Returns count, total distance, total duration, and total TSS across every
    matching activity (not just a single paginated page). Strenth activities are
    excluded from the distance total to match the frontend stats bar.
    """
    # Validate min/max pairs
    if (
        min_distance is not None
        and max_distance is not None
        and min_distance > max_distance
    ):
        raise HTTPException(
            status_code=422, detail="min_distance must be <= max_distance"
        )
    if (
        min_duration is not None
        and max_duration is not None
        and min_duration > max_duration
    ):
        raise HTTPException(
            status_code=422, detail="min_duration must be <= max_duration"
        )
    if min_tss is not None and max_tss is not None and min_tss > max_tss:
        raise HTTPException(status_code=422, detail="min_tss must be <= max_tss")

    where = [Activity.user_id == current_user.id, Activity.source != "wahoo"]
    if sport_type:
        where.append(Activity.sport_type == sport_type)
    if source:
        where.append(Activity.source == source)
    if start_date_after:
        where.append(Activity.start_date >= start_date_after)
    if start_date_before:
        where.append(Activity.start_date <= start_date_before)
    if q:
        where.append(Activity.name.ilike(f"%{q}%"))
    if min_distance is not None:
        where.append(Activity.distance_meters >= min_distance)
    if max_distance is not None:
        where.append(Activity.distance_meters <= max_distance)
    if min_duration is not None:
        where.append(Activity.duration_seconds >= min_duration)
    if max_duration is not None:
        where.append(Activity.duration_seconds <= max_duration)
    if min_tss is not None:
        where.append(Activity.tss >= min_tss)
    if max_tss is not None:
        where.append(Activity.tss <= max_tss)

    result = await db.execute(
        select(
            func.count(Activity.id).label("count"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            Activity.sport_type.notin_(STRENGTH_SPORT_TYPES),
                            Activity.distance_meters,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("total_distance"),
            func.coalesce(func.sum(Activity.duration_seconds), 0).label(
                "total_duration"
            ),
            func.coalesce(func.sum(Activity.tss), 0).label("total_tss"),
        ).where(*where)
    )
    row = result.one()
    return ActivitySummary(
        count=int(row.count or 0),
        total_distance_meters=float(row.total_distance or 0),
        total_duration_seconds=float(row.total_duration or 0),
        total_tss=float(row.total_tss or 0),
    )


@router.get("/calendar")
async def get_activities_calendar(
    start_date: date = Query(..., description="Start of month (YYYY-MM-DD)"),
    end_date: date = Query(..., description="End of month (YYYY-MM-DD)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return lightweight activity data + daily health metrics for calendar display.

    Returns both activities and daily metrics for the date range so the
    calendar can show recovery/sleep/strain badges alongside activity dots.
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

    activity_entries = [
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

    # Fetch daily metrics for the date range (recovery, sleep, strain)
    dm_result = await db.execute(
        select(DailyMetric)
        .where(
            DailyMetric.user_id == current_user.id,
            DailyMetric.metric_date >= start_date,
            DailyMetric.metric_date <= end_date,
        )
        .order_by(DailyMetric.metric_date)
    )
    daily_metrics_raw = list(dm_result.scalars().all())

    # Deduplicate by date (prefer whoop source which has the most data)
    metrics_by_date: dict = {}
    for dm in daily_metrics_raw:
        d = dm.metric_date
        if d not in metrics_by_date or dm.source == "whoop":
            metrics_by_date[d] = dm

    daily_metric_entries = [
        DailyMetricSummary(
            date=d,
            recovery_score=dm.recovery_score,
            hrv_ms=dm.hrv_ms,
            strain=dm.strain,
            sleep_duration_minutes=dm.sleep_duration_minutes,
            sleep_efficiency=dm.sleep_efficiency,
            resting_hr=dm.resting_hr,
            respiratory_rate=dm.respiratory_rate,
        )
        for d, dm in metrics_by_date.items()
    ]

    # Fetch sleep logs for the date range
    sl_result = await db.execute(
        select(SleepLog)
        .where(
            SleepLog.user_id == current_user.id,
            SleepLog.sleep_date >= start_date,
            SleepLog.sleep_date <= end_date,
        )
        .order_by(SleepLog.sleep_date)
    )
    sleep_logs_raw = list(sl_result.scalars().all())

    sleep_log_entries = [
        SleepLogSummary(
            id=sl.id,
            sleep_date=sl.sleep_date,
            source=sl.source,
            total_sleep_seconds=sl.total_sleep_seconds,
            deep_sleep_seconds=sl.deep_sleep_seconds,
            rem_sleep_seconds=sl.rem_sleep_seconds,
            light_sleep_seconds=sl.light_sleep_seconds,
            awake_seconds=sl.awake_seconds,
            sleep_efficiency=sl.sleep_efficiency,
            sleep_start=sl.sleep_start,
            sleep_end=sl.sleep_end,
        )
        for sl in sleep_logs_raw
    ]

    return CalendarDayData(
        activities=activity_entries,
        daily_metrics=daily_metric_entries,
        sleep_logs=sleep_log_entries,
    )


@router.post("/backfill")
async def backfill_activities(
    max_pages: int = Query(
        50, ge=1, le=200, description="Max Strava API pages to fetch"
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Backfill ALL historical Strava activities. Returns SSE stream with progress.

    Events:
        progress  — per-page (activities), per-5-activities (streams), once (linking)
        page_error — non-fatal per-activity failure, continues
        error      — fatal, stream ends
        complete   — final summary
    """
    from app.database import async_session_factory
    from app.models.user import OAuthConnection
    from app.services.cache import redis_lock
    from app.services.strava import backfill_all_activities_stream

    user_id = current_user.id

    # Validate connection exists before starting the stream
    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.user_id == user_id,
            OAuthConnection.provider == "strava",
        )
    )
    connection = result.scalar_one_or_none()
    if not connection:
        raise HTTPException(status_code=404, detail="No Strava connection found")

    # Prevent concurrent backfills for the same user
    try:
        lock = redis_lock(f"strava-backfill:{user_id}", ttl=3600)
        await lock.__aenter__()
    except RuntimeError:
        raise HTTPException(
            status_code=409, detail="A Strava backfill is already in progress"
        )

    async def event_stream():
        async with async_session_factory() as stream_db:
            try:
                async for event in backfill_all_activities_stream(
                    stream_db, user_id, max_pages=max_pages
                ):
                    yield f"data: {json.dumps(event)}\n\n"
            except ValueError as e:
                yield f"data: {json.dumps({'type': 'error', 'detail': str(e)})}\n\n"
            except Exception as e:
                logger.error(
                    f"Strava backfill stream error for user {user_id}: {e}",
                    exc_info=True,
                )
                yield f"data: {json.dumps({'type': 'error', 'detail': 'An unexpected error occurred during backfill.'})}\n\n"
            finally:
                # Rollback any uncommitted transaction so the connection is
                # returned to the pool in a clean state on client disconnect.
                try:
                    if stream_db.is_active:
                        await stream_db.rollback()
                except Exception:
                    pass
                await stream_db.close()
                await lock.__aexit__(None, None, None)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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


# ── Merge Threshold Analysis ───────────────────────────────────────────────


class MergeThresholdResult(BaseModel):
    """Result of a merge-threshold analysis scan."""

    threshold: float
    total_activities: int
    total_pairs_scored: int
    pairs_above_threshold: int
    likely_merges: int
    potential_false_positives: int
    pairs: list[dict] = Field(
        default_factory=list, description="Detailed pair scores (top matches)"
    )


class MergePairDetail(BaseModel):
    """Detail about a scored activity pair."""

    activity_a_id: str
    activity_a_name: str
    activity_a_source: str
    activity_a_sport: str
    activity_a_date: str
    activity_b_id: str
    activity_b_name: str
    activity_b_source: str
    activity_b_sport: str
    activity_b_date: str
    score: float
    date_score: float
    sport_score: float
    duration_score: float
    distance_score: float
    likely_false_positive: bool


@router.get("/merge-analysis")
async def analyze_merge_thresholds(
    threshold: float = Query(
        0.60, ge=0.0, le=1.0, description="Merge threshold to test"
    ),
    days: int = Query(90, ge=7, le=365, description="Lookback period in days"),
    limit: int = Query(100, ge=10, le=500, description="Max activities to scan"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Analyze what would merge at a given threshold.

    Scans recent activities and scores every pair using the same weighted
    algorithm as the production merge service. Returns summary counts and
    the top matching pairs with their component scores.

    Use this to tune `ACTIVITY_MERGE_THRESHOLD` — lower values catch more
    duplicates but risk false positives (different activities merging).
    """
    from app.services.merge_service import (
        _date_proximity_score,
        _distance_score,
        _duration_score,
        _sport_type_score,
    )

    cutoff = date.today() - timedelta(days=days)

    result = await db.execute(
        select(Activity)
        .where(
            Activity.user_id == current_user.id,
            Activity.start_date >= cutoff,
        )
        .order_by(Activity.start_date.desc())
        .limit(limit)
    )
    activities = list(result.scalars().all())

    total_activities = len(activities)
    total_pairs = 0
    pairs_above = 0
    likely_merges = 0
    potential_false_positives = 0
    scored_pairs: list[dict] = []

    # Compare every pair (within a ±6h window for efficiency)
    for i in range(len(activities)):
        for j in range(i + 1, len(activities)):
            a = activities[i]
            b = activities[j]

            # Quick skip: more than 6h apart
            time_diff = abs((a.start_date - b.start_date).total_seconds())
            if time_diff > 6 * 3600:
                continue

            total_pairs += 1

            # Score using the same algorithm as merge_service
            date_s = _date_proximity_score(a.start_date, b.start_date)
            sport_s = _sport_type_score(a.sport_type, b.sport_type)
            dur_s = _duration_score(a.duration_seconds, b.duration_seconds)
            dist_s = _distance_score(a.distance_meters, b.distance_meters)

            score = (
                (date_s * 0.50) + (sport_s * 0.20) + (dur_s * 0.15) + (dist_s * 0.15)
            )

            if score >= threshold:
                pairs_above += 1

                # Heuristic false-positive detection:
                # Same source + different name + score < 0.85 → likely different activities
                # Different source + same-ish data → likely true duplicate
                is_false_positive = False
                if (
                    a.source == b.source
                    and a.name != b.name
                    and score < 0.85
                    or a.sport_type != b.sport_type
                    and score < 0.70
                ):
                    is_false_positive = True

                if is_false_positive:
                    potential_false_positives += 1
                else:
                    likely_merges += 1

                scored_pairs.append(
                    {
                        "activity_a_id": str(a.id),
                        "activity_a_name": a.name,
                        "activity_a_source": a.source,
                        "activity_a_sport": a.sport_type,
                        "activity_a_date": a.start_date.isoformat(),
                        "activity_b_id": str(b.id),
                        "activity_b_name": b.name,
                        "activity_b_source": b.source,
                        "activity_b_sport": b.sport_type,
                        "activity_b_date": b.start_date.isoformat(),
                        "score": round(score, 3),
                        "date_score": round(date_s, 3),
                        "sport_score": round(sport_s, 3),
                        "duration_score": round(dur_s, 3),
                        "distance_score": round(dist_s, 3),
                        "likely_false_positive": is_false_positive,
                    }
                )

    # Sort scored pairs by score descending, limit to top 50 for response
    scored_pairs.sort(key=lambda p: p["score"], reverse=True)

    return {
        "threshold": threshold,
        "total_activities": total_activities,
        "total_pairs_scored": total_pairs,
        "pairs_above_threshold": pairs_above,
        "likely_merges": likely_merges,
        "potential_false_positives": potential_false_positives,
        "pairs": scored_pairs[:50],
    }


# ── File Import ───────────────────────────────────────────────────────────────


@router.post("/import-gpx")
async def import_gpx(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Import an activity from a GPX file upload.

    Parses the GPX using the existing ``parse_gpx`` service, computes
    distance / elevation gain from the track points, and creates an
    Activity record with ``source='manual'``.
    """
    from app.services.gpx import parse_gpx
    from app.services.polyline_utils import encode_polyline, haversine_distance

    # BUG-017: Limit file size to 50MB
    MAX_FILE_SIZE = 50 * 1024 * 1024
    raw = await file.read()
    if len(raw) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413, detail="File too large. Maximum size is 50MB."
        )
    try:
        gpx_text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=400, detail="File must be valid UTF-8 encoded GPX XML"
        )

    try:
        parsed = parse_gpx(gpx_text, include_timestamps=True)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    points = parsed["points"]
    elevations = parsed["elevations"]
    timestamps = parsed.get("timestamps", [])

    # Compute total distance
    total_distance = 0.0
    for i in range(1, len(points)):
        total_distance += haversine_distance(
            points[i - 1][0],
            points[i - 1][1],
            points[i][0],
            points[i][1],
        )

    # Compute elevation gain
    elev_gain = 0.0
    for i in range(1, len(elevations)):
        if elevations[i] is not None and elevations[i - 1] is not None:
            diff = elevations[i] - elevations[i - 1]
            if diff > 0:
                elev_gain += diff

    # Derive start_date from first timestamp or fall back to now
    valid_timestamps = [t for t in timestamps if t is not None]
    start_date = valid_timestamps[0] if valid_timestamps else datetime.now(UTC)

    # Derive duration from first and last timestamps
    duration_seconds = None
    if len(valid_timestamps) >= 2:
        delta = valid_timestamps[-1] - valid_timestamps[0]
        duration_seconds = max(int(delta.total_seconds()), 0)

    encoded_polyline = encode_polyline(points)

    activity = Activity(
        user_id=current_user.id,
        source="manual",
        sport_type=parsed["sport_type"],
        name=parsed["name"],
        start_date=start_date,
        duration_seconds=duration_seconds,
        distance_meters=round(total_distance, 1) if total_distance > 0 else None,
        elevation_gain_meters=round(elev_gain, 1) if elev_gain > 0 else None,
        raw_data={"map": {"summary_polyline": encoded_polyline}},
    )
    db.add(activity)
    await db.flush()

    # Re-query with eager loading so _enrich_activity_read can access relationships
    result = await db.execute(
        select(Activity)
        .options(
            selectinload(Activity.lifting_session),
            selectinload(Activity.sources),
            selectinload(Activity.route),
        )
        .where(Activity.id == activity.id)
    )
    activity = result.scalar_one()

    enriched = _enrich_activity_read(activity)
    return enriched


@router.post("/import-fit")
async def import_fit(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Import an activity from a FIT file upload.

    Parses the FIT file, creates an Activity with session-level metrics
    and ActivityStream records for time-series data (HR, power, GPS, etc.).
    """
    from app.services.fit_parser import parse_fit_file
    from app.services.polyline_utils import encode_polyline

    # BUG-017: Limit file size to 50MB
    MAX_FILE_SIZE = 50 * 1024 * 1024
    raw = await file.read()
    if len(raw) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413, detail="File too large. Maximum size is 50MB."
        )

    try:
        parsed = parse_fit_file(raw)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    session = parsed["session"]
    streams = parsed.get("streams", {})

    # Build encoded polyline from GPS stream if available (filter out None values)
    gps_lats = streams.get("position_lat", [])
    gps_lons = streams.get("position_long", [])
    encoded_polyline = None
    if gps_lats and gps_lons and len(gps_lats) == len(gps_lons):
        points = [
            (lat, lng)
            for lat, lng in zip(gps_lats, gps_lons)
            if lat is not None and lng is not None
        ]
        if points:
            encoded_polyline = encode_polyline(points)

    activity = Activity(
        user_id=current_user.id,
        source="manual",
        sport_type=session.get("sport_type", "cycling"),
        name=session.get("name", "Imported Activity"),
        start_date=session.get("start_time", datetime.now(UTC)),
        duration_seconds=session.get("duration_seconds"),
        distance_meters=session.get("distance_meters"),
        elevation_gain_meters=session.get("elevation_gain_meters"),
        average_heartrate=session.get("average_heartrate"),
        max_heartrate=session.get("max_heartrate"),
        average_power=session.get("average_power"),
        normalized_power=session.get("normalized_power"),
        average_speed=session.get("average_speed"),
        average_cadence=session.get("average_cadence"),
        calories=session.get("calories"),
        raw_data={"map": {"summary_polyline": encoded_polyline}}
        if encoded_polyline
        else None,
    )
    db.add(activity)
    await db.flush()

    # Persist time-series streams
    STREAM_TYPE_MAP = {
        "heartrate": "heartrate",
        "power": "power",
        "cadence": "cadence",
        "altitude": "altitude",
        "enhanced_speed": "velocity",
        "position_lat": "position_lat",
        "position_long": "position_long",
        "temperature": "temperature",
    }
    dur = session.get("duration_seconds")
    for fit_key, stream_type in STREAM_TYPE_MAP.items():
        values = streams.get(fit_key)
        if values and len(values) > 0:
            res = max(1, dur // len(values)) if dur else None
            stream = ActivityStream(
                activity_id=activity.id,
                stream_type=stream_type,
                data={"data": values},
                resolution=res,
            )
            db.add(stream)

    # Re-query with eager loading so _enrich_activity_read can access relationships
    result = await db.execute(
        select(Activity)
        .options(
            selectinload(Activity.lifting_session),
            selectinload(Activity.sources),
            selectinload(Activity.route),
        )
        .where(Activity.id == activity.id)
    )
    activity = result.scalar_one()
    enriched = _enrich_activity_read(activity)
    return enriched


# ── Activity Analysis ────────────────────────────────────────────────────────


@router.get("/{activity_id}/analysis", response_model=RideAnalysisResponse)
async def get_activity_analysis(
    activity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get comprehensive analysis of a ride activity."""
    from app.services.session_analysis import analyze_ride

    analysis = await analyze_ride(db, current_user.id, activity_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    return RideAnalysisResponse(**analysis)


# ── Per-Activity AI Analysis ─────────────────────────────────────────────────


@router.get("/{activity_id}/ai-analysis")
async def get_activity_ai_analysis(
    activity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get cached AI analysis for a specific activity.

    Returns the most recent per-activity LLM analysis, or null if none exists.
    """
    from app.models.llm_analysis import LlmAnalysis
    from app.schemas.llm_analysis import LlmAnalysisRead

    result = await db.execute(
        select(LlmAnalysis)
        .where(
            LlmAnalysis.user_id == current_user.id,
            LlmAnalysis.activity_id == activity_id,
        )
        .order_by(LlmAnalysis.created_at.desc())
        .limit(1)
    )
    analysis = result.scalar_one_or_none()
    if not analysis:
        return None
    return LlmAnalysisRead.model_validate(analysis)


@router.post("/{activity_id}/ai-analysis")
async def trigger_activity_ai_analysis(
    activity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate an AI analysis for a specific activity.

    Uses Gemini to analyze the ride data in the context of the user's
    recent training load, recovery, and other rides.
    """
    from app.schemas.llm_analysis import LlmAnalysisRead
    from app.services.llm_analysis import run_activity_ai_analysis

    # Verify activity exists and belongs to user
    result = await db.execute(
        select(Activity).where(
            Activity.id == activity_id,
            Activity.user_id == current_user.id,
        )
    )
    activity = result.scalar_one_or_none()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    try:
        analysis = await run_activity_ai_analysis(db, current_user.id, activity_id)
        if analysis is None:
            raise HTTPException(status_code=404, detail="Activity not found")
        await db.commit()
        return LlmAnalysisRead.model_validate(analysis)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e!s}")


# ── Activity Context (connections + analytical summary) ────────────────────────


@router.get("/{activity_id}/context", response_model=ActivityContextRead)
async def get_activity_context(
    activity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get full contextual data for an activity: system connections,
    pre-activity health, ride analytics, and training-load position.

    This endpoint aggregates data from across the app to answer the question
    "what is this activity's story?" — what training plan it fulfilled,
    what PRs it achieved, how the user's recovery looked, how it fits
    in the training load cycle, and what the AI analysis says.

    Rely-on computation is lazy (only for cycling ride metrics).
    """
    from app.models.llm_analysis import LlmAnalysis
    from app.models.nutrition import RideFuelPlan
    from app.services.cycling import (
        compute_training_load,
        get_daily_tss,
        get_or_create_cycling_profile,
    )
    from app.services.session_analysis import analyze_ride

    # ── Verify activity exists ────────────────────────────────────────────────
    result = await db.execute(
        select(Activity)
        .options(
            selectinload(Activity.sources),
            selectinload(Activity.route),
            selectinload(Activity.lifting_session).selectinload(LiftingSession.sets),
        )
        .where(Activity.id == activity_id, Activity.user_id == current_user.id)
    )
    activity = result.scalar_one_or_none()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    activity_date = activity.start_date.date()

    # ── 1. Connections ────────────────────────────────────────────────────────
    # Training plan day
    plan_result = await db.execute(
        select(TrainingPlanDay, TrainingPlan)
        .join(TrainingPlan, TrainingPlanDay.plan_id == TrainingPlan.id)
        .where(TrainingPlanDay.activity_id == activity_id)
        .limit(1)
    )
    plan_row = plan_result.first()
    training_plan_day = None
    if plan_row:
        day, plan = plan_row
        training_plan_day = {
            "plan_id": plan.id,
            "plan_name": plan.name,
            "plan_type": plan.plan_type,
            "day_date": day.day_date,
            "day_number": (day.day_date - plan.start_date).days + 1,
            "planned_type": day.planned_type,
            "planned_focus": day.planned_focus,
            "planned_tss": day.planned_tss,
            "completed": day.completed,
        }

    # Personal records linked to this activity
    pr_result = await db.execute(
        select(PersonalRecord)
        .where(
            PersonalRecord.user_id == current_user.id,
            PersonalRecord.activity_id == activity_id,
        )
        .order_by(PersonalRecord.created_at.desc())
    )
    personal_records = [
        {
            "id": pr.id,
            "exercise_name": pr.exercise_name,
            "weight_kg": pr.weight_kg,
            "reps": pr.reps,
            "estimated_1rm": pr.estimated_1rm,
            "achieved_date": pr.achieved_date,
        }
        for pr in pr_result.scalars().all()
    ]

    # AI analysis
    ai_result = await db.execute(
        select(LlmAnalysis)
        .where(
            LlmAnalysis.user_id == current_user.id,
            LlmAnalysis.activity_id == activity_id,
        )
        .order_by(LlmAnalysis.created_at.desc())
        .limit(1)
    )
    ai_analysis = ai_result.scalar_one_or_none()
    ai_analysis_link = None
    if ai_analysis:
        raw_text = ai_analysis.analysis_text
        summary_text = raw_text[:200]
        if len(raw_text) > 200:
            summary_text = summary_text.rsplit(" ", 1)[0] + "…"
        ai_analysis_link = {
            "id": ai_analysis.id,
            "analysis_type": ai_analysis.analysis_type,
            "summary": summary_text,
            "model_used": ai_analysis.model_used,
            "created_at": ai_analysis.created_at,
        }

    # Fuel plan
    fuel_result = await db.execute(
        select(RideFuelPlan)
        .where(
            RideFuelPlan.user_id == current_user.id,
            RideFuelPlan.activity_id == activity_id,
        )
        .limit(1)
    )
    fuel_plan_row = fuel_result.scalar_one_or_none()
    fuel_plan_link = None
    if fuel_plan_row:
        fuel_plan_link = {
            "id": fuel_plan_row.id,
            "planned_duration_min": fuel_plan_row.planned_duration_min,
            "pre_ride_carbs_g": fuel_plan_row.pre_ride_carbs_g,
            "during_carbs_per_hour_g": fuel_plan_row.during_carbs_per_hour_g,
            "source": fuel_plan_row.source,
        }

    # Linked lifting session
    linked_lifting = None
    if activity.lifting_session:
        ls = activity.lifting_session
        linked_lifting = {
            "id": ls.id,
            "session_date": ls.session_date,
            "focus": ls.focus,
            "set_count": len(ls.sets) if ls.sets else 0,
            "total_volume_kg": ls.total_volume_kg,
        }

    connections = {
        "training_plan_day": training_plan_day,
        "personal_records": personal_records,
        "ai_analysis": ai_analysis_link,
        "fuel_plan": fuel_plan_link,
        "linked_lifting_session": linked_lifting,
    }

    # ── 2. Health overlay (previous day's metrics + last night's sleep) ─────
    from datetime import timedelta as _td

    prev_date = activity_date - _td(days=1)
    health_overlay = None
    dm_result = await db.execute(
        select(DailyMetric)
        .where(
            DailyMetric.user_id == current_user.id,
            DailyMetric.metric_date == prev_date,
        )
        .order_by(DailyMetric.source)
        .limit(1)
    )
    dm = dm_result.scalar_one_or_none()
    if dm:
        health_overlay = {
            "date": prev_date,
            "hrv_ms": dm.hrv_ms,
            "recovery_score": dm.recovery_score,
            "resting_hr": dm.resting_hr,
            "sleep_duration_minutes": dm.sleep_duration_minutes,
            "sleep_efficiency": dm.sleep_efficiency,
        }

    if health_overlay is None:
        # Try DailyMetric where sleep_date matches (sleep often logged on wake date)
        sleep_result = await db.execute(
            select(SleepLog)
            .where(
                SleepLog.user_id == current_user.id,
                SleepLog.sleep_date == prev_date,
            )
            .order_by(SleepLog.source)
            .limit(1)
        )
        sleep = sleep_result.scalar_one_or_none()
        if sleep:
            health_overlay = {
                "date": prev_date,
                "hrv_ms": None,
                "recovery_score": None,
                "resting_hr": None,
                "sleep_duration_minutes": sleep.total_sleep_seconds / 60
                if sleep.total_sleep_seconds
                else None,
                "sleep_efficiency": sleep.sleep_efficiency,
            }

    # ── 3. Ride metrics (cycling only, lazy computation) ───────────────────
    ride_metrics = None
    if activity.sport_type == "cycling":
        analysis = await analyze_ride(db, current_user.id, activity_id)
        if analysis is not None:
            # Map the analysis dict to RideMetricsRead fields
            power_zones = analysis.get("power_zones", [])
            decoupling = analysis.get("decoupling")
            climbing = analysis.get("climbing_analysis")
            tss_bd = analysis.get("tss_breakdown", {})

            # Top speed — check velocity stream
            top_speed_kmh = await _compute_top_speed(db, activity_id)

            ride_metrics = {
                "power_zones": [
                    {
                        "zone_name": z.get("zone_name", ""),
                        "zone_label": z.get("zone_label", ""),
                        "seconds": z.get("seconds", 0),
                        "pct": z.get("pct", 0),
                    }
                    for z in power_zones
                ],
                "normalized_power": analysis.get("normalized_power"),
                "intensity_factor": analysis.get("intensity_factor"),
                "variability_index": analysis.get("variability_index"),
                "efficiency_factor": analysis.get("efficiency_factor"),
                "vam": analysis.get("vam"),
                "decoupling_pct": decoupling.get("decoupling_pct")
                if decoupling
                else None,
                "decoupling_class": decoupling.get("classification")
                if decoupling
                else None,
                "tss": tss_bd.get("total_tss") if tss_bd else activity.tss,
                "tss_per_hour": tss_bd.get("tss_per_hour") if tss_bd else None,
                "climbing_meters": climbing.get("total_climbing_m")
                if climbing
                else None,
                "top_speed_kmh": top_speed_kmh,
            }

    # ── 4. Training load context (ATL/CTL/TSB on activity date) ─────────────
    load_context = None
    if activity.sport_type == "cycling":
        profile = await get_or_create_cycling_profile(db, current_user.id)
        if profile.ftp_watts:
            lookback = 90
            end_date = activity_date
            start_date = end_date - _td(days=lookback + 42)
            daily_tss = await get_daily_tss(db, current_user.id, start_date, end_date)
            load_data = compute_training_load(
                daily_tss, end_date, lookback_days=lookback
            )
            if load_data:
                latest = load_data[-1]
                load_context = {
                    "atl": latest.get("atl"),
                    "ctl": latest.get("ctl"),
                    "tsb": latest.get("tsb"),
                }

    return ActivityContextRead(
        activity_id=activity.id,
        sport_type=activity.sport_type,
        connections=connections,
        health_overlay=health_overlay,
        ride_metrics=ride_metrics,
        load_context=load_context,
    )


# ── Dynamic /{activity_id} routes ────────────────────────────────────────────────


@router.get("/{activity_id}", response_model=ActivityDetailRead)
async def get_activity(
    activity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single activity by ID (with stream data)."""
    result = await db.execute(
        select(Activity)
        .options(
            selectinload(Activity.lifting_session).selectinload(LiftingSession.sets),
            selectinload(Activity.sources),
            selectinload(Activity.route),
            selectinload(Activity.streams),
        )
        .where(
            Activity.id == activity_id,
            Activity.user_id == current_user.id,
        )
    )
    activity = result.scalar_one_or_none()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    read = _enrich_activity_read(activity)
    return ActivityDetailRead(
        **read.model_dump(),
        streams=[
            ActivityStreamRead.model_validate(s) for s in (activity.streams or [])
        ],
    )


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


async def _compute_top_speed(db: AsyncSession, activity_id: uuid.UUID) -> float | None:
    """Compute max velocity in km/h from the activity's velocity stream(s)."""
    result = await db.execute(
        select(ActivityStream).where(
            ActivityStream.activity_id == activity_id,
            ActivityStream.stream_type.in_(
                ["velocity", "velocity_smooth", "enhanced_speed"]
            ),
        )
    )
    stream = result.scalar_one_or_none()
    if stream is None:
        return None
    raw = stream.data.get("data", []) if isinstance(stream.data, dict) else []
    values = [float(v) for v in raw if v is not None]
    if not values:
        return None
    max_mps = max(values)
    return round(max_mps * 3.6, 1)
