"""Route service — CRUD, deduplication, and merge logic."""

import logging
import uuid
from difflib import SequenceMatcher

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.integrations import jev_client
from app.models.route import Route, RouteMergeLog, RouteSource
from app.services.polyline_utils import (
    decode_polyline,
    haversine_distance,
    shape_similarity,
)
from app.services.route_matching import (
    ScoreBreakdown,
    cheap_candidate,
    score_route_pair,
)

logger = logging.getLogger(__name__)

settings = get_settings()

# ── Dedup thresholds ─────────────────────────────────────────────────────────

LOOP_THRESHOLD_M = 200  # Start/end within this distance = loop


def _safe_decode(encoded: str) -> list[tuple[float, float]]:
    """``decode_polyline`` that tolerates malformed input (returns [])."""
    try:
        return decode_polyline(encoded)
    except Exception:
        return []


# ── Scoring components ───────────────────────────────────────────────────────


def _proximity_score(
    new_start_lat: float,
    new_start_lng: float,
    new_end_lat: float,
    new_end_lng: float,
    existing_start_lat: float,
    existing_start_lng: float,
    existing_end_lat: float,
    existing_end_lng: float,
    new_is_loop: bool | None = None,
    existing_is_loop: bool | None = None,
) -> float:
    """Score based on start/end point proximity. 0.0–1.0.

    Loop-aware: loops have start≈end, so both checks double-count the
    same point. For loops we only compare start distance; for
    point-to-point we require both ends to converge. City-exit loops
    (e.g. Edinburgh diverging routes) therefore stay low unless shape
    also matches, while East Coast point-to-point variants (different
    village entry points but same corridor) get a lenient 0.6.
    """
    start_dist = haversine_distance(
        new_start_lat, new_start_lng, existing_start_lat, existing_start_lng
    )
    end_dist = haversine_distance(
        new_end_lat, new_end_lng, existing_end_lat, existing_end_lng
    )

    # Infer loop status if not provided (LOOP_THRESHOLD_M = 200)
    if new_is_loop is None:
        new_is_loop = (
            haversine_distance(new_start_lat, new_start_lng, new_end_lat, new_end_lng)
            < LOOP_THRESHOLD_M
        )
    if existing_is_loop is None:
        existing_is_loop = (
            haversine_distance(
                existing_start_lat,
                existing_start_lng,
                existing_end_lat,
                existing_end_lng,
            )
            < LOOP_THRESHOLD_M
        )

    # Both loops: start≈end, so only start matters
    if new_is_loop and existing_is_loop:
        if start_dist < 500:
            return 1.0
        elif start_dist < 1000:
            return 0.3
        else:
            return 0.0

    # Point-to-point / out-and-back: be lenient for corridor variants
    # (e.g. East Coast via different villages but same A198 spine)
    if start_dist < 500 and end_dist < 500:
        return 1.0
    elif start_dist < 1000 or end_dist < 1000:
        return 0.6
    elif start_dist < 2000 or end_dist < 2000:
        return 0.3
    else:
        return 0.0


def _distance_score(dist1: float, dist2: float) -> float:
    """Score based on distance similarity. 0.0–1.0."""
    if dist1 <= 0 or dist2 <= 0:
        return 0.0
    ratio = min(dist1, dist2) / max(dist1, dist2)
    if ratio >= 0.95:
        return 1.0
    elif ratio >= 0.90:
        return 0.8
    elif ratio >= 0.80:
        return 0.5
    else:
        return 0.0


def _name_score(name1: str, name2: str) -> float:
    """Score based on name similarity. 0.0–1.0."""
    n1 = name1.lower().strip()
    n2 = name2.lower().strip()
    return SequenceMatcher(None, n1, n2).ratio()


def _compute_match_score(
    new_distance: float,
    new_encoded_polyline: str,
    new_name: str,
    new_start_lat: float,
    new_start_lng: float,
    new_end_lat: float,
    new_end_lng: float,
    existing: Route,
) -> float:
    """Match score between a candidate route and an existing route (0.0–1.0).

    Delegates to the pure :mod:`app.services.route_matching` engine: symmetric
    coverage (rejects sub-sections) + discrete Fréchet (order- and
    direction-sensitive; lap/detour tolerant) + endpoint proximity. Reversed
    routes score 0.
    """
    new_points = _safe_decode(new_encoded_polyline)
    existing_points = _safe_decode(existing.encoded_polyline)
    if len(new_points) < 2 or len(existing_points) < 2:
        return 0.0

    breakdown = score_route_pair(
        new_points,
        existing_points,
        length_a=new_distance,
        length_b=existing.distance_meters,
        auto_threshold=settings.route_match_auto_threshold,
        review_floor=settings.route_match_threshold,
        gate=settings.route_match_gate,
    )

    logger.debug(
        f"Match score for '{new_name}' vs '{existing.name}': "
        f"coverage={breakdown.min_coverage:.2f} frechet={breakdown.frechet_similarity:.2f} "
        f"endpoint={breakdown.endpoint_similarity:.2f} reversed={breakdown.reversed} "
        f"→ {breakdown.total:.3f} ({breakdown.tier})"
    )
    return breakdown.total


def score_route_breakdown(
    new_distance: float,
    new_encoded_polyline: str,
    existing: Route,
) -> ScoreBreakdown:
    """Full :class:`ScoreBreakdown` for a candidate vs an existing route."""
    new_points = _safe_decode(new_encoded_polyline)
    existing_points = _safe_decode(existing.encoded_polyline)
    if len(new_points) < 2 or len(existing_points) < 2:
        return score_route_pair([], [])
    return score_route_pair(
        new_points,
        existing_points,
        length_a=new_distance,
        length_b=existing.distance_meters,
        auto_threshold=settings.route_match_auto_threshold,
        review_floor=settings.route_match_threshold,
        gate=settings.route_match_gate,
    )


# ── Core CRUD operations ─────────────────────────────────────────────────────


def compute_is_loop(
    start_lat: float, start_lng: float, end_lat: float, end_lng: float
) -> bool:
    """Check if route start and end are within LOOP_THRESHOLD_M."""
    return haversine_distance(start_lat, start_lng, end_lat, end_lng) < LOOP_THRESHOLD_M


async def find_duplicate_route(
    db: AsyncSession,
    user_id: uuid.UUID,
    distance_meters: float,
    encoded_polyline: str,
    name: str,
    start_lat: float,
    start_lng: float,
    end_lat: float,
    end_lng: float,
    threshold: float | None = None,
) -> Route | None:
    """Find an existing route that likely matches the given route data.

    Pre-filters on start coordinates (loop-aware) then runs the matching engine.
    ``threshold`` defaults to ``route_match_auto_threshold`` so sync only
    auto-merges high-confidence duplicates; lower-confidence candidates surface
    in the review queue instead.
    """
    if threshold is None:
        threshold = settings.route_match_auto_threshold

    # Fetch all user routes (typically < 1000 per user)
    result = await db.execute(
        select(Route)
        .options(selectinload(Route.sources))
        .where(Route.user_id == user_id)
    )
    existing_routes = list(result.scalars().all())

    if not existing_routes:
        return None

    if len(_safe_decode(encoded_polyline)) < 2:
        return None

    best_route = None
    best_score = 0.0

    new_is_loop = compute_is_loop(start_lat, start_lng, end_lat, end_lng)
    for route in existing_routes:
        # Loop-aware pre-filter: loops share origin (home) → 500m is enough and
        # blocks city-exit false candidates. Point-to-point corridor variants
        # can start up to 2km apart.
        existing_is_loop = compute_is_loop(
            route.start_lat, route.start_lng, route.end_lat, route.end_lng
        )
        prefilter_m = 500 if (new_is_loop and existing_is_loop) else 2000
        start_dist = haversine_distance(
            start_lat, start_lng, route.start_lat, route.start_lng
        )
        if start_dist > prefilter_m:
            continue

        score = _compute_match_score(
            distance_meters,
            encoded_polyline,
            name,
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
        logger.info(
            f"Found duplicate route '{best_route.name}' (id={best_route.id}) "
            f"with score {best_score:.3f} (threshold={threshold})"
        )
        return best_route

    if best_route is not None:
        logger.info(
            f"No duplicate found for '{name}'. Best match was "
            f"'{best_route.name}' with score {best_score:.3f} "
            f"(below threshold {threshold})"
        )

    return None


async def create_route(
    db: AsyncSession,
    user_id: uuid.UUID,
    name: str,
    sport_type: str,
    distance_meters: float,
    encoded_polyline: str,
    elevation_gain_meters: float | None = None,
    estimated_time_seconds: int | None = None,
    elevation_profile: dict | None = None,
    surface_profile: dict | None = None,
    country: str | None = None,
    locality: str | None = None,
    raw_data: dict | None = None,
) -> Route:
    """Create a new route with computed start/end coordinates and loop detection."""
    points = _safe_decode(encoded_polyline)
    if not points:
        raise ValueError("Polyline contains no points")

    start_lat, start_lng = points[0]
    end_lat, end_lng = points[-1]
    is_loop = compute_is_loop(start_lat, start_lng, end_lat, end_lng)

    route = Route(
        user_id=user_id,
        name=name,
        sport_type=sport_type,
        distance_meters=distance_meters,
        elevation_gain_meters=elevation_gain_meters,
        estimated_time_seconds=estimated_time_seconds,
        encoded_polyline=encoded_polyline,
        elevation_profile=elevation_profile,
        surface_profile=surface_profile,
        start_lat=start_lat,
        start_lng=start_lng,
        end_lat=end_lat,
        end_lng=end_lng,
        country=country,
        locality=locality,
        is_loop=is_loop,
    )
    db.add(route)
    await db.flush()
    return route


async def add_route_source(
    db: AsyncSession,
    route_id: uuid.UUID,
    provider: str,
    provider_route_id: str,
    provider_name: str,
    encoded_polyline: str,
    raw_data: dict | None = None,
    user_id: uuid.UUID | None = None,
) -> RouteSource:
    """Add a provider source to an existing route.

    Skips if a source with the same provider already exists on this route
    to avoid duplicate provider badges in the UI (e.g. Strava Routes API
    and activity-derived polyline both mapping to provider="strava").
    ``user_id`` scopes the source row to its owner (RMI-09).
    """
    # Check if a source from this provider already exists on this route
    existing = await db.execute(
        select(RouteSource).where(
            RouteSource.route_id == route_id,
            RouteSource.provider == provider,
        )
    )
    existing_source = existing.first()
    if existing_source:
        logger.info(
            f"Route {route_id} already has a source from {provider}, skipping duplicate"
        )
        return existing_source

    source = RouteSource(
        route_id=route_id,
        user_id=user_id,
        provider=provider,
        provider_route_id=provider_route_id,
        provider_name=provider_name,
        encoded_polyline=encoded_polyline,
        raw_data=raw_data,
    )
    db.add(source)
    await db.flush()
    return source


async def create_or_merge_route(
    db: AsyncSession,
    user_id: uuid.UUID,
    name: str,
    sport_type: str,
    distance_meters: float,
    encoded_polyline: str,
    provider: str,
    provider_route_id: str,
    provider_name: str,
    elevation_gain_meters: float | None = None,
    estimated_time_seconds: int | None = None,
    elevation_profile: dict | None = None,
    surface_profile: dict | None = None,
    country: str | None = None,
    locality: str | None = None,
    raw_data: dict | None = None,
) -> Route:
    """Create a new route or merge with an existing duplicate.

    This is the main entry point called by provider sync services.
    Returns the Route (either newly created or the existing one with a new source).
    """
    # Check if this provider route already exists (user-scoped: each user
    # owns a distinct Route for the same provider tour — RMI-09)
    existing_source = await db.execute(
        select(RouteSource).where(
            RouteSource.provider == provider,
            RouteSource.provider_route_id == provider_route_id,
            RouteSource.user_id == user_id,
        )
    )
    existing_row = existing_source.scalar_one_or_none()
    if existing_row:
        logger.info(f"Route source already exists: {provider}/{provider_route_id}")
        source = existing_row
        # Return the parent route, filling surface_profile if missing
        result = await db.execute(
            select(Route)
            .options(selectinload(Route.sources))
            .where(Route.id == source.route_id)
        )
        route = result.scalar_one()
        if surface_profile and not route.surface_profile:
            route.surface_profile = surface_profile
            await db.flush()
        return route

    # Compute geometry from polyline
    points = _safe_decode(encoded_polyline)
    if not points:
        raise ValueError(f"Empty polyline for {provider}/{provider_route_id}")

    start_lat, start_lng = points[0]
    end_lat, end_lng = points[-1]

    # Check for duplicates
    duplicate = await find_duplicate_route(
        db,
        user_id,
        distance_meters,
        encoded_polyline,
        name,
        start_lat,
        start_lng,
        end_lat,
        end_lng,
    )

    if duplicate:
        # Merge: add source to existing route
        await add_route_source(
            db,
            duplicate.id,
            provider,
            provider_route_id,
            provider_name,
            encoded_polyline,
            raw_data,
            user_id,
        )
        # Optionally update the canonical polyline if the new one is higher fidelity
        new_point_count = len(points)
        existing_points = _safe_decode(duplicate.encoded_polyline)
        if new_point_count > len(existing_points):
            duplicate.encoded_polyline = encoded_polyline
            if elevation_profile:
                duplicate.elevation_profile = elevation_profile
            # Geometry changed: derived data must be recomputed (RMI-10).
            duplicate.terrain_classification = None
        # Update surface profile if the new source provides it and the existing route doesn't have one
        if surface_profile and not duplicate.surface_profile:
            duplicate.surface_profile = surface_profile
        await db.flush()
        logger.info(
            f"Merged {provider}/{provider_route_id} into existing route '{duplicate.name}'"
        )
        return duplicate
    else:
        # Create new route
        route = await create_route(
            db,
            user_id,
            name,
            sport_type,
            distance_meters,
            encoded_polyline,
            elevation_gain_meters,
            estimated_time_seconds,
            elevation_profile,
            surface_profile,
            country,
            locality,
            raw_data,
        )
        # Add the source
        await add_route_source(
            db,
            route.id,
            provider,
            provider_route_id,
            provider_name,
            encoded_polyline,
            raw_data,
            user_id,
        )
        logger.info(f"Created new route '{name}' from {provider}/{provider_route_id}")
        return route


async def get_user_routes(
    db: AsyncSession,
    user_id: uuid.UUID,
    sport_type: str | None = None,
    source: str | None = None,
    is_loop: bool | None = None,
    min_distance: float | None = None,
    max_distance: float | None = None,
    q: str | None = None,
    terrain_type: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[Route]:
    """List routes with optional filters."""
    query = (
        select(Route)
        .options(selectinload(Route.sources))
        .where(Route.user_id == user_id)
    )

    if sport_type:
        query = query.where(Route.sport_type == sport_type)
    if is_loop is not None:
        query = query.where(Route.is_loop == is_loop)
    if min_distance is not None:
        query = query.where(Route.distance_meters >= min_distance)
    if max_distance is not None:
        query = query.where(Route.distance_meters <= max_distance)
    if q:
        query = query.where(Route.name.ilike(f"%{q}%"))
    if terrain_type:
        query = query.where(
            Route.terrain_classification["terrain_type"].astext == terrain_type
        )

    query = query.order_by(Route.created_at.desc()).limit(limit).offset(offset)

    result = await db.execute(query)
    routes = list(result.scalars().all())

    # Filter by source provider if specified (post-filter since it's a relationship)
    if source:
        routes = [r for r in routes if any(s.provider == source for s in r.sources)]

    return routes


async def get_route_by_id(
    db: AsyncSession,
    route_id: uuid.UUID,
    user_id: uuid.UUID,
) -> Route | None:
    """Get a single route by ID, ensuring it belongs to the user."""
    result = await db.execute(
        select(Route)
        .options(
            selectinload(Route.sources),
            selectinload(Route.tags),
        )
        .where(Route.id == route_id, Route.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def update_route(
    db: AsyncSession,
    route_id: uuid.UUID,
    user_id: uuid.UUID,
    name: str | None = None,
    sport_type: str | None = None,
) -> Route | None:
    """Update route metadata."""
    route = await get_route_by_id(db, route_id, user_id)
    if not route:
        return None
    if name is not None:
        route.name = name
    if sport_type is not None:
        route.sport_type = sport_type
    await db.flush()
    return route


async def delete_route(
    db: AsyncSession,
    route_id: uuid.UUID,
    user_id: uuid.UUID,
) -> bool:
    """Delete a route and all its sources."""
    route = await get_route_by_id(db, route_id, user_id)
    if not route:
        return False
    await db.delete(route)
    await db.flush()
    return True


async def merge_routes(
    db: AsyncSession,
    primary_route_id: uuid.UUID,
    duplicate_route_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    score: float = 0.0,
    breakdown: dict | None = None,
    record_log: bool = True,
) -> Route | None:
    """Merge two routes **non-destructively**.

    Children are remapped rather than dropped: activities and training-plan
    days are reassigned to the primary, tags and collection memberships are
    unioned, segments are moved (collisions dropped and rebuilt by the weekly
    task), and quality/favourite/derived fields are preserved. A
    :class:`RouteMergeLog` row is written so the merge can be undone via
    :func:`undo_route_merge`.
    """
    from app.models.activity import Activity
    from app.models.route_organize import (
        RouteCollectionItem,
        RouteQuality,
        RouteTagging,
    )
    from app.models.segment import Segment
    from app.models.training_plan import TrainingPlanDay

    primary = await get_route_by_id(db, primary_route_id, user_id)
    duplicate = await get_route_by_id(db, duplicate_route_id, user_id)

    if not primary or not duplicate:
        return None
    if primary.id == duplicate.id:
        return primary

    snapshot = {
        "id": str(duplicate.id),
        "name": duplicate.name,
        "sport_type": duplicate.sport_type,
        "distance_meters": duplicate.distance_meters,
        "elevation_gain_meters": duplicate.elevation_gain_meters,
        "estimated_time_seconds": duplicate.estimated_time_seconds,
        "encoded_polyline": duplicate.encoded_polyline,
        "elevation_profile": duplicate.elevation_profile,
        "surface_profile": duplicate.surface_profile,
        "start_lat": duplicate.start_lat,
        "start_lng": duplicate.start_lng,
        "end_lat": duplicate.end_lat,
        "end_lng": duplicate.end_lng,
        "country": duplicate.country,
        "locality": duplicate.locality,
        "is_loop": duplicate.is_loop,
        "is_favorite": duplicate.is_favorite,
        "quality_score": duplicate.quality_score,
        "created_at": duplicate.created_at.isoformat() if duplicate.created_at else None,
        # Phase 2: keep the embeddings so the learned metric can be trained on
        # this decision later (the duplicate's Route row is deleted below).
        "road_embedding": duplicate.road_embedding,
    }
    primary_embedding = primary.road_embedding

    moved: dict[str, list[str]] = {
        "source_ids": [],
        "activity_ids": [],
        "plan_day_ids": [],
        "tag_ids": [],
        "collection_ids": [],
        "segment_ids": [],
    }

    # 1. Sources
    for source in duplicate.sources:
        source.route_id = primary.id
        moved["source_ids"].append(str(source.id))

    # 2. Activities (previously ON DELETE SET NULL → silently unlinked)
    activity_ids = [
        r
        for (r,) in (
            await db.execute(
                select(Activity.id).where(Activity.route_id == duplicate.id)
            )
        ).all()
    ]
    if activity_ids:
        await db.execute(
            update(Activity)
            .where(Activity.id.in_(activity_ids))
            .values(route_id=primary.id)
        )
        moved["activity_ids"] = [str(a) for a in activity_ids]

    # 3. Training-plan days (previously ON DELETE SET NULL)
    plan_day_ids = [
        r
        for (r,) in (
            await db.execute(
                select(TrainingPlanDay.id).where(
                    TrainingPlanDay.planned_route_id == duplicate.id
                )
            )
        ).all()
    ]
    if plan_day_ids:
        await db.execute(
            update(TrainingPlanDay)
            .where(TrainingPlanDay.id.in_(plan_day_ids))
            .values(planned_route_id=primary.id)
        )
        moved["plan_day_ids"] = [str(p) for p in plan_day_ids]

    # 4. Tags — union (skip collisions)
    primary_tag_ids = {t.id for t in primary.tags}
    dup_taggings = (
        await db.execute(
            select(RouteTagging).where(RouteTagging.route_id == duplicate.id)
        )
    ).scalars().all()
    for tagging in dup_taggings:
        if tagging.tag_id not in primary_tag_ids:
            db.add(RouteTagging(route_id=primary.id, tag_id=tagging.tag_id))
            primary_tag_ids.add(tagging.tag_id)
            moved["tag_ids"].append(str(tagging.tag_id))

    # 5. Collections — union (skip collisions)
    primary_collection_ids = {
        r
        for (r,) in (
            await db.execute(
                select(RouteCollectionItem.collection_id).where(
                    RouteCollectionItem.route_id == primary.id
                )
            )
        ).all()
    }
    dup_items = (
        await db.execute(
            select(RouteCollectionItem).where(
                RouteCollectionItem.route_id == duplicate.id
            )
        )
    ).scalars().all()
    for item in dup_items:
        if item.collection_id not in primary_collection_ids:
            db.add(
                RouteCollectionItem(
                    collection_id=item.collection_id, route_id=primary.id
                )
            )
            primary_collection_ids.add(item.collection_id)
            moved["collection_ids"].append(str(item.collection_id))

    # 6. Segments — move, drop collisions (weekly task rebuilds them)
    primary_ranges = {
        (s.start_dist_m, s.end_dist_m)
        for s in (
            await db.execute(select(Segment).where(Segment.route_id == primary.id))
        ).scalars().all()
    }
    dup_segments = (
        await db.execute(select(Segment).where(Segment.route_id == duplicate.id))
    ).scalars().all()
    for segment in dup_segments:
        key = (segment.start_dist_m, segment.end_dist_m)
        if key in primary_ranges:
            await db.delete(segment)
        else:
            segment.route_id = primary.id
            primary_ranges.add(key)
            moved["segment_ids"].append(str(segment.id))

    # 7. Quality — reassign if primary has none, otherwise drop
    primary_quality = (
        await db.execute(
            select(RouteQuality).where(RouteQuality.route_id == primary.id)
        )
    ).scalar_one_or_none()
    dup_quality = (
        await db.execute(
            select(RouteQuality).where(RouteQuality.route_id == duplicate.id)
        )
    ).scalar_one_or_none()
    if dup_quality is not None:
        if primary_quality is None:
            dup_quality.route_id = primary.id
        else:
            await db.delete(dup_quality)

    # 8. Canonical fields
    dup_points = _safe_decode(duplicate.encoded_polyline)
    prim_points = _safe_decode(primary.encoded_polyline)
    if len(dup_points) > len(prim_points):
        primary.encoded_polyline = duplicate.encoded_polyline
        if duplicate.elevation_profile:
            primary.elevation_profile = duplicate.elevation_profile
    if not primary.surface_profile and duplicate.surface_profile:
        primary.surface_profile = duplicate.surface_profile
    primary.is_favorite = primary.is_favorite or duplicate.is_favorite
    if duplicate.quality_score is not None:
        primary.quality_score = max(primary.quality_score or 0.0, duplicate.quality_score)
    # Force recompute of derived caches (RMI-10)
    primary.terrain_classification = None

    # 9. Audit log
    if record_log:
        db.add(
            RouteMergeLog(
                user_id=user_id,
                primary_route_id=primary.id,
                merged_route_id=duplicate.id,
                score=score,
                breakdown={
                    **(breakdown or {}),
                    # Phase 2 training signal: the surviving primary's embedding
                    # (the duplicate's is in `snapshot`).
                    "primary_embedding": primary_embedding,
                },
                snapshot=snapshot,
                moved=moved,
            )
        )

    await db.flush()
    await db.delete(duplicate)
    await db.flush()

    return await get_route_by_id(db, primary_route_id, user_id)


async def undo_route_merge(
    db: AsyncSession,
    log_id: uuid.UUID,
    user_id: uuid.UUID,
) -> Route | None:
    """Undo a route merge recorded in :class:`RouteMergeLog`.

    Recreates the merged-away route with its original id and moves the recorded
    children back. Segment collisions dropped during the merge cannot be
    restored here — the weekly ``recompute_ride_segments`` task rebuilds them.
    """
    from app.models.activity import Activity
    from app.models.route import Route
    from app.models.route_organize import (
        RouteCollectionItem,
        RouteQuality,
        RouteTagging,
    )
    from app.models.segment import Segment
    from app.models.training_plan import TrainingPlanDay

    log = (
        await db.execute(
            select(RouteMergeLog).where(
                RouteMergeLog.id == log_id, RouteMergeLog.user_id == user_id
            )
        )
    ).scalar_one_or_none()
    if log is None or log.undone_at is not None:
        return None

    snapshot = log.snapshot or {}
    moved = log.moved or {}
    new_id = log.merged_route_id

    existing = (
        await db.execute(select(Route).where(Route.id == new_id))
    ).scalar_one_or_none()
    if existing is not None:
        return None  # id already in use — refuse to clobber

    route = Route(
        id=new_id,
        user_id=user_id,
        name=snapshot.get("name", "Restored route"),
        sport_type=snapshot.get("sport_type", "cycling"),
        distance_meters=snapshot.get("distance_meters", 0.0),
        elevation_gain_meters=snapshot.get("elevation_gain_meters"),
        estimated_time_seconds=snapshot.get("estimated_time_seconds"),
        encoded_polyline=snapshot.get("encoded_polyline", ""),
        elevation_profile=snapshot.get("elevation_profile"),
        surface_profile=snapshot.get("surface_profile"),
        start_lat=snapshot.get("start_lat", 0.0),
        start_lng=snapshot.get("start_lng", 0.0),
        end_lat=snapshot.get("end_lat", 0.0),
        end_lng=snapshot.get("end_lng", 0.0),
        country=snapshot.get("country"),
        locality=snapshot.get("locality"),
        is_loop=snapshot.get("is_loop", False),
        is_favorite=snapshot.get("is_favorite", False),
        quality_score=snapshot.get("quality_score"),
    )
    db.add(route)
    await db.flush()

    source_ids = moved.get("source_ids", [])
    if source_ids:
        await db.execute(
            update(RouteSource)
            .where(RouteSource.id.in_([uuid.UUID(s) for s in source_ids]))
            .values(route_id=new_id)
        )

    activity_ids = moved.get("activity_ids", [])
    if activity_ids:
        await db.execute(
            update(Activity)
            .where(Activity.id.in_([uuid.UUID(a) for a in activity_ids]))
            .values(route_id=new_id)
        )

    plan_day_ids = moved.get("plan_day_ids", [])
    if plan_day_ids:
        await db.execute(
            update(TrainingPlanDay)
            .where(TrainingPlanDay.id.in_([uuid.UUID(p) for p in plan_day_ids]))
            .values(planned_route_id=new_id)
        )

    tag_ids = moved.get("tag_ids", [])
    if tag_ids:
        await db.execute(
            delete(RouteTagging).where(
                RouteTagging.route_id == log.primary_route_id,
                RouteTagging.tag_id.in_([uuid.UUID(t) for t in tag_ids]),
            )
        )
        for t in tag_ids:
            db.add(RouteTagging(route_id=new_id, tag_id=uuid.UUID(t)))

    collection_ids = moved.get("collection_ids", [])
    if collection_ids:
        await db.execute(
            delete(RouteCollectionItem).where(
                RouteCollectionItem.route_id == log.primary_route_id,
                RouteCollectionItem.collection_id.in_(
                    [uuid.UUID(c) for c in collection_ids]
                ),
            )
        )
        for c in collection_ids:
            db.add(RouteCollectionItem(collection_id=uuid.UUID(c), route_id=new_id))

    segment_ids = moved.get("segment_ids", [])
    if segment_ids:
        await db.execute(
            update(Segment)
            .where(Segment.id.in_([uuid.UUID(s) for s in segment_ids]))
            .values(route_id=new_id)
        )

    quality = (
        await db.execute(
            select(RouteQuality).where(RouteQuality.route_id == log.primary_route_id)
        )
    ).scalar_one_or_none()
    if quality is not None:
        quality.route_id = new_id

    from datetime import UTC, datetime

    log.undone_at = datetime.now(UTC)
    await db.flush()

    return await get_route_by_id(db, new_id, user_id)


# Jev route-pair arbitration (Phase 3). Only review-tier pairs are arbitrated;
# the deterministic score/breakdown/tier are never changed.
ROUTE_DIFFERENT_DROP_CONFIDENCE = 0.75


async def _arbitrate_route_pair(a: Route, b: Route) -> jev_client.JevResult | None:
    """Ask Jev whether two routes are the same. None when Jev is unset/errors."""
    return await jev_client.decide(
        {
            "route_a": a.name,
            "route_b": b.name,
            "distance_a_km": round((a.distance_meters or 0) / 1000, 1),
            "distance_b_km": round((b.distance_meters or 0) / 1000, 1),
        },
        {
            "same": jev_client.choice(
                "Are these two routes the same route?",
                {
                    "same": "The same route (naming/ordering differences only)",
                    "different": "Clearly different routes",
                    "unclear": "Cannot tell from the names",
                },
            )
        },
    )


async def _apply_route_arbitration(pairs: list[dict]) -> list[dict]:
    """Arbitrate review-tier pairs with Jev. No-op when Jev is unset.

    - ``different`` at ≥ 0.75 confidence → dropped from the review queue.
    - ``same`` / ``unclear`` → kept, annotated with ``jev_decision`` + confidence.
    """
    if not pairs or not jev_client.is_configured():
        return pairs

    out: list[dict] = []
    for pair in pairs:
        if pair.get("tier") != "review":
            out.append(pair)
            continue
        result = await _arbitrate_route_pair(pair["route_a"], pair["route_b"])
        if result is None:
            out.append(pair)
            continue
        decision = result.choice("same")
        ans = result.answers.get("same")
        confidence = ans.confidence if ans else None
        if decision == "different" and (confidence or 0) >= ROUTE_DIFFERENT_DROP_CONFIDENCE:
            continue  # clearly different — leave the review queue
        out.append({**pair, "jev_decision": decision, "jev_confidence": confidence})
    return out


async def find_potential_duplicates(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> list[dict]:
    """Find route pairs that may be duplicates for manual review.

    Runs the matching engine over cheap-prefiltered pairs and returns
    ``{route_a, route_b, score, breakdown, tier, requires_confirmation}`` dicts.
    """
    result = await db.execute(
        select(Route)
        .options(selectinload(Route.sources), selectinload(Route.tags))
        .where(Route.user_id == user_id)
    )
    routes = list(result.scalars().all())

    decoded: dict[uuid.UUID, list[tuple[float, float]]] = {
        route.id: _safe_decode(route.encoded_polyline) for route in routes
    }

    potential: list[dict] = []
    for i in range(len(routes)):
        for j in range(i + 1, len(routes)):
            a, b = routes[i], routes[j]
            pa, pb = decoded[a.id], decoded[b.id]
            if not cheap_candidate(
                pa, pb, length_a=a.distance_meters, length_b=b.distance_meters
            ):
                continue
            breakdown = score_route_pair(
                pa,
                pb,
                length_a=a.distance_meters,
                length_b=b.distance_meters,
                auto_threshold=settings.route_match_auto_threshold,
                review_floor=settings.route_match_threshold,
                gate=settings.route_match_gate,
            )
            if breakdown.matched:
                potential.append(
                    {
                        "route_a": a,
                        "route_b": b,
                        "score": breakdown.total,
                        "breakdown": breakdown.to_dict(),
                        "tier": breakdown.tier,
                        "requires_confirmation": breakdown.tier != "auto",
                    }
                )

    potential.sort(key=lambda x: x["score"], reverse=True)
    return await _apply_route_arbitration(potential)


async def find_cached_duplicates(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> list[dict] | None:
    """Review-queue pairs from the cached similarity graph.

    Returns ``None`` when no cached graph exists yet (caller should fall back to
    the synchronous :func:`find_potential_duplicates`). Rows whose routes have
    since been deleted are skipped.
    """
    from app.models.route import RouteSimilarity

    rows = (
        await db.execute(
            select(RouteSimilarity)
            .where(RouteSimilarity.user_id == user_id)
            .order_by(RouteSimilarity.score.desc())
        )
    ).scalars().all()
    if not rows:
        return None

    route_ids = {r.route_a_id for r in rows} | {r.route_b_id for r in rows}
    routes = (
        await db.execute(
            select(Route)
            .options(selectinload(Route.sources), selectinload(Route.tags))
            .where(Route.id.in_(route_ids))
        )
    ).scalars().all()
    by_id = {r.id: r for r in routes}

    out: list[dict] = []
    for row in rows:
        a = by_id.get(row.route_a_id)
        b = by_id.get(row.route_b_id)
        if a is None or b is None:
            continue
        out.append(
            {
                "route_a": a,
                "route_b": b,
                "score": row.score,
                "breakdown": row.breakdown,
                "tier": row.tier,
                "requires_confirmation": row.tier != "auto",
            }
        )
    return await _apply_route_arbitration(out)
