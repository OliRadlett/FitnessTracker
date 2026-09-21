import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

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
    estimated_tss: float | None = None  # B-31 duration×RPE load estimate
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


# ── Load Suggestion (FL3) ───────────────────────────────────────────────────


class SuggestLoadRequest(BaseModel):
    """Suggest a working weight as % of the current e1RM.

    Out-of-range values fail with HTTP 422 via pydantic validation.
    """

    exercise_name: str = Field(..., min_length=1, max_length=255)
    sets: int = Field(..., ge=1, le=20)
    reps: int = Field(..., ge=1, le=30)
    pct_1rm: float = Field(0.8, ge=0.3, le=1.0)


class SuggestLoadResponse(BaseModel):
    """%1RM-derived target; null target with ``"none"`` basis when history is empty."""

    target_kg: float | None = None
    basis_1rm_kg: float | None = None
    pct_1rm: float
    basis_source: Literal["pr", "recent_sets", "none"]

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
    """Presigned GET for playback of an R2-uploaded video."""

    url: str


class LiftVideoListParams(BaseModel):
    """Query params for listing a user's strength videos."""

    exercise_name: str | None = None
    lifting_session_id: uuid.UUID | None = None
    personal_record_id: uuid.UUID | None = None
    after: date | None = None  # filter created_at >= after
    before: date | None = None  # filter created_at <= before
    limit: int = 50
    offset: int = 0

    model_config = {"from_attributes": False}


class LiftVideoBase(BaseModel):
    r2_key: str | None = None
    file_name: str | None = None
    content_type: str | None = None
    size_bytes: int | None = None
    duration_seconds: int | None = None
    exercise_name: str | None = None
    lifting_session_id: uuid.UUID | None = None
    personal_record_id: uuid.UUID | None = None
    notes: str | None = None
    expected_reps: int | None = None
    camera_view: str | None = None


class LiftVideoCreate(LiftVideoBase):
    pass


class LiftVideoRead(LiftVideoBase):
    id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    # Video processing fields
    trimmed_r2_key: str | None = None
    analysis_status: str | None = None
    analysis_text: str | None = None
    exercise_auto: str | None = None
    reps_count: int | None = None
    weight_kg: float | None = None
    confidence: float | None = None
    trim_start_sec: float | None = None
    trim_end_sec: float | None = None
    processed_at: datetime | None = None

    # Video analysis — IPF form scoring (§3.18)
    form_score: float | None = None
    competition_valid: bool | None = None
    form_analysis_json: str | None = None
    form_deviations: str | None = None
    form_coaching_cues: str | None = None

    # Velocity tracking (§3.18)
    mean_concentric_velocity: float | None = None
    peak_velocity: float | None = None
    velocity_loss_pct: float | None = None
    velocity_profile_json: str | None = None
    vbt_zone: str | None = None

    # Rest timing (§3.18)
    rest_periods_json: str | None = None
    avg_rest_seconds: float | None = None
    rest_cv: float | None = None

    # Consistency (§3.18)
    rep_consistency_score: float | None = None
    tempo_consistency_cv: float | None = None
    rep_timing_json: str | None = None

    # Setup analysis (§3.18)
    setup_score: float | None = None
    setup_analysis_json: str | None = None
    setup_duration_seconds: float | None = None

    # Estimated RPE (§3.18)
    estimated_rpe: float | None = None
    rpe_confidence: float | None = None
    rpe_evidence_json: str | None = None

    model_config = {"from_attributes": True}


class VideoProcessStatus(BaseModel):
    """Response for video processing status check."""

    video_id: uuid.UUID
    analysis_status: str | None = None
    exercise_auto: str | None = None
    reps_count: int | None = None
    weight_kg: float | None = None
    confidence: float | None = None
    analysis_text: str | None = None
    processed_at: datetime | None = None

    # Video analysis fields (§3.18)
    form_score: float | None = None
    competition_valid: bool | None = None
    form_deviations: str | None = None
    form_coaching_cues: str | None = None
    mean_concentric_velocity: float | None = None
    peak_velocity: float | None = None
    velocity_loss_pct: float | None = None
    vbt_zone: str | None = None
    avg_rest_seconds: float | None = None
    rest_cv: float | None = None
    rep_consistency_score: float | None = None
    setup_score: float | None = None
    setup_duration_seconds: float | None = None
    estimated_rpe: float | None = None
    rpe_confidence: float | None = None
    rpe_evidence_json: str | None = None
    # B-30: AI estimate adjusted by the user's RPE calibration (None when
    # uncalibrated — equals estimated_rpe then).
    calibrated_rpe: float | None = None
