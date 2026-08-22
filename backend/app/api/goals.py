"""Goals API — CRUD for training goals with progress computation."""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.activity import Activity
from app.models.cycling import CyclingProfile
from app.models.goal import Goal
from app.models.lifting import LiftingSession, PersonalRecord
from app.models.user import User
from app.models.weight import WeightLog
from app.schemas.goal import GoalCreate, GoalRead, GoalUpdate
from app.services.auth import get_current_user

router = APIRouter()

# Supported goal types and how to compute current_value
GOAL_TYPES = {
    "ftp_target",
    "weight_target",
    "weekly_sessions",
    "1rm_target",
    "distance_target",
}


async def _compute_current_value(
    db: AsyncSession, user_id: uuid.UUID, goal: Goal
) -> float | None:
    """Compute the current value for a goal based on its type."""
    today = date.today()

    if goal.goal_type == "ftp_target":
        result = await db.execute(
            select(CyclingProfile.ftp_watts).where(CyclingProfile.user_id == user_id)
        )
        ftp = result.scalar_one_or_none()
        return float(ftp) if ftp else None

    elif goal.goal_type == "weight_target":
        result = await db.execute(
            select(WeightLog.weight_kilogram)
            .where(WeightLog.user_id == user_id)
            .order_by(WeightLog.date.desc())
            .limit(1)
        )
        weight = result.scalar_one_or_none()
        return float(weight) if weight else None

    elif goal.goal_type == "weekly_sessions":
        # Count sessions in the last 7 days (lifting + cardio)
        from datetime import timedelta

        week_ago = today - timedelta(days=7)
        result = await db.execute(
            select(LiftingSession.id).where(
                LiftingSession.user_id == user_id,
                LiftingSession.session_date >= week_ago,
            )
        )
        lifting_count = len(result.scalars().all())

        result = await db.execute(
            select(Activity.id).where(
                Activity.user_id == user_id,
                Activity.start_date >= week_ago,
                Activity.source != "wahoo",
            )
        )
        activity_count = len(result.scalars().all())

        return float(lifting_count + activity_count)

    elif goal.goal_type == "1rm_target":
        # Use notes field to store exercise name for 1rm targets
        exercise_name = goal.notes
        if not exercise_name:
            return None
        result = await db.execute(
            select(PersonalRecord.estimated_1rm)
            .where(
                PersonalRecord.user_id == user_id,
                PersonalRecord.exercise_name == exercise_name,
                PersonalRecord.record_type == "1rm",
            )
            .order_by(PersonalRecord.estimated_1rm.desc())
            .limit(1)
        )
        best = result.scalar_one_or_none()
        return float(best) if best else None

    elif goal.goal_type == "distance_target":
        # Total distance this month (km converted to the target unit)
        from datetime import timedelta

        month_start = today.replace(day=1)
        result = await db.execute(
            select(Activity.distance_meters).where(
                Activity.user_id == user_id,
                Activity.source != "wahoo",
                Activity.start_date >= month_start,
            )
        )
        distances = result.scalars().all()
        total_km = sum((d or 0) for d in distances) / 1000
        return round(total_km, 1)

    return None


@router.get("", response_model=list[GoalRead])
async def list_goals(
    status_filter: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all goals for the current user, optionally filtered by status."""
    query = select(Goal).where(Goal.user_id == current_user.id)
    if status_filter:
        query = query.where(Goal.status == status_filter)
    query = query.order_by(Goal.created_at.desc())
    result = await db.execute(query)
    goals = list(result.scalars().all())

    # Auto-update current values
    for goal in goals:
        current = await _compute_current_value(db, current_user.id, goal)
        if current is not None:
            goal.current_value = current
            # Auto-mark as achieved
            if goal.status == "active" and current >= goal.target_value:
                goal.status = "achieved"
            # Auto-expire if past target date
            if (
                goal.target_date
                and goal.status == "active"
                and date.today() > goal.target_date
            ):
                if current < goal.target_value:
                    goal.status = "expired"

    await db.flush()
    for g in goals:
        await db.refresh(g)
    return [GoalRead.model_validate(g) for g in goals]


@router.post("", response_model=GoalRead, status_code=status.HTTP_201_CREATED)
async def create_goal(
    data: GoalCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new training goal."""
    if data.goal_type not in GOAL_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid goal_type. Must be one of: {', '.join(GOAL_TYPES)}",
        )

    goal = Goal(
        user_id=current_user.id,
        goal_type=data.goal_type,
        target_value=data.target_value,
        current_value=data.current_value,
        target_date=data.target_date,
        notes=data.notes,
    )
    db.add(goal)
    await db.flush()

    # Compute initial current value
    current = await _compute_current_value(db, current_user.id, goal)
    if current is not None:
        goal.current_value = current

    await db.flush()
    # Refresh to load server-default columns (created_at, updated_at, status)
    # before Pydantic validation — avoids MissingGreenlet lazy-load error.
    await db.refresh(goal)
    return GoalRead.model_validate(goal)


@router.get("/{goal_id}", response_model=GoalRead)
async def get_goal(
    goal_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Goal).where(Goal.id == goal_id, Goal.user_id == current_user.id)
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    # Refresh current value
    current = await _compute_current_value(db, current_user.id, goal)
    if current is not None:
        goal.current_value = current

    await db.flush()
    await db.refresh(goal)
    return GoalRead.model_validate(goal)


@router.patch("/{goal_id}", response_model=GoalRead)
async def update_goal(
    goal_id: uuid.UUID,
    data: GoalUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Goal).where(Goal.id == goal_id, Goal.user_id == current_user.id)
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    update_data = data.model_dump(exclude_unset=True)
    if "goal_type" in update_data and update_data["goal_type"] not in GOAL_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid goal_type. Must be one of: {', '.join(GOAL_TYPES)}",
        )

    for field, value in update_data.items():
        setattr(goal, field, value)

    await db.flush()
    await db.refresh(goal)
    return GoalRead.model_validate(goal)


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_goal(
    goal_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Goal).where(Goal.id == goal_id, Goal.user_id == current_user.id)
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    await db.delete(goal)
    await db.flush()
