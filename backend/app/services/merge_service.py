"""Activity deduplication, merging, and activity↔route linking.

Mirrors the route_service.py dedup pattern:
- find_duplicate_activity() uses weighted scoring to detect same-activity-from-different-providers
- merge_activity() merges data from a duplicate into the primary, creates ActivitySource
- link_activity_to_route() matches GPS activities to saved routes
"""

import logging
import uuid
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.models.activity import Activity, ActivitySource
from app.models.route import Route

logger = logging.getLogger(__name__)

settings = get_settings()

# ── Provider priority for merge conflicts ────────────────────────────────────
# Higher value = preferred when both providers have data for the same field.
PROVIDER_PRIORITY: dict[str, int] = {
    "strava": 3,
    "wahoo": 2,
    "whoop": 1,
    "komoot": 1,
    "manual": 0,
}

# Sport types that are considered compatible for matching purposes
_COMPATIBLE_SPORT_TYPES: dict[str, set[str]] = {
    "cycling": {"cycling", "virtual_cycling"},
    "running": {"running"},
    "swimming": {"swimming"},
    "strength": {"strength", "powerlifting"},
    "powerlifting": {"strength", "powerlifting"},
    "walking": {"walking", "hiking"},
    "hiking": {"walking", "hiking"},
}


# ── Scoring components ───────────────────────────────────────────────────────


def _date_proximity_score(d1, d2) -> float:
    """Score 0.0–1.0 based on time proximity between two datetimes.

    Within 30 min = 1.0  (very likely same activity)
    Within 2 hours = 0.9
    Within 4 hours = 0.7
    Within 6 hours = 0.5
    Same day       = 0.3
    Else           = 0.0
    """
    diff = abs((d1 - d2).total_seconds())
    thirty_min = 30 * 60
    two_hours = 2 * 3600
    four_hours = 4 * 3600
    six_hours = 6 * 3600
    if diff <= thirty_min:
        return 1.0
    elif diff <= two_hours:
        return 0.9
    elif diff <= four_hours:
        return 0.7
    elif diff <= six_hours:
        return 0.5
    # Same calendar day
    elif d1.date() == d2.date():
        return 0.3
    return 0.0


def _sport_type_score(type1: str, type2: str) -> float:
    """Score 0.0–1.0 based on sport type compatibility.

    Exact match         = 1.0
    Compatible (group)  = 0.5
    Different           = 0.0
    """
    if type1 == type2:
        return 1.0
    compatible = _COMPATIBLE_SPORT_TYPES.get(type1, {type1})
    if type2 in compatible:
        return 0.5
    return 0.0


def _duration_score(dur1: int | None, dur2: int | None) -> float:
    """Score 0.0–1.0 based on duration similarity (ratio of shorter/longer)."""
    if not dur1 or not dur2 or dur1 <= 0 or dur2 <= 0:
        return 0.5  # neutral when data missing
    return min(dur1, dur2) / max(dur1, dur2)


def _distance_score(dist1: float | None, dist2: float | None) -> float:
    """Score 0.0–1.0 based on distance similarity (ratio of shorter/longer).

    Returns 0.5 (neutral) if either distance is missing.
    """
    if not dist1 or not dist2 or dist1 <= 0 or dist2 <= 0:
        return 0.5  # neutral when data missing
    return min(dist1, dist2) / max(dist1, dist2)


def _compute_activity_match_score(
    candidate: Activity,
    sport_type: str,
    start_date,
    duration_seconds: int | None,
    distance_meters: float | None,
) -> float:
    """Compute weighted match score between a candidate activity and new activity data.

    Weights:
    - Date proximity  50%
    - Sport type       20%
    - Duration         15%
    - Distance         15%
    """
    date_s = _date_proximity_score(candidate.start_date, start_date)
    sport_s = _sport_type_score(candidate.sport_type, sport_type)
    dur_s = _duration_score(candidate.duration_seconds, duration_seconds)
    dist_s = _distance_score(candidate.distance_meters, distance_meters)

    # Hard cutoff: completely incompatible sport types should never match
    if sport_s == 0.0:
        return 0.0

    return (date_s * 0.50) + (sport_s * 0.20) + (dur_s * 0.15) + (dist_s * 0.15)


# ── Duplicate detection ──────────────────────────────────────────────────────


async def find_duplicate_activity(
    db: AsyncSession,
    user_id: uuid.UUID,
    sport_type: str,
    start_date,
    duration_seconds: int | None = None,
    distance_meters: float | None = None,
) -> Activity | None:
    """Find an existing activity that likely matches the given activity data.

    Searches for activities within ±6 hours of the start date, then scores
    each candidate using the weighted algorithm. Returns the best match if
    it exceeds the configured threshold.
    """
    threshold = settings.activity_merge_threshold
    time_window = timedelta(hours=6)

    result = await db.execute(
        select(Activity)
        .options(selectinload(Activity.sources))
        .where(
            Activity.user_id == user_id,
            Activity.start_date >= start_date - time_window,
            Activity.start_date <= start_date + time_window,
        )
    )
    candidates = list(result.scalars().all())

    if not candidates:
        return None

    best_activity = None
    best_score = 0.0

    for candidate in candidates:
        score = _compute_activity_match_score(
            candidate,
            sport_type,
            start_date,
            duration_seconds,
            distance_meters,
        )
        if score > best_score:
            best_score = score
            best_activity = candidate

    if best_score >= threshold and best_activity is not None:
        logger.info(
            f"Found duplicate activity '{best_activity.name}' (score {best_score:.2f})"
        )
        return best_activity

    # Near-miss logging: score within 0.05 of threshold — likely false negative
    if best_score >= threshold - 0.05 and best_activity is not None:
        logger.warning(
            f"Near-miss merge: '{best_activity.name}' scored {best_score:.2f} "
            f"(threshold {threshold:.2f}). Consider reviewing for false negative."
        )

    return None


# ── Merge logic ──────────────────────────────────────────────────────────────

# Fields that participate in priority-based merge (provider with higher priority wins)
_MERGE_FIELDS = [
    "name",
    "duration_seconds",
    "distance_meters",
    "elevation_gain_meters",
    "average_heartrate",
    "max_heartrate",
    "average_power",
    "normalized_power",
    "average_speed",
    "average_cadence",
    "tss",
    "calories",
    "rpe",
]


def _provider_priority(provider: str) -> int:
    return PROVIDER_PRIORITY.get(provider, 0)


async def merge_activity(
    db: AsyncSession,
    primary: Activity,
    new_data: dict,
    provider: str,
    provider_activity_id: str,
    raw_data: dict | None = None,
) -> ActivitySource:
    """Merge data from a new provider into an existing primary activity.

    1. Creates an ActivitySource record for the new provider.
    2. Updates primary activity fields when the new provider has higher priority
       and the primary field is None (or the new provider outranks the primary source).

    Returns the newly created ActivitySource.
    """
    # 1. Create the ActivitySource
    source = ActivitySource(
        activity_id=primary.id,
        provider=provider,
        provider_activity_id=provider_activity_id,
        provider_name=new_data.get("name"),
        raw_data=raw_data,
    )
    db.add(source)

    # 2. Priority-based field merge
    primary_priority = _provider_priority(primary.source)
    new_priority = _provider_priority(provider)

    for field in _MERGE_FIELDS:
        new_val = new_data.get(field)
        existing_val = getattr(primary, field, None)

        if new_val is None:
            continue

        # Fill empty fields regardless of priority
        if existing_val is None or new_priority > primary_priority:
            setattr(primary, field, new_val)

    # 3. Merge raw_data — keep the primary's raw_data, but store full response in source
    # (raw_data on Activity stays from the primary provider)

    # 4. Update primary_source if higher priority
    if new_priority > primary_priority:
        primary.source = provider
        primary.provider_activity_id = provider_activity_id

    await db.flush()
    logger.info(
        f"Merged {provider}/{provider_activity_id} into activity '{primary.name}'"
    )
    return source


# ── Activity ↔ Route linking ─────────────────────────────────────────────────


def _extract_activity_polyline(activity: Activity) -> str | None:
    """Extract encoded polyline from activity raw_data (Strava map.summary_polyline)."""
    if not activity.raw_data:
        return None
    map_data = activity.raw_data.get("map", {})
    return map_data.get("summary_polyline") or map_data.get("polyline") or None


async def link_activity_to_route(
    db: AsyncSession,
    activity: Activity,
    routes: list[Route] | None = None,
) -> bool:
    """Attempt to link an activity to a saved route using GPS data.

    Extracts the activity's polyline from raw_data, compares it against
    all user routes using the existing route_service scoring algorithm,
    and links if score >= activity_route_link_threshold.

    If ``routes`` is provided, uses that list instead of querying the DB
    (avoids N+1 when called in a loop for the same user).

    Returns True if a link was made.
    """
    if activity.route_id is not None:
        return False  # Already linked

    polyline = _extract_activity_polyline(activity)
    if not polyline:
        return False  # No GPS data

    # Only link GPS sport types
    if activity.sport_type not in ("cycling", "running", "walking", "hiking"):
        return False

    from app.services.polyline_utils import decode_polyline
    from app.services.route_service import _compute_match_score

    points = decode_polyline(polyline)
    if not points or len(points) < 2:
        return False

    start_lat, start_lng = points[0]
    end_lat, end_lng = points[-1]

    # Fetch all user routes (or use pre-fetched list)
    if routes is None:
        result = await db.execute(select(Route).where(Route.user_id == activity.user_id))
        routes = list(result.scalars().all())

    if not routes:
        return False

    threshold = settings.activity_route_link_threshold
    best_route = None
    best_score = 0.0

    for route in routes:
        # Quick pre-filter: skip if sport types are incompatible
        if route.sport_type != activity.sport_type and not (
            route.sport_type in ("cycling", "running")
            and activity.sport_type in ("cycling", "running")
        ):
            continue

        # Quick pre-filter: skip if start points are > 5km apart
        from app.services.polyline_utils import haversine_distance

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
        logger.info(
            f"Linked activity '{activity.name}' to route '{best_route.name}' "
            f"(score {best_score:.2f})"
        )
        return True

    return False


async def backfill_activity_route_links(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> int:
    """Re-run route linking for all unlinked GPS activities.

    Returns the number of new links created.
    """
    result = await db.execute(
        select(Activity).where(
            Activity.user_id == user_id,
            Activity.route_id.is_(None),
            Activity.sport_type.in_(["cycling", "running", "walking", "hiking"]),
        )
    )
    activities = list(result.scalars().all())

    # Pre-fetch routes once to avoid N+1 queries
    routes_result = await db.execute(select(Route).where(Route.user_id == user_id))
    routes = list(routes_result.scalars().all())

    linked_count = 0
    for activity in activities:
        if await link_activity_to_route(db, activity, routes=routes):
            linked_count += 1

    return linked_count
