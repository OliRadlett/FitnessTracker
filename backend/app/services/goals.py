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


def alignment_pct(
    goal: Goal, current: float, today: date, deload_days: int = 0
) -> float | None:
    """On-track score: (progress / elapsed) × 100, clamped to 0–200.

    - progress is sign-aware: works for both increase and decrease goals
    - None when there is no target_date, no starting_value, or elapsed <= 0
    - *deload_days* are excluded from elapsed time (P2 deload-aware
      progress): programmed recovery is not schedule the athlete was meant
      to progress on, so counting those days burns alignment for resting
      correctly.
    """
    if goal.target_date is None or goal.starting_value is None:
        return None
    if goal.created_at is None:
        return None

    # ``created_at`` is stored timezone-aware (UTC); convert to the host
    # frame so it lines up with the caller-supplied ``today`` (local).
    # Comparing raw UTC against a local ``date.today()`` made day zero last
    # an extra hour past local midnight (or skip it entirely), flipping
    # alignment between None and 0.0.
    created_at = (
        goal.created_at.astimezone()
        if goal.created_at.tzinfo
        else goal.created_at
    )
    created = created_at.date()
    total_span = (goal.target_date - created).days
    elapsed = (today - created).days - max(0, deload_days)
    if total_span <= 0 or elapsed <= 0:
        return None

    target_delta = goal.target_value - goal.starting_value
    if target_delta == 0:
        return None

    progress = (current - goal.starting_value) / target_delta
    raw = (progress / elapsed) * total_span * 100
    return round(max(0.0, min(200.0, raw)), 1)


# ── Trajectory verdict + due notices (P2 divergence unification) ──────────


def trajectory_verdict(
    status: str | None,
    badge: str | None,
    alignment: float | None,
) -> str:
    """One canonical trajectory word for a goal (P2 divergence unification).

    Status, projection badge, and alignment previously answered "how is this
    goal doing" three different ways in three different places (API
    enrichment, ``goalDisplayBadge`` precedence, adaptive off-pace badges).
    This is the single precedence every consumer should read:

    - terminal statuses report themselves (``achieved``/``abandoned``/``expired``)
    - an ungated projection badge wins (``On Track``→``on_track``,
      ``At Risk``→``behind``, ``Unlikely``→``off_track``) — the regression
      answers "will I hit it", alignment only "am I ahead of schedule"
    - otherwise the alignment cut points (``ahead`` ≥100, ``on_track`` ≥85,
      ``behind`` >0, ``off_track`` at/below 0), matching the card labels
    - ``unknown`` when there is nothing to read from

    Adaptive off-pace stays badge-gated deliberately (``GOAL_OFF_PACE_BADGES``)
    — promoting alignment-``behind`` into training ease-off is a coaching
    decision for the science review (t4), not this change.
    """
    if status in ("achieved", "abandoned", "expired"):
        return status
    if badge and badge != "Not enough data":
        if badge == "On Track":
            return "on_track"
        if badge == "At Risk":
            return "behind"
        return "off_track"
    if alignment is None:
        return "unknown"
    if alignment >= 100:
        return "ahead"
    if alignment >= 85:
        return "on_track"
    if alignment > 0:
        return "behind"
    return "off_track"


#: Target-date reminder windows: days-left → notice label. Fired from the
#: weekly check-ins task via ``goal_due_notice``; notification type stays
#: ``goal_milestone`` (no new opt-in type, no frontend change).
GOAL_DUE_WINDOWS: dict[int, str] = {
    7: "due in 7 days",
    1: "due tomorrow",
}


def goal_due_notice(days_left: int) -> str | None:
    """Notice label when *days_left* hits a reminder window, else None."""
    return GOAL_DUE_WINDOWS.get(days_left)


# ── State computation ────────────────────────────────────────────────────────


async def compute_goal_state(
    db: AsyncSession,
    user_id: uuid.UUID,
    goal: Goal,
    today: date | None = None,
    deload_weeks: set[date] | None = None,
) -> dict | None:
    """Resolve the metric's current value and refresh cached goal state.

    Updates ``current_value``, lazily backfills ``starting_value`` (None after
    migration or unresolvable data at creation), and runs the uniform status
    transition.  Alignment excludes deload days (P2 deload-aware progress);
    pass a precomputed *deload_weeks* set to share one detection across a
    goal list, otherwise it is detected per goal (fail-open: errors mean
    zero deload days).  Returns enrichment info (direction/alignment) or None
    when the metric could not be resolved.
    """
    from app.services.goal_deload import deload_days_in_range, deload_week_starts

    today = today or date.today()
    current = await resolve_metric(db, user_id, goal.metric, goal.filter_json)

    if current is not None:
        goal.current_value = current
        # Lazy starting_value backfill — first successful resolution becomes
        # the trajectory origin (legacy rows migrate with NULL here).
        if goal.starting_value is None:
            goal.starting_value = current

    update_goal_status(goal, today, current)

    deload_days = 0
    if goal.created_at is not None and goal.target_date is not None:
        created = (
            goal.created_at.astimezone()
            if goal.created_at.tzinfo
            else goal.created_at
        ).date()
        if deload_weeks is None:
            deload_weeks = await deload_week_starts(db, user_id, created, today)
        deload_days = deload_days_in_range(deload_weeks, created, today)

    direction = derive_direction(goal)
    alignment = (
        alignment_pct(goal, goal.current_value, today, deload_days)
        if goal.current_value is not None
        else None
    )
    return {
        "current": current,
        "direction": direction,
        "alignment_pct": alignment,
        "deload_days": deload_days,
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
