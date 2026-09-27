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
    # FL3: optional %e1RM / RPE basis keys ride on the entry (no migration);
    # validate their ranges when present, otherwise leave the shape alone.
    for i, entry in enumerate(v):
        pct = entry.get("pct_1rm")
        if pct is not None:
            try:
                pct_f = float(pct)
            except (TypeError, ValueError):
                raise ValueError(
                    f"planned_exercises[{i}].pct_1rm must be a number"
                ) from None
            if not 0.3 <= pct_f <= 1.0:
                raise ValueError(
                    f"planned_exercises[{i}].pct_1rm must be between 0.3 and 1.0"
                )
        target_rpe = entry.get("target_rpe")
        if target_rpe is not None:
            try:
                rpe_f = float(target_rpe)
            except (TypeError, ValueError):
                raise ValueError(
                    f"planned_exercises[{i}].target_rpe must be a number"
                ) from None
            if not 1 <= rpe_f <= 10:
                raise ValueError(
                    f"planned_exercises[{i}].target_rpe must be between 1 and 10"
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
    )  # squat, bench, deadlift, overhead_press, accessories, full_body,
    # push, pull, legs, upper, lower
    planned_exercises: list[dict[str, Any]] | None = None
    planned_volume_kg: float | None = None
    planned_rpe: float | None = None
    planned_power_watts: float | None = None
    planned_zone: str | None = Field(None, max_length=10)
    planned_route_id: uuid.UUID | None = None
    lifting_session_id: uuid.UUID | None = None
    warmup_template_id: uuid.UUID | None = None
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
    # Wahoo push state (server-managed via /days/{id}/push-to-wahoo)
    wahoo_plan_id: int | None = None
    wahoo_workout_id: int | None = None
    wahoo_route_id: int | None = None
    wahoo_pushed_at: datetime | None = None
    wahoo_push_workout: bool = False
    wahoo_push_route: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


class TrainingPlanDayUpdate(BaseModel):
    """Partial single-day update (PATCH) — only provided fields are applied.

    Server-managed columns (``activity_id``, ``lifting_session_id``) are not
    client-settable here.  ``planned_volume_kg`` may be sent, but if
    ``planned_exercises`` is also provided the server recomputes volume from
    the exercise list to keep them in sync.
    """

    sport: Literal["cycle", "strength", "rest"] | None = None
    planned_tss: float | None = None
    planned_duration_min: int | None = None
    planned_type: str | None = None  # rest, easy, moderate, hard, race
    workout_description: str | None = Field(None, max_length=1000)
    planned_focus: str | None = Field(None, max_length=50)
    planned_exercises: list[dict[str, Any]] | None = None
    planned_volume_kg: float | None = None
    planned_rpe: float | None = None
    planned_power_watts: float | None = None
    planned_zone: str | None = Field(None, max_length=10)
    planned_route_id: uuid.UUID | None = None
    warmup_template_id: uuid.UUID | None = None
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
    route_id: uuid.UUID | None = None
    route_name: str | None = None


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
    day_status: Literal["pending", "completed", "partial", "missed", "rest"] = "pending"
    # FL1: True when fresh plan_workout targets (current FTP) differ from
    # the stored ones beyond epsilon. Only set on upcoming cycle days.
    targets_stale: bool = False


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
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


# ── Adaptive suggestions (§3.11) ──────────────────────────────────────────


class AdaptiveAction(BaseModel):
    """One-tap apply action targeting a plan day."""

    label: str
    plan_id: str
    day_id: str
    fields: dict[str, Any]


class AdaptiveSuggestion(BaseModel):
    """A single recommendation with optional apply actions."""

    type: str
    title: str
    detail: str
    severity: str
    actions: list[AdaptiveAction] = []


class AdaptiveAxis(BaseModel):
    """One analysed signal axis (load / recovery / conformity / health)."""

    key: str
    title: str
    stance: str
    severity: str
    guidance: str


class AdaptiveSuggestionsResponse(BaseModel):
    """Weekly adaptive recommendation envelope (§3.11)."""

    generated_at: datetime
    plan_id: str | None = None
    plan_name: str | None = None
    fatigue: str | None = None
    summary: str
    axes: list[AdaptiveAxis] = []
    suggestions: list[AdaptiveSuggestion] = []

    model_config = {"from_attributes": True}


class GeneratePlanRequest(BaseModel):
    """Request to auto-generate a plan from a template."""

    name: str
    template_type: str  # build, base, peak, taper, recovery
    weeks: int = 4
    start_date: date
    base_tss: float = 300.0  # weekly TSS starting point
    event_id: uuid.UUID | None = None  # optional — links plan and applies taper


# ── FL1: refresh cycle targets ──────────────────────────────────────────


class RefreshTargetDay(BaseModel):
    """One plan day whose stored targets were re-anchored to current FTP."""

    day_id: uuid.UUID
    day_date: date
    old_power: float | None = None
    new_power: float | None = None
    old_tss: float | None = None
    new_tss: float | None = None


class CpFtpMismatch(BaseModel):
    """Honest cross-check: fitted CP vs profile FTP diverged >10%.

    Zones stay FTP-anchored; this is surfaced, never silently applied.
    """

    ftp: float
    critical_power: float
    pct_diff: float


class RefreshStrengthDay(BaseModel):
    """One planned exercise whose %e1RM-basis weight was re-solved (FL3)."""

    day_id: uuid.UUID
    day_date: date
    exercise: str
    old_weight_kg: float | None = None
    new_weight_kg: float | None = None
    pct_1rm: float | None = None
    basis_1rm_kg: float | None = None
    basis_source: str | None = None


class RefreshTargetsResponse(BaseModel):
    """Result of POST /training-plans/{plan_id}/refresh-targets (FL1)."""

    refreshed: list[RefreshTargetDay] = []
    stale_but_unchanged: list[uuid.UUID] = []
    cp_ftp_mismatch: CpFtpMismatch | None = None
    # Upcoming uncompleted strength days skipped (FL3 owns %1RM later).
    strength_days_skipped: int = 0
    # FL3: strength days whose %e1RM-basis weights were re-solved (same call).
    strength_refreshed: list[RefreshStrengthDay] = []


# ── FL2: missed-session reconciliation ──────────────────────────────────


class WahooPushRequest(BaseModel):
    """Which parts of a cycle day to push to Wahoo."""

    push_workout: bool = True
    push_route: bool = True


class WahooPushResponse(BaseModel):
    """Result of a push / remove operation against Wahoo."""

    pushed_at: datetime | None = None
    push_workout: bool = False
    push_route: bool = False
    wahoo_plan_id: int | None = None
    wahoo_workout_id: int | None = None
    wahoo_route_id: int | None = None


class RescheduleDayRequest(BaseModel):
    """Move an uncompleted day to another date within the plan."""

    target_date: date


class SubstituteDayRequest(BaseModel):
    """Convert a missed day into an alternate session on the same date.

    ``sport``/``planned_type`` use Literal vocab so unknown values fail
    with HTTP 422 before reaching the service.
    """

    sport: Literal["cycle", "strength", "rest"]
    planned_type: Literal["rest", "easy", "moderate", "hard", "race"]
    planned_duration_min: int | None = None
    planned_tss: float | None = None
    planned_power_watts: float | None = None
    planned_volume_kg: float | None = None
    planned_rpe: float | None = None


class UnplannedActivity(BaseModel):
    """Compact actual for an activity linked to no plan day."""

    id: uuid.UUID
    name: str
    sport_type: str
    start_date: datetime
    duration_seconds: int | None = None
    distance_meters: float | None = None
    tss: float | None = None
    average_power: float | None = None

    model_config = {"from_attributes": True}


class UnplannedLiftingSession(BaseModel):
    """Compact actual for a lifting session linked to no plan day."""

    id: uuid.UUID
    session_date: date
    focus: str | None = None
    total_volume_kg: float | None = None
    duration_seconds: int | None = None

    model_config = {"from_attributes": True}


class UnplannedActualsResponse(BaseModel):
    """Activities + lifting sessions in the last N days on no plan day."""

    plan_id: uuid.UUID
    days: int = 14
    activities: list[UnplannedActivity] = []
    lifting_sessions: list[UnplannedLiftingSession] = []
