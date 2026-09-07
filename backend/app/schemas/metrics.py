"""Schemas for metrics endpoints (readiness, sleep intelligence, weight, health alerts)."""

from datetime import date

from pydantic import BaseModel, Field

# Mirrors CyclingProfileUpdate.weight_kg bounds — kg.
WEIGHT_MIN_KG = 20
WEIGHT_MAX_KG = 300


class WeightEntryCreate(BaseModel):
    date: date | None = Field(
        None, description="Log date — defaults to today when omitted"
    )
    weight_kg: float = Field(..., ge=WEIGHT_MIN_KG, le=WEIGHT_MAX_KG)


class WeightEntryUpdate(BaseModel):
    weight_kg: float = Field(..., ge=WEIGHT_MIN_KG, le=WEIGHT_MAX_KG)
