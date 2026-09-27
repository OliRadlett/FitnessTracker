"""Jev free-text tagging for lifting sessions (Phase 1).

Best-effort: ``tag_lifting_session`` writes ``LiftingSession.ai_tags`` when Jev
is configured and is a no-op otherwise. It never raises to the caller and never
blocks the write path — the API schedules it as a background task and a weekly
backfill covers anything missed.

Confidence routing follows the design (plans/jev-decision-layer.md §4.4):
``pain_injury`` is stored from 0.40 up (so the health path can cross-check);
``outcome`` only when the choice confidence is ≥ 0.60.
"""

from __future__ import annotations

import hashlib
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.integrations import jev_client
from app.models.lifting import LiftingSession

logger = logging.getLogger(__name__)

_CAP = 4000  # cap how much note text is sent

PAIN_REVIEW_FLOOR = 0.40  # store pain_injury at/above this
CHOICE_MIN_CONFIDENCE = 0.60  # store outcome only when the choice is confident


def _note_hash(note: str) -> str:
    return hashlib.sha1(note.strip().encode("utf-8")).hexdigest()


def _questions() -> dict:
    return {
        "pain_injury": jev_client.noul(
            "Does the athlete mention pain, a tweak, or an injury?"
        ),
        "high_fatigue": jev_client.noul(
            "Does this describe unusual fatigue or overreaching?"
        ),
        "pr_mention": jev_client.noul(
            "Does this mention a personal record or a new max?"
        ),
        "outcome": jev_client.choice(
            "What best describes the session?",
            {
                "breakthrough": "Beat expectations / felt strong",
                "on_target": "Completed the plan as intended",
                "grind": "Completed but struggled / heavy / a slog",
                "failed_sets": "Missed reps or failed sets",
                "deload": "Intentionally light / recovery session",
            },
        ),
        "energy": jev_client.score("Rate reported energy/motivation.", ["low", "ok", "high"]),
    }


def _build_state(session: LiftingSession) -> dict:
    return {
        "note": (session.notes or "")[:_CAP],
        "focus": session.focus,
        "program_name": session.program_name,
        "duration_seconds": session.duration_seconds,
        "rpe_session": session.rpe_session,
        "total_volume_kg": session.total_volume_kg,
    }


def build_tags(result: jev_client.JevResult, note_hash: str, model: str) -> dict:
    """Map a ``JevResult`` to the stored ``ai_tags`` payload.

    ``model`` is the *configured* model (e.g. ``jev-latest``) and is the
    staleness key; ``resolved_model`` records the concrete version the SDK
    returned.
    """
    tags: dict = {
        "source": "jev",
        "model": model,
        "resolved_model": result.model,
        "computed_at": result.computed_at,
        "note_hash": note_hash,
    }
    pain = result.noul("pain_injury")
    if pain is not None and pain >= PAIN_REVIEW_FLOOR:
        tags["pain_injury"] = round(pain, 3)
    fatigue = result.noul("high_fatigue")
    if fatigue is not None:
        tags["high_fatigue"] = round(fatigue, 3)
    pr = result.noul("pr_mention")
    if pr is not None and pr >= 0.5:
        tags["pr_mention"] = round(pr, 3)
    outcome = result.answers.get("outcome")
    if (
        outcome is not None
        and outcome.choice
        and (outcome.confidence or 0) >= CHOICE_MIN_CONFIDENCE
    ):
        tags["outcome"] = outcome.choice
        tags["outcome_confidence"] = round(outcome.confidence or 0, 3)
    energy = result.score("energy")
    if energy is not None:
        tags["energy"] = energy
    return tags


async def tag_lifting_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    session: LiftingSession,
) -> bool:
    """Tag one session. Returns True when ``ai_tags`` changed. Never raises."""
    note = (session.notes or "").strip()
    if not note or not jev_client.is_configured():
        return False

    note_hash = _note_hash(note)
    existing = session.ai_tags or {}
    if (
        existing.get("note_hash") == note_hash
        and existing.get("model") == get_settings().jev_model
    ):
        return False  # already tagged for this note + model

    try:
        result = await jev_client.decide(
            _build_state(session), _questions(), user_id=user_id
        )
    except Exception as e:  # decide() shouldn't raise; belt-and-braces
        logger.warning("Jev tagging failed for session %s: %s", session.id, e)
        return False

    if result is None:
        return False

    session.ai_tags = build_tags(result, note_hash, get_settings().jev_model)
    return True


async def tag_lifting_session_by_id(session_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Background entry point: open a session, tag, commit. Never raises."""
    from app.database import async_session_factory

    try:
        async with async_session_factory() as db:
            session = await db.get(LiftingSession, session_id)
            if session is None or session.user_id != user_id:
                return
            if await tag_lifting_session(db, user_id, session):
                await db.commit()
    except Exception as e:
        logger.warning(
            "Jev background tagging failed for session %s: %s", session_id, e
        )


async def backfill_free_text_tags(db: AsyncSession, user_id: uuid.UUID) -> int:
    """Tag all of a user's notes-bearing sessions (idempotent). Returns count."""
    if not jev_client.is_configured():
        return 0

    result = await db.execute(
        select(LiftingSession).where(
            LiftingSession.user_id == user_id,
            LiftingSession.notes.isnot(None),
            LiftingSession.notes != "",
        )
    )
    tagged = 0
    for session in result.scalars():
        if await tag_lifting_session(db, user_id, session):
            tagged += 1
    return tagged
