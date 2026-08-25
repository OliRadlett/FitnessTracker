"""Strava service — webhook event handling."""

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.strava_client import strava_client
from app.models.activity import Activity, ActivitySource, ActivityStream
from app.models.user import OAuthConnection
from app.services.strava.linking import link_activity_to_lifting_sessions
from app.services.strava.sync import (
    _create_activity_from_strava,
    _find_activity_source,
    _map_strava_type,
    _safe_float,
    refresh_if_needed,
)


async def handle_strava_event(
    db: AsyncSession,
    object_type: str,
    object_id: int,
    aspect_type: str,
    owner_id: int,
    updates: dict | None = None,
) -> None:
    """Handle incoming Strava webhook events."""
    if object_type != "activity":
        return

    if aspect_type == "create":
        await _handle_activity_create(db, owner_id, object_id)
    elif aspect_type == "update":
        await _handle_activity_update(db, owner_id, object_id, updates or {})
    elif aspect_type == "delete":
        await _handle_activity_delete(db, owner_id, object_id)


async def _handle_activity_create(
    db: AsyncSession, strava_athlete_id: int, activity_id: int
) -> None:
    """Fetch and store a new activity from a webhook event."""
    from app.services.merge_service import (
        find_duplicate_activity,
        link_activity_to_route,
        merge_activity,
    )

    # Find the connection by provider_user_id
    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.provider == "strava",
            OAuthConnection.provider_user_id == str(strava_athlete_id),
        )
    )
    connection = result.scalar_one_or_none()
    if not connection:
        return

    connection = await refresh_if_needed(db, connection)

    # Check if already synced via ActivitySource
    existing_source = await _find_activity_source(db, str(activity_id))
    if existing_source:
        return

    # Fetch activity detail
    sa = await strava_client.get_activity_detail(connection.access_token, activity_id)

    start_date = datetime.fromisoformat(sa["start_date"].replace("Z", "+00:00"))
    sport_type = _map_strava_type(sa.get("sport_type", sa.get("type", "Unknown")))
    duration_seconds = int(sa.get("moving_time") or 0)
    distance_meters = sa.get("distance")

    # Use merge engine to detect duplicates from other providers
    duplicate = await find_duplicate_activity(
        db,
        connection.user_id,
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
            str(activity_id),
            raw_data=sa,
        )
        activity = duplicate
    else:
        activity = await _create_activity_from_strava(
            db, sa, connection.user_id, connection
        )

    # Fetch and store streams
    try:
        streams = await strava_client.get_activity_streams(
            connection.access_token, activity_id
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
        await db.flush()
    except Exception:
        pass  # Streams are optional

    # Auto-compute TSS for cycling activities
    from app.services.cycling import (
        auto_compute_tss_for_activity,
        get_or_create_cycling_profile,
    )

    profile = await get_or_create_cycling_profile(db, activity.user_id)
    if profile.ftp_watts and activity.sport_type == "cycling" and activity.tss is None:
        await auto_compute_tss_for_activity(db, activity, profile.ftp_watts)
        await db.flush()

    # Auto-link to lifting session if this is a strength activity
    await link_activity_to_lifting_sessions(db, activity)

    # Auto-link to route if GPS activity
    await link_activity_to_route(db, activity)


async def _handle_activity_update(
    db: AsyncSession, strava_athlete_id: int, activity_id: int, updates: dict
) -> None:
    """Handle activity update webhook."""
    # Verify activity belongs to the user who owns this Strava connection (BUG-009)
    conn_result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.provider == "strava",
            OAuthConnection.provider_user_id == str(strava_athlete_id),
        )
    )
    connection = conn_result.scalar_one_or_none()
    if not connection:
        return

    result = await db.execute(
        select(Activity).where(
            Activity.source == "strava",
            Activity.provider_activity_id == str(activity_id),
            Activity.user_id == connection.user_id,
        )
    )
    activity = result.scalar_one_or_none()
    if not activity:
        return

    if "title" in updates:
        activity.name = updates["title"]
    await db.flush()


async def _handle_activity_delete(
    db: AsyncSession, strava_athlete_id: int, activity_id: int
) -> None:
    """Handle activity deletion webhook."""
    # Verify activity belongs to the user who owns this Strava connection (BUG-009)
    conn_result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.provider == "strava",
            OAuthConnection.provider_user_id == str(strava_athlete_id),
        )
    )
    connection = conn_result.scalar_one_or_none()
    if not connection:
        return

    result = await db.execute(
        select(Activity).where(
            Activity.source == "strava",
            Activity.provider_activity_id == str(activity_id),
            Activity.user_id == connection.user_id,
        )
    )
    activity = result.scalar_one_or_none()
    if activity:
        await db.delete(activity)
        await db.flush()
