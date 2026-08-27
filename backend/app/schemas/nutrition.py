"""Schemas for ride fuel plans."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class FuelPlanCreate(BaseModel):
    """Generate a fuel plan for a planned or completed ride.

    Provide activity_id for a synced ride, OR planned_duration_min for a
    future ride. If both are given the explicit values win.
    """

    activity_id: uuid.UUID | None = None
    planned_duration_min: int | None = Field(default=None, gt=0, le=1440)
    planned_if: float | None = Field(default=None, ge=0.4, le=1.3)


class FuelScheduleEntry(BaseModel):
    time_min: int
    carbs_g: float
    hydration_ml: float
    sodium_mg: float
    suggestion: str


class RideFuelPlanRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    activity_id: uuid.UUID | None
    planned_duration_min: int | None
    planned_if: float | None
    pre_ride_carbs_g: float | None
    during_carbs_per_hour_g: float | None
    during_hydration_ml_per_hour: float | None
    during_sodium_mg_per_hour: float | None
    post_ride_carbs_g: float | None
    post_ride_protein_g: float | None
    schedule: list[FuelScheduleEntry] | None
    actual_pre_ride_notes: str | None
    actual_during_notes: str | None
    actual_post_ride_notes: str | None
    actual_water_ml: float | None
    actual_carbs_g: float | None
    actual_electrolytes_mg: float | None
    source: Literal["auto", "manual"]
    created_at: datetime
    updated_at: datetime


class FuelPlanActualsUpdate(BaseModel):
    """Log what was actually consumed (post-ride)."""

    actual_water_ml: float | None = Field(default=None, ge=0)
    actual_carbs_g: float | None = Field(default=None, ge=0)
    actual_electrolytes_mg: float | None = Field(default=None, ge=0)
