"""TypeSafe Jev (System One) decision client — optional third-party integration.

Jev answers a fixed set of *typed* questions over a piece of state and returns
calibrated answers (it generates no prose). This integration is always
best-effort:

* when ``TYPESAFE_API_KEY`` is unset (or ``jev_enabled`` is False) every call
  no-ops and returns ``None`` — deterministic behaviour is unchanged;
* it never raises to the caller — SDK errors, timeouts and the shared AI budget
  guard are all swallowed into ``None``;
* the SDK is imported lazily, so a deployment without the extra still imports
  this module fine.

Only text is sent. All SDK-typed references are confined to this module.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Deterministic offline mode for CI/tests — no network, no SDK needed.
_FAKE_ENV = "JEV_FAKE"


@dataclass
class JevAnswer:
    """A single answered question."""

    kind: str  # "noul" | "choice" | "score"
    noul: float | None = None
    choice: str | None = None
    score: float | None = None
    confidence: float | None = None
    probabilities: dict[str, float] = field(default_factory=dict)


@dataclass
class JevResult:
    answers: dict[str, JevAnswer]
    model: str
    computed_at: str

    def noul(self, name: str) -> float | None:
        ans = self.answers.get(name)
        return ans.noul if ans else None

    def choice(self, name: str) -> str | None:
        ans = self.answers.get(name)
        return ans.choice if ans else None

    def score(self, name: str) -> float | None:
        ans = self.answers.get(name)
        return ans.score if ans else None


def noul(instructions: str, criteria: dict | None = None) -> dict:
    """Yes/no question; Jev returns P(true) in [0, 1]."""
    q: dict = {"type": "noul", "instructions": instructions}
    if criteria is not None:
        q["criteria"] = criteria
    return q


def choice(instructions: str, criteria: dict[str, str | None]) -> dict:
    """Pick one labelled option; ``criteria`` maps label -> description (or None)."""
    return {"type": "choice", "instructions": instructions, "criteria": criteria}


def score(instructions: str, criteria: list[str]) -> dict:
    """Rate on an ordered scale; index *i* describes score *i* (0-based)."""
    return {"type": "score", "instructions": instructions, "criteria": list(criteria)}


def is_configured() -> bool:
    from app.config import get_settings

    s = get_settings()
    return bool(s.typesafe_api_key) and s.jev_enabled


def _fake_enabled() -> bool:
    return os.environ.get(_FAKE_ENV) == "1"


def _now_iso() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).isoformat()


def _fake_result(questions: dict, model: str) -> JevResult:
    """Deterministic canned answers (no network) for CI/tests."""
    answers: dict[str, JevAnswer] = {}
    for name, q in questions.items():
        kind = q.get("type")
        if kind == "noul":
            answers[name] = JevAnswer("noul", noul=0.5, confidence=0.5)
        elif kind == "choice":
            labels = list((q.get("criteria") or {}).keys())
            answers[name] = JevAnswer(
                "choice",
                choice=labels[0] if labels else None,
                confidence=0.5,
                probabilities={lbl: 1.0 / len(labels) for lbl in labels}
                if labels
                else {},
            )
        elif kind == "score":
            answers[name] = JevAnswer("score", score=0.0, confidence=0.5)
    return JevResult(answers=answers, model=model, computed_at=_now_iso())


async def decide(
    state,
    questions: dict,
    *,
    user_id: uuid.UUID | None = None,
    timeout_s: float | None = None,
) -> JevResult | None:
    """Ask Jev a batch of typed questions.

    Returns a :class:`JevResult`, or ``None`` when Jev is unset/disabled, in
    fake mode with no input, or on any failure. Never raises.
    """
    if not questions:
        return None

    from app.config import get_settings

    settings = get_settings()
    model = settings.jev_model

    if _fake_enabled():
        return _fake_result(questions, model)

    if not is_configured():
        return None

    timeout = timeout_s if timeout_s is not None else settings.jev_timeout_s

    try:
        if user_id is None:
            return await _call(state, questions, model, timeout)
        # Shared per-user AI budget/lock. The guard raises HTTPException(429)
        # when the budget is exhausted or a duplicate is in flight — swallowed.
        from app.services.llm_base import ai_generation_guard

        async with ai_generation_guard(user_id, "jev", "batch"):
            return await _call(state, questions, model, timeout)
    except Exception as e:  # includes HTTPException(429) and any SDK error
        logger.warning("Jev decide() skipped: %s", e)
        return None


async def _call(state, questions: dict, model: str, timeout: float) -> JevResult | None:
    try:
        from typesafe_sdk import AsyncTypeSafeClient
    except Exception as e:  # SDK extra not installed
        logger.warning("typesafe-sdk not installed: %s", e)
        return None

    try:
        async with AsyncTypeSafeClient(model=model) as client:
            resp = await asyncio.wait_for(
                client.system_one(state=state, questions=questions), timeout=timeout
            )
    except Exception as e:
        logger.warning("Jev call failed: %s", e)
        return None

    return _parse(resp, questions, model)


def _parse(resp, questions: dict, fallback_model: str) -> JevResult:
    raw = getattr(resp, "answers", None) or {}
    answers: dict[str, JevAnswer] = {}
    for name, q in questions.items():
        kind = q.get("type")
        ans = JevAnswer(kind=kind)
        a = raw.get(name) if hasattr(raw, "get") else None
        if a is not None:
            if kind == "noul":
                ans.noul = _as_float(getattr(a, "noul", None))
            elif kind == "choice":
                ans.choice = getattr(a, "choice", None)
            elif kind == "score":
                ans.score = _as_float(getattr(a, "score", None))
            ans.confidence = _as_float(getattr(a, "confidence", None))
            probs = getattr(a, "probabilities", None)
            if probs:
                try:
                    ans.probabilities = {str(k): float(v) for k, v in dict(probs).items()}
                except Exception:
                    ans.probabilities = {}
        answers[name] = ans
    return JevResult(
        answers=answers,
        model=getattr(resp, "model", None) or fallback_model,
        computed_at=_now_iso(),
    )


def _as_float(value) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None
