"""Goals service — semantic goal state computation, transitions, and check-ins.

Phase 6: replaces the old hard-coded ``goal_type`` switch with a semantic
metric registry (services/goal_metrics.py).  Goal direction is *derived*
(starting_value vs target_value) rather than stored, and status transitions
run uniformly through :func:`update_goal_status` instead of GET-side effects.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.goal import Goal, GoalCheckIn
from app.services.goal_metrics import METRIC_REGISTRY, resolve_metric

logger = logging.getLogger(__name__)


# ── Direction / status / alignment (pure helpers) ────────────────────────────


def derive_direction(goal: Goal) -> str | None:
    """Derive goal direction without a column.

    ``decrease`` when the start was above the target (e.g. weight loss),
    ``increase`` otherwise.  Returns None when neither starting_value nor a
    resolvable metric default is available.
    """
    if goal.starting_value is not None:
        return "decrease" if goal.starting_value > goal.target_value else "increase"
    definition = METRIC_REGISTRY.get(goal.metric)
    if definition is not None:
        return definition.default_direction
    return None


def update_goal_status(
    goal: Goal,
    today: date,
    current: float | None = None,
    allow_expire: bool = True,
) -> None:
    """Uniform status transition — called on every read/write path.

    - achieved: crossed the target per derived direction (increase: >=,
      decrease: <=)
    - expired: past target_date and not achieved
    - NEVER auto-transitions away from ``abandoned``
    """
    if goal.status == "abandoned":
        return

    if goal.status != "achieved":
        direction = derive_direction(goal)
        value = current if current is not None else goal.current_value
        if value is not None:
            if direction == "decrease":
                if value <= goal.target_value:
                    goal.status = "achieved"
            elif value >= goal.target_value:
                goal.status = "achieved"

    if (
        allow_expire
        and goal.status == "active"
        and goal.target_date is not None
        and today > goal.target_date
    ):
        goal.status = "expired"


def alignment_pct(goal: Goal, current: float, today: date) -> float | None:
    """On-track score: (progress / elapsed) × 100, clamped to 0–200.

    - progress is sign-aware: works for both increase and decrease goals
    - None when there is no target_date, no starting_value, or elapsed <= 0
    """
    if goal.target_date is None or goal.starting_value is None:
        return None
    if goal.created_at is None:
        return None

    created = goal.created_at.date()
    total_span = (goal.target_date - created).days
    elapsed = (today - created).days
    if total_span <= 0 or elapsed <= 0:
        return None

    target_delta = goal.target_value - goal.starting_value
    if target_delta == 0:
        return None

    progress = (current - goal.starting_value) / target_delta
    raw = (progress / elapsed) * total_span * 100
    return round(max(0.0, min(200.0, raw)), 1)


# ── State computation ────────────────────────────────────────────────────────


async def compute_goal_state(
    db: AsyncSession, user_id: uuid.UUID, goal: Goal, today: date | None = None
) -> dict | None:
    """Resolve the metric's current value and refresh cached goal state.

    Updates ``current_value``, lazily backfills ``starting_value`` (None after
    migration or unresolvable data at creation), and runs the uniform status
    transition.  Returns enrichment info (direction/alignment) or None when
    the metric could not be resolved.
    """
    today = today or date.today()
    current = await resolve_metric(db, user_id, goal.metric, goal.filter_json)

    if current is not None:
        goal.current_value = current
        # Lazy starting_value backfill — first successful resolution becomes
        # the trajectory origin (legacy rows migrate with NULL here).
        if goal.starting_value is None:
            goal.starting_value = current

    update_goal_status(goal, today, current)

    direction = derive_direction(goal)
    alignment = (
        alignment_pct(goal, goal.current_value, today)
        if goal.current_value is not None
        else None
    )
    return {
        "current": current,
        "direction": direction,
        "alignment_pct": alignment,
    }


# ── Check-ins ────────────────────────────────────────────────────────────────


async def record_manual_check_in(
    db: AsyncSession,
    user_id: uuid.UUID,
    goal_id: uuid.UUID,
    value: float,
    note: str | None = None,
    today: date | None = None,
) -> GoalCheckIn:
    """Record a manual check-in against a goal owned by *user_id*.

    Also updates the goal's cached current_value and re-runs the status
    transition so a manual reading can achieve a goal immediately.
    """
    result = await db.execute(
        select(Goal).where(Goal.id == goal_id, Goal.user_id == user_id)
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise LookupError("Goal not found")

    today = today or date.today()
    check_in = GoalCheckIn(
        user_id=user_id,
        goal_id=goal.id,
        check_in_date=today,
        value=value,
        alignment_pct=alignment_pct(goal, value, today),
        note=note,
        source="manual",
    )
    db.add(check_in)

    goal.current_value = value
    update_goal_status(goal, today, value)
    await db.flush()
    await db.refresh(check_in)
    return check_in


async def list_check_ins(
    db: AsyncSession, user_id: uuid.UUID, goal_id: uuid.UUID
) -> list[GoalCheckIn]:
    """Check-in history for a goal, oldest first."""
    result = await db.execute(
        select(GoalCheckIn)
        .where(GoalCheckIn.user_id == user_id, GoalCheckIn.goal_id == goal_id)
        .order_by(GoalCheckIn.check_in_date.asc(), GoalCheckIn.created_at.asc())
    )
    return list(result.scalars().all())


async def record_all_check_ins(
    db: AsyncSession, user_id: uuid.UUID, today: date | None = None
) -> int:
    """Snapshot every ACTIVE goal (celery-facing weekly check-in).

    Skips goals that already have a check-in for today.  Returns the number of
    check-ins recorded.
    """
    today = today or date.today()
    result = await db.execute(
        select(Goal).where(Goal.user_id == user_id, Goal.status == "active")
    )
    goals = list(result.scalars().all())

    recorded = 0
    for goal in goals:
        existing = await db.execute(
            select(GoalCheckIn.id).where(
                GoalCheckIn.goal_id == goal.id,
                GoalCheckIn.check_in_date == today,
            )
        )
        if existing.scalar_one_or_none() is not None:
            continue

        try:
            state = await compute_goal_state(db, user_id, goal, today)
        except Exception:
            logger.warning(
                "Metric resolution failed for goal %s (%s)",
                goal.id,
                goal.metric,
                exc_info=True,
            )
            continue

        if state is None or state["current"] is None:
            continue

        db.add(
            GoalCheckIn(
                user_id=user_id,
                goal_id=goal.id,
                check_in_date=today,
                value=state["current"],
                alignment_pct=state["alignment_pct"],
                source="auto",
            )
        )
        recorded += 1

    await db.flush()
    return recorded


async def reactivate_goal(
    db: AsyncSession, user_id: uuid.UUID, goal_id: uuid.UUID, today: date | None = None
) -> Goal:
    """Bring an expired goal back to active and recompute its state.

    Expiry is suppressed on the recomputation so a goal whose target_date is
    already in the past doesn't instantly flip back to expired — the user is
    expected to move the target date (or the metric may achieve it outright).
    """
    result = await db.execute(
        select(Goal).where(Goal.id == goal_id, Goal.user_id == user_id)
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise LookupError("Goal not found")
    if goal.status not in ("expired", "abandoned"):
        raise ValueError(
            f"Goal status is {goal.status!r} — only expired/abandoned "
            "goals can be reactivated"
        )

    goal.status = "active"
    current = await resolve_metric(db, user_id, goal.metric, goal.filter_json)
    if current is not None:
        goal.current_value = current
        if goal.starting_value is None:
            goal.starting_value = current
    update_goal_status(goal, today or date.today(), current, allow_expire=False)
    await db.flush()
    await db.refresh(goal)
    return goal
