"""Nutrition API — ride fuel plan CRUD and generation."""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.nutrition import (
    FuelPlanActualsUpdate,
    FuelPlanCreate,
    RideFuelPlanRead,
)
from app.services.auth import get_current_user
from app.services.nutrition import (
    delete_fuel_plan,
    generate_fuel_plan,
    get_fuel_plan,
    get_plan_for_activity,
    save_actuals_for_activity,
    update_fuel_plan_actuals,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/fuel-plan", response_model=RideFuelPlanRead, status_code=status.HTTP_201_CREATED)
async def create_fuel_plan(
    payload: FuelPlanCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate a fuel plan for a planned or completed ride.

    Pass `activity_id` to derive duration/intensity from a synced ride, or
    `planned_duration_min` (+ optional `planned_if`) for a future ride.
    Generating for an activity replaces any existing plan for it.
    """
    if payload.activity_id is None and payload.planned_duration_min is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide activity_id or planned_duration_min",
        )
    try:
        plan = await generate_fuel_plan(
            db,
            current_user.id,
            activity_id=payload.activity_id,
            planned_duration_min=payload.planned_duration_min,
            planned_if=payload.planned_if,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return _with_schedule(plan)


@router.get("/fuel-plan/{plan_id}", response_model=RideFuelPlanRead)
async def read_fuel_plan(
    plan_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    plan = await get_fuel_plan(db, current_user.id, plan_id)
    if not plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Fuel plan not found"
        )
    return _with_schedule(plan)


@router.get("/fuel-plan/activity/{activity_id}", response_model=RideFuelPlanRead | None)
async def read_plan_for_activity(
    activity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the fuel plan for an activity (null if none exists)."""
    try:
        plan = await get_plan_for_activity(db, current_user.id, activity_id)
    except Exception:
        logger.exception("Failed to load fuel plan for activity %s", activity_id)
        raise HTTPException(status_code=500, detail="Failed to load fuel plan")
    if not plan:
        return None
    return _with_schedule(plan)


@router.patch("/fuel-plan/{plan_id}", response_model=RideFuelPlanRead)
async def log_fuel_actuals(
    plan_id: uuid.UUID,
    payload: FuelPlanActualsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Log what was actually consumed pre/during/post ride."""
    plan = await update_fuel_plan_actuals(
        db,
        current_user.id,
        plan_id,
        actual_pre=payload.actual_pre_ride_notes,
        actual_during=payload.actual_during_notes,
        actual_post=payload.actual_post_ride_notes,
        actual_water_ml=payload.actual_water_ml,
        actual_carbs_g=payload.actual_carbs_g,
        actual_electrolytes_mg=payload.actual_electrolytes_mg,
    )
    if not plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Fuel plan not found"
        )
    return _with_schedule(plan)


@router.delete("/fuel-plan/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_fuel_plan(
    plan_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    deleted = await delete_fuel_plan(db, current_user.id, plan_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Fuel plan not found"
        )


@router.post("/fuel-plan/actuals", response_model=RideFuelPlanRead, status_code=status.HTTP_201_CREATED)
async def log_actuals_for_activity(
    payload: FuelPlanActualsUpdate,
    activity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Log nutrition actuals for an activity.

    Creates a minimal fuel plan if one doesn't exist for this activity.
    """
    plan = await save_actuals_for_activity(
        db,
        current_user.id,
        activity_id,
        actual_pre=payload.actual_pre_ride_notes,
        actual_during=payload.actual_during_notes,
        actual_post=payload.actual_post_ride_notes,
        actual_water_ml=payload.actual_water_ml,
        actual_carbs_g=payload.actual_carbs_g,
        actual_electrolytes_mg=payload.actual_electrolytes_mg,
    )
    return _with_schedule(plan)


def _with_schedule(plan) -> dict:
    """Serialize a RideFuelPlan with schedule_json exposed as `schedule`."""
    data = {
        "id": plan.id,
        "user_id": plan.user_id,
        "activity_id": plan.activity_id,
        "planned_duration_min": plan.planned_duration_min,
        "planned_if": plan.planned_if,
        "pre_ride_carbs_g": plan.pre_ride_carbs_g,
        "during_carbs_per_hour_g": plan.during_carbs_per_hour_g,
        "during_hydration_ml_per_hour": plan.during_hydration_ml_per_hour,
        "during_sodium_mg_per_hour": plan.during_sodium_mg_per_hour,
        "post_ride_carbs_g": plan.post_ride_carbs_g,
        "post_ride_protein_g": plan.post_ride_protein_g,
        "schedule": plan.schedule_json or [],
        "actual_pre_ride_notes": plan.actual_pre_ride_notes,
        "actual_during_notes": plan.actual_during_notes,
        "actual_post_ride_notes": plan.actual_post_ride_notes,
        "actual_water_ml": plan.actual_water_ml,
        "actual_carbs_g": plan.actual_carbs_g,
        "actual_electrolytes_mg": plan.actual_electrolytes_mg,
        "source": plan.source,
        "created_at": plan.created_at,
        "updated_at": plan.updated_at,
    }
    return data
