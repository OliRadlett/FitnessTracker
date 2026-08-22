"""Strava service — activity sync, token refresh, backfill, route sync."""

import logging
import math
import uuid
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.integrations.strava_client import strava_client
from app.models.activity import Activity, ActivitySource, ActivityStream
from app.models.lifting import LiftingSession
from app.models.user import OAuthConnection

logger = logging.getLogger(__name__)


# ── NaN / Inf guard ─────────────────────────────────────────────────────────


def _safe_float(value, default=None):
    """Return *default* if *value* is None, NaN, or Inf."""
    if value is None:
        return default
    try:
        v = float(value)
        return default if (math.isnan(v) or math.isinf(v)) else v
    except (TypeError, ValueError):
        return default


# ── Strava type mapping ─────────────────────────────────────────────────────


def _map_strava_type(strava_type: str) -> str:
    """Map Strava sport types to our internal sport types."""
    mapping = {
        "Ride": "cycling",
        "VirtualRide": "cycling",
        "MountainBikeRide": "cycling",
        "GravelRide": "cycling",
        "EBikeRide": "cycling",
        "Run": "running",
        "TrailRun": "running",
        "VirtualRun": "running",
        "Swim": "swimming",
        "WeightTraining": "strength",
        "Workout": "strength",
        "CrossFit": "strength",
        "Powerlifting": "strength",
        "StrengthTraining": "strength",
        "Walk": "walking",
        "Hike": "hiking",
    }
    return mapping.get(strava_type, strava_type.lower())


# ── Connection helpers ──────────────────────────────────────────────────────


async def get_strava_connection(
    db: AsyncSession, user_id: uuid.UUID
) -> OAuthConnection | None:
    """Get the Strava OAuth connection for a user."""
    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.user_id == user_id,
            OAuthConnection.provider == "strava",
        )
    )
    return result.scalar_one_or_none()


async def refresh_if_needed(
    db: AsyncSession, connection: OAuthConnection
) -> OAuthConnection:
    """Refresh the access token if it's expired."""
    if connection.token_expires_at and connection.token_expires_at < datetime.now(UTC):
        if not connection.refresh_token:
            raise ValueError("No refresh token available")
        token_data = await strava_client.refresh_access_token(connection.refresh_token)
        connection.access_token = token_data["access_token"]
        connection.refresh_token = token_data.get(
            "refresh_token", connection.refresh_token
        )
        connection.token_expires_at = datetime.fromtimestamp(
            token_data["expires_at"], tz=UTC
        )
        await db.flush()
    return connection


# ── Activity creation helpers ───────────────────────────────────────────────


async def _create_activity_from_strava(
    db: AsyncSession,
    sa: dict,
    user_id: uuid.UUID,
    connection: OAuthConnection,
) -> Activity:
    """Create a new Activity from Strava API data and add an ActivitySource."""
    activity = Activity(
        user_id=user_id,
        connection_id=connection.id,
        source="strava",
        provider_activity_id=str(sa["id"]),
        sport_type=_map_strava_type(sa.get("sport_type", sa.get("type", "Unknown"))),
        name=sa.get("name", "Untitled"),
        start_date=datetime.fromisoformat(sa["start_date"].replace("Z", "+00:00")),
        duration_seconds=int(sa.get("moving_time", 0)),
        distance_meters=_safe_float(sa.get("distance")),
        elevation_gain_meters=_safe_float(sa.get("total_elevation_gain")),
        average_heartrate=_safe_float(sa.get("average_heartrate")),
        max_heartrate=_safe_float(sa.get("max_heartrate")),
        average_power=_safe_float(sa.get("average_watts")),
        normalized_power=_safe_float(sa.get("weighted_average_watts")),
        average_speed=_safe_float(sa.get("average_speed")),
        average_cadence=_safe_float(sa.get("average_cadence")),
        calories=_safe_float(sa.get("calories")),
        raw_data=sa,
    )
    db.add(activity)
    await db.flush()

    # Create the ActivitySource provenance record
    source = ActivitySource(
        activity_id=activity.id,
        provider="strava",
        provider_activity_id=str(sa["id"]),
        provider_name=sa.get("name"),
        raw_data=sa,
    )
    db.add(source)
    await db.flush()

    return activity


async def _find_activity_source(
    db: AsyncSession, provider_activity_id: str
) -> ActivitySource | None:
    """Check if an ActivitySource already exists for this Strava activity."""
    result = await db.execute(
        select(ActivitySource).where(
            ActivitySource.provider == "strava",
            ActivitySource.provider_activity_id == provider_activity_id,
        )
    )
    return result.scalar_one_or_none()


# ── Sync logic ──────────────────────────────────────────────────────────────


async def sync_activities(
    db: AsyncSession,
    user_id: uuid.UUID,
    after: datetime | None = None,
    limit: int = 100,
) -> list[Activity]:
    """Fetch and store recent Strava activities for a user.

    Uses the merge engine to detect duplicates with existing activities
    from other providers (Wahoo, Komoot). Creates ActivitySource records
    for all synced activities.
    """
    from app.services.merge_service import (
        find_duplicate_activity,
        link_activity_to_route,
        merge_activity,
    )
    from app.services.strava.linking import link_activity_to_lifting_sessions

    connection = await get_strava_connection(db, user_id)
    if not connection:
        raise ValueError("No Strava connection found")

    connection = await refresh_if_needed(db, connection)

    strava_activities = await strava_client.get_activities(
        access_token=connection.access_token,
        after=after,
        per_page=min(limit, 100),
    )

    synced: list[Activity] = []
    for sa in strava_activities:
        provider_id = str(sa["id"])

        # Check if already synced via ActivitySource
        existing_source = await _find_activity_source(db, provider_id)
        if existing_source:
            continue

        # Also check legacy source/provider_activity_id on Activity for backward compat
        legacy = await db.execute(
            select(Activity).where(
                Activity.source == "strava",
                Activity.provider_activity_id == provider_id,
            )
        )
        existing_activity = legacy.scalar_one_or_none()
        if existing_activity:
            # Backfill the ActivitySource record
            source = ActivitySource(
                activity_id=existing_activity.id,
                provider="strava",
                provider_activity_id=provider_id,
                provider_name=existing_activity.name,
                raw_data=sa,
            )
            db.add(source)
            continue

        # Parse activity data
        start_date = datetime.fromisoformat(sa["start_date"].replace("Z", "+00:00"))
        sport_type = _map_strava_type(sa.get("sport_type", sa.get("type", "Unknown")))
        duration_seconds = int(sa.get("moving_time", 0))
        distance_meters = sa.get("distance")

        # Use merge engine to detect duplicates from other providers
        duplicate = await find_duplicate_activity(
            db,
            user_id,
            sport_type,
            start_date,
            duration_seconds,
            distance_meters,
        )

        if duplicate:
            # Merge into the existing activity
            new_data = {
                "name": sa.get("name"),
                "duration_seconds": duration_seconds,
                "distance_meters": _safe_float(distance_meters),
                "elevation_gain_meters": _safe_float(sa.get("total_elevation_gain")),
                "average_heartrate": _safe_float(sa.get("average_heartrate")),
                "max_heartrate": _safe_float(sa.get("max_heartrate")),
                "average_power": _safe_float(sa.get("average_watts")),
                "normalized_power": _safe_float(sa.get("weighted_average_watts")),
                "average_speed": _safe_float(sa.get("average_speed")),
                "average_cadence": _safe_float(sa.get("average_cadence")),
                "calories": _safe_float(sa.get("calories")),
            }
            await merge_activity(
                db,
                duplicate,
                new_data,
                "strava",
                provider_id,
                raw_data=sa,
            )
            synced.append(duplicate)
        else:
            # Create new activity
            activity = await _create_activity_from_strava(db, sa, user_id, connection)
            synced.append(activity)

    await db.flush()

    # Fetch streams for newly synced cycling activities (needed for power curve, zones, etc.)
    for activity in synced:
        if activity.sport_type == "cycling" and activity.provider_activity_id:
            try:
                streams = await strava_client.get_activity_streams(
                    connection.access_token, int(activity.provider_activity_id)
                )
                for stream_type, stream_data in streams.items():
                    if "data" in stream_data:
                        raw_res = stream_data.get("resolution")
                        resolution = None
                        if isinstance(raw_res, int):
                            resolution = raw_res
                        elif isinstance(raw_res, str) and raw_res.isdigit():
                            resolution = int(raw_res)

                        stream = ActivityStream(
                            activity_id=activity.id,
                            stream_type=stream_type,
                            data={"data": stream_data["data"]},
                            resolution=resolution,
                        )
                        db.add(stream)
            except Exception:
                pass  # Streams are optional — don't fail the sync
    await db.flush()

    # Auto-compute TSS for cycling activities if not provided by Strava
    from app.services.cycling import (
        auto_compute_tss_for_activity,
        get_or_create_cycling_profile,
    )

    profile = await get_or_create_cycling_profile(db, user_id)
    if profile.ftp_watts:
        for activity in synced:
            if activity.sport_type == "cycling" and activity.tss is None:
                await auto_compute_tss_for_activity(db, activity, profile.ftp_watts)
        await db.flush()

    # Auto-link newly synced strength activities to lifting sessions
    for activity in synced:
        await link_activity_to_lifting_sessions(db, activity)

    # Auto-link GPS activities to routes
    for activity in synced:
        await link_activity_to_route(db, activity)

    return synced


async def backfill_all_activities(
    db: AsyncSession,
    user_id: uuid.UUID,
    max_pages: int = 50,
) -> dict:
    """Backfill ALL historical Strava activities for a user.

    Pages through the Strava API repeatedly until no more activities are
    returned or ``max_pages`` is reached.  Uses the same merge/dedup
    logic as :func:`sync_activities`.

    Returns a dict with counts: ``{"synced": N, "skipped": N, "pages": N}``.
    """
    from app.services.merge_service import (
        find_duplicate_activity,
        merge_activity,
    )
    from app.services.strava.linking import (
        MATCH_THRESHOLD,
        STRENGTH_SPORT_TYPES,
        _match_score,
    )

    connection = await get_strava_connection(db, user_id)
    if not connection:
        raise ValueError("No Strava connection found")

    connection = await refresh_if_needed(db, connection)

    synced_total = 0
    skipped_total = 0
    synced_cycling: list[tuple[uuid.UUID, int]] = []  # (activity_id, strava_id)
    page = 1

    while page <= max_pages:
        strava_activities = await strava_client.get_activities(
            access_token=connection.access_token,
            page=page,
            per_page=100,
        )

        if not strava_activities:
            break

        for sa in strava_activities:
            provider_id = str(sa["id"])

            # Check if already synced via ActivitySource
            existing_source = await _find_activity_source(db, provider_id)
            if existing_source:
                skipped_total += 1
                continue

            # Legacy check
            legacy = await db.execute(
                select(Activity).where(
                    Activity.source == "strava",
                    Activity.provider_activity_id == provider_id,
                )
            )
            existing_activity = legacy.scalar_one_or_none()
            if existing_activity:
                source = ActivitySource(
                    activity_id=existing_activity.id,
                    provider="strava",
                    provider_activity_id=provider_id,
                    provider_name=existing_activity.name,
                    raw_data=sa,
                )
                db.add(source)
                skipped_total += 1
                continue

            # Parse and create
            start_date = datetime.fromisoformat(sa["start_date"].replace("Z", "+00:00"))
            sport_type = _map_strava_type(
                sa.get("sport_type", sa.get("type", "Unknown"))
            )
            duration_seconds = int(sa.get("moving_time", 0))
            distance_meters = sa.get("distance")

            duplicate = await find_duplicate_activity(
                db,
                user_id,
                sport_type,
                start_date,
                duration_seconds,
                distance_meters,
            )

            if duplicate:
                new_data = {
                    "name": sa.get("name"),
                    "duration_seconds": duration_seconds,
                    "distance_meters": _safe_float(distance_meters),
                    "elevation_gain_meters": _safe_float(
                        sa.get("total_elevation_gain")
                    ),
                    "average_heartrate": _safe_float(sa.get("average_heartrate")),
                    "max_heartrate": _safe_float(sa.get("max_heartrate")),
                    "average_power": _safe_float(sa.get("average_watts")),
                    "normalized_power": _safe_float(sa.get("weighted_average_watts")),
                    "average_speed": _safe_float(sa.get("average_speed")),
                    "average_cadence": _safe_float(sa.get("average_cadence")),
                    "calories": _safe_float(sa.get("calories")),
                }
                await merge_activity(
                    db, duplicate, new_data, "strava", provider_id, raw_data=sa
                )
                if sport_type == "cycling":
                    synced_cycling.append((duplicate.id, int(provider_id)))
            else:
                activity = await _create_activity_from_strava(
                    db, sa, user_id, connection
                )
                if sport_type == "cycling":
                    synced_cycling.append((activity.id, int(provider_id)))

            synced_total += 1

        # Commit every 10 pages to persist partial progress
        if page % 10 == 0:
            await db.commit()
            logger.info(
                f"Strava backfill progress: {synced_total} synced, "
                f"{skipped_total} skipped through page {page}"
            )
        else:
            await db.flush()
        page += 1

        # If fewer than 100 results, we've reached the end
        if len(strava_activities) < 100:
            break

    # Fetch streams for newly synced cycling activities
    stream_count = 0
    for activity_id, strava_id in synced_cycling:
        try:
            streams = await strava_client.get_activity_streams(
                connection.access_token, strava_id
            )
            for stream_type, stream_data in streams.items():
                if "data" in stream_data:
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
            stream_count += 1
        except Exception:
            pass  # Streams are optional — don't fail the backfill
    if synced_cycling:
        logger.info(
            f"Backfilled streams for {stream_count} of {len(synced_cycling)} cycling activities"
        )
    await db.flush()

    # Auto-link newly synced activities to lifting sessions and routes.
    # Pre-fetch all candidate data in bulk to avoid N+1 queries.
    from app.models.route import Route
    from app.services.merge_service import _extract_activity_polyline
    from app.services.polyline_utils import decode_polyline, haversine_distance
    from app.services.route_service import _compute_match_score

    # 1. Collect IDs of activities already linked to a lifting session
    linked_ids_result = await db.execute(
        select(LiftingSession.activity_id).where(
            LiftingSession.user_id == user_id,
            LiftingSession.activity_id.isnot(None),
        )
    )
    linked_activity_ids = set(linked_ids_result.scalars().all())

    # 2. Fetch all Strava activities with lifting_session eagerly loaded
    result = await db.execute(
        select(Activity)
        .options(selectinload(Activity.lifting_session))
        .where(
            Activity.user_id == user_id,
            Activity.source == "strava",
        )
    )
    all_activities = list(result.scalars().unique().all())
    activities = [a for a in all_activities if a.id not in linked_activity_ids]

    if not activities:
        return {
            "synced": synced_total,
            "skipped": skipped_total,
            "pages": page - 1,
            "streams_backfilled": stream_count,
        }

    # 3. Batch-fetch all unlinked lifting sessions with sets (for strength matching)
    session_result = await db.execute(
        select(LiftingSession)
        .options(selectinload(LiftingSession.sets))
        .where(
            LiftingSession.user_id == user_id,
            LiftingSession.activity_id.is_(None),
        )
    )
    unlinked_sessions = list(session_result.scalars().all())
    # Index by date for fast ±2 day lookups
    sessions_by_date: dict[date, list] = defaultdict(list)
    for s in unlinked_sessions:
        sessions_by_date[s.session_date].append(s)

    # 4. Batch-fetch all user routes (for route matching)
    route_result = await db.execute(select(Route).where(Route.user_id == user_id))
    all_routes = list(route_result.scalars().all())

    # 5. Link activities using pre-fetched data (no per-activity DB queries)
    for activity in activities:
        # -- Strength activity → lifting session matching --
        if activity.sport_type in STRENGTH_SPORT_TYPES and not activity.lifting_session:
            activity_date = (
                activity.start_date.date()
                if activity.start_date.tzinfo
                else activity.start_date.date()
            )
            candidates = []
            for offset in range(-2, 3):
                check_date = activity_date + timedelta(days=offset)
                candidates.extend(sessions_by_date.get(check_date, []))
            if candidates:
                scored = [(s, _match_score(activity, s)) for s in candidates]
                scored.sort(key=lambda x: x[1], reverse=True)
                best_session, best_score = scored[0]
                if best_score >= MATCH_THRESHOLD:
                    best_session.activity_id = activity.id
                    if not best_session.duration_seconds and activity.duration_seconds:
                        best_session.duration_seconds = activity.duration_seconds

        # -- GPS activity → route matching --
        if activity.route_id is None and all_routes:
            if activity.sport_type in ("cycling", "running", "walking", "hiking"):
                polyline = _extract_activity_polyline(activity)
                if polyline:
                    points = decode_polyline(polyline)
                    if points and len(points) >= 2:
                        from app.config import get_settings as _gs

                        threshold = _gs().activity_route_link_threshold
                        start_lat, start_lng = points[0]
                        end_lat, end_lng = points[-1]
                        best_route = None
                        best_score = 0.0
                        for route in all_routes:
                            if route.sport_type != activity.sport_type and not (
                                route.sport_type in ("cycling", "running")
                                and activity.sport_type in ("cycling", "running")
                            ):
                                continue
                            start_dist = haversine_distance(
                                start_lat, start_lng, route.start_lat, route.start_lng
                            )
                            if start_dist > 5000:
                                continue
                            score = _compute_match_score(
                                activity.distance_meters or 0,
                                polyline,
                                activity.name,
                                start_lat,
                                start_lng,
                                end_lat,
                                end_lng,
                                route,
                            )
                            if score > best_score:
                                best_score = score
                                best_route = route
                        if best_score >= threshold and best_route is not None:
                            activity.route_id = best_route.id

    await db.flush()
    return {
        "synced": synced_total,
        "skipped": skipped_total,
        "pages": page - 1,
        "streams_backfilled": stream_count,
    }


async def backfill_streams_for_all_activities(
    db: AsyncSession,
    user_id: uuid.UUID | None = None,
) -> dict:
    """Backfill streams for cycling activities that are missing them.

    Queries all cycling activities with a ``provider_activity_id`` that
    have no associated ``ActivityStream`` records, fetches streams from
    Strava, and stores them.

    If *user_id* is given, only that user's activities are processed.
    Returns ``{"backfilled": N, "total": N}``.
    """
    from sqlalchemy import not_

    # Subquery: activity IDs that already have streams
    stream_exists = (
        select(ActivityStream.activity_id)
        .where(ActivityStream.activity_id == Activity.id)
        .correlate(Activity)
        .exists()
    )

    query = select(Activity).where(
        Activity.sport_type == "cycling",
        Activity.provider_activity_id.isnot(None),
        not_(stream_exists),
    )
    if user_id:
        query = query.where(Activity.user_id == user_id)

    result = await db.execute(query)
    activities = list(result.scalars().all())

    if not activities:
        return {"backfilled": 0, "total": 0}

    # Group by user to batch token refresh
    activities_by_user: dict[uuid.UUID, list[Activity]] = defaultdict(list)
    for a in activities:
        activities_by_user[a.user_id].append(a)

    backfilled = 0
    total = len(activities)

    for uid, user_activities in activities_by_user.items():
        connection = await get_strava_connection(db, uid)
        if not connection:
            logger.warning(
                f"No Strava connection for user {uid}, skipping stream backfill"
            )
            continue

        try:
            connection = await refresh_if_needed(db, connection)
        except Exception as e:
            logger.warning(f"Could not refresh Strava token for user {uid}: {e}")
            continue

        for activity in user_activities:
            try:
                streams = await strava_client.get_activity_streams(
                    connection.access_token, int(activity.provider_activity_id)
                )
                for stream_type, stream_data in streams.items():
                    if "data" in stream_data:
                        raw_res = stream_data.get("resolution")
                        resolution = None
                        if isinstance(raw_res, int):
                            resolution = raw_res
                        elif isinstance(raw_res, str) and raw_res.isdigit():
                            resolution = int(raw_res)

                        stream = ActivityStream(
                            activity_id=activity.id,
                            stream_type=stream_type,
                            data={"data": stream_data["data"]},
                            resolution=resolution,
                        )
                        db.add(stream)
                backfilled += 1
            except Exception as e:
                logger.debug(f"Failed to fetch streams for activity {activity.id}: {e}")

        # Commit per user to save progress
        await db.commit()

    logger.info(f"Backfilled streams for {backfilled} of {total} activities")
    return {"backfilled": backfilled, "total": total}


# ── Route sync ───────────────────────────────────────────────────────────────


async def sync_strava_routes(
    db: AsyncSession,
    user_id: uuid.UUID,
    limit: int = 100,
) -> tuple[int, int]:
    """Fetch and store Strava routes for a user.

    Sources:
    1. Strava Routes API (dedicated saved routes with full polylines)
    2. Existing cycling activities with map.summary_polyline (activity-derived routes)

    Returns (total_synced, merged_count).
    """
    from app.services.polyline_utils import polyline_total_distance
    from app.services.route_service import create_or_merge_route

    connection = await get_strava_connection(db, user_id)
    if not connection:
        raise ValueError("No Strava connection found")

    connection = await refresh_if_needed(db, connection)

    synced_count = 0
    merged_count = 0

    # 1. Sync from Strava Routes API
    page = 1
    while synced_count < limit:
        try:
            routes = await strava_client.get_athlete_routes(
                connection.access_token,
                page=page,
                per_page=30,
            )
        except Exception as e:
            logging.getLogger(__name__).error(
                f"Failed to fetch Strava routes page {page}: {e}"
            )
            break

        if not routes:
            break

        for route_data in routes:
            route_id = str(route_data.get("id", ""))
            if not route_id:
                continue

            name = route_data.get("name", "Strava Route")
            distance = route_data.get("distance", 0) or 0
            elevation_gain = route_data.get("elevation_gain", 0) or 0
            estimated_time = route_data.get("estimated_moving_time", 0) or None

            # Get the best available polyline
            map_data = route_data.get("map", {})
            polyline = map_data.get("polyline") or map_data.get("summary_polyline", "")
            if not polyline:
                logging.getLogger(__name__).warning(
                    f"Skipping Strava route {route_id}: no polyline"
                )
                continue

            sport_type = _map_strava_type(route_data.get("type", "Ride"))

            # Compute distance from polyline if not provided
            if distance <= 0:
                distance = polyline_total_distance(polyline)

            # Check if already synced
            from sqlalchemy import select as sa_select

            from app.models.route import RouteSource

            existing = await db.execute(
                sa_select(RouteSource).where(
                    RouteSource.provider == "strava",
                    RouteSource.provider_route_id == route_id,
                )
            )
            was_existing = existing.scalar_one_or_none() is not None

            await create_or_merge_route(
                db,
                user_id,
                name=name,
                sport_type=sport_type,
                distance_meters=distance,
                encoded_polyline=polyline,
                provider="strava",
                provider_route_id=route_id,
                provider_name=name,
                elevation_gain_meters=elevation_gain if elevation_gain > 0 else None,
                estimated_time_seconds=estimated_time,
                raw_data=route_data,
            )

            synced_count += 1
            if was_existing:
                merged_count += 1

        page += 1
        if len(routes) < 30:
            break

    # 2. Extract routes from existing cycling activities with polylines
    # Find cycling activities that have map.summary_polyline in raw_data
    from sqlalchemy import select as sa_select

    result = await db.execute(
        sa_select(Activity).where(
            Activity.user_id == user_id,
            Activity.sport_type == "cycling",
            Activity.source == "strava",
            Activity.raw_data.isnot(None),
        )
    )
    activities = list(result.scalars().all())

    for activity in activities:
        if not activity.raw_data:
            continue
        map_data = activity.raw_data.get("map", {})
        polyline = map_data.get("polyline") or map_data.get("summary_polyline", "")
        if not polyline:
            continue

        activity_provider_id = f"activity_{activity.provider_activity_id}"

        # Check if this activity-derived route already exists
        from app.models.route import RouteSource

        existing = await db.execute(
            sa_select(RouteSource).where(
                RouteSource.provider == "strava",
                RouteSource.provider_route_id == activity_provider_id,
            )
        )
        if existing.scalar_one_or_none():
            continue

        distance = activity.distance_meters or polyline_total_distance(polyline)

        await create_or_merge_route(
            db,
            user_id,
            name=activity.name,
            sport_type="cycling",
            distance_meters=distance,
            encoded_polyline=polyline,
            provider="strava",
            provider_route_id=activity_provider_id,
            provider_name=activity.name,
            elevation_gain_meters=activity.elevation_gain_meters,
            estimated_time_seconds=activity.duration_seconds,
            raw_data={"activity_id": str(activity.id), "source": "activity_polyline"},
        )
        synced_count += 1

    logging.getLogger(__name__).info(
        f"Strava route sync complete for user {user_id}: {synced_count} synced, {merged_count} merged"
    )
    return synced_count, merged_count
