from datetime import date

from pydantic import BaseModel


class DashboardSummary(BaseModel):
    """Top-level summary for the dashboard."""
    weekly_volume_kg: float = 0.0
    weekly_sessions: int = 0
    weekly_tss: float = 0.0
    weekly_distance_meters: float = 0.0
    latest_recovery: float | None = None
    latest_hrv_ms: float | None = None
    latest_strain: float | None = None
    active_alerts_count: int = 0
    current_week_start: date
    current_week_end: date


class WeeklyReport(BaseModel):
    """Detailed weekly report."""
    week_start: date
    week_end: date
    lifting_sessions: int = 0
    lifting_volume_kg: float = 0.0
    cardio_sessions: int = 0
    total_tss: float = 0.0
    avg_recovery: float | None = None
    avg_hrv_ms: float | None = None
    avg_sleep_hours: float | None = None
    new_prs: int = 0


class MonthlySummaryItem(BaseModel):
    """Aggregated training stats for a single month."""
    month: str  # e.g. "2026-01"
    total_tss: float = 0.0
    lifting_volume_kg: float = 0.0
    total_distance_meters: float = 0.0
    total_time_seconds: float = 0.0
    lifting_sessions: int = 0
    cardio_sessions: int = 0
    pr_count: int = 0
    avg_recovery: float | None = None
