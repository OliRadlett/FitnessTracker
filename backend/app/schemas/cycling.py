"""Cycling-specific Pydantic schemas."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field


# ── Cycling Profile ──────────────────────────────────────────────────────────

class CyclingProfileRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    ftp_watts: float | None = None
    weight_kg: float | None = None
    lactate_threshold_hr: float | None = None
    auto_estimate_ftp: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CyclingProfileUpdate(BaseModel):
    ftp_watts: float | None = Field(None, gt=0, le=1000, description="Functional Threshold Power in watts")
    weight_kg: float | None = Field(None, gt=20, le=300, description="Body weight in kg")
    lactate_threshold_hr: float | None = Field(None, gt=30, le=250, description="Lactate Threshold Heart Rate in bpm")
    auto_estimate_ftp: bool | None = Field(None, description="Enable/disable weekly automatic FTP estimation")


# ── FTP History ──────────────────────────────────────────────────────────────

class FtpHistoryRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    ftp_watts: float
    effective_date: date
    source: str
    notes: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class FtpHistoryCreate(BaseModel):
    ftp_watts: float = Field(..., gt=0, le=1000)
    effective_date: date
    source: str = "manual"
    notes: str | None = None


# ── Training Load (CTL/ATL/TSB) ─────────────────────────────────────────────

class DailyLoadPoint(BaseModel):
    """A single day's training load data."""
    date: date
    tss: float = 0.0
    ctl: float = 0.0  # Chronic Training Load (fitness)
    atl: float = 0.0  # Acute Training Load (fatigue)
    tsb: float = 0.0  # Training Stress Balance (form)


class TrainingLoadResponse(BaseModel):
    """Training load over time."""
    data: list[DailyLoadPoint]
    current_ctl: float = 0.0
    current_atl: float = 0.0
    current_tsb: float = 0.0


# ── Power Analysis ───────────────────────────────────────────────────────────

class PowerDurationPoint(BaseModel):
    """Best power at a given duration."""
    duration_label: str  # e.g. "5s", "1min", "5min", "20min", "60min"
    duration_seconds: int
    best_power_watts: float | None = None
    date_achieved: date | None = None


class PowerCurveResponse(BaseModel):
    """Enhanced power curve from stream data."""
    data: list[PowerDurationPoint]
    ftp_watts: float | None = None


class PowerZoneDistribution(BaseModel):
    """Time spent in each power zone."""
    zone: str  # Z1, Z2, Z3, Z4, Z5, Z6, Z7
    zone_name: str  # Active Recovery, Endurance, Tempo, Threshold, VO2max, Anaerobic, Neuromuscular
    lower_bound_watts: float
    upper_bound_watts: float
    time_seconds: int
    percentage: float  # percentage of total time


class PowerZonesResponse(BaseModel):
    """Power zone distribution for a given period."""
    ftp_watts: float
    zones: list[PowerZoneDistribution]
    total_time_seconds: int


class MetricTrend(BaseModel):
    """Trend indicator comparing current value against a rolling baseline."""
    current_value: float | None = None
    baseline_value: float | None = None
    direction: str = "stable"  # "up", "down", "stable"


class MetricBenchmark(BaseModel):
    """Benchmark classification for a metric value."""
    label: str  # e.g. "Trained", "Good", "Excellent"
    range: str  # e.g. "3.0–4.0"
    raw_label: str  # internal label


class CyclingMetricsSummary(BaseModel):
    """Summary of cycling-specific metrics."""
    recent_tss: float = 0.0  # last 7 days
    recent_distance_km: float = 0.0
    recent_time_hours: float = 0.0
    recent_elevation_m: float = 0.0
    recent_rides: int = 0
    avg_intensity_factor: float | None = None
    avg_variability_index: float | None = None
    best_20min_power: float | None = None
    estimated_ftp: float | None = None
    ftp_watts: float | None = None
    weight_kg: float | None = None
    power_to_weight: float | None = None  # W/kg at FTP

    # Trend indicators (current 7d vs 28-day rolling average)
    tss_trend: MetricTrend | None = None
    distance_trend: MetricTrend | None = None
    time_trend: MetricTrend | None = None
    elevation_trend: MetricTrend | None = None
    rides_trend: MetricTrend | None = None
    if_trend: MetricTrend | None = None
    vi_trend: MetricTrend | None = None

    # Benchmark classifications
    ftp_wkg_benchmark: MetricBenchmark | None = None
    ctl_benchmark: MetricBenchmark | None = None
    vi_benchmark: MetricBenchmark | None = None


class HrZoneDistribution(BaseModel):
    """Time spent in each heart rate zone."""
    zone: str
    zone_name: str
    lower_bound_hr: float
    upper_bound_hr: float
    time_seconds: int
    percentage: float


class HrZonesResponse(BaseModel):
    """HR zone distribution for a given period."""
    lthr: float
    zones: list[HrZoneDistribution]
    total_time_seconds: int


class PowerVsHrPoint(BaseModel):
    """A data point for power vs heart rate analysis."""
    power: float
    heart_rate: float
    date: date


class PowerVsHrResponse(BaseModel):
    """Power vs heart rate scatter data."""
    data: list[PowerVsHrPoint]


# ── Enhanced FTP Estimate ───────────────────────────────────────────────────


class FtpEstimateDetail(BaseModel):
    """Individual FTP estimate from a specific method."""
    ftp: float
    confidence: float
    source_duration: int
    method: str


class FtpEstimateResponse(BaseModel):
    """Enhanced FTP estimate response with confidence scoring."""
    estimated_ftp: float
    confidence: float  # 0.0 - 1.0
    method: str  # primary method used
    source_duration: int  # primary duration in seconds
    all_estimates: list[FtpEstimateDetail]
    source_method: str | None = None  # human-readable for display
    best_power_available: dict[str, float | None]
    days_analyzed: int
    accepted: bool = False
    previous_ftp: float | None = None


# ── VO2max Estimation ─────────────────────────────────────────────────────


class Vo2maxDetail(BaseModel):
    """Individual VO2max estimate from a specific method."""
    vo2max: float
    confidence: float
    method: str


class Vo2maxResponse(BaseModel):
    """VO2max estimation response."""
    vo2max: float  # ml/kg/min
    confidence: float
    method: str
    classification: str  # Poor, Below Average, Average, Good, Excellent, Superior
    all_estimates: list[Vo2maxDetail]


class Vo2maxHistoryPoint(BaseModel):
    """A single VO2max estimate in the history trend."""
    date: date
    vo2max: float
    method: str


class Vo2maxHistoryResponse(BaseModel):
    """VO2max trend over time."""
    data: list[Vo2maxHistoryPoint]
    current_vo2max: float | None = None
    current_classification: str | None = None


# ── Decoupling Analysis ───────────────────────────────────────────────────


class DecouplingActivityPoint(BaseModel):
    """Decoupling result for a single activity."""
    date: date
    activity_id: str
    decoupling_pct: float
    first_half_ratio: float
    second_half_ratio: float
    classification: str
    duration_seconds: int


class DecouplingHistoryResponse(BaseModel):
    """Decoupling trend over time for recent long rides."""
    data: list[DecouplingActivityPoint]
    avg_decoupling_pct: float | None = None
    classification: str | None = None  # overall classification based on average


class DecouplingSingleResponse(BaseModel):
    """Decoupling result for a single activity."""
    decoupling_pct: float
    first_half_ratio: float
    second_half_ratio: float
    classification: str
    duration_seconds: int
    activity_id: str | None = None
