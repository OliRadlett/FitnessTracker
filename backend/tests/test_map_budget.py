"""Tests for the server-side monthly map-open budget."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app.services.map_budget import claim_map_open


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, int] = {}
        self.expires: dict[str, int] = {}

    async def incr(self, key: str) -> int:
        self.values[key] = self.values.get(key, 0) + 1
        return self.values[key]

    async def expire(self, key: str, seconds: int) -> bool:
        self.expires[key] = seconds
        return True


class BrokenRedis:
    async def incr(self, key: str) -> int:
        raise RuntimeError("redis down")

    async def expire(self, key: str, seconds: int) -> bool:
        return True


@pytest.mark.asyncio
async def test_claims_under_limit_and_blocks_over_limit() -> None:
    redis = FakeRedis()
    user_id = uuid4()
    now = datetime(2026, 11, 3, tzinfo=UTC)

    first = await claim_map_open(user_id, limit=2, redis_client=redis, now=now)
    second = await claim_map_open(user_id, limit=2, redis_client=redis, now=now)
    third = await claim_map_open(user_id, limit=2, redis_client=redis, now=now)

    assert first == {"allowed": True, "used": 1, "limit": 2}
    assert second == {"allowed": True, "used": 2, "limit": 2}
    assert third == {"allowed": False, "used": 3, "limit": 2}
    assert redis.expires


@pytest.mark.asyncio
async def test_fails_open_when_redis_is_down() -> None:
    result = await claim_map_open(
        uuid4(),
        limit=2,
        redis_client=BrokenRedis(),
        now=datetime(2026, 11, 3, tzinfo=UTC),
    )
    assert result == {"allowed": True, "used": 0, "limit": 2}
