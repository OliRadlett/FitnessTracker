"""Server-side monthly 3D map-open budget.

The spend-cap budget is the hard no-spend layer; this is the app-side guard
that stops a single user from opening the 3D map hundreds of times. It is
intentionally fail-open: an unreachable Redis must not make the viewer
unusable, and the Google spend cap still protects the bill.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Protocol
from uuid import UUID

from app.services.cache import _get_redis

logger = logging.getLogger(__name__)

MAP_OPEN_LIMIT = 500
MAP_OPEN_TTL_SECONDS = 40 * 24 * 60 * 60


class RedisLike(Protocol):
    async def incr(self, key: str) -> int: ...
    async def expire(self, key: str, seconds: int) -> bool: ...


def month_key(now: datetime | None = None) -> str:
    current = now or datetime.now(UTC)
    return current.strftime("%Y-%m")


async def claim_map_open(
    user_id: UUID,
    *,
    limit: int = MAP_OPEN_LIMIT,
    redis_client: RedisLike | None = None,
    now: datetime | None = None,
) -> dict[str, int | bool]:
    """Increment the user's monthly map-open counter and report the result."""
    key = f"relive3d:map-opens:{user_id}:{month_key(now)}"
    try:
        client = redis_client or _get_redis()
        used = int(await client.incr(key))
        if used == 1:
            await client.expire(key, MAP_OPEN_TTL_SECONDS)
        return {"allowed": used <= limit, "used": used, "limit": limit}
    except Exception as exc:
        logger.warning("Relive map budget unavailable (fail-open): %s", exc)
        return {"allowed": True, "used": 0, "limit": limit}
