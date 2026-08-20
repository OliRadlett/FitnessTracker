import uuid
from datetime import date, datetime

from pydantic import BaseModel

# ── Lifting Set ───────────────────────────────────────────────────────────────

class LiftingSetBase(BaseModel):
    exercise_name: str
    set_number: int
    weight_kg: float
    reps: int
    rpe: float | None = None
    is_warmup: bool = False
    is_amrap: bool = False
    notes: str | None = None


class LiftingSetCreate(LiftingSetBase):
    pass


class LiftingSetUpdate(BaseModel):
    exercise_name: str | None = None
    set_number: int | None = None
    weight_kg: float | None = None
    reps: int | None = None
    rpe: float | None = None
    is_warmup: bool | None = None
    is_amrap: bool | None = None
    notes: str | None = None


class LiftingSetRead(LiftingSetBase):
    id: uuid.UUID
    session_id: uuid.UUID

    model_config = {"from_attributes": True}


# ── Lifting Session ───────────────────────────────────────────────────────────

class LiftingSessionBase(BaseModel):
    session_date: date
    program_name: str | None = None
    focus: str | None = None
    duration_seconds: int | None = None
    rpe_session: float | None = None
    notes: str | None = None


class LiftingSessionCreate(LiftingSessionBase):
    sets: list[LiftingSetCreate] = []


class LiftingSessionUpdate(BaseModel):
    session_date: date | None = None
    program_name: str | None = None
    focus: str | None = None
    duration_seconds: int | None = None
    rpe_session: float | None = None
    notes: str | None = None


class LiftingSessionLink(BaseModel):
    """Request to manually link/unlink a lifting session to a Strava activity."""
    activity_id: uuid.UUID | None = None  # None to unlink


class LinkedActivityRead(BaseModel):
    """Subset of activity data shown alongside a lifting session."""
    id: uuid.UUID
    source: str
    sport_type: str
    name: str
    start_date: datetime
    duration_seconds: int | None = None
    average_heartrate: float | None = None
    max_heartrate: float | None = None
    calories: float | None = None

    model_config = {"from_attributes": True}


class LiftingSessionRead(LiftingSessionBase):
    id: uuid.UUID
    user_id: uuid.UUID
    activity_id: uuid.UUID | None = None
    total_volume_kg: float | None = None
    sets: list[LiftingSetRead] = []
    linked_activity: LinkedActivityRead | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Personal Record ───────────────────────────────────────────────────────────

class PersonalRecordCreate(BaseModel):
    """Request to manually create a PR (for sessions not logged in the app)."""
    exercise_name: str
    record_type: str = "1rm"
    weight_kg: float
    reps: int
    achieved_date: date
    notes: str | None = None


class PersonalRecordRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    exercise_name: str
    record_type: str
    weight_kg: float
    reps: int
    estimated_1rm: float | None = None
    achieved_date: date
    session_id: uuid.UUID | None = None
    notes: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Volume / Stats ────────────────────────────────────────────────────────────

class VolumeTrendPoint(BaseModel):
    week_start: date
    total_volume_kg: float
    session_count: int


class VolumeTrendResponse(BaseModel):
    exercise_name: str | None = None
    data: list[VolumeTrendPoint]


# ── Warmup Template ───────────────────────────────────────────────────────────

class WarmupTemplateStepBase(BaseModel):
    step_number: int
    weight_kg: float
    reps: int
    notes: str | None = None


class WarmupTemplateStepCreate(WarmupTemplateStepBase):
    pass


class WarmupTemplateStepUpdate(BaseModel):
    step_number: int | None = None
    weight_kg: float | None = None
    reps: int | None = None
    notes: str | None = None


class WarmupTemplateStepRead(WarmupTemplateStepBase):
    id: uuid.UUID
    warmup_template_id: uuid.UUID

    model_config = {"from_attributes": True}


class WarmupTemplateBase(BaseModel):
    name: str
    exercise_name: str | None = None


class WarmupTemplateCreate(WarmupTemplateBase):
    steps: list[WarmupTemplateStepCreate] = []


class WarmupTemplateUpdate(BaseModel):
    name: str | None = None
    exercise_name: str | None = None
    steps: list[WarmupTemplateStepCreate] | None = None  # replaces all steps if provided


class WarmupTemplateRead(WarmupTemplateBase):
    id: uuid.UUID
    user_id: uuid.UUID
    steps: list[WarmupTemplateStepRead] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Session Analysis ─────────────────────────────────────────────────────────


class ExerciseVolume(BaseModel):
    exercise_name: str
    volume_kg: float


class SetProgressionPoint(BaseModel):
    set_number: int
    weight_kg: float
    reps: int
    estimated_1rm: float | None = None


class RepDropoff(BaseModel):
    exercise_name: str
    first_set_reps: int
    last_set_reps: int
    dropoff_pct: float


class PrProximity(BaseModel):
    exercise_name: str
    top_set_1rm: float
    pr_1rm: float
    proximity_pct: float


class LiftingAnalysisResponse(BaseModel):
    model_config = {"from_attributes": True}
    volume_breakdown: list[ExerciseVolume]
    set_progression: dict[str, list[SetProgressionPoint]]  # exercise_name -> points
    rep_dropoff: list[RepDropoff]
    pr_proximity: list[PrProximity]
    rpe_analysis: dict  # session_rpe, avg_set_rpe, etc.
    fatigue_index: float  # 0-100
    session_density: float | None  # kg per minute
    exercise_count: int
    working_sets_count: int
