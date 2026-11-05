"""Refresh a user's route intelligence after routes change.

Quality and terrain are weekly-only jobs, so a route synced or imported today
can sit unclassified for a week. This runs the cheap local passes in one place:

1. terrain classification for routes with a profile that lack a usable class
   (local engine, no Modal);
2. quality recomputation for every route (terrain and surface feed it).

Callers must flush their route writes first; the service re-queries with
``sources`` eager-loaded (completeness reads them, and lazy loading is illegal
on an async session).
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.route import Route

logger = logging.getLogger(__name__)


def _has_usable_terrain(route: Route) -> bool:
    terrain = route.terrain_classification
    return bool(terrain) and terrain.get("terrain_type") not in (None, "unknown")


async def refresh_route_intelligence(db: AsyncSession, user_id: uuid.UUID) -> dict:
    """Classify missing terrain and rescore quality. Best-effort per route."""
    from app.integrations.route_intelligence import classify_route_terrain
    from app.services.polyline_utils import decode_polyline
    from app.services.route_elevation import backfill_route_elevations
    from app.services.route_quality_service import compute_and_store_quality

    elevation_backfilled = await backfill_route_elevations(db, user_id)

    routes = (
        await db.execute(
            select(Route)
            .options(selectinload(Route.sources))
            .where(Route.user_id == user_id)
        )
    ).scalars().all()

    terrain_classified = 0
    for route in routes:
        if not route.elevation_profile or _has_usable_terrain(route):
            continue
        try:
            polyline = (
                decode_polyline(route.encoded_polyline)
                if route.encoded_polyline
                else None
            )
            terrain = classify_route_terrain(route.elevation_profile, polyline)
        except Exception:
            logger.warning(
                "Terrain classification failed for route %s", route.id, exc_info=True
            )
            continue
        if terrain.get("terrain_type") != "unknown":
            route.terrain_classification = terrain
            terrain_classified += 1

    quality_scored = 0
    for route in routes:
        try:
            await compute_and_store_quality(db, route, user_id)
            quality_scored += 1
        except Exception:
            logger.warning(
                "Quality scoring failed for route %s", route.id, exc_info=True
            )

    await db.flush()
    return {
        "routes": len(routes),
        "elevation_backfilled": elevation_backfilled,
        "terrain_classified": terrain_classified,
        "quality_scored": quality_scored,
    }
