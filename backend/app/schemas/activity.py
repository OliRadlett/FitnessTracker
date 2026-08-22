import uuid
from datetime import date, datetime

from pydantic import BaseModel

# ── Linked Lifting Session Summary ────────────────────────────────────────────


class LinkedLiftingSessionSummary(BaseModel):
    """Subset of lifting session data shown alongside an activity."""

    id: uuid.UUID
    session_date: date
    focus: str | None = None
    set_count: int = 0
    total_volume_kg: float | None = None

    model_config = {"from_attributes": True}


# ── Activity Source ──────────────────────────────────────────────────────────


class ActivitySourceRead(BaseModel):
    """Provenance record for a merged activity."""

    id: uuid.UUID
    provider: str
    provider_activity_id: str
    provider_name: str | None = None
    synced_at: datetime

    model_config = {"from_attributes": True}


# ── Activity ──────────────────────────────────────────────────────────────────


class ActivityBase(BaseModel):
    source: str
    sport_type: str
    name: str
    start_date: datetime
    duration_seconds: int | None = None
    distance_meters: float | None = None
    elevation_gain_meters: float | None = None
    average_heartrate: float | None = None
    max_heartrate: float | None = None
    average_power: float | None = None
    normalized_power: float | None = None
    average_speed: float | None = None
    average_cadence: float | None = None
    tss: float | None = None
    calories: float | None = None
    rpe: float | None = None


class ActivityCreate(ActivityBase):
    provider_activity_id: str | None = None


class ActivityRead(ActivityBase):
    id: uuid.UUID
    user_id: uuid.UUID
    connection_id: uuid.UUID | None = None
    route_id: uuid.UUID | None = None
    route_name: str | None = None
    provider_activity_id: str | None = None
    linked_lifting_session: LinkedLiftingSessionSummary | None = None
    encoded_polyline: str | None = None
    sources: list[ActivitySourceRead] = []
    synced_at: datetime
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ActivityListParams(BaseModel):
    sport_type: str | None = None
    source: str | None = None
    start_date_after: datetime | None = None
    start_date_before: datetime | None = None
    limit: int = 50
    offset: int = 0


# ── Activity Stream ───────────────────────────────────────────────────────────


class ActivityStreamRead(BaseModel):
    id: uuid.UUID
    activity_id: uuid.UUID
    stream_type: str
    data: dict
    resolution: int | None = None

    model_config = {"from_attributes": True}


# ── Activity Calendar Entry ──────────────────────────────────────────────────


class ActivityCalendarEntry(BaseModel):
    """Lightweight activity data for calendar display."""

    id: uuid.UUID
    date: date
    sport_type: str
    name: str
    duration_seconds: int | None = None
    distance_meters: float | None = None
    tss: float | None = None
    focus: str | None = None

    model_config = {"from_attributes": True}


class DailyMetricSummary(BaseModel):
    """Lightweight daily metric data for calendar day cells."""

    date: date
    recovery_score: float | None = None
    hrv_ms: float | None = None
    strain: float | None = None
    sleep_duration_minutes: float | None = None
    sleep_efficiency: float | None = None
    resting_hr: float | None = None
    respiratory_rate: float | None = None

    model_config = {"from_attributes": True}


class SleepLogSummary(BaseModel):
    """Lightweight sleep log data for calendar day detail panel."""

    id: uuid.UUID
    sleep_date: date
    source: str
    total_sleep_seconds: int | None = None
    deep_sleep_seconds: int | None = None
    rem_sleep_seconds: int | None = None
    light_sleep_seconds: int | None = None
    awake_seconds: int | None = None
    sleep_efficiency: float | None = None
    sleep_start: datetime | None = None
    sleep_end: datetime | None = None

    model_config = {"from_attributes": True}


class CalendarDayData(BaseModel):
    """Combined activity + health data for a calendar day."""

    activities: list[ActivityCalendarEntry]
    daily_metrics: list[DailyMetricSummary]
    sleep_logs: list[SleepLogSummary] = []


# ── Ride Analysis ────────────────────────────────────────────────────────────


class PowerZoneDistribution(BaseModel):
    zone_name: str
    zone_label: str
    seconds: float
    pct: float


class PowerHistogramBucket(BaseModel):
    range_label: str  # "0-50W"
    count: int
    pct: float


class PacingSegment(BaseModel):
    pct_start: float
    pct_end: float
    avg_power: float | None = None
    avg_hr: float | None = None


class RideAnalysisResponse(BaseModel):
    model_config = {"from_attributes": True}
    power_zones: list[PowerZoneDistribution]
    power_distribution: list[PowerHistogramBucket]
    pacing_analysis: dict  # segments list + power_variability
    variability_index: float | None
    intensity_factor: float | None
    decoupling: dict | None  # from compute_decoupling_for_activity
    efficiency_factor: float | None
    vam: float | None
    tss_breakdown: dict  # total_tss, tss_per_hour
    climbing_analysis: dict | None
