"""Compute the union bounding box of all routes (for the OSM bootstrap).

Standalone async helper so ``osm_bootstrap --bbox routes`` can pass a small bbox
to the graph builder without a user id.
"""

from __future__ import annotations

import os

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        # Fall back to the app settings (async driver).
        from app.config import get_settings

        url = get_settings().database_url
    return url


async def _compute() -> tuple[float, float, float, float]:
    import app.models
    from app.models.route import Route
    from app.services.polyline_utils import decode_polyline

    engine = create_async_engine(_database_url())
    try:
        async with AsyncSession(engine) as db:
            rows = (
                await db.execute(
                    select(Route.start_lat, Route.start_lng, Route.end_lat, Route.end_lng)
                )
            ).all()
            lats: list[float] = []
            lngs: list[float] = []
            for s_lat, s_lng, e_lat, e_lng in rows:
                lats.extend([s_lat, e_lat])
                lngs.extend([s_lng, e_lng])
            # Multi-point polylines may extend beyond endpoints; sample them too.
            polylines = (
                await db.execute(select(Route.encoded_polyline))
            ).scalars().all()
            for encoded in polylines:
                for lat, lng in decode_polyline(encoded):
                    lats.append(lat)
                    lngs.append(lng)
        if not lats:
            raise SystemExit("No routes found to compute a bbox")
        return (min(lats), min(lngs), max(lats), max(lngs))
    finally:
        await engine.dispose()


def compute_route_bbox() -> tuple[float, float, float, float]:
    """Return ``(min_lat, min_lng, max_lat, max_lng)`` across all routes."""
    import asyncio

    return asyncio.run(_compute())
