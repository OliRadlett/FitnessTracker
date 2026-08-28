"""Smart collection rules evaluator — filters routes based on collection rules.

Smart collections store rules as JSONB in route_collections.rules.
Supported rule keys (all optional):
  - surface_type: list of surface strings to include (e.g. ["gravel", "dirt"])
  - min_distance_km: float — only routes >= this distance
  - max_distance_km: float — only routes <= this distance
  - min_elevation: float — only routes >= this elevation gain (meters)
  - max_elevation: float — only routes <= this elevation gain (meters)
  - sport_type: list of sport types to include
  - is_loop: bool — filter by loop vs point-to-point
  - is_favorite: bool — filter by favorite status
  - min_quality_score: float — only routes >= this quality score (0-100)
  - q: string — search by route name

The rules are applied as a conjunction (AND) of all present filters.
"""

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.route import Route

logger = logging.getLogger(__name__)


async def evaluate_smart_collection(
    db: AsyncSession,
    user_id,
    collection_id,
) -> list[Route]:
    """Evaluate a smart collection's rules and return matching routes.

    Raises ValueError if the collection is not found or not smart.
    """
    from app.models.route_organize import RouteCollection

    result = await db.execute(
        select(RouteCollection)
        .where(
            RouteCollection.id == collection_id,
            RouteCollection.user_id == user_id,
        )
        .options(selectinload(RouteCollection.items))
    )
    collection = result.scalar_one_or_none()

    if collection is None:
        raise ValueError(f"Collection {collection_id} not found for user {user_id}")

    if not collection.is_smart:
        raise ValueError(f"Collection {collection_id} is not a smart collection")

    rules = collection.rules or {}
    if not rules:
        # Empty rules = all routes match (like a "All Routes" collection)
        result = await db.execute(select(Route).where(Route.user_id == user_id))
        return list(result.scalars().all())

    query = select(Route).where(Route.user_id == user_id)

    # Apply each rule
    if rules.get("surface_type"):
        surfaces = rules["surface_type"]
        for s in surfaces:
            query = query.where(Route.surface_profile.has_key(s))

    if "min_distance_km" in rules and rules["min_distance_km"] is not None:
        min_m = float(rules["min_distance_km"]) * 1000
        query = query.where(Route.distance_meters >= min_m)

    if "max_distance_km" in rules and rules["max_distance_km"] is not None:
        max_m = float(rules["max_distance_km"]) * 1000
        query = query.where(Route.distance_meters <= max_m)

    if "min_elevation" in rules and rules["min_elevation"] is not None:
        query = query.where(
            Route.elevation_gain_meters >= float(rules["min_elevation"])
        )

    if "max_elevation" in rules and rules["max_elevation"] is not None:
        query = query.where(
            Route.elevation_gain_meters <= float(rules["max_elevation"])
        )

    if rules.get("sport_type"):
        query = query.where(Route.sport_type.in_(rules["sport_type"]))

    if "is_loop" in rules and rules["is_loop"] is not None:
        query = query.where(Route.is_loop == bool(rules["is_loop"]))

    if "is_favorite" in rules and rules["is_favorite"] is not None:
        query = query.where(Route.is_favorite == bool(rules["is_favorite"]))

    if "min_quality_score" in rules and rules["min_quality_score"] is not None:
        query = query.where(Route.quality_score >= float(rules["min_quality_score"]))

    if rules.get("q"):
        query = query.where(Route.name.ilike(f"%{rules['q']}%"))

    result = await db.execute(query)
    return list(result.scalars().all())


async def evaluate_all_smart_collections(
    db: AsyncSession,
    user_id,
) -> dict[str, list[Route]]:
    """Evaluate all smart collections for a user and return routes per collection.

    Returns a dict mapping collection_id -> list of matching Route objects.
    """
    from app.models.route_organize import RouteCollection

    result = await db.execute(
        select(RouteCollection).where(
            RouteCollection.user_id == user_id,
            RouteCollection.is_smart == True,
        )
    )
    collections = list(result.scalars().all())

    results: dict[str, list[Route]] = {}
    for collection in collections:
        try:
            routes = await evaluate_smart_collection(db, user_id, collection.id)
            results[str(collection.id)] = routes
        except ValueError as e:
            logger.warning(f"Skipping collection {collection.id}: {e}")

    return results


def validate_collection_rules(rules: dict[str, Any]) -> list[str]:
    """Validate a collection's rules and return a list of error messages.

    Returns an empty list if all rules are valid.
    """
    errors: list[str] = []
    valid_keys = {
        "surface_type",
        "min_distance_km",
        "max_distance_km",
        "min_elevation",
        "max_elevation",
        "sport_type",
        "is_loop",
        "is_favorite",
        "min_quality_score",
        "q",
    }

    for key in rules:
        if key not in valid_keys:
            errors.append(
                f"Unknown rule key: '{key}'. Valid keys: {', '.join(sorted(valid_keys))}"
            )

    if "min_distance_km" in rules and "max_distance_km" in rules:
        min_d = float(rules.get("min_distance_km") or 0)
        max_d = float(rules.get("max_distance_km") or 0)
        if max_d < min_d:
            errors.append("max_distance_km must be >= min_distance_km")

    if "min_elevation" in rules and "max_elevation" in rules:
        min_e = float(rules.get("min_elevation") or 0)
        max_e = float(rules.get("max_elevation") or 0)
        if max_e < min_e:
            errors.append("max_elevation must be >= min_elevation")

    if "min_quality_score" in rules:
        score = float(rules.get("min_quality_score") or 0)
        if score < 0 or score > 100:
            errors.append("min_quality_score must be between 0 and 100")

    return errors
