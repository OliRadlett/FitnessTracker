"""Wahoo service — OAuth helper, token refresh, route sync, activity sync."""

import uuid
import logging
from datetime import datetime, timezone, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.wahoo_client import wahoo_client
from app.models.activity import Activity, ActivitySource
from app.models.user import OAuthConnection
from app.services.polyline_utils import (
    wahoo_points_to_polyline,
    polyline_total_distance,
    extract_elevation_profile_from_wahoo_points,
)
from app.services.route_service import create_or_merge_route

logger = logging.getLogger(__name__)


# ── Sport type mapping ───────────────────────────────────────────────────────

_WAHOO_SPORT_TYPE_MAP: dict[str, str] = {
    "cycling": "cycling",
    "biking": "cycling",
    "road_cycling": "cycling",
    "mountain_biking": "cycling",
    "indoor_cycling": "cycling",
    "running": "running",
    "trail_running": "running",
    "treadmill_running": "running",
    "swimming": "swimming",
    "walking": "walking",
    "hiking": "hiking",
    "fitness": "strength",
    "strength_training": "strength",
    "gym": "strength",
}


def _map_wahoo_sport_type(wahoo_type: str | None) -> str:
    """Map Wahoo workout type to internal sport type."""
    if not wahoo_type:
        return "cycling"  # Wahoo is primarily cycling
    return _WAHOO_SPORT_TYPE_MAP.get(wahoo_type.lower(), wahoo_type.lower())


async def get_wahoo_connection(db: AsyncSession, user_id: uuid.UUID) -> OAuthConnection | None:
    """Get the Wahoo OAuth connection for a user."""
    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.user_id == user_id,
            OAuthConnection.provider == "wahoo",
        )
    )
    return result.scalar_one_or_none()


async def refresh_if_needed(db: AsyncSession, connection: OAuthConnection) -> OAuthConnection:
    """Refresh the access token if it's expired."""
    if connection.token_expires_at and connection.token_expires_at < datetime.now(timezone.utc):
        if not connection.refresh_token:
            raise ValueError("No refresh token available")
        token_data = await wahoo_client.refresh_access_token(connection.refresh_token)
        connection.access_token = token_data["access_token"]
        connection.refresh_token = token_data.get("refresh_token", connection.refresh_token)
        if "expires_in" in token_data:
            connection.token_expires_at = datetime.now(timezone.utc) + timedelta(
                seconds=int(token_data["expires_in"])
            )
        await db.flush()
    return connection


# ── Activity sync ────────────────────────────────────────────────────────────


async def sync_wahoo_activities(
    db: AsyncSession,
    user_id: uuid.UUID,
    limit: int = 100,
) -> list[Activity]:
    """Enrich existing Strava activities with Wahoo workout data.

    Strava is the single source of truth for activities. Wahoo data is used
    ONLY to enrich existing Strava activities — if no matching Strava activity
    exists, the Wahoo workout is skipped (not created as a standalone activity).

    Matching is done by date proximity + sport type + duration similarity.
    Wahoo data fills in gaps: power data, HR data, elevation, calories, etc.

    Returns the list of enriched activities.
    """
    from app.services.merge_service import find_duplicate_activity, merge_activity, link_activity_to_route
    from app.services.cycling import auto_compute_tss_for_activity, get_or_create_cycling_profile

    connection = await get_wahoo_connection(db, user_id)
    if not connection:
        raise ValueError("No Wahoo connection found")

    connection = await refresh_if_needed(db, connection)

    synced: list[Activity] = []
    page = 1

    while len(synced) < limit:
        try:
            workouts = await wahoo_client.get_workouts(
                connection.access_token, page=page, per_page=50,
            )
        except Exception as e:
            logger.error(f"Failed to fetch Wahoo workouts page {page}: {e}")
            break

        if not workouts:
            break

        # Handle case where API returns a dict with workouts nested inside
        if isinstance(workouts, dict):
            workouts = workouts.get("workouts", workouts.get("data", []))
        if not isinstance(workouts, list):
            logger.warning(f"Wahoo workouts response is not a list: {type(workouts)}")
            break

        for workout in workouts:
            if not isinstance(workout, dict):
                logger.warning(f"Skipping non-dict workout: {type(workout)}")
                continue
            workout_id = str(workout.get("id", ""))
            if not workout_id:
                continue

            # Check if already synced via ActivitySource
            existing_source_result = await db.execute(
                select(ActivitySource).where(
                    ActivitySource.provider == "wahoo",
                    ActivitySource.provider_activity_id == workout_id,
                )
            )
            if existing_source_result.scalar_one_or_none():
                continue

            # Parse workout data
            name = workout.get("name", "Wahoo Workout")
            sport_type = _map_wahoo_sport_type(workout.get("workout_type") or workout.get("sport_type"))

            # Parse start date — Wahoo may use "starts" or "start_date"
            starts_raw = workout.get("starts") or workout.get("start_date") or workout.get("created_at")
            if not starts_raw:
                logger.warning(f"Skipping Wahoo workout {workout_id}: no start date")
                continue

            if isinstance(starts_raw, str):
                start_date = datetime.fromisoformat(starts_raw.replace("Z", "+00:00"))
            else:
                start_date = starts_raw

            # Duration — Wahoo may use "duration" (seconds) or "minutes"
            duration_seconds = workout.get("duration") or workout.get("moving_time")
            if not duration_seconds:
                minutes = workout.get("minutes")
                if minutes:
                    duration_seconds = int(float(minutes) * 60)

            # Distance in meters
            distance_meters = workout.get("distance") or workout.get("distance_meters")

            # Power data
            average_power = workout.get("average_power") or workout.get("avg_power")
            normalized_power = workout.get("normalized_power") or workout.get("weighted_average_power")

            # HR data
            average_heartrate = workout.get("average_heartrate") or workout.get("avg_heartrate")
            max_heartrate = workout.get("max_heartrate")

            # Other metrics
            elevation_gain = workout.get("elevation_gain") or workout.get("total_elevation_gain")
            average_speed = workout.get("average_speed") or workout.get("avg_speed")
            calories = workout.get("calories") or workout.get("kcal")

            # Use merge engine to detect duplicates from other providers
            duplicate = await find_duplicate_activity(
                db, user_id, sport_type, start_date,
                int(duration_seconds) if duration_seconds else None,
                float(distance_meters) if distance_meters else None,
            )

            new_data = {
                "name": name,
                "duration_seconds": int(duration_seconds) if duration_seconds else None,
                "distance_meters": float(distance_meters) if distance_meters else None,
                "elevation_gain_meters": float(elevation_gain) if elevation_gain else None,
                "average_heartrate": float(average_heartrate) if average_heartrate else None,
                "max_heartrate": float(max_heartrate) if max_heartrate else None,
                "average_power": float(average_power) if average_power else None,
                "normalized_power": float(normalized_power) if normalized_power else None,
                "average_speed": float(average_speed) if average_speed else None,
                "calories": float(calories) if calories else None,
            }

            if duplicate:
                # Enrich the existing Strava activity with Wahoo data
                await merge_activity(
                    db, duplicate, new_data, "wahoo", workout_id, raw_data=workout,
                )
                synced.append(duplicate)
                logger.info(f"Enriched activity '{duplicate.name}' with Wahoo workout {workout_id}")
            else:
                # No matching Strava activity found — skip (don't create standalone Wahoo activity)
                logger.debug(f"Skipping Wahoo workout {workout_id} ({name}): no matching Strava activity")

            if len(synced) >= limit:
                break

        page += 1
        if len(workouts) < 50:
            break

    await db.flush()

    # Auto-compute TSS for cycling activities
    profile = await get_or_create_cycling_profile(db, user_id)
    if profile.ftp_watts:
        for activity in synced:
            if activity.sport_type == "cycling" and activity.tss is None:
                await auto_compute_tss_for_activity(db, activity, profile.ftp_watts)
        await db.flush()

    # Auto-link GPS activities to routes
    for activity in synced:
        await link_activity_to_route(db, activity)

    logger.info(f"Wahoo activity sync complete for user {user_id}: {len(synced)} synced/merged")
    return synced


# ── Route sync ───────────────────────────────────────────────────────────────


async def sync_wahoo_routes(
    db: AsyncSession,
    user_id: uuid.UUID,
    limit: int = 100,
) -> tuple[int, int]:
    """Fetch and store Wahoo routes for a user.

    Handles multiple Wahoo point data formats and extracts elevation profiles
    from GPS point arrays when available.

    Returns (total_synced, merged_count).
    """
    connection = await get_wahoo_connection(db, user_id)
    if not connection:
        raise ValueError("No Wahoo connection found")

    connection = await refresh_if_needed(db, connection)

    synced_count = 0
    merged_count = 0
    page = 1

    while synced_count < limit:
        try:
            routes = await wahoo_client.get_routes(
                connection.access_token, page=page, per_page=50,
            )
        except Exception as e:
            logger.error(f"Failed to fetch Wahoo routes page {page}: {e}")
            break

        if not routes:
            break

        # Handle case where API returns a dict with routes nested inside
        if isinstance(routes, dict):
            routes = routes.get("routes", routes.get("data", []))
        if not isinstance(routes, list):
            logger.warning(f"Wahoo routes response is not a list: {type(routes)}")
            break

        for route_data in routes:
            if not isinstance(route_data, dict):
                logger.warning(f"Skipping non-dict route: {type(route_data)}")
                continue
            route_id = str(route_data.get("id", ""))
            if not route_id:
                continue

            name = route_data.get("name", "Wahoo Route")
            distance = route_data.get("distance", 0) or 0  # meters

            # Extract GPS points from the route
            # Wahoo routes may have "points" or "course_points" arrays
            points_data = route_data.get("points", [])

            if not points_data:
                # Try to fetch detailed route for GPS data
                try:
                    detail = await wahoo_client.get_route_detail(
                        connection.access_token, int(route_id),
                    )
                    points_data = detail.get("points", [])
                    route_data = detail  # Use the detailed data
                except Exception:
                    logger.warning(f"Skipping Wahoo route {route_id}: no GPS data")
                    continue

            if not points_data:
                logger.warning(f"Skipping Wahoo route {route_id}: empty points")
                continue

            # Convert Wahoo points to polyline and extract elevation profile
            # Wahoo points can be: [{"location": [lat, lng, ele]}, ...] or [[lat, lng, ele], ...]
            elevation_profile = None
            try:
                if isinstance(points_data[0], dict):
                    # Extract from location field
                    coords = []
                    for p in points_data:
                        loc = p.get("location") or p.get("latlng") or []
                        if len(loc) >= 2:
                            coords.append(loc)
                    polyline = wahoo_points_to_polyline(coords)
                    # Extract elevation profile from coords (may have 3rd element)
                    if coords and len(coords[0]) >= 3:
                        elevation_profile = extract_elevation_profile_from_wahoo_points(coords)
                elif isinstance(points_data[0], list):
                    polyline = wahoo_points_to_polyline(points_data)
                    # Extract elevation profile from point arrays
                    if points_data and len(points_data[0]) >= 3:
                        elevation_profile = extract_elevation_profile_from_wahoo_points(points_data)
                else:
                    logger.warning(f"Skipping Wahoo route {route_id}: unknown point format")
                    continue
            except (ValueError, IndexError) as e:
                logger.warning(f"Skipping Wahoo route {route_id}: {e}")
                continue

            if distance <= 0:
                distance = polyline_total_distance(polyline)

            elevation_gain = route_data.get("ascent", 0) or route_data.get("elevation_gain", 0) or None
            estimated_time = route_data.get("estimated_time", 0) or None

            await create_or_merge_route(
                db, user_id,
                name=name,
                sport_type="cycling",  # Wahoo routes are cycling by default
                distance_meters=distance,
                encoded_polyline=polyline,
                provider="wahoo",
                provider_route_id=route_id,
                provider_name=name,
                elevation_gain_meters=elevation_gain,
                estimated_time_seconds=estimated_time,
                elevation_profile=elevation_profile,
                raw_data=route_data,
            )
            synced_count += 1

        page += 1
        if len(routes) < 50:
            break

    logger.info(f"Wahoo route sync complete for user {user_id}: {synced_count} synced, {merged_count} merged")
    return synced_count, merged_count
