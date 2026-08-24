"""Training Plans API — thin router delegating to services.training_plan."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.conformity import (
    DayConformityResponse,
    LinkActivitiesResponse,
    PlanConformityResponse,
)
from app.schemas.training_plan import (
    GeneratePlanRequest,
    TrainingPlanCreate,
    TrainingPlanDayRead,
    TrainingPlanDayUpdate,
    TrainingPlanRead,
    TrainingPlanSummary,
    TrainingPlanUpdate,
    TrainingWeekResponse,
)
from app.services import conformity as conformity_service
from app.services import training_plan as plan_service
from app.services.auth import get_current_user

router = APIRouter()


def _plan_to_read(plan) -> TrainingPlanRead:
    return TrainingPlanRead.model_validate(plan)


@router.get("", response_model=list[TrainingPlanSummary])
async def list_plans(
    status_filter: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all training plans for the current user."""
    plans = await plan_service.list_plans(db, current_user.id, status_filter)
    return [
        TrainingPlanSummary(
            id=p.id,
            name=p.name,
            start_date=p.start_date,
            end_date=p.end_date,
            plan_type=p.plan_type,
            status=p.status,
            event_id=p.event_id,
            day_count=len(p.days),
            completed_days=sum(1 for d in p.days if d.completed),
        )
        for p in plans
    ]


@router.get("/{plan_id}", response_model=TrainingPlanRead)
async def get_plan(
    plan_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single training plan with all its days."""
    plan = await plan_service.get_plan(db, current_user.id, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Training plan not found")
    return _plan_to_read(plan)


@router.post("", response_model=TrainingPlanRead, status_code=status.HTTP_201_CREATED)
async def create_plan(
    data: TrainingPlanCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new training plan with optional days."""
    try:
        plan = await plan_service.create_plan(db, current_user.id, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return _plan_to_read(plan)


@router.patch("/{plan_id}", response_model=TrainingPlanRead)
async def update_plan(
    plan_id: uuid.UUID,
    data: TrainingPlanUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a training plan.

    Days, when provided, are saved non-destructively: dates are matched
    against existing days and updated in place (preserving completed flags
    and linked activities), new dates are inserted, removed dates deleted.
    """
    try:
        plan = await plan_service.update_plan(db, current_user.id, plan_id, data)
    except ValueError as e:
        detail = str(e)
        code = 404 if detail == "Training plan not found" else 400
        raise HTTPException(status_code=code, detail=detail) from e
    return _plan_to_read(plan)


@router.delete("/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plan(
    plan_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a training plan and all its days."""
    try:
        deleted = await plan_service.delete_plan(db, current_user.id, plan_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not deleted:
        raise HTTPException(status_code=404, detail="Training plan not found")


@router.get("/{plan_id}/week/{week_number}", response_model=TrainingWeekResponse)
async def get_plan_week(
    plan_id: uuid.UUID,
    week_number: int,
    include_weather: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get one Monday-based week of a plan with enrichment.

    Week 1 starts on the Monday of the week containing the plan's
    ``start_date``. Days carry weather + bad-weather badges (when within the
    forecast window), linked activity / lifting-session summaries, readiness
    (CTL/ATL/TSB) for the plan owner, and route matches on cycle days.
    """
    try:
        week = await plan_service.get_plan_week(
            db, current_user.id, plan_id, week_number, include_weather
        )
    except ValueError as e:
        detail = str(e)
        # Unknown plans and out-of-range weeks are both client 404s.
        code = 404 if "not found" in detail or "outside this plan" in detail else 400
        raise HTTPException(status_code=code, detail=detail) from e
    return week


@router.patch("/{plan_id}/days/{day_id}", response_model=TrainingPlanDayRead)
async def update_plan_day(
    plan_id: uuid.UUID,
    day_id: uuid.UUID,
    data: TrainingPlanDayUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Targeted single-day update (e.g. assign a planned route).

    Only provided fields change; ``completed`` flags and linked
    activity/lifting sessions are preserved.
    """
    try:
        day = await plan_service.update_plan_day(
            db, current_user.id, plan_id, day_id, data
        )
    except ValueError as e:
        detail = str(e)
        code = 404 if "not found" in detail else 400
        raise HTTPException(status_code=code, detail=detail) from e
    return TrainingPlanDayRead.model_validate(day)


# ── Conformity endpoints (Phase 5C) ───────────────────────────────────────


@router.get("/{plan_id}/conformity", response_model=PlanConformityResponse)
async def get_plan_conformity(
    plan_id: uuid.UUID,
    weeks: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Weekly planned-vs-actual conformity for a plan.

    ``weeks`` optionally restricts the response to the last N weeks that
    have scored days. Includes overall percentage, trend, per-week
    breakdowns (by sport) and human-readable pattern callouts.
    """
    try:
        result = await conformity_service.get_plan_conformity(
            db, current_user.id, plan_id, weeks
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return result


@router.get("/{plan_id}/days/{day_id}/conformity", response_model=DayConformityResponse)
async def get_day_conformity(
    plan_id: uuid.UUID,
    day_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Conformity score for a single training-plan day."""
    try:
        result = await conformity_service.get_day_conformity(
            db, current_user.id, plan_id, day_id
        )
    except ValueError as e:
        detail = str(e)
        code = 404 if "not found" in detail else 400
        raise HTTPException(status_code=code, detail=detail) from e
    return result


@router.post("/{plan_id}/link-activities", response_model=LinkActivitiesResponse)
async def link_plan_activities(
    plan_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Auto-link recent activities/lifting sessions to unlinked plan days.

    Cycle days match activities by calendar date (last 14 days); strength
    days match lifting sessions by date, requiring a focus match when both
    sides declare one.
    """
    try:
        linked = await conformity_service.link_activities_to_plan_days(
            db, current_user.id, plan_id
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"linked": linked}


# ── Template generation endpoint ──────────────────────────────────────────


@router.post(
    "/generate", response_model=TrainingPlanRead, status_code=status.HTTP_201_CREATED
)
async def generate_plan(
    data: GeneratePlanRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Auto-generate a mixed-week training plan from a template type.

    Weeks contain rest Sundays, Tue/Thu strength days (rotating
    squat/bench/deadlift focus) and Mon/Wed/Fri/Sat cycle rides. When
    ``event_id`` is provided the plan is linked to the event and the final
    days are tapered.
    """
    try:
        plan = await plan_service.generate_plan(db, current_user.id, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return _plan_to_read(plan)
