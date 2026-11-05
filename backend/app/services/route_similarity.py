"""Per-user route-similarity graph: compute it, cache it, report its state.

The matching engine is expensive (full-resolution geometry over every candidate
pair — ~15–20 minutes for 86 routes), so it must never run inside a request.
This module owns the background job body, a Redis-backed scan state, and the
read helpers the API uses to tell "not scanned" from "no duplicates".
"""

from __future__ import annotations

import logging
import secrets
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_LOCK_TTL_S = 2 * 60 * 60
_STATE_TTL_S = 30 * 24 * 60 * 60
_STATE_PREFIX = "route-similarity:state:"


def _state_key(user_id: uuid.UUID) -> str:
    return f"{_STATE_PREFIX}{user_id}"


def _lock_key(user_id: uuid.UUID) -> str:
    return f"route-similarity:lock:{user_id}"


async def _client() -> Any | None:
    """Redis client, or None when Redis is unavailable (fail open)."""
    from app.services.cache import _get_redis

    try:
        return _get_redis()
    except Exception:  # pragma: no cover - defensive; Redis outages are runtime
        logger.warning("Route similarity: Redis unavailable", exc_info=True)
        return None


async def _acquire_lock(user_id: uuid.UUID) -> str | None:
    client = await _client()
    if client is None:
        # No Redis: allow the scan. A duplicated scan is wasteful, not unsafe
        # (the graph is rebuilt idempotently per user).
        return ""
    token = secrets.token_hex(16)
    try:
        acquired = await client.set(_lock_key(user_id), token, nx=True, ex=_LOCK_TTL_S)
        return token if acquired else None
    except Exception:
        logger.warning("Route similarity: lock unavailable", exc_info=True)
        return ""


async def _release_lock(user_id: uuid.UUID, token: str | None) -> None:
    if token is None:
        return
    client = await _client()
    if client is None:
        return
    try:
        current = await client.get(_lock_key(user_id))
        if isinstance(current, bytes):
            current = current.decode()
        if token and current == token:
            await client.delete(_lock_key(user_id))
    except Exception:  # pragma: no cover
        logger.warning("Route similarity: lock release failed", exc_info=True)


async def _set_state(user_id: uuid.UUID, **fields: Any) -> None:
    client = await _client()
    if client is None:
        return
    try:
        key = _state_key(user_id)
        await client.hset(
            key,
            mapping={k: "" if v is None else str(v) for k, v in fields.items()},
        )
        await client.expire(key, _STATE_TTL_S)
    except Exception:  # pragma: no cover
        logger.warning("Route similarity: state write failed", exc_info=True)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def decode_hash(raw: dict) -> dict[str, str]:
    """Normalise a redis hash to str->str.

    ``redis.asyncio`` returns bytes by default. Reading ``raw["state"]`` on a
    bytes hash yields ``None`` and the API silently reported ``never`` while
    Redis held ``running`` — the scan looked like it had never happened.
    """
    return {
        (k.decode() if isinstance(k, bytes) else k): (
            v.decode() if isinstance(v, bytes) else v
        )
        for k, v in raw.items()
    }


async def get_scan_state(db: AsyncSession, user_id: uuid.UUID) -> dict:
    """Scan status for the Maintain surface.

    Redis holds the live state (running / ready / failed). When it has nothing
    (fresh process, cache from before this feature), a populated graph is
    still reported as ready from the rows themselves.
    """
    from app.models.route import RouteSimilarity

    state: dict[str, Any] = {
        "state": "never",
        "started_at": None,
        "finished_at": None,
        "pairs": None,
        "error": None,
    }

    client = await _client()
    if client is not None:
        try:
            raw = await client.hgetall(_state_key(user_id))
            if raw:
                decoded = decode_hash(raw)
                state.update(
                    state=decoded.get("state") or "never",
                    started_at=decoded.get("started_at") or None,
                    finished_at=decoded.get("finished_at") or None,
                    pairs=(
                        int(decoded["pairs"])
                        if decoded.get("pairs") not in (None, "")
                        else None
                    ),
                    error=decoded.get("error") or None,
                )
                return state
        except Exception:  # pragma: no cover
            logger.warning("Route similarity: state read failed", exc_info=True)

    row = (
        await db.execute(
            select(
                func.count(RouteSimilarity.id), func.max(RouteSimilarity.computed_at)
            ).where(RouteSimilarity.user_id == user_id)
        )
    ).one()
    count, latest = int(row[0] or 0), row[1]
    if count > 0:
        state.update(state="ready", finished_at=_iso(latest), pairs=count)
    return state


async def enqueue_user_similarity(user_id: uuid.UUID) -> str:
    """Queue a scan. Returns ``queued`` or ``running``.

    The scan itself takes the lock in :func:`recompute_user_similarity`; this
    check is only to avoid stacking a second task behind a live one.
    """
    from app.tasks.scheduler import recompute_user_route_similarity

    client = await _client()
    if client is not None:
        try:
            if await client.exists(_lock_key(user_id)):
                return "running"
        except Exception:  # pragma: no cover
            logger.warning("Route similarity: lock check failed", exc_info=True)

    await _set_state(
        user_id,
        state="queued",
        started_at=datetime.now(UTC).isoformat(),
        finished_at="",
        pairs="",
        error="",
    )
    try:
        recompute_user_route_similarity.delay(str(user_id))
    except Exception:
        # Broker down: do not leave the UI polling a scan that was never queued.
        await _set_state(
            user_id,
            state="failed",
            finished_at=datetime.now(UTC).isoformat(),
            error="Could not queue the scan",
        )
        raise
    return "queued"


async def recompute_user_similarity(db: AsyncSession, user_id: uuid.UUID) -> dict:
    """Build the cached similarity graph for one user.

    Mirrors the weekly task's flow: score candidates (Modal with a local
    fallback), re-blend with road/embedding signals, replace ``route_similarity``
    idempotently, then auto-merge only when the gate is explicitly enabled.
    """
    from app.config import get_settings
    from app.integrations.route_intelligence import compute_route_similarity_on_modal
    from app.models.route import Route, RouteSimilarity
    from app.services.polyline_utils import decode_polyline
    from app.services.road_matching import load_metric, road_signals
    from app.services.route_matching import score_route_pair
    from app.services.route_service import merge_routes

    settings = get_settings()
    token = await _acquire_lock(user_id)
    if token is None:
        return {"status": "running", "pairs": 0, "merged": 0}

    await _set_state(
        user_id,
        state="running",
        started_at=datetime.now(UTC).isoformat(),
        finished_at="",
        pairs="",
        error="",
    )
    try:
        auto = settings.route_match_auto_threshold
        review = settings.route_match_threshold
        gate = settings.route_match_gate

        routes = (
            (await db.execute(select(Route).where(Route.user_id == user_id)))
            .scalars()
            .all()
        )
        if len(routes) < 2:
            await _set_state(
                user_id,
                state="ready",
                finished_at=datetime.now(UTC).isoformat(),
                pairs=0,
                error="",
            )
            return {"status": "ready", "pairs": 0, "merged": 0}

        routes_data = [
            {
                "id": str(r.id),
                "polyline": decode_polyline(r.encoded_polyline),
                "distance_meters": r.distance_meters,
            }
            for r in routes
        ]

        # Skip obviously-unrelated pairs before full scoring. This is the same
        # gate the synchronous review scan uses (length ratio + padded bbox);
        # without it the graph scores every pair — 3,655 full Frechet runs for
        # 86 routes, which is the difference between minutes and tens of
        # minutes. Purely a prefilter: anything it drops could not have matched.
        from app.services.route_matching import cheap_candidate

        candidate_pairs = [
            [i, j]
            for i in range(len(routes_data))
            for j in range(i + 1, len(routes_data))
            if cheap_candidate(
                routes_data[i]["polyline"],
                routes_data[j]["polyline"],
                length_a=routes_data[i]["distance_meters"],
                length_b=routes_data[j]["distance_meters"],
            )
        ]

        graph = compute_route_similarity_on_modal(
            routes_data,
            candidate_pairs,
            auto_threshold=auto,
            review_floor=review,
            gate=gate,
        )
        pairs = graph.get("pairs", [])

        by_id = {str(r.id): r for r in routes}
        points_by_id = {d["id"]: d["polyline"] for d in routes_data}
        metric = await load_metric(db, user_id)
        for p in pairs:
            a = by_id.get(p["a"])
            b = by_id.get(p["b"])
            if a is None or b is None:
                continue
            rj, es = road_signals(a, b, metric)
            # Road/embedding are optional enrichment, not a requirement. A
            # user with no Phase-2 data must still get geometry-only rows;
            # skipping here emptied the cache for exactly those accounts.
            bd = score_route_pair(
                points_by_id[p["a"]],
                points_by_id[p["b"]],
                length_a=a.distance_meters,
                length_b=b.distance_meters,
                auto_threshold=auto,
                review_floor=review,
                gate=gate,
                road_jaccard=rj,
                embedding_similarity=es,
            )
            p.update(bd.to_dict())

        await db.execute(
            delete(RouteSimilarity).where(RouteSimilarity.user_id == user_id)
        )
        for p in pairs:
            db.add(
                RouteSimilarity(
                    user_id=user_id,
                    route_a_id=uuid.UUID(p["a"]),
                    route_b_id=uuid.UUID(p["b"]),
                    score=p["total"],
                    tier=p["tier"],
                    breakdown=p,
                )
            )

        # Auto-merge is off by default (no validated threshold). Detection is
        # unaffected: pairs above are cached either way.
        merged_count = 0
        merged_away: set[str] = set()
        if not settings.route_auto_merge_enabled:
            logger.info(
                "Auto-merge disabled; %d duplicate pair(s) left for review",
                sum(1 for p in pairs if p["tier"] == "auto"),
            )
        else:
            for p in pairs:
                if p["tier"] != "auto":
                    continue
                if p["a"] in merged_away or p["b"] in merged_away:
                    continue
                merged = await merge_routes(
                    db,
                    uuid.UUID(p["a"]),
                    uuid.UUID(p["b"]),
                    user_id,
                    score=p["total"],
                    breakdown=p,
                )
                if merged is not None:
                    merged_away.add(p["b"])
                    merged_count += 1

        await db.commit()
        await _set_state(
            user_id,
            state="ready",
            finished_at=datetime.now(UTC).isoformat(),
            pairs=len(pairs),
            error="",
        )
        return {"status": "ready", "pairs": len(pairs), "merged": merged_count}
    except Exception as exc:
        await db.rollback()
        await _set_state(
            user_id,
            state="failed",
            finished_at=datetime.now(UTC).isoformat(),
            error=str(exc)[:300],
        )
        raise
    finally:
        await _release_lock(user_id, token)
