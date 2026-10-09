"""Goals API — thin CRUD over the semantic-goals service layer (Phase 6).

Status transitions run uniformly through ``services.goals.update_goal_status``
on every read/write path — there is no GET-list side effect any more.
"""

from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.goal import Goal
from app.models.user import User
from app.schemas.goal import (
    GoalCheckInCreate,
    GoalCheckInRead,
    GoalCreate,
    GoalEnriched,
    GoalRead,
    GoalTemplatesResponse,
    GoalUpdate,
    MetricInfo,
    ReactivateResponse,
)
from app.services.auth import get_current_user
from app.services.goal_metrics import (
    METRIC_REGISTRY,
    list_metrics,
    validate_metric_filters,
)
from app.services.goals import (
    alignment_pct,
    compute_goal_state,
    derive_direction,
    list_check_ins,
    reactivate_goal,
    record_manual_check_in,
    trajectory_verdict,
)

router = APIRouter()

VALID_STATUSES = {"active", "achieved", "expired", "abandoned"}


def _enrich(goal: Goal, state: dict | None, today: date) -> GoalEnriched:
    """Build the enriched read model (direction/alignment/progress/units)."""
    direction = state["direction"] if state else derive_direction(goal)
    current = goal.current_value

    progress_pct: float | None = None
    if current is not None and goal.starting_value is not None:
        span = goal.target_value - goal.starting_value
        if span != 0:
            progress_pct = round(
                max(0.0, min(100.0, (current - goal.starting_value) / span * 100)), 1
            )
        # Degenerate trajectory (goal just created or starting_value lazily
        # backfilled to current → progress 0% next to "465 / 500" text looks
        # broken). For increase goals fall back to absolute attainment so the
        # bar matches the displayed current/target numbers (0.2).
        if (
            (progress_pct is None or progress_pct == 0)
            and span > 0
            and goal.target_value > 0
        ):
            progress_pct = round(min(100.0, current / goal.target_value * 100), 1)

    definition = METRIC_REGISTRY.get(goal.metric)
    enriched = GoalEnriched.model_validate(goal)
    enriched.direction = direction
    enriched.alignment_pct = state["alignment_pct"] if state else None
    if enriched.alignment_pct is None and current is not None:
        enriched.alignment_pct = alignment_pct(goal, current, today)
    enriched.progress_pct = progress_pct
    enriched.metric_label = definition.label if definition else None
    enriched.metric_unit = definition.unit if definition else None
    # P2 divergence unification: one canonical trajectory word (no badge on
    # this path, so the verdict falls back to status + alignment).
    enriched.trajectory_verdict = trajectory_verdict(
        goal.status, None, enriched.alignment_pct
    )
    return enriched


async def _get_owned_goal(goal_id: uuid.UUID, db: AsyncSession, user: User) -> Goal:
    result = await db.execute(
        select(Goal).where(Goal.id == goal_id, Goal.user_id == user.id)
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    return goal


# ── Metrics registry (registered before /{goal_id} routes) ───────────────────


@router.get("/metrics", response_model=list[MetricInfo])
async def get_metrics(
    _current_user: User = Depends(get_current_user),
):
    """List all available semantic metrics — drives dynamic goal forms."""
    return [MetricInfo(**m) for m in list_metrics()]


@router.get("/templates", response_model=GoalTemplatesResponse)
async def get_templates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Personalised male-only goal starters (plate milestones, BW-ratio
    standards, Big-3 clubs). Each template carries a ``create_payload``
    that POSTs straight to ``POST /goals``."""
    from app.services.goal_templates import get_goal_templates

    return await get_goal_templates(db, current_user.id)


# ── CRUD ─────────────────────────────────────────────────────────────────────


@router.get("", response_model=list[GoalEnriched])
async def list_goals(
    status_filter: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List goals for the current user with refreshed state + enrichment."""
    today = date.today()
    query = select(Goal).where(Goal.user_id == current_user.id)
    if status_filter:
        if status_filter not in VALID_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status_filter. Must be one of: "
                f"{', '.join(sorted(VALID_STATUSES))}",
            )
        query = query.where(Goal.status == status_filter)
    query = query.order_by(Goal.created_at.desc())
    result = await db.execute(query)
    goals = list(result.scalars().all())

    enriched = []
    for goal in goals:
        state = await compute_goal_state(db, current_user.id, goal, today)
        enriched.append(_enrich(goal, state, today))

    # get_db handles commit; flush keeps transitions within the request txn
    await db.flush()
    return enriched


@router.post("", response_model=GoalEnriched, status_code=status.HTTP_201_CREATED)
async def create_goal(
    data: GoalCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a goal against a semantic metric; snapshots starting_value."""
    error = validate_metric_filters(data.metric, data.filter_json)
    if error:
        raise HTTPException(status_code=400, detail=error)

    goal = Goal(
        user_id=current_user.id,
        metric=data.metric,
        filter_json=data.filter_json,
        target_value=data.target_value,
        target_date=data.target_date,
        notes=data.notes,
        status="active",
    )
    db.add(goal)
    await db.flush()

    # Resolve + snapshot starting_value at creation time
    today = date.today()
    await compute_goal_state(db, current_user.id, goal, today)

    await db.flush()
    await db.refresh(goal)
    return _enrich(goal, None, today)


@router.get("/{goal_id}", response_model=GoalEnriched)
async def get_goal(
    goal_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today = date.today()
    goal = await _get_owned_goal(goal_id, db, current_user)
    state = await compute_goal_state(db, current_user.id, goal, today)
    await db.flush()
    await db.refresh(goal)
    return _enrich(goal, state, today)


@router.patch("/{goal_id}", response_model=GoalEnriched)
async def update_goal(
    goal_id: uuid.UUID,
    data: GoalUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today = date.today()
    goal = await _get_owned_goal(goal_id, db, current_user)

    updates = data.model_dump(exclude_unset=True)
    if "metric" in updates and updates["metric"] not in METRIC_REGISTRY:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown metric {updates['metric']!r}. Must be one of: "
            f"{', '.join(METRIC_REGISTRY)}",
        )

    # Status machine guard: achieved is sticky and abandoned is terminal, so
    # PATCH must not resurrect them (or revive an expired goal) directly —
    # that path would bypass reactivate_goal's re-baseline and re-expiry
    # suppression. Use POST /{goal_id}/reactivate instead. The only manual
    # transition PATCH allows is giving up: active/expired → abandoned.
    if "status" in updates and updates["status"] != goal.status:
        new_status = updates["status"]
        if new_status == "active" or goal.status in ("achieved", "abandoned"):
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Cannot move goal from {goal.status!r} to {new_status!r} "
                    "via PATCH — use POST /{goal_id}/reactivate"
                    if new_status == "active" or goal.status == "abandoned"
                    else f"Cannot move goal from {goal.status!r} to "
                    f"{new_status!r} via PATCH (achieved is sticky)"
                ),
            )
        if new_status != "abandoned":
            raise HTTPException(
                status_code=409,
                detail=f"Cannot move goal from {goal.status!r} to {new_status!r} via PATCH",
            )

    metric_changed = {"metric", "filter_json"} & updates.keys()

    for field, value in updates.items():
        setattr(goal, field, value)

    # Revalidate filters after a metric/filter change
    if metric_changed:
        error = validate_metric_filters(goal.metric, goal.filter_json)
        if error:
            raise HTTPException(status_code=400, detail=error)
        # A new metric/filter needs a new trajectory origin — otherwise
        # progress/alignment would be measured from the old metric's
        # starting_value. NULL re-arms the lazy backfill in
        # compute_goal_state below.
        goal.starting_value = None

    await compute_goal_state(db, current_user.id, goal, today)
    await db.flush()
    await db.refresh(goal)
    return _enrich(goal, None, today)


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_goal(
    goal_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    goal = await _get_owned_goal(goal_id, db, current_user)
    await db.delete(goal)
    await db.flush()


# ── Check-ins ────────────────────────────────────────────────────────────────


@router.post(
    "/{goal_id}/checkins",
    response_model=GoalCheckInRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_check_in(
    goal_id: uuid.UUID,
    data: GoalCheckInCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Record a manual check-in (value + optional note)."""
    try:
        check_in = await record_manual_check_in(
            db, current_user.id, goal_id, data.value, data.note
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await db.flush()
    return GoalCheckInRead.model_validate(check_in)


@router.get("/{goal_id}/checkins", response_model=list[GoalCheckInRead])
async def get_check_ins(
    goal_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Check-in history for a goal, oldest first."""
    await _get_owned_goal(goal_id, db, current_user)
    check_ins = await list_check_ins(db, current_user.id, goal_id)
    return [GoalCheckInRead.model_validate(c) for c in check_ins]


# ── Lifecycle ────────────────────────────────────────────────────────────────


@router.post("/{goal_id}/reactivate", response_model=ReactivateResponse)
async def reactivate(
    goal_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Bring an expired/abandoned goal back to active and recompute state."""
    try:
        goal = await reactivate_goal(db, current_user.id, goal_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return ReactivateResponse(
        id=goal.id, status=goal.status, message="Goal reactivated"
    )
