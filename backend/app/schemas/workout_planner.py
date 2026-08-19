"""Workout Planner Pydantic schemas — request/response models."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

# ── Zone Definitions ──────────────────────────────────────────────────────────


class WorkoutZone(BaseModel):
    """A single workout intensity zone."""

    zone: str  # z1, z2, z3, z4, z5
    name: str  # Very Easy, Easy, Moderate, Hard, Very Hard
    color: str  # hex color for UI
    if_low: float  # Intensity Factor lower bound
    if_high: float  # Intensity Factor upper bound
    power_low: int  # Watts lower bound
    power_high: int  # Watts upper bound
    hr_low: int  # Heart rate lower bound (bpm)
    hr_high: int  # Heart rate upper bound (bpm)
    tss_per_hour_low: float  # TSS per hour at lower IF
    tss_per_hour_high: float  # TSS per hour at upper IF


class ReadinessInfo(BaseModel):
    """Training readiness based on CTL/TSB."""

    current_ctl: float  # Chronic Training Load (fitness)
    current_atl: float  # Acute Training Load (fatigue)
    current_tsb: float  # Training Stress Balance (form)
    recommended_max_zone: str  # e.g. "z3"
    readiness_note: str
    is_fatigued: bool


class WorkoutZonesResponse(BaseModel):
    """Response for GET /zones — all zone definitions + readiness context."""

    zones: list[WorkoutZone]
    readiness: ReadinessInfo
    ftp_watts: float | None = None
    lthr: float | None = None


# ── Workout Planning ──────────────────────────────────────────────────────────


class WorkoutPlanRequest(BaseModel):
    """Request to plan a workout with concrete targets."""

    difficulty: str = Field(
        ...,
        description="Zone difficulty: z1, z2, z3, z4, z5",
        pattern="^z[1-5]$",
    )
    duration_minutes: int = Field(
        ...,
        gt=0,
        le=600,
        description="Planned ride duration in minutes",
    )


class WorkoutPlanResponse(BaseModel):
    """Response with concrete workout targets."""

    difficulty: str
    zone_id: str
    zone_name: str
    duration_minutes: int
    target_power_low: int  # watts
    target_power_high: int  # watts
    target_if_low: float  # Intensity Factor
    target_if_high: float
    target_hr_low: int  # bpm
    target_hr_high: int  # bpm
    target_tss_low: float  # Training Stress Score
    target_tss_high: float
    estimated_calories_low: int
    estimated_calories_high: int


# ── Route Matching ────────────────────────────────────────────────────────────


class RouteMatchItem(BaseModel):
    """A single route match with score and stats."""

    route_id: uuid.UUID
    route_name: str
    distance_meters: float
    elevation_gain_meters: float | None = None
    is_loop: bool
    match_score: float = Field(description="0.0-1.0 how well this route matches the workout")
    avg_tss: float | None = None
    avg_power: float | None = None
    avg_hr: float | None = None
    avg_duration_min: float | None = None
    ride_count: int
    is_estimated: bool = Field(description="True for unridden routes (estimates)")
    confidence: float = Field(description="0.0-1.0 confidence in the match data")


class RouteMatchRequest(BaseModel):
    """Request to find routes matching a planned workout."""

    difficulty: str = Field(
        ...,
        description="Zone difficulty: z1, z2, z3, z4, z5",
        pattern="^z[1-5]$",
    )
    duration_minutes: int | None = Field(
        None,
        gt=0,
        le=600,
        description="Planned ride duration in minutes (optional for matching)",
    )
    max_results: int = Field(10, gt=0, le=50, description="Max routes to return")


class RouteMatchResponse(BaseModel):
    """Response with ranked route matches."""

    matches: list[RouteMatchItem]
    workout_target: WorkoutPlanResponse | None = None
