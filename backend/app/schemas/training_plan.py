import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


def _validate_planned_exercises(
    v: list[dict[str, Any]] | None,
) -> list[dict[str, Any]] | None:
    """Ensure planned_exercises is a list of dicts with required keys."""
    if v is None:
        return v
    required = {"exercise", "sets", "reps"}
    for i, entry in enumerate(v):
        if not isinstance(entry, dict):
            raise ValueError(f"planned_exercises[{i}] must be an object")  # noqa: TRY004
        missing = required - entry.keys()
        if missing:
            raise ValueError(
                f"planned_exercises[{i}] missing required keys: {sorted(missing)}"
            )
    return v


class TrainingPlanDayBase(BaseModel):
    day_date: date
    sport: Literal["cycle", "strength", "rest"] = "cycle"
    planned_tss: float | None = None
    planned_duration_min: int | None = None
    planned_type: str = "rest"  # rest, easy, moderate, hard, race
    workout_description: str | None = Field(None, max_length=1000)
    planned_focus: str | None = Field(
        None, max_length=50
    )  # squat, bench, deadlift, overhead_press, accessories, full_body
    planned_exercises: list[dict[str, Any]] | None = None
    planned_volume_kg: float | None = None
    planned_rpe: float | None = None
    planned_power_watts: float | None = None
    planned_zone: str | None = Field(None, max_length=10)
    planned_route_id: uuid.UUID | None = None
    lifting_session_id: uuid.UUID | None = None
    warmup_template_id: uuid.UUID | None = None
    session_type: str | None = Field(
        None, max_length=20
    )  # push, pull, legs, upper, lower, full_body
    notes: str | None = None
    # Client-settable completion toggle; activity_id stays server-managed.
    completed: bool | None = None

    @field_validator("planned_exercises")
    @classmethod
    def validate_planned_exercises(
        cls, v: list[dict[str, Any]] | None
    ) -> list[dict[str, Any]] | None:
        return _validate_planned_exercises(v)


class TrainingPlanDayCreate(TrainingPlanDayBase):
    pass


class TrainingPlanDayRead(TrainingPlanDayBase):
    id: uuid.UUID
    plan_id: uuid.UUID
    activity_id: uuid.UUID | None = None
    completed: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


class TrainingPlanDayUpdate(BaseModel):
    """Partial single-day update (PATCH) — only provided fields are applied.

    Server-managed columns (``activity_id``, ``lifting_session_id``,
    ``planned_volume_kg``) are not client-settable here.
    """

    sport: Literal["cycle", "strength", "rest"] | None = None
    planned_tss: float | None = None
    planned_duration_min: int | None = None
    planned_type: str | None = None  # rest, easy, moderate, hard, race
    workout_description: str | None = Field(None, max_length=1000)
    planned_focus: str | None = Field(None, max_length=50)
    planned_exercises: list[dict[str, Any]] | None = None
    planned_rpe: float | None = None
    planned_power_watts: float | None = None
    planned_zone: str | None = Field(None, max_length=10)
    planned_route_id: uuid.UUID | None = None
    warmup_template_id: uuid.UUID | None = None
    session_type: str | None = Field(
        None, max_length=20
    )  # push, pull, legs, upper, lower, full_body
    notes: str | None = Field(None, max_length=500)
    completed: bool | None = None

    @field_validator("planned_exercises")
    @classmethod
    def validate_planned_exercises(
        cls, v: list[dict[str, Any]] | None
    ) -> list[dict[str, Any]] | None:
        return _validate_planned_exercises(v)


# ── Weekly view (Phase 5B) ────────────────────────────────────────────────


class DayWeather(BaseModel):
    """Normalized daily forecast entry (Open-Meteo cache shape)."""

    date: str  # ISO date string, as stored in the forecast cache
    conditions: str | None = None
    temp_min: float | None = None
    temp_max: float | None = None
    precipitation_probability: float | None = None
    precipitation_sum: float | None = None
    wind_speed_max: float | None = None


class BadWeather(BaseModel):
    """Bad-riding-weather flag from ``weather.is_bad_weather()``."""

    reason: str
    level: str


class ActualActivity(BaseModel):
    """Summary of the activity linked to a plan day."""

    id: uuid.UUID
    name: str
    sport_type: str
    start_date: datetime
    duration_seconds: int | None = None
    distance_meters: float | None = None
    tss: float | None = None
    average_power: float | None = None


class ActualLiftingSession(BaseModel):
    """Summary of the lifting session linked to a plan day."""

    id: uuid.UUID
    session_date: date
    focus: str | None = None
    total_volume_kg: float | None = None


class WarmupStepRead(BaseModel):
    step_number: int
    weight_kg: float
    reps: int
    notes: str | None = None
    model_config = {"from_attributes": True}


class WarmupTemplateRead(BaseModel):
    id: uuid.UUID
    name: str
    exercise_name: str | None = None
    steps: list[WarmupStepRead] = []
    model_config = {"from_attributes": True}


class WeekRouteMatch(BaseModel):
    """Compact route match for inline display on cycle day cards."""

    route_id: uuid.UUID
    name: str
    score: float
    confidence: float
    estimated_tss: float | None = None
    ride_count: int


class WeekReadiness(BaseModel):
    """CTL/ATL/TSB snapshot with a recommended intensity ceiling."""

    tsb: float
    ctl: float
    atl: float
    recommended_max_zone: str  # e.g. "z3"


class TrainingWeekDay(TrainingPlanDayRead):
    """A plan day enriched with weather, actuals, and route matches."""

    weather: DayWeather | None = None
    bad_weather: BadWeather | None = None
    actual_activity: ActualActivity | None = None
    actual_lifting_session: ActualLiftingSession | None = None
    route_matches: list[WeekRouteMatch] | None = None
    warmup_template: WarmupTemplateRead | None = None


class TrainingWeekResponse(BaseModel):
    """One Monday-based week of an active plan (GET /{plan_id}/week/{n})."""

    plan_id: uuid.UUID
    week_number: int
    week_start: date
    week_end: date
    readiness: WeekReadiness | None = None
    days: list[TrainingWeekDay] = []


class TrainingPlanBase(BaseModel):
    name: str
    description: str | None = None
    start_date: date
    end_date: date
    plan_type: str = "custom"  # custom, build, base, peak, taper, recovery
    status: str = "draft"  # draft, active, completed, archived
    event_id: uuid.UUID | None = None


class TrainingPlanCreate(TrainingPlanBase):
    days: list[TrainingPlanDayCreate] = []


class TrainingPlanUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    plan_type: str | None = None
    status: str | None = None
    event_id: uuid.UUID | None = None
    days: list[TrainingPlanDayCreate] | None = None


class TrainingPlanRead(TrainingPlanBase):
    id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    days: list[TrainingPlanDayRead] = []

    model_config = {"from_attributes": True}


class TrainingPlanSummary(BaseModel):
    """Lightweight plan info without days."""

    id: uuid.UUID
    name: str
    start_date: date
    end_date: date
    plan_type: str
    status: str
    event_id: uuid.UUID | None = None
    day_count: int = 0
    completed_days: int = 0

    model_config = {"from_attributes": True}


class GeneratePlanRequest(BaseModel):
    """Request to auto-generate a plan from a template."""

    name: str
    template_type: str  # build, base, peak, taper, recovery
    weeks: int = 4
    start_date: date
    base_tss: float = 300.0  # weekly TSS starting point
    event_id: uuid.UUID | None = None  # optional — links plan and applies taper
