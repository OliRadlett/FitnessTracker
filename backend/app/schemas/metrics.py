"""Schemas for metrics endpoints (readiness, sleep intelligence, weight, health alerts)."""

from datetime import date as date_type

from pydantic import BaseModel, Field

# Mirrors CyclingProfileUpdate.weight_kg bounds — kg.
WEIGHT_MIN_KG = 20
WEIGHT_MAX_KG = 300

# Body composition bounds (Withings BIA ranges + manual entry validation).
BODY_FAT_MIN, BODY_FAT_MAX = 3, 60
FAT_MASS_MIN, FAT_MASS_MAX = 2, 150
LEAN_MASS_MIN, LEAN_MASS_MAX = 15, 200
MUSCLE_MASS_MIN, MUSCLE_MASS_MAX = 10, 150
BONE_MASS_MIN, BONE_MASS_MAX = 0.5, 8
HYDRATION_MIN, HYDRATION_MAX = 30, 80
VISCERAL_FAT_MIN, VISCERAL_FAT_MAX = 1, 59
BMI_MIN, BMI_MAX = 10, 80


class BodyComposition(BaseModel):
    """Optional body composition fields (Withings scales or manual entry)."""

    body_fat_percent: float | None = Field(None, ge=BODY_FAT_MIN, le=BODY_FAT_MAX)
    fat_mass_kg: float | None = Field(None, ge=FAT_MASS_MIN, le=FAT_MASS_MAX)
    lean_mass_kg: float | None = Field(None, ge=LEAN_MASS_MIN, le=LEAN_MASS_MAX)
    muscle_mass_kg: float | None = Field(None, ge=MUSCLE_MASS_MIN, le=MUSCLE_MASS_MAX)
    bone_mass_kg: float | None = Field(None, ge=BONE_MASS_MIN, le=BONE_MASS_MAX)
    hydration_percent: float | None = Field(None, ge=HYDRATION_MIN, le=HYDRATION_MAX)
    visceral_fat_index: float | None = Field(
        None, ge=VISCERAL_FAT_MIN, le=VISCERAL_FAT_MAX
    )
    bmi: float | None = Field(None, ge=BMI_MIN, le=BMI_MAX)


class WeightEntryCreate(BodyComposition):
    date: date_type | None = None
    weight_kg: float = Field(..., ge=WEIGHT_MIN_KG, le=WEIGHT_MAX_KG)


class WeightEntryUpdate(BodyComposition):
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
