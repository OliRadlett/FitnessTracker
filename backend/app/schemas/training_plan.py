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
    # FL3/S1: optional %e1RM / RPE / provenance keys ride on the entry (JSONB,
    # no migration); validate their ranges when present, leave the shape alone
    # otherwise.
    for i, entry in enumerate(v):
        pct = entry.get("pct_1rm")
        if pct is not None:
            try:
                pct_f = float(pct)
            except (TypeError, ValueError):
                raise ValueError(
                    f"planned_exercises[{i}].pct_1rm must be a number"
                ) from None
            # Floor is >0, not 0.3: a deload week legitimately prescribes below
            # the 0.3 the single-shot suggest-load API accepts (0.30 × 0.9
            # deload = 0.27), and the basis has to be storable for
            # refresh-targets to re-solve it.
            if not 0 < pct_f <= 1.0:
                raise ValueError(
                    f"planned_exercises[{i}].pct_1rm must be between 0 and 1.0"
                )
        # ``rpe`` is the canonical target RPE (S1). ``target_rpe`` is
        # DEPRECATED and accepted only so older payloads keep validating —
        # ``rpe`` wins wherever both appear.
        for key in ("rpe", "target_rpe"):
            rpe = entry.get(key)
            if rpe is None:
                continue
            try:
                rpe_f = float(rpe)
            except (TypeError, ValueError):
                raise ValueError(
                    f"planned_exercises[{i}].{key} must be a number"
                ) from None
            if not 1 <= rpe_f <= 10:
                raise ValueError(
                    f"planned_exercises[{i}].{key} must be between 1 and 10"
                )
        # Provenance: 'manual' entries are never overwritten by a suggestion
        # or by refresh-targets, so the value is load-bearing, not cosmetic.
        weight_source = entry.get("weight_source")
        if weight_source is not None and weight_source not in (
            "manual",
            "suggested",
        ):
            raise ValueError(
                f"planned_exercises[{i}].weight_source must be 'manual' or 'suggested'"
            )
        note = entry.get("note")
        if note is not None and not isinstance(note, str):
            raise ValueError(f"planned_exercises[{i}].note must be a string")
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

    ``activity_id`` / ``lifting_session_id`` are client-settable so the
    unplanned strip can attach an actual to a chosen day (ownership is
    validated in the service).  ``planned_volume_kg`` may be sent, but if
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
    activity_id: uuid.UUID | None = None
    lifting_session_id: uuid.UUID | None = None
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
    # S1: per-exercise progression rules (see ExerciseRule).
    strength_progression: list[dict[str, Any]] | None = None


class TrainingPlanUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    plan_type: str | None = None
    status: str | None = None
    event_id: uuid.UUID | None = None
    # S1: per-exercise progression rules; replacing the list replaces the ramp.
    strength_progression: list[dict[str, Any]] | None = None
    # DEPRECATED for editing: supplying ``days`` replaces the plan's whole day
    # set — ``save_plan_days`` upserts by ``day_date`` and DELETES dates missing
    # from the payload. Prefer the targeted day endpoints (``PATCH /days/{id}``,
    # ``POST /days``, ``DELETE /days/{id}``, ``POST /days/{id}/swap``).
    days: list[TrainingPlanDayCreate] | None = None


class TrainingPlanRead(TrainingPlanBase):
    id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    days: list[TrainingPlanDayRead] = []
    # S1: null means "no rules" (stateless %e1RM suggestions as before).
    strength_progression: list[dict[str, Any]] | None = None

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
    template_type: str  # build, base, peak, taper, recovery, strength
    weeks: int = 4
    start_date: date
    base_tss: float = 300.0  # weekly TSS starting point (cycling templates)
    event_id: uuid.UUID | None = None  # optional — links plan and applies taper

    # ── Strength template options (when template_type == "strength") ────────
    #
    # `strength_template` encodes a progressive-overload pattern. Each entry
    # is applied to the matching week (1-indexed). Unset weeks inherit the
    # nearest preceding entry, so a 6-week plan only needs entries for weeks
    # where the stimulus changes.
    strength_template: list["StrengthWeekTemplate"] | None = None

    # Focus rotation for strength days (e.g. ["squat", "bench", "deadlift"]).
    # Defaults to ["squat", "bench", "deadlift"] when omitted.
    strength_focuses: list[str] | None = None

    # Optional starting point (overrides auto-detection from user history).
    strength_start_rpe: float | None = None
    strength_start_sets: int | None = None
    strength_start_reps: int | None = None
    strength_start_weight_kg: float | None = None


class StrengthWeekTemplate(BaseModel):
    """One week's progressive-overload parameters in a strength template."""

    week: int  # 1-indexed
    rpe: float | None = None
    sets: int | None = None
    reps: int | None = None
    # Optional per-exercise weight overrides keyed by focus (e.g. "squat").
    weights: dict[str, float] | None = None
    notes: str | None = None


class ExerciseSuggestion(BaseModel):
    """One exercise with a suggested new weight."""

    exercise_name: str
    old_weight_kg: float | None
    suggested_weight_kg: float
    rpe: float | None
    sets: int
    reps: int


class StrengthDaySuggestion(BaseModel):
    """Suggested updates for a future plan day based on prior-week performance."""

    day_id: uuid.UUID
    day_date: date
    sport: str
    planned_focus: str | None = None
    exercises: list[ExerciseSuggestion] = []


class StrengthPlanSuggestionsResponse(BaseModel):
    """Full response wrapping the list of day-level suggestions."""

    plan_id: uuid.UUID
    generated_at: datetime
    suggestions: list[StrengthDaySuggestion] = []
    summary: str | None = None


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


# ── S1: strength progression (rules · suggest · apply · materialise) ──────
#
# The resolver's contract in one line: the *anchor* is recent history (e1RM),
# the *progression* is the plan's own previous weeks, and the response explains
# every number it produced. Nothing here writes a weight — ``suggest`` proposes,
# ``apply`` writes what the user accepted, ``materialise`` fills targets.


class ProgressionStart(BaseModel):
    """Week-1 targets for an exercise ramp."""

    sets: int | None = Field(None, ge=1, le=20)
    reps: int | None = Field(None, ge=1, le=50)
    rpe: float | None = Field(None, ge=1, le=10)


class ProgressionWeekly(BaseModel):
    """Per-week increments applied on top of ``start``."""

    rpe_delta: float | None = Field(None, ge=-2, le=2)
    reps_delta: int | None = Field(None, ge=-5, le=5)
    sets_delta: int | None = Field(None, ge=-5, le=5)
    # mode == "load" only: chained off the previous week's prescribed kg.
    load_delta_kg: float | None = Field(None, ge=-20, le=20)
    load_delta_pct: float | None = Field(None, ge=-0.2, le=0.2)


class ExerciseRule(BaseModel):
    """One exercise's multi-week progression rule (S1).

    ``mode='rpe'`` (default) re-solves the load from the current e1RM and the
    week's RPE, so a moving e1RM self-corrects the prescription.
    ``mode='load'`` chains off the previous week's prescribed weight instead —
    for coaches who want explicit weekly brackets.
    """

    exercise: str
    mode: Literal["rpe", "load"] = "rpe"
    start: ProgressionStart | None = None
    weekly: ProgressionWeekly | None = None
    # Every Nth week is a deload: suppress the ramp's direction and scale back
    # (load modes × ``deload_factor``, RPE modes −1 RPE).
    deload_every: int | None = Field(None, ge=2, le=12)
    deload_factor: float | None = Field(None, gt=0, le=1.0)
    # Prescribe off a training max (e.g. 0.9) rather than the true e1RM.
    # Defaults to 1.0 — nothing changes unless asked for. The safety check
    # always compares against the *true* e1RM.
    training_max_pct: float | None = Field(None, gt=0, le=1.0)

    @field_validator("exercise")
    @classmethod
    def _exercise_required(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("exercise is required")
        return v.strip()


class StrengthProgressionSuggestRequest(BaseModel):
    """Scope for a suggestion pass (never writes)."""

    scope: Literal["day", "week", "plan"] = "plan"
    day_id: uuid.UUID | None = None
    week: int | None = Field(None, ge=1, le=104)
    # Re-suggest even entries the user set by hand (weight_source='manual').
    force: bool = False


class ProgressionTarget(BaseModel):
    """One proposed weight, with everything needed to justify it (S1 §4.2)."""

    day_id: uuid.UUID
    day_date: date
    week: int | None = None
    exercise_index: int
    exercise: str
    sets: int | None = None
    reps: int | None = None
    rpe: float | None = None
    # Proposal (null when skipped — see skipped_reason).
    weight_kg: float | None = None
    pct_1rm: float | None = None
    # Basis: what the number is anchored on, and when it was achieved.
    basis_1rm_kg: float | None = None
    basis_source: Literal["pr", "recent_sets", "none"] | None = None
    basis_date: date | None = None
    training_max_pct: float | None = None
    # Progression: where it came from.
    prev_week_kg: float | None = None
    delta_kg: float | None = None
    mode: Literal["rpe", "load"] | None = None
    is_deload: bool = False
    safety_warning: str | None = None
    skipped_reason: (
        Literal["manual", "no_basis", "reps_too_high", "no_target"] | None
    ) = None


class StrengthProgressionSuggestResponse(BaseModel):
    plan_id: uuid.UUID
    targets: list[ProgressionTarget] = []


class ProgressionApplyTarget(BaseModel):
    """One accepted suggestion, addressed by (day, index in that day's list)."""

    day_id: uuid.UUID
    exercise_index: int = Field(..., ge=0)
    weight_kg: float = Field(..., gt=0)
    # >0 rather than >=0.3: a deload scales the fraction below the single-shot
    # suggest-load floor (see _validate_planned_exercises).
    pct_1rm: float | None = Field(None, gt=0, le=1.0)


class StrengthProgressionApplyRequest(BaseModel):
    targets: list[ProgressionApplyTarget] = Field(..., min_length=1)
    # Overwrite entries the user set by hand (weight_source='manual').
    force: bool = False


class ProgressionApplyResult(BaseModel):
    day_id: uuid.UUID
    exercise_index: int
    exercise: str
    weight_kg: float | None = None
    pct_1rm: float | None = None
    previous_weight_kg: float | None = None
    previous_weight_source: str | None = None
    applied: bool = False
    skipped_reason: str | None = None


class StrengthProgressionApplyResponse(BaseModel):
    plan_id: uuid.UUID
    applied: list[ProgressionApplyResult] = []
    skipped: list[ProgressionApplyResult] = []


class MaterialiseRequest(BaseModel):
    """Fill per-week cells from the plan's rules (S1 §3.2).

    ``fill-empty`` writes only where the entry has no value for the field yet;
    ``replace`` overwrites the rule's fields on every matching entry. Weights
    are never touched here — they come from ``suggest`` + ``apply``.
    """

    rules: list[ExerciseRule] | None = None
    weeks: list[int] | None = None
    mode: Literal["replace", "fill-empty"] = "fill-empty"


class MaterialisedEntry(BaseModel):
    day_id: uuid.UUID
    day_date: date
    week: int
    exercise_index: int
    exercise: str
    sets: int | None = None
    reps: int | None = None
    rpe: float | None = None
    is_deload: bool = False


class MaterialiseSkip(BaseModel):
    week: int
    exercise: str
    reason: str  # no_matching_entry | existing_targets


class MaterialiseResponse(BaseModel):
    plan_id: uuid.UUID
    rules_saved: int = 0
    days_updated: int = 0
    entries_updated: list[MaterialisedEntry] = []
    skipped: list[MaterialiseSkip] = []


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


class SwapDayRequest(BaseModel):
    """Swap two plan days' dates (atomic).

    Both days must belong to the same plan and be uncompleted. The service
    exchanges ``day_date`` between them; nothing else moves, so linked
    actuals stay with their own row.
    """

    target_day_id: uuid.UUID


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
