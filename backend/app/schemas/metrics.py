"""Schemas for metrics endpoints (readiness, sleep intelligence, weight, health alerts)."""

from datetime import date

from pydantic import BaseModel, Field, field_validator

# Mirrors CyclingProfileUpdate.weight_kg bounds — kg.
WEIGHT_MIN_KG = 20
WEIGHT_MAX_KG = 300


class WeightEntryCreate(BaseModel):
    date: date | None = None
    weight_kg: float

    @field_validator("weight_kg")
    @classmethod
    def _weight_bounds(cls, v):
        if not (WEIGHT_MIN_KG <= v <= WEIGHT_MAX_KG):
            raise ValueError("weight_kg must be between 20 and 300 kg")
        return v


class WeightEntryUpdate(BaseModel):
    weight_kg: float = Field(..., ge=WEIGHT_MIN_KG, le=WEIGHT_MAX_KG)


class HealthPreferencesUpdate(BaseModel):
    """Partial health-alert preference update (§3.12).

    ``disabled`` — alert types to disable entirely; ``snoozed`` — alert type →
    ISO date until which the type is silent; ``thresholds`` — per-signal
    override fields (e.g. ``drop_pct``, ``stddev_min``, ``bpm``).
    """

    disabled: list[str] | None = None
    snoozed: dict[str, str] | None = None
    thresholds: dict[str, dict[str, float]] | None = None
