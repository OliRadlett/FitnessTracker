"""Fill a route's elevation profile from its source activity's altitude stream.

Strava route sync stores ``total_elevation_gain`` but no profile, so half the
library could never be terrain-classified. Those routes were created from an
activity (``raw_data.activity_id``) and the activity's altitude stream is
already stored — this samples it onto the route to produce the canonical
``{distance, elevation}`` profile.
"""

from __future__ import annotations

import json
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.activity import ActivityStream
from app.models.route import Route

logger = logging.getLogger(__name__)

PROFILE_POINTS = 120


def _stream_values(stream_data) -> list[float | None]:
    """Streams are stored as ``{"data": [...]}`` (JSONB may arrive as str)."""
    payload = json.loads(stream_data) if isinstance(stream_data, str) else stream_data
    if isinstance(payload, dict):
        payload = payload.get("data")
    if not isinstance(payload, list):
        return []
    return [float(v) if isinstance(v, (int, float)) else None for v in payload]


def resample_elevation(
    altitudes: list[float | None],
    distances: list[float | None] | None,
    route_distance_m: float,
    points: int = PROFILE_POINTS,
) -> dict | None:
    """Resample a stream onto ``points`` evenly spaced route distances.

    ``distances`` may be None (or shorter than ``altitudes``); then the
    altitude samples are assumed evenly spaced across the route. Returns None
    when fewer than two usable samples exist.
    """
    if len(altitudes) < 2 or route_distance_m <= 0:
        return None

    pairs: list[tuple[float, float]] = []
    if distances and len(distances) >= len(altitudes):
        for distance, altitude in zip(distances, altitudes):
            if distance is None or altitude is None:
                continue
            pairs.append((float(distance), float(altitude)))
    else:
        span = len(altitudes) - 1
        for index, altitude in enumerate(altitudes):
            if altitude is None:
                continue
            pairs.append((route_distance_m * index / span, float(altitude)))

    if len(pairs) < 2:
        return None

    pairs.sort(key=lambda pair: pair[0])
    # A stream can repeat its first distance while the GPS settles; keep the
    # last value at each distance so interpolation never divides by zero.
    deduped: list[tuple[float, float]] = []
    for distance, altitude in pairs:
        if deduped and abs(distance - deduped[-1][0]) < 1e-6:
            deduped[-1] = (distance, altitude)
        else:
            deduped.append((distance, altitude))
    pairs = deduped
    if len(pairs) < 2:
        return None

    source_span = pairs[-1][0]
    if source_span <= 0:
        return None

    sampled_distances: list[float] = []
    sampled_elevations: list[float] = []
    cursor = 0
    for index in range(points):
        target = route_distance_m * index / (points - 1)
        source_target = target if source_span == route_distance_m else (
            target / route_distance_m * source_span
        )
        while cursor < len(pairs) - 2 and pairs[cursor + 1][0] < source_target:
            cursor += 1
        d1, e1 = pairs[cursor]
        d2, e2 = pairs[cursor + 1]
        if d2 <= d1:
            altitude = e1
        else:
            fraction = (source_target - d1) / (d2 - d1)
            altitude = e1 + max(0.0, min(1.0, fraction)) * (e2 - e1)
        sampled_distances.append(round(target, 1))
        sampled_elevations.append(round(altitude, 1))

    return {"distance": sampled_distances, "elevation": sampled_elevations}


def _activity_id(route: Route) -> str | None:
    for source in route.sources:
        raw = source.raw_data
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except ValueError:
                continue
        if isinstance(raw, dict) and raw.get("activity_id"):
            return str(raw["activity_id"])
    return None


async def backfill_route_elevations(db: AsyncSession, user_id: uuid.UUID) -> int:
    """Give routes without a profile one, from their source activity stream."""
    routes = (
        await db.execute(
            select(Route)
            .options(selectinload(Route.sources))
            .where(Route.user_id == user_id)
        )
    ).scalars().all()

    missing = [route for route in routes if not route.elevation_profile]
    if not missing:
        return 0

    activity_ids: dict[uuid.UUID, uuid.UUID] = {}
    for route in missing:
        raw_id = _activity_id(route)
        if not raw_id:
            continue
        try:
            activity_ids[route.id] = uuid.UUID(raw_id)
        except ValueError:
            continue
    if not activity_ids:
        return 0

    streams = (
        await db.execute(
            select(ActivityStream).where(
                ActivityStream.activity_id.in_(set(activity_ids.values())),
                ActivityStream.stream_type.in_(("altitude", "distance")),
            )
        )
    ).scalars().all()

    by_activity: dict[uuid.UUID, dict[str, list[float | None]]] = {}
    for stream in streams:
        by_activity.setdefault(stream.activity_id, {})[stream.stream_type] = (
            _stream_values(stream.data)
        )

    backfilled = 0
    for route in missing:
        streams_for_activity = by_activity.get(activity_ids.get(route.id, uuid.uuid4()))
        if not streams_for_activity:
            continue
        altitudes = streams_for_activity.get("altitude") or []
        if not altitudes:
            continue
        profile = resample_elevation(
            altitudes,
            streams_for_activity.get("distance"),
            float(route.distance_meters or 0),
        )
        if profile:
            route.elevation_profile = profile
            backfilled += 1

    if backfilled:
        await db.flush()
    return backfilled
