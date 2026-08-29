"""Shared utilities for LLM analysis services.

Provides constants, JSON serialization, big-lift PR lookup, record storage,
and the common Gemini API call wrapper used by all domain-specific analyzers.
"""

import json
import logging
import uuid
from datetime import date, datetime
from datetime import date as date_type

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.llm_analysis import LlmAnalysis

logger = logging.getLogger(__name__)

GEMINI_MODEL = "gemini-3.6-flash"
GEMINI_TIMEOUT_S = 60


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
        response = await client.aio.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.7,
                max_output_tokens=4096,
                http_options=types.HttpOptions(timeout=GEMINI_TIMEOUT_S * 1000),
            ),
        )
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
