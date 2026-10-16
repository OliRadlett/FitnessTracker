"""Weekly plan review (C3) — one snapshot composing the existing engines.

The review answers "what changes next week?" by composing conformity, training
load, adaptive advice and goals. Each section is computed **independently** and
degrades to ``None`` on failure, so one broken engine never costs the whole
review (AGENTS.md pitfall 43 — a composite response must not read as unanimous
when a component stayed silent).

Persisted once a week by the ``weekly_plan_review`` beat task; read back by
``GET /training-plans/{id}/review``. The ``(plan_id, week_start)`` unique
constraint makes persistence idempotent.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.goal import Goal
from app.models.plan_review import PlanReviewSnapshot

logger = logging.getLogger(__name__)


def monday_of(d: date) -> date:
    """Monday of the week containing ``d`` (the review's idempotency key)."""
    return d - timedelta(days=d.weekday())


async def compute_plan_review(
    db: AsyncSession, user_id: uuid.UUID, plan_id: uuid.UUID
) -> dict:
    """Compose the weekly review payload for a plan (C3)."""
    from app.services.training_plan import _get_plan_or_none

    plan = await _get_plan_or_none(db, user_id, plan_id)
    if not plan:
        raise ValueError("Training plan not found")

    today = date.today()

    # ── Load (CTL/ATL/TSB) ────────────────────────────────────────────────
    load = None
    try:
        from app.services.cycling import training_load_for_user

        series = await training_load_for_user(db, user_id, today)
        if isinstance(series, tuple):
            series = series[0]
        if series:
            last = series[-1]
            load = {"ctl": last["ctl"], "atl": last["atl"], "tsb": last["tsb"]}
    except Exception:  # degrade, never fail the review
        logger.warning("plan review: load section failed", exc_info=True)

    # ── Conformity ────────────────────────────────────────────────────────
    conformity = None
    try:
        from app.services import conformity as conformity_service

        conf = await conformity_service.get_plan_conformity(
            db, user_id, plan_id, weeks=4
        )
        data = conf.model_dump() if hasattr(conf, "model_dump") else dict(conf)
        conformity = {
            "overall_pct": data.get("overall_pct"),
            "trend": data.get("trend"),
            "patterns": data.get("patterns", []),
        }
    except Exception:  # degrade
        logger.warning("plan review: conformity section failed", exc_info=True)

    # ── Adaptive advice (carries the one-tap apply actions) ───────────────
    adaptive = None
    try:
        from app.services.adaptive import generate_adaptive_suggestions

        adv = await generate_adaptive_suggestions(db, user_id, plan_id)
        adaptive = {
            "summary": adv.get("summary"),
            "fatigue": adv.get("fatigue"),
            "axes": [
                {
                    "key": a.get("key"),
                    "title": a.get("title"),
                    "stance": a.get("stance"),
                    "severity": a.get("severity"),
                }
                for a in adv.get("axes", [])
            ],
            "suggestions": [
                {
                    "type": s.get("type"),
                    "title": s.get("title"),
                    "detail": s.get("detail"),
                    "severity": s.get("severity"),
                    "actions": s.get("actions", []),
                }
                for s in adv.get("suggestions", [])
            ],
        }
    except Exception:  # degrade
        logger.warning("plan review: adaptive section failed", exc_info=True)

    # ── Day counts (no engine needed) ─────────────────────────────────────
    days = plan.days or []
    missed = [
        d
        for d in days
        if d.day_date < today
        and not d.completed
        and d.sport != "rest"
        and d.activity_id is None
        and d.lifting_session_id is None
    ]
    upcoming = [d for d in days if d.day_date >= today and not d.completed]

    # ── Goals ─────────────────────────────────────────────────────────────
    active_goals = 0
    try:
        res = await db.execute(
            select(Goal.id).where(Goal.user_id == user_id, Goal.status == "active")
        )
        active_goals = len(res.all())
    except Exception:  # degrade
        logger.warning("plan review: goals section failed", exc_info=True)

    return {
        "week_start": monday_of(today).isoformat(),
        "generated_at": datetime.now(UTC).isoformat(),
        "plan_name": plan.name,
        "load": load,
        "conformity": conformity,
        "adaptive": adaptive,
        "missed_days": len(missed),
        "missed_dates": [d.day_date.isoformat() for d in missed[:10]],
        "upcoming_days": len(upcoming),
        "active_goals": active_goals,
    }


async def persist_plan_review(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    payload: dict,
) -> bool:
    """Insert the snapshot for its week. Idempotent — False when one exists."""
    stmt = (
        pg_insert(PlanReviewSnapshot)
        .values(
            user_id=user_id,
            plan_id=plan_id,
            week_start=date.fromisoformat(payload["week_start"]),
            payload=payload,
        )
        .on_conflict_do_nothing(constraint="uq_plan_review_snapshots_plan_week")
        .returning(PlanReviewSnapshot.id)
    )
    res = await db.execute(stmt)
    return res.scalar_one_or_none() is not None


async def get_latest_review(
    db: AsyncSession, user_id: uuid.UUID, plan_id: uuid.UUID
) -> dict | None:
    """The most recent snapshot payload for a plan, or None."""
    res = await db.execute(
        select(PlanReviewSnapshot.payload)
        .where(
            PlanReviewSnapshot.user_id == user_id,
            PlanReviewSnapshot.plan_id == plan_id,
        )
        .order_by(PlanReviewSnapshot.week_start.desc())
        .limit(1)
    )
    return res.scalar_one_or_none()
