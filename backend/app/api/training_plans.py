"""Training Plans API — thin router delegating to services.training_plan."""

import uuid
from datetime import date

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
    days match lifting sessions by date, blocked only when both sides
    declare focus vocabularies mapping to disjoint compatibility groups.
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


# ── Copy endpoints ────────────────────────────────────────────────────────


@router.post(
    "/{plan_id}/days/{day_id}/copy-from-session/{session_id}",
    response_model=TrainingPlanDayRead,
)
async def copy_from_session(
    plan_id: uuid.UUID,
    day_id: uuid.UUID,
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Copy exercises from a past lifting session into a training plan day.

    Groups non-warmup sets by exercise and populates planned_exercises.
    Sets planned_focus from the session if the day doesn't have one.
    """
    try:
        day = await plan_service.copy_session_to_plan_day(
            db, current_user.id, plan_id, day_id, session_id
        )
    except ValueError as e:
        detail = str(e)
        code = 404 if "not found" in detail else 400
        raise HTTPException(status_code=code, detail=detail) from e
    return TrainingPlanDayRead.model_validate(day)


@router.post(
    "/{plan_id}/days/{source_day_id}/copy-to-date/{target_date}",
    response_model=TrainingPlanDayRead,
    status_code=status.HTTP_201_CREATED,
)
async def copy_day_to_date(
    plan_id: uuid.UUID,
    source_day_id: uuid.UUID,
    target_date: date,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Copy a plan day's exercises to a new date within the same plan.

    Creates a new day at the target date with the same planned fields
    (exercises, focus, sport, type, warmup template, session type, etc.).
    """
    try:
        day = await plan_service.copy_plan_day(
            db, current_user.id, plan_id, source_day_id, target_date
        )
    except ValueError as e:
        detail = str(e)
        code = 404 if "not found" in detail else 400
        raise HTTPException(status_code=code, detail=detail) from e
    return TrainingPlanDayRead.model_validate(day)


# ── Workout preview (Feature 2) ──────────────────────────────────────────


@router.post("/preview-workout")
async def preview_workout(
    duration_minutes: int,
    workout_type: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Preview TSS/power/zone targets for a given workout type and duration.

    Uses the user's current FTP from their cycling profile.  Returns None
    fields when FTP is not set.
    """
    from app.services.training_plan import _TYPE_TO_DIFFICULTY
    from app.services.workout_planner import plan_workout

    difficulty = _TYPE_TO_DIFFICULTY.get(workout_type)
    if not difficulty:
        raise HTTPException(status_code=400, detail=f"Unknown workout type: {workout_type}")

    # Fetch FTP from cycling profile
    from sqlalchemy import select as sa_select

    from app.models.cycling import CyclingProfile

    result = await db.execute(
        sa_select(CyclingProfile).where(CyclingProfile.user_id == current_user.id)
    )
    profile = result.scalar_one_or_none()
    ftp = profile.ftp_watts if profile and profile.ftp_watts else None

    if not ftp:
        return {
            "targets": None,
            "message": "FTP not set — cannot compute targets",
        }

    targets = plan_workout(
        ftp=ftp,
        lthr=profile.lactate_threshold_hr if profile else None,
        weight_kg=profile.weight_kg if profile else None,
        difficulty=difficulty,
        duration_minutes=duration_minutes,
    )

    if not targets:
        return {"targets": None, "message": "Could not compute targets"}

    return {
        "targets": {
            "difficulty": targets.difficulty,
            "zone_id": targets.zone_id,
            "zone_name": targets.zone_name,
            "duration_minutes": targets.duration_minutes,
            "target_power_low": targets.target_power_low,
            "target_power_high": targets.target_power_high,
            "target_if_low": targets.target_if_low,
            "target_if_high": targets.target_if_high,
            "target_tss_low": targets.target_tss_low,
            "target_tss_high": targets.target_tss_high,
            "estimated_calories_low": targets.estimated_calories_low,
            "estimated_calories_high": targets.estimated_calories_high,
        },
        "ftp": ftp,
        "message": None,
    }
