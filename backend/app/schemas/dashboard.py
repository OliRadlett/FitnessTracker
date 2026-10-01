from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel


class TodayActivitySummary(BaseModel):
    """Single activity summary for the today view."""

    model_config = {"from_attributes": True}
    id: UUID
    name: str
    sport_type: str
    start_date: datetime
    duration_seconds: int | None = None
    distance_meters: float | None = None
    average_power: float | None = None
    normalized_power: float | None = None
    average_heartrate: float | None = None
    tss: float | None = None
    calories: float | None = None


class TodayLiftingSummary(BaseModel):
    """Single lifting session summary for the today view."""

    model_config = {"from_attributes": True}
    id: UUID
    session_date: date
    focus: str | None = None
    duration_seconds: int | None = None
    rpe_session: float | None = None
    total_volume_kg: float = 0.0
    sets_count: int = 0


class RestDaySuggestion(BaseModel):
    """Auto-suggested rest day based on TSB, recovery, and training history."""

    should_rest: bool = False
    reasons: list[str] = []
    current_tsb: float | None = None
    latest_recovery: float | None = None
    consecutive_training_days: int = 0


class EngineConsensus(BaseModel):
    """One engine's vote on the daily verdict (plan §1).

    ``available: False`` with a ``reason`` is a first-class outcome, not an
    error. Cross-domain analysis runs weekly; before its first run the honest
    thing to show is "not run yet", because a verdict that silently omits an
    engine reads as unanimous agreement from the ones that spoke.
    """

    engine: str
    stance: str | None = None
    confidence: str | None = None
    available: bool = True
    reason: str | None = None
    note: str | None = None
    analyzed_at: datetime | None = None


class ProjectedLoadPoint(BaseModel):
    """One day of the forward look, from ``compute_tsb_projection``."""

    date: date
    ctl: float | None = None
    atl: float | None = None
    tsb: float | None = None


class TodayVerdict(BaseModel):
    """The unified daily verdict: all five engines, with provenance.

    The headline follows the *strongest* rest signal rather than an average of
    all engines. An average of "train" and "rest" produces "train, but rest", and
    the athlete acts on the first word - so an averaged verdict is worse than
    either engine's own answer.
    """

    should_rest: bool = False
    headline: str = ""
    reasons: list[str] = []
    consensus: list[EngineConsensus] = []
    projected_load: list[ProjectedLoadPoint] = []


class TodaySummary(BaseModel):
    """Aggregated today data for the dashboard today view."""

    today_activities: list[TodayActivitySummary] = []
    today_lifting_sessions: list[TodayLiftingSummary] = []
    today_tss: float = 0.0
    today_volume_kg: float = 0.0
    today_distance_meters: float = 0.0
    today_duration_seconds: int = 0
    latest_recovery: float | None = None
    latest_hrv_ms: float | None = None
    latest_strain: float | None = None
    latest_sleep_hours: float | None = None
    current_ctl: float = 0.0
    current_atl: float = 0.0
    current_tsb: float = 0.0
    active_alerts: int = 0
    # Shared verdict input (3.1) — Today Brief renders RestDayBanner from this.
    rest_day_suggestion: RestDaySuggestion | None = None
    # The enriched verdict (plan §1), composed from all five engines with
    # provenance. ``None`` only when composition failed outright — the page then
    # falls back to the legacy rest-only field above, which is retained for
    # exactly that path.
    verdict: TodayVerdict | None = None


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
    rest_day_suggestion: RestDaySuggestion | None = None


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


class TrainingStreaks(BaseModel):
    """Training streak and consistency metrics."""

    current_streak_days: int = 0
    longest_streak_days: int = 0
    weekly_consistency_pct: float = 0.0  # % of last 12 weeks with >=3 training days
    monthly_sessions: list[dict] = []  # [{month: "2026-01", sessions: 8}, ...]


# ── Yearly Summary ─────────────────────────────────────────────────────────


class PRHighlight(BaseModel):
    """A single PR highlight for the yearly summary."""

    exercise_name: str
    record_type: str
    weight_kg: float
    reps: int
    estimated_1rm: float | None = None
    achieved_date: date
    improvement_pct: float | None = None
    # Cycling PR fields (populated when pr_type == "cycling")
    pr_type: str | None = None  # "lifting" | "cycling"
    power_watts: float | None = None
    w_per_kg: float | None = None
    duration_label: str | None = None


class BestActivity(BaseModel):
    """A highlight activity (longest ride, etc.)."""

    id: UUID | None = None
    name: str
    sport_type: str
    start_date: date
    value: float  # the highlight metric (distance_m, duration_s, etc.)
    unit: str  # "km", "m", "kg", "hours"


class YearlyHighlights(BaseModel):
    """Best-of highlights for the year."""

    best_month_tss: str | None = None  # e.g. "2026-07"
    best_month_tss_value: float = 0.0
    longest_ride: BestActivity | None = None
    heaviest_lift: BestActivity | None = None
    total_prs: int = 0
    pr_highlights: list[PRHighlight] = []


class YearOverYearComparison(BaseModel):
    """Year-over-year delta values."""

    activities_delta: int = 0
    distance_delta_m: float = 0.0
    time_delta_s: float = 0.0
    tss_delta: float = 0.0
    lifting_volume_delta_kg: float = 0.0
    lifting_sessions_delta: int = 0
    prs_delta: int = 0
    avg_recovery_delta: float | None = None
    # Percentage changes (null if previous year had zero)
    activities_pct: float | None = None
    distance_pct: float | None = None
    time_pct: float | None = None
    tss_pct: float | None = None
    lifting_volume_pct: float | None = None


class YearlySummary(BaseModel):
    """Comprehensive yearly training review."""

    year: int
    # Totals
    total_activities: int = 0
    total_distance_m: float = 0.0
    total_time_s: float = 0.0
    total_tss: float = 0.0
    total_lifting_sessions: int = 0
    total_lifting_volume_kg: float = 0.0
    # Averages
    avg_recovery: float | None = None
    avg_hrv_ms: float | None = None
    # Monthly breakdown
    months: list[MonthlySummaryItem] = []
    # Highlights
    highlights: YearlyHighlights = YearlyHighlights()
    # Year-over-year comparison (null if no previous year data)
    year_over_year: YearOverYearComparison | None = None
