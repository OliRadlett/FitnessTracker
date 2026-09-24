"""Cycling-specific Pydantic schemas."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field

# Sanity bounds for FTP write paths. Mirror the estimator clamp in
# `services/cycling/power_curve.py` (estimate_ftp_from_power_curve_detailed
# returns None outside 50-600W) so manual entries can't drift from it.
FTP_MIN_WATTS = 50
FTP_MAX_WATTS = 600

# ── Cycling Profile ──────────────────────────────────────────────────────────


class CyclingProfileRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    ftp_watts: float | None = None
    weight_kg: float | None = None
    lactate_threshold_hr: float | None = None
    auto_estimate_ftp: bool = False
    home_lat: float | None = Field(
        None, ge=-90, le=90, description="Home latitude for weather lookups"
    )
    home_lng: float | None = Field(
        None, ge=-180, le=180, description="Home longitude for weather lookups"
    )
    # Personalized power model fields (fitted by Modal weekly task)
    critical_power: float | None = Field(
        None, description="Critical Power from Morton 3-param model (watts)"
    )
    w_prime: float | None = Field(
        None, description="W' (anaerobic work capacity) in joules"
    )
    p_max: float | None = Field(
        None, description="Pmax sprint ceiling from Morton 3-param model (watts)"
    )
    power_model_r_squared: float | None = Field(
        None, description="R² fit quality of the CP model"
    )
    personalized_vo2max: float | None = Field(
        None, description="VO2max from power-HR regression (ml/kg/min)"
    )
    ctl_tau: int | None = Field(
        None, description="Personalized CTL time constant (days)"
    )
    atl_tau: int | None = Field(
        None, description="Personalized ATL time constant (days)"
    )
    power_model_fitted_at: datetime | None = Field(
        None, description="When the power model was last fitted"
    )
    # Weather-performance analysis fields (fitted by Modal weekly task)
    weather_coefficients: dict | None = Field(
        None, description="Personalized weather-performance coefficients"
    )
    weather_insights: list[str] | None = Field(
        None, description="Personalized weather insights"
    )
    weather_analyzed_at: datetime | None = Field(
        None, description="When weather analysis was last performed"
    )
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CyclingProfileUpdate(BaseModel):
    ftp_watts: float | None = Field(
        None,
        ge=FTP_MIN_WATTS,
        le=FTP_MAX_WATTS,
        description="Functional Threshold Power in watts",
    )
    weight_kg: float | None = Field(
        None, gt=20, le=300, description="Body weight in kg"
    )
    lactate_threshold_hr: float | None = Field(
        None, gt=30, le=250, description="Lactate Threshold Heart Rate in bpm"
    )
    auto_estimate_ftp: bool | None = Field(
        None, description="Enable/disable weekly automatic FTP estimation"
    )
    home_lat: float | None = Field(
        None, ge=-90, le=90, description="Home latitude for weather lookups"
    )
    home_lng: float | None = Field(
        None, ge=-180, le=180, description="Home longitude for weather lookups"
    )


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
    ftp_watts: float = Field(..., ge=FTP_MIN_WATTS, le=FTP_MAX_WATTS)
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
    # Personalized model overlay
    cp: float | None = Field(None, description="Critical Power (Morton 3-param)")
    w_prime: float | None = Field(None, description="W' in joules")
    p_max: float | None = Field(None, description="Pmax sprint ceiling in watts")
    model_r_squared: float | None = Field(None, description="CP model fit quality")
    fitted_curve: dict[str, float] | None = Field(
        None, description="Model-predicted power at standard durations"
    )


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


# ── Cycling Power Records (PRs) ──────────────────────────────────────────────


class CyclingPowerRecordRead(BaseModel):
    """A single cycling power PR (best power at a duration bucket)."""

    id: uuid.UUID
    user_id: uuid.UUID
    duration_label: str
    duration_seconds: int
    power_watts: float
    weight_kg: float | None = None
    w_per_kg: float | None = None
    improvement_pct: float | None = None
    achieved_date: date
    activity_id: uuid.UUID | None = None
    activity_name: str | None = None
    notes: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class CyclingPowerRecordReadWithActivity(CyclingPowerRecordRead):
    """CyclingPowerRecordRead that eagerly includes activity metadata."""

    activity_start_date: datetime | None = None
    activity_distance_meters: float | None = None
    activity_duration_seconds: int | None = None


class CyclingPowerRecordCreate(BaseModel):
    """Request to manually create a cycling power PR."""

    duration_label: str
    duration_seconds: int
    power_watts: float = Field(..., gt=0)
    achieved_date: date
    notes: str | None = None


class PrCheckRequest(BaseModel):
    """Request to trigger PR detection."""

    activity_id: uuid.UUID | None = None


class PrCheckResponse(BaseModel):
    """Response from a PR check operation."""

    checked: int
    new_prs: int
    updated_prs: int
    prs: list[CyclingPowerRecordRead]


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


# ── Personalized Power Model ──────────────────────────────────────────────


class PowerModelCriticalPower(BaseModel):
    """Critical power model results."""

    cp: float | None = Field(None, description="Critical Power (watts)")
    w_prime: float | None = Field(None, description="W' (joules)")
    p_max: float | None = Field(None, description="Pmax sprint ceiling (watts)")
    model_r_squared: float | None = Field(None, description="R² fit quality")
    fitted_curve: dict[str, float] | None = Field(
        None, description="Model-predicted power at standard durations"
    )
    method: str | None = None
    data_points_used: int = 0


class PowerModelPersonalizedVo2max(BaseModel):
    """Personalized VO2max from power-HR regression."""

    vo2max: float | None = None
    method: str | None = None
    r_squared: float | None = None
    regression_slope: float | None = None
    regression_intercept: float | None = None
    data_points_used: int = 0


class PowerModelAdaptiveConstants(BaseModel):
    """Personalized CTL/ATL time constants."""

    ctl_tau: int = 42
    atl_tau: int = 7
    improvement_pct: float | None = None
    correlation: float | None = None
    method: str | None = None
    data_points_used: int = 0


class PowerModelResultsResponse(BaseModel):
    """Complete personalized power model results."""

    critical_power: PowerModelCriticalPower | None = None
    personalized_vo2max: PowerModelPersonalizedVo2max | None = None
    adaptive_constants: PowerModelAdaptiveConstants | None = None
    fitted_at: datetime | None = None


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


# ── Suggested Training Cycle ────────────────────────────────────────────────


class SuggestedDay(BaseModel):
    """A single day in the suggested training cycle."""

    day_name: str  # e.g. "Monday"
    date: str  # ISO date
    workout_type: str  # "rest" | "recovery" | "endurance" | "tempo" | "threshold" | "vo2max" | "strength" | "mixed"
    label: str  # Human-readable label e.g. "Easy Recovery Ride"
    description: str  # What to do and why
    target_tss: float | None = None  # Suggested TSS target
    intensity: str  # "low" | "moderate" | "high" | "none"
    icon: str  # Emoji icon


class SuggestedCycleResponse(BaseModel):
    """Suggested 7-day training cycle based on recovery and training load."""

    readiness: str  # "green" | "yellow" | "red"
    readiness_message: str
    current_tsb: float | None = None
    current_ctl: float | None = None
    current_atl: float | None = None
    latest_recovery: float | None = None
    latest_hrv: float | None = None
    days: list[SuggestedDay]
    summary: str  # Overall recommendation text


# ── Weather-Performance Analysis ────────────────────────────────────────────


class WeatherPowerVsTemp(BaseModel):
    """Power vs temperature relationship."""

    slope_per_celsius: float | None = None
    intercept: float | None = None
    r_squared: float | None = None
    optimal_range_c: tuple[float, float] | None = None
    data_points: int = 0


class WeatherPowerVsWind(BaseModel):
    """Power vs wind relationship."""

    headwind_penalty_pct: float | None = None
    tailwind_boost_pct: float | None = None
    crosswind_penalty_pct: float | None = None
    power_vs_speed_slope: float | None = None
    power_vs_speed_r_squared: float | None = None
    data_points: dict[str, int] | None = None


class WeatherDecouplingVsTemp(BaseModel):
    """Decoupling vs temperature relationship."""

    slope_per_celsius: float | None = None
    r_squared: float | None = None
    threshold_c: float | None = None
    penalty_above_pct: float | None = None
    data_points: int = 0


class WeatherHrVsTemp(BaseModel):
    """Heart rate vs temperature relationship."""

    slope_bpm_per_celsius: float | None = None
    intercept: float | None = None
    r_squared: float | None = None
    data_points: int = 0


class WeatherCoefficients(BaseModel):
    """Multi-variate weather coefficients for power prediction."""

    features: list[str]
    coefficients: dict[str, float]
    intercept: float
    r_squared: float
    data_points: int


class WeatherAnalysisResponse(BaseModel):
    """Complete weather-performance analysis results."""

    power_vs_temp: WeatherPowerVsTemp | None = None
    power_vs_wind: WeatherPowerVsWind | None = None
    decoupling_vs_temp: WeatherDecouplingVsTemp | None = None
    hr_vs_temp: WeatherHrVsTemp | None = None
    weather_coefficients: WeatherCoefficients | None = None
    personalized_insights: list[str] = []
    analyzed_at: datetime | None = None
