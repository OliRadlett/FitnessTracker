"""Activity API — list/filter/get activities, calendar, backfill route links, merge analysis, file import."""

import uuid
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import Date, asc, cast, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.activity import Activity, ActivityStream
from app.models.daily_metric import DailyMetric
from app.models.lifting import LiftingSession
from app.models.sleep import SleepLog
from app.models.user import User
from app.schemas.activity import (
    ActivityCalendarEntry,
    ActivityRead,
    ActivityStreamRead,
    CalendarDayData,
    DailyMetricSummary,
    LinkedLiftingSessionSummary,
    RideAnalysisResponse,
    SleepLogSummary,
)
from app.services.auth import get_current_user

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
    max_pages: int = Query(
        50, ge=1, le=200, description="Max Strava API pages to fetch"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Backfill ALL historical Strava activities for the current user.

    Pages through the Strava API to fetch the complete activity history,
    not just the most recent 100.  Uses merge/dedup to avoid duplicates.
    This may take a while for accounts with many activities.
    """
    from app.services.cache import redis_lock
    from app.services.strava import backfill_all_activities

    try:
        async with redis_lock(f"strava-backfill:{current_user.id}", ttl=3600):
            result = await backfill_all_activities(db, current_user.id, max_pages=max_pages)
            await db.commit()
    except RuntimeError:
        raise HTTPException(
            status_code=409, detail="A Strava backfill is already in progress"
        )
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
