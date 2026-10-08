"""The unified daily verdict for ``/today`` (plan §1).

Five engines already exist and each reaches a different conclusion about what
today should be:

- ``_suggest_rest_days`` / training load  -- current CTL/ATL/TSB, recovery
- ``adaptive.generate_adaptive_suggestions`` -- stance + day actions
- ``deficiency.analyze_deficiencies`` -- which weakness is most urgent
- ``CrossDomainInsight`` -- sleep-performance / cross-sport correlations
- ``projections.compute_tsb_projection`` -- the week ahead

``/dashboard/today`` consumed only the first of those, so the other four were
computed for other pages and silently absent from the one page whose entire job
is "what should I do today". That is not a missing feature; it is one verdict
reading one input.

This service composes all five into a single verdict **with provenance**: every
engine's stance appears in ``consensus`` whether or not it has something to say,
so a disagreement is visible rather than averaged into a confident-sounding
headline.

Three decisions worth stating:

**Every engine is best-effort.** A verdict that fails because one optional
weekly job has not run yet is worse than a thinner verdict. Each engine is
wrapped independently; a failure degrades that engine's ``consensus`` row to
``available: false`` with the reason, and the verdict still renders.

**Absence is reported, not hidden.** Cross-domain previously reached ``/today``
only by not raising a 404, so its signal vanished silently - and cross-domain
is this app's actual thesis. It now appears as ``available: false`` with
"analysis runs weekly", which is honest: the user can tell "not run yet" from
"broken".

**The verdict lives in the service layer, not the API layer.** ``_suggest_rest_days``
was in ``api/dashboard/__init__.py``; composing five engines there would have put
business logic in a route module. It is imported and called, not moved, so the
legacy ``rest_day_suggestion`` field keeps working unchanged.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cross_domain import CrossDomainInsight

# How far ahead `projected_load` looks. A week is what the plan is built around
# and what the athlete can act on; a fortnight is more horizon than anyone
# reads on a daily screen.
PROJECTION_DAYS = 7

# Stances an engine can vote. Deliberately few: every extra value multiplies
# the combinations the headline logic has to reason about, and "train / cut / rest
# / add" is the whole vocabulary of a daily call.
STANCE_TRAIN = "train"
STANCE_CUT = "cut"
STANCE_REST = "rest"
STANCE_ADD = "add"


class EngineRow:
    """One engine's contribution to the verdict.

    A plain class rather than a Pydantic model because these are assembled and
    filtered in this module and serialised by the schema layer; a model here
    would be a second definition of the same shape.
    """

    __slots__ = ("analyzed_at", "available", "confidence", "engine", "note", "reason", "stance")

    def __init__(
        self,
        engine: str,
        *,
        stance: str | None = None,
        confidence: str | None = None,
        available: bool = True,
        reason: str | None = None,
        note: str | None = None,
        analyzed_at: datetime | None = None,
    ) -> None:
        self.engine = engine
        self.stance = stance
        self.confidence = confidence
        self.available = available
        self.reason = reason
        self.note = note
        self.analyzed_at = analyzed_at

    def as_dict(self) -> dict[str, Any]:
        return {
            "engine": self.engine,
            "stance": self.stance,
            "confidence": self.confidence,
            "available": self.available,
            "reason": self.reason,
            "note": self.note,
            "analyzed_at": self.analyzed_at,
        }


def _stance_from_adaptive(adaptive: dict[str, Any]) -> tuple[str, str]:
    """Reduce the adaptive engine's output to one stance plus a confidence.

    ``generate_adaptive_suggestions`` returns ``suggestions`` (a list of typed
    actions), not a single verdict. The strongest action type wins, because
    "swap in a rest day" and "add an easy spin" are not equally weighted and
    averaging them would produce a stance nobody asked for.
    """
    types = {s.get("type") for s in adaptive.get("suggestions") or []}
    severities = [
        s.get("severity") for s in adaptive.get("suggestions") or [] if s.get("severity")
    ]
    # More than one engine-level intervention is not a subtle nudge.
    confidence = "high" if severities.count("critical") else (
        "medium" if severities else "low"
    )

    if "rest_day" in types or "reduce_load" in types:
        return STANCE_CUT, confidence
    if "add_easy" in types or "add_volume" in types:
        return STANCE_ADD, confidence
    fatigue = adaptive.get("fatigue") or {}
    level = str(fatigue.get("level", "")).lower()
    if level in ("high", "very_high", "severe"):
        return STANCE_CUT, confidence or "low"
    return STANCE_TRAIN, confidence or "low"


def _deficiency_row(deficiency: Any) -> EngineRow:
    """Vote on the most severe weakness.

    Only ``critical``/``high`` severities move the needle. An athlete with three
    low-severity imbalances does not need to rest; that is a body-comp
    consideration, and treating it as a training-load signal would make the
    verdict flail.
    """
    weaknesses = getattr(deficiency, "weaknesses", None) or []
    ranked = sorted(
        (w for w in weaknesses if getattr(w, "severity", None) in ("critical", "high")),
        key=lambda w: 0 if w.severity == "critical" else 1,
    )
    if not ranked:
        return EngineRow(
            "deficiency",
            stance=STANCE_TRAIN,
            confidence="low",
            available=True,
            reason="no critical or high weaknesses",
        )
    top = ranked[0]
    note = getattr(top, "detail", None) or f"{top.severity} {top.category}"
    return EngineRow(
        "deficiency",
        stance=STANCE_CUT if top.severity == "critical" else STANCE_TRAIN,
        confidence="high" if top.severity == "critical" else "medium",
        available=True,
        note=note,
        analyzed_at=getattr(deficiency, "computed_at", None),
    )


async def _cross_domain_row(db: AsyncSession, user_id: uuid.UUID) -> EngineRow:
    """Cross-domain presence, read as data rather than as an exception.

    The API endpoint raises 404 when there is nothing, which is why this signal
    used to disappear from ``/today`` entirely. Here the absence is the finding:
    "not run yet" is information, and it is reported with the same prominence as
    a real result so the user can tell a scheduled gap from a failure.

    F3 lock: ``combined_load`` from the cross-domain analysis is exploratory
    and insights-only (see ``integrations/cross_domain.py``) — this row
    deliberately reads presence/metadata only and never feeds
    ``combined_load`` into the stance. The verdict must stay independent of
    the unvalidated unified-load heuristic.
    """
    result = await db.execute(
        select(CrossDomainInsight)
        .where(CrossDomainInsight.user_id == user_id)
        .order_by(desc(CrossDomainInsight.created_at))
        .limit(1)
    )
    latest = result.scalar_one_or_none()
    if latest is None:
        return EngineRow(
            "cross_domain",
            available=False,
            reason="no analysis yet; runs weekly on Sundays",
        )
    return EngineRow(
        "cross_domain",
        stance=STANCE_TRAIN,
        confidence="low",
        available=True,
        note=f"latest {getattr(latest, 'insight_type', 'insight')}",
        analyzed_at=latest.created_at,
    )


def _projection_row(
    projection: dict[str, Any] | None, error: str | None
) -> EngineRow:
    if error is not None:
        return EngineRow("projection", available=False, reason=error)
    if projection is None:
        return EngineRow(
            "projection",
            available=False,
            reason="no active plan to project against",
        )
    points = projection.get("points") or projection.get("projection") or []
    return EngineRow(
        "projection",
        stance=STANCE_TRAIN,
        confidence="medium" if points else "low",
        available=bool(points),
        reason=None if points else "plan has no future sessions in the window",
        analyzed_at=datetime.now().astimezone(),
    )


def _headline(should_rest: bool, consensus: list[EngineRow]) -> str:
    """One sentence, driven by whichever engine actually voted.

    The headline names the winning engine rather than averaging the consensus
    into something no engine said. An averaged headline is the failure mode this
    whole section is about: it reads confident and nobody can act on it.
    """
    if not should_rest:
        return "Go ahead with today's plan."
    rest_voters = [r for r in consensus if r.available and r.stance in (STANCE_REST, STANCE_CUT)]
    if not rest_voters:
        return "Take it easy today."
    lead = rest_voters[0]
    labels = {
        "recovery": "recovery is low",
        "tsb": "you are overreached",
        "consecutive_days": "you have trained several days running",
        "alert": "an active health alert says so",
        "scheduled_rest": "today is a scheduled rest day",
        "rest_day_suggestion": "training load says rest",
        "adaptive": "the adaptive engine says cut back",
        "deficiency": "there is a critical weakness to address",
    }
    why = labels.get(lead.engine, f"{lead.engine} says rest")
    return f"Take it easy — {why}."


async def compute_today_verdict(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    rest_day_suggestion: Any = None,
    plan_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Compose all five engines into one verdict. Never raises.

    ``rest_day_suggestion`` is passed in rather than computed here because
    ``/dashboard/today`` already computes it and caching that value is the
    difference between one load query and two.
    """
    consensus: list[EngineRow] = []

    # 1. The existing rest-day signal: current load, recovery, streak.
    if rest_day_suggestion is not None:
        should_rest = bool(getattr(rest_day_suggestion, "should_rest", False))
        reasons = list(getattr(rest_day_suggestion, "reasons", []) or [])
        recovery = getattr(rest_day_suggestion, "latest_recovery", None)
        tsb = getattr(rest_day_suggestion, "current_tsb", None)
        confidence = "high" if (recovery is not None and recovery < 40) else "medium"
        consensus.append(
            EngineRow(
                "rest_day_suggestion",
                stance=STANCE_REST if should_rest else STANCE_TRAIN,
                confidence=confidence if should_rest else "low",
                available=True,
                note=reasons[0] if reasons else None,
            )
        )
        if tsb is not None and tsb <= -25:
            consensus.append(
                EngineRow(
                    "tsb",
                    stance=STANCE_CUT,
                    confidence="high",
                    available=True,
                    note=f"TSB {tsb:.0f}",
                )
            )
    else:
        should_rest = False
        reasons = []
        # Still emit the row. "This engine had no input" is not the same as
        # "this engine had nothing to say", and emitting nothing for it is
        # exactly the silence-that-reads-as-agreement this module exists to
        # remove — the consensus would show four engines and look unanimous.
        consensus.append(
            EngineRow(
                "rest_day_suggestion",
                available=False,
                reason="rest-day signal not computed",
            )
        )

    # 2. Adaptive engine. Requires an active plan; raises ValueError otherwise,
    #    which is a "not applicable", not a failure.
    try:
        from app.services.adaptive import generate_adaptive_suggestions

        adaptive = await generate_adaptive_suggestions(db, user_id, plan_id)
        stance, confidence = _stance_from_adaptive(adaptive)
        consensus.append(
            EngineRow(
                "adaptive",
                stance=stance,
                confidence=confidence,
                available=True,
                note=(adaptive.get("summary") or "")[:160] or None,
            )
        )
    except Exception as exc:
        consensus.append(
            EngineRow("adaptive", available=False, reason=f"{type(exc).__name__}: {exc}")
        )

    # 3. Deficiency.
    try:
        from app.services.deficiency import analyze_deficiencies

        consensus.append(_deficiency_row(await analyze_deficiencies(db, user_id)))
    except Exception as exc:
        consensus.append(
            EngineRow("deficiency", available=False, reason=f"{type(exc).__name__}: {exc}")
        )

    # 4. Cross-domain.
    try:
        consensus.append(await _cross_domain_row(db, user_id))
    except Exception as exc:
        consensus.append(
            EngineRow("cross_domain", available=False, reason=f"{type(exc).__name__}: {exc}")
        )

    # 5. Forward projection. Only meaningful with a plan; without one this is
    #    "not applicable" rather than a degraded verdict.
    projected: list[dict[str, Any]] = []
    projection_error: str | None = None
    if plan_id is None:
        projection_error = "no active plan"
    else:
        try:
            from app.services.projections import compute_tsb_projection

            projection = await compute_tsb_projection(
                db, user_id, plan_id, days_ahead=PROJECTION_DAYS
            )
            projected = list(projection.get("points") or projection.get("projection") or [])
        except Exception as exc:
            projection_error = f"{type(exc).__name__}: {exc}"
    consensus.append(_projection_row(projection if not projection_error else None, projection_error))

    # The verdict follows the strongest rest signal, not the average: a verdict
    # that averages "train" against "rest" produces "train, but..." and the
    # athlete acts on the first word.
    strong_rest = [
        r
        for r in consensus
        if r.available and r.stance in (STANCE_REST, STANCE_CUT) and r.confidence in ("high", "medium")
    ]
    should_rest = should_rest or bool(strong_rest)

    if not reasons and should_rest:
        reasons = [
            r.note or f"{r.engine} recommends resting"
            for r in strong_rest
            if r.note
        ]

    return {
        "should_rest": should_rest,
        "headline": _headline(should_rest, consensus),
        "reasons": reasons,
        "consensus": [row.as_dict() for row in consensus],
        "projected_load": projected,
    }