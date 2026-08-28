"""Route service — CRUD, deduplication, and merge logic."""

import logging
import uuid
from difflib import SequenceMatcher

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.models.route import Route, RouteSource
from app.services.polyline_utils import (
    decode_polyline,
    haversine_distance,
    shape_similarity,
)

logger = logging.getLogger(__name__)

settings = get_settings()

# ── Dedup thresholds ─────────────────────────────────────────────────────────

LOOP_THRESHOLD_M = 200  # Start/end within this distance = loop


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
) -> float:
    """Score based on start/end point proximity. 0.0–1.0."""
    start_dist = haversine_distance(
        new_start_lat, new_start_lng, existing_start_lat, existing_start_lng
    )
    end_dist = haversine_distance(
        new_end_lat, new_end_lng, existing_end_lat, existing_end_lng
    )

    if start_dist < 200 and end_dist < 200:
        return 1.0
    elif start_dist < 500 and end_dist < 500:
        return 0.7
    elif start_dist < 1000 and end_dist < 1000:
        return 0.3
    elif start_dist < 2000 and end_dist < 2000:
        return 0.15
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
    """Compute weighted match score between a candidate route and an existing route.

    Score = proximity × 0.40 + distance × 0.30 + name × 0.15 + shape × 0.15
    """
    proximity = _proximity_score(
        new_start_lat,
        new_start_lng,
        new_end_lat,
        new_end_lng,
        existing.start_lat,
        existing.start_lng,
        existing.end_lat,
        existing.end_lng,
    )
    distance = _distance_score(new_distance, existing.distance_meters)
    name = _name_score(new_name, existing.name)
    shape = shape_similarity(new_encoded_polyline, existing.encoded_polyline)

    return (proximity * 0.25) + (distance * 0.25) + (name * 0.15) + (shape * 0.35)


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
) -> Route | None:
    """Find an existing route that likely matches the given route data.

    Uses a pre-filter on start coordinates (within ~5km) before computing
    the full weighted match score.
    """
    # Fetch all user routes (typically < 1000 per user)
    result = await db.execute(
        select(Route)
        .options(selectinload(Route.sources))
        .where(Route.user_id == user_id)
    )
    existing_routes = list(result.scalars().all())

    if not existing_routes:
        return None

    best_route = None
    best_score = 0.0

    for route in existing_routes:
        # Quick pre-filter: skip if start points are > 5km apart
        start_dist = haversine_distance(
            start_lat, start_lng, route.start_lat, route.start_lng
        )
        if start_dist > 5000:
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

    if best_score >= settings.route_match_threshold and best_route is not None:
        logger.info(
            f"Found duplicate route '{best_route.name}' with score {best_score:.2f}"
        )
        return best_route

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
    points = decode_polyline(encoded_polyline)
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
) -> RouteSource:
    """Add a provider source to an existing route.

    Skips if a source with the same provider already exists on this route
    to avoid duplicate provider badges in the UI (e.g. Strava Routes API
    and activity-derived polyline both mapping to provider="strava").
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
    # Check if this provider route already exists
    existing_source = await db.execute(
        select(RouteSource).where(
            RouteSource.provider == provider,
            RouteSource.provider_route_id == provider_route_id,
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
    points = decode_polyline(encoded_polyline)
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
        )
        # Optionally update the canonical polyline if the new one is higher fidelity
        new_point_count = len(points)
        existing_points = decode_polyline(duplicate.encoded_polyline)
        if new_point_count > len(existing_points):
            duplicate.encoded_polyline = encoded_polyline
            if elevation_profile:
                duplicate.elevation_profile = elevation_profile
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
) -> Route | None:
    """Manually merge two routes: move all sources from the duplicate to the primary."""
    primary = await get_route_by_id(db, primary_route_id, user_id)
    duplicate = await get_route_by_id(db, duplicate_route_id, user_id)

    if not primary or not duplicate:
        return None
    if primary.id == duplicate.id:
        return primary

    # Move sources from duplicate to primary
    for source in duplicate.sources:
        source.route_id = primary.id

    # Update primary's polyline if the duplicate has a better one
    dup_points = decode_polyline(duplicate.encoded_polyline)
    prim_points = decode_polyline(primary.encoded_polyline)
    if len(dup_points) > len(prim_points):
        primary.encoded_polyline = duplicate.encoded_polyline
        if duplicate.elevation_profile:
            primary.elevation_profile = duplicate.elevation_profile

    await db.flush()

    # Delete the duplicate (sources already moved)
    await db.delete(duplicate)
    await db.flush()

    # Reload with fresh sources
    return await get_route_by_id(db, primary_route_id, user_id)


async def find_potential_duplicates(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> list[dict]:
    """Find route pairs that may be duplicates for manual review.

    Returns a list of {route_a, route_b, score} dicts.
    """
    result = await db.execute(
        select(Route)
        .options(selectinload(Route.sources))
        .where(Route.user_id == user_id)
    )
    routes = list(result.scalars().all())

    potential: list[dict] = []
    for i in range(len(routes)):
        for j in range(i + 1, len(routes)):
            a, b = routes[i], routes[j]
            score = _compute_match_score(
                a.distance_meters,
                a.encoded_polyline,
                a.name,
                a.start_lat,
                a.start_lng,
                a.end_lat,
                a.end_lng,
                b,
            )
            if score >= 0.40:  # Lower threshold for "potential" duplicates
                potential.append(
                    {
                        "route_a": a,
                        "route_b": b,
                        "score": round(score, 3),
                    }
                )

    potential.sort(key=lambda x: x["score"], reverse=True)
    return potential
