"""Schemas for metrics endpoints (readiness, sleep intelligence, weight, health alerts)."""

from datetime import date as date_type

from pydantic import BaseModel, Field

# Mirrors CyclingProfileUpdate.weight_kg bounds — kg.
WEIGHT_MIN_KG = 20
WEIGHT_MAX_KG = 300


class WeightEntryCreate(BaseModel):
    date: date_type | None = None
    weight_kg: float = Field(..., ge=WEIGHT_MIN_KG, le=WEIGHT_MAX_KG)


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
