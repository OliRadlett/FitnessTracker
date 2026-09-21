"""Shared utilities for LLM analysis services.

Provides constants, JSON serialization, big-lift PR lookup, record storage,
and the common Gemini API call wrapper used by all domain-specific analyzers.
"""

import asyncio
import json
import logging
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime
from datetime import date as date_type

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.llm_analysis import LlmAnalysis

logger = logging.getLogger(__name__)

GEMINI_MODEL = "gemini-3.6-flash"
GEMINI_TIMEOUT_S = 60

# Bounded retries for transient Gemini failures (503 overload, 429 rate limit,
# timeouts). Without this a single upstream blip silently costs a weekly run
# (e.g. the Sunday ``weekly_llm_analysis`` produced nothing on 2026-09-20 after
# a 503 UNAVAILABLE).
GEMINI_MAX_ATTEMPTS = 3
GEMINI_RETRY_BASE_DELAY_S = 2.0
_GEMINI_TRANSIENT_MARKERS = (
    "503",
    "unavailable",
    "429",
    "rate limit",
    "overloaded",
    "resource_exhausted",
    "timeout",
    "deadline",
)


def _is_transient_gemini_error(exc: BaseException) -> bool:
    """True for retryable Gemini errors (overload / rate limit / timeout)."""
    message = str(exc).lower()
    return any(marker in message for marker in _GEMINI_TRANSIENT_MARKERS)


# ── AI spend guards (AI-01 / AI-03) ──────────────────────────────────────────

AI_GENERATIONS_PER_MINUTE = 5
AI_BUDGET_WINDOW_S = 60
AI_LOCK_TTL_S = 5 * 60

# Compare-and-delete so a slow generation never releases a successor's lock.
_AI_RELEASE_LUA = (
    "if redis.call('get', KEYS[1]) == ARGV[1] then "
    "  return redis.call('del', KEYS[1]) "
    "else "
    "  return 0 "
    "end"
)


def _has_signal(value) -> bool:
    """True when a compiled-context value carries analyzable signal.

    Zeros, nulls, blanks, dates, and recursively-empty containers carry no
    signal — a stats payload with none of these is an empty context that
    Gemini would confidently narrate anyway (AI-03).
    """
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (date, datetime)):
        return False
    if isinstance(value, dict):
        return any(_has_signal(v) for v in value.values())
    if isinstance(value, (list, tuple)):
        return any(_has_signal(v) for v in value)
    return True


def ensure_context_sufficient(stats: dict | None, label: str) -> None:
    """Raise ValueError when a compiled context has no analyzable signal.

    Callers map ValueError → 400, so low-data users get "not enough data"
    instead of a fabricated narrative stored as real analysis.
    """
    if not stats or not _has_signal(stats):
        raise ValueError(
            f"Not enough data yet for {label} analysis — "
            "log some training first, then try again."
        )


@asynccontextmanager
async def ai_generation_guard(
    user_id: uuid.UUID, kind: str, target: str = ""
):
    """Per-user AI budget + in-flight dedupe around one Gemini generation.

    - Fixed-window cap (``AI_GENERATIONS_PER_MINUTE``/min per user) → 429.
    - Non-blocking Redis lock per (user, kind, target): a duplicate
      concurrent request → 429 instead of a second Gemini call + record.
    - Fail-open on Redis outage (availability first, matching ``redis_lock``).
    """
    import secrets
    import time

    from app.services.cache import _get_redis

    r = _get_redis()
    window = int(time.time()) // AI_BUDGET_WINDOW_S
    budget_key = f"ai_budget:{user_id}:{window}"
    lock_key = f"ai_gen:{user_id}:{kind}:{target or '-'}"
    try:
        count = await r.incr(budget_key)
        if count == 1:
            await r.expire(budget_key, AI_BUDGET_WINDOW_S)
        if count > AI_GENERATIONS_PER_MINUTE:
            raise HTTPException(
                status_code=429,
                detail="AI analysis budget exceeded (5/minute). "
                "Wait a minute and try again.",
            )
        lock_token = secrets.token_hex(16)
        acquired = await r.set(lock_key, lock_token, nx=True, ex=AI_LOCK_TTL_S)
        if not acquired:
            raise HTTPException(
                status_code=429,
                detail="An analysis of this type is already running. "
                "Wait for it to finish instead of starting another.",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"AI guard Redis unavailable (fail-open): {e}")
        lock_token = None  # type: ignore[assignment]

    try:
        yield
    finally:
        if lock_token is not None:
            try:
                await r.eval(_AI_RELEASE_LUA, 1, lock_key, lock_token)
            except Exception as e:
                logger.warning(f"AI guard lock release failed (non-critical): {e}")


def _make_json_serializable(obj):
    """Recursively convert date/datetime objects to ISO strings."""
    if isinstance(obj, dict):
        return {k: _make_json_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_make_json_serializable(item) for item in obj]
    elif isinstance(obj, (date, datetime)):
        return obj.isoformat()
    return obj


async def _big_lift_pbs(db: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    """All-time best estimated-1RM PR per big lift, with the date achieved.

    Gives the LLM historical strength context even when the PBs are months old
    (recent_prs only covers the last 4 weeks).
    """
    from app.models.lifting import PersonalRecord
    from app.services.exercise_db import BIG_3_ORDER

    result = await db.execute(
        select(PersonalRecord).where(
            PersonalRecord.user_id == user_id,
            PersonalRecord.exercise_name.in_(BIG_3_ORDER),
            PersonalRecord.record_type == "1rm",
            PersonalRecord.estimated_1rm.isnot(None),
        )
    )
    best: dict[str, PersonalRecord] = {}
    for pr in result.scalars().all():
        current = best.get(pr.exercise_name)
        if current is None or (pr.estimated_1rm or 0) > (current.estimated_1rm or 0):
            best[pr.exercise_name] = pr

    pbs = []
    for lift in BIG_3_ORDER:
        pr = best.get(lift)
        if pr is not None:
            pbs.append(
                {
                    "exercise": pr.exercise_name,
                    "weight_kg": pr.weight_kg,
                    "reps": pr.reps,
                    "estimated_1rm": round(pr.estimated_1rm, 1)
                    if pr.estimated_1rm is not None
                    else None,
                    "date_achieved": str(pr.achieved_date),
                }
            )
    return pbs


async def _store_analysis(
    db: AsyncSession,
    user_id: uuid.UUID,
    analysis_type: str,
    stats: dict,
    analysis_text: str,
    **extra_fields,
) -> LlmAnalysis:
    """Create and store an LlmAnalysis record, then return it."""
    record = LlmAnalysis(
        user_id=user_id,
        analysis_type=analysis_type,
        analysis_date=date_type.today(),
        stats_json=_make_json_serializable(stats),
        analysis_text=analysis_text,
        model_used=GEMINI_MODEL,
        **extra_fields,
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)
    return record


async def _call_gemini(prompt: str, truncation_label: str) -> str:
    """Call the Gemini API with a prompt and return the response text.

    Shared by all domain analyzers — handles auth, error classification,
    empty-response detection, and truncation warnings.
    """
    from google import genai
    from google.genai import types

    from app.config import get_settings

    settings = get_settings()

    if not settings.gemini_api_key:
        raise ValueError("GEMINI_API_KEY not configured")

    client = genai.Client(api_key=settings.gemini_api_key)

    try:
        response = None
        delay = GEMINI_RETRY_BASE_DELAY_S
        for attempt in range(1, GEMINI_MAX_ATTEMPTS + 1):
            try:
                response = await client.aio.models.generate_content(
                    model=GEMINI_MODEL,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        temperature=0.7,
                        max_output_tokens=4096,
                        http_options=types.HttpOptions(timeout=GEMINI_TIMEOUT_S * 1000),
                    ),
                )
                break
            except Exception as e:
                if not _is_transient_gemini_error(e) or attempt == GEMINI_MAX_ATTEMPTS:
                    raise
                logger.warning(
                    "Gemini transient error (attempt %d/%d); retrying in %.0fs: %s",
                    attempt,
                    GEMINI_MAX_ATTEMPTS,
                    delay,
                    e,
                )
                await asyncio.sleep(delay)
                delay *= 2
    except Exception as e:
        error_msg = str(e).lower()
        if "rate limit" in error_msg or "429" in error_msg:
            logger.error("Gemini API rate limit hit: %s", e)
            raise ValueError(
                "AI analysis rate limit exceeded. Please try again in a few minutes."
            ) from e
        if "timeout" in error_msg or "deadline" in error_msg:
            logger.error("Gemini API timeout: %s", e)
            raise ValueError(
                "AI analysis timed out. The service may be overloaded — please try again."
            ) from e
        logger.error("Gemini API call failed: %s", e)
        raise ValueError(f"AI analysis failed: {e!s}") from e

    if not response.text:
        raise ValueError("Gemini returned an empty response. Please try again.")

    try:
        if response.candidates and response.candidates[0].finish_reason:
            finish = str(response.candidates[0].finish_reason)
            if "MAX" in finish.upper():
                logger.warning(
                    "Gemini %s analysis truncated (finish_reason=%s)", truncation_label, finish
                )
    except Exception as e:
        logger.debug("Gemini response parsing failed (non-critical): %s", e)

    return response.text
