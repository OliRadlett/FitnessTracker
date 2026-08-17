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
    auto_estimate_ftp: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CyclingProfileUpdate(BaseModel):
    ftp_watts: float | None = Field(None, gt=0, le=1000, description="Functional Threshold Power in watts")
    weight_kg: float | None = Field(None, gt=20, le=300, description="Body weight in kg")
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


class PowerVsHrPoint(BaseModel):
    """A data point for power vs heart rate analysis."""
    power: float
    heart_rate: float
    date: date


class PowerVsHrResponse(BaseModel):
    """Power vs heart rate scatter data."""
    data: list[PowerVsHrPoint]
