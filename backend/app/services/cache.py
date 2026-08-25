"""Redis-backed response caching utility for expensive API endpoints.

Usage:
    from app.services.cache import cached

    @cached(ttl=120, key_prefix="training-load")
    async def compute_training_load(db, user_id, days):
        ...
"""

import functools
import hashlib
import json
import logging
from collections.abc import Callable
from contextlib import asynccontextmanager
from typing import Any

import redis.asyncio as aioredis

from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

_redis: aioredis.Redis | None = None


def _get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url)
    return _redis


@asynccontextmanager
async def redis_lock(name: str, ttl: int = 600):
    """Distributed lock via Redis SET NX EX.

    Usage:
        async with redis_lock("whoop-backfill:user123"):
            # only one caller runs this block at a time
            ...

    Raises RuntimeError if the lock is already held.
    """
    r = _get_redis()
    key = f"lock:{name}"
    acquired = await r.set(key, "1", nx=True, ex=ttl)
    if not acquired:
        raise RuntimeError(f"Lock '{name}' is already held")
    try:
        yield
    finally:
        await r.delete(key)


def _make_cache_key(prefix: str, *args, **kwargs) -> str:
    """Build a deterministic cache key from function arguments."""
    # Filter out non-serializable args (like db sessions)
    serializable_args = []
    for a in args:
        if isinstance(a, (str, int, float, bool, type(None))):
            serializable_args.append(a)
        elif hasattr(a, "hex"):  # UUID
            serializable_args.append(str(a))
    for k, v in sorted(kwargs.items()):
        if isinstance(v, (str, int, float, bool, type(None))) or hasattr(v, "hex"):
            serializable_args.append(f"{k}={v}")

    key_data = json.dumps(serializable_args, sort_keys=True, default=str)
    key_hash = hashlib.md5(key_data.encode()).hexdigest()[:12]
    return f"fittrack:{prefix}:{key_hash}"


def cached(ttl: int = 120, key_prefix: str = "", to_dict: Callable | None = None):
    """Decorator that caches async function results in Redis.

    Args:
        ttl: Cache time-to-live in seconds.
        key_prefix: Prefix for the cache key (e.g. "training-load").
        to_dict: Optional converter applied to the result before storing
            (e.g. ``dataclasses.asdict``). Required for dataclass results —
            without it a cache hit returns a plain dict while a miss returns
            the dataclass, producing inconsistent shapes.

    The decorated function must be async. The first two positional args
    are assumed to be (db, user_id) and are used to build the cache key.
    """

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            # Build cache key from function name + args
            prefix = key_prefix or func.__name__
            cache_key = _make_cache_key(prefix, *args, **kwargs)

            # Try cache hit
            try:
                r = _get_redis()
                cached_val = await r.get(cache_key)
                if cached_val is not None:
                    return json.loads(cached_val)
            except Exception as e:
                logger.debug("Cache read failed for %s: %s", cache_key, e)

            # Cache miss — compute
            result = await func(*args, **kwargs)

            # Store in cache
            try:
                r = _get_redis()
                payload = to_dict(result) if to_dict else result
                await r.setex(cache_key, ttl, json.dumps(payload, default=str))
            except Exception as e:
                logger.debug("Cache write failed for %s: %s", cache_key, e)

            return result

        return wrapper

    return decorator


async def invalidate_prefix(prefix: str) -> int:
    """Delete all cache keys matching a prefix. Returns count of deleted keys."""
    try:
        r = _get_redis()
        count = 0
        async for key in r.scan_iter(match=f"fittrack:{prefix}:*"):
            await r.delete(key)
            count += 1
        return count
    except Exception as e:
        logger.debug("Cache invalidation failed for prefix %s: %s", prefix, e)
        return 0
