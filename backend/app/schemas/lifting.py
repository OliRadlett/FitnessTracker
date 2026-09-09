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
    """Optional client_id enables idempotent logging from the live tracker
    (retries with the same client_id return the existing row)."""

    client_id: str | None = None


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
    client_id: str | None = None

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
    started_at: datetime | None = None
    """Optional client-generated key for idempotent live-session creation."""
    live_key: str | None = None


class LiftingSessionUpdate(BaseModel):
    session_date: date | None = None
    program_name: str | None = None
    focus: str | None = None
    duration_seconds: int | None = None
    rpe_session: float | None = None
    notes: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None


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
    started_at: datetime | None = None
    ended_at: datetime | None = None
    whoop_strain: float | None = None
    whoop_avg_hr: int | None = None
    whoop_max_hr: int | None = None
    whoop_kilojoules: float | None = None
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
    activity_id: uuid.UUID | None = None
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
    steps: list[WarmupTemplateStepCreate] | None = (
        None  # replaces all steps if provided
    )


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


# ── Strength videos (§1.1) ─────────────────────────────────────────────────────


class VideoUploadRequest(BaseModel):
    """Request a presigned PUT URL for a new video upload."""

    file_name: str
    content_type: str
    size_bytes: int


class VideoUploadResponse(BaseModel):
    """Presigned PUT URL + object key returned by /upload-url."""

    upload_url: str
    key: str
    fields: dict


class VideoStreamUrl(BaseModel):
    """Resolved playback URL for a video."""

    url: str
    mode: str  # "embed" (external_url) | "direct" (R2 presigned GET)


class LiftVideoListParams(BaseModel):
    """Query params for listing a user's strength videos."""

    source: str | None = None  # "upload" | "url"
    exercise_name: str | None = None
    lifting_session_id: uuid.UUID | None = None
    personal_record_id: uuid.UUID | None = None
    after: date | None = None  # filter created_at >= after
    before: date | None = None  # filter created_at <= before
    limit: int = 50
    offset: int = 0

    model_config = {"from_attributes": False}


class LiftVideoBase(BaseModel):
    source: str
    external_url: str | None = None
    r2_key: str | None = None
    file_name: str | None = None
    content_type: str | None = None
    size_bytes: int | None = None
    duration_seconds: int | None = None
    exercise_name: str | None = None
    lifting_session_id: uuid.UUID | None = None
    personal_record_id: uuid.UUID | None = None
    notes: str | None = None


class LiftVideoCreate(LiftVideoBase):
    pass


class LiftVideoRead(LiftVideoBase):
    id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
