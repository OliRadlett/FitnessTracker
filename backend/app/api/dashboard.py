"""Dashboard API — summary and weekly report endpoints."""

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.activity import Activity
from app.models.daily_metric import DailyMetric
from app.models.health_alert import HealthAlert
from app.models.lifting import LiftingSession, PersonalRecord
from app.models.sleep import SleepLog
from app.models.user import User
from app.schemas.dashboard import DashboardSummary, MonthlySummaryItem, WeeklyReport
from app.services.auth import get_current_user

router = APIRouter()


def _week_bounds(offset_weeks: int = 0) -> tuple[date, date]:
    """Return (monday, sunday) for the current week, optionally offset."""
    today = date.today()
    monday = today - timedelta(days=today.weekday()) - timedelta(weeks=offset_weeks)
    sunday = monday + timedelta(days=6)
    return monday, sunday


@router.get("/summary", response_model=DashboardSummary)
async def dashboard_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the dashboard summary for the current week."""
    monday, sunday = _week_bounds()
    uid = current_user.id

    # Lifting volume this week
    result = await db.execute(
        select(func.coalesce(func.sum(LiftingSession.total_volume_kg), 0.0))
        .where(LiftingSession.user_id == uid, LiftingSession.session_date.between(monday, sunday))
    )
    weekly_volume = float(result.scalar() or 0.0)

    # Session count
    result = await db.execute(
        select(func.count(LiftingSession.id))
        .where(LiftingSession.user_id == uid, LiftingSession.session_date.between(monday, sunday))
    )
    weekly_sessions = int(result.scalar() or 0)

    # TSS this week (Strava is source of truth — exclude standalone Wahoo)
    result = await db.execute(
        select(func.coalesce(func.sum(Activity.tss), 0.0))
        .where(
            Activity.user_id == uid,
            Activity.source != "wahoo",
            Activity.start_date >= monday,
            Activity.start_date <= sunday,
        )
    )
    weekly_tss = float(result.scalar() or 0.0)

    # Weekly distance (cardio activities only — Strava as source of truth)
    CARDIO_SPORT_TYPES = ["cycling", "running", "swimming", "walking", "hiking"]
    result = await db.execute(
        select(func.coalesce(func.sum(Activity.distance_meters), 0.0))
        .where(
            Activity.user_id == uid,
            Activity.source != "wahoo",
            Activity.start_date >= monday,
            Activity.start_date <= sunday,
            Activity.sport_type.in_(CARDIO_SPORT_TYPES),
        )
    )
    weekly_distance = float(result.scalar() or 0.0)

    # Latest recovery & HRV
    result = await db.execute(
        select(DailyMetric)
        .where(DailyMetric.user_id == uid, DailyMetric.recovery_score.isnot(None))
        .order_by(DailyMetric.metric_date.desc())
        .limit(1)
    )
    latest_metric = result.scalar_one_or_none()
    latest_recovery = latest_metric.recovery_score if latest_metric else None
    latest_hrv = latest_metric.hrv_ms if latest_metric else None

    # Latest strain (from Whoop cycles)
    result = await db.execute(
        select(DailyMetric)
        .where(DailyMetric.user_id == uid, DailyMetric.strain.isnot(None))
        .order_by(DailyMetric.metric_date.desc())
        .limit(1)
    )
    latest_strain_metric = result.scalar_one_or_none()
    latest_strain = latest_strain_metric.strain if latest_strain_metric else None

    # Active alerts
    result = await db.execute(
        select(func.count(HealthAlert.id))
        .where(HealthAlert.user_id == uid, HealthAlert.status == "active")
    )
    active_alerts = int(result.scalar() or 0)

    return DashboardSummary(
        weekly_volume_kg=weekly_volume,
        weekly_sessions=weekly_sessions,
        weekly_tss=weekly_tss,
        weekly_distance_meters=weekly_distance,
        latest_recovery=latest_recovery,
        latest_hrv_ms=latest_hrv,
        latest_strain=latest_strain,
        active_alerts_count=active_alerts,
        current_week_start=monday,
        current_week_end=sunday,
    )


@router.get("/weekly-report", response_model=WeeklyReport)
async def weekly_report(
    weeks_back: int = Query(0, ge=0, le=12, description="0 = current week, 1 = last week, etc."),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a detailed weekly report."""
    monday, sunday = _week_bounds(offset_weeks=weeks_back)
    uid = current_user.id

    # Lifting
    result = await db.execute(
        select(
            func.count(LiftingSession.id),
            func.coalesce(func.sum(LiftingSession.total_volume_kg), 0.0),
        )
        .where(LiftingSession.user_id == uid, LiftingSession.session_date.between(monday, sunday))
    )
    row = result.one()
    lifting_sessions = int(row[0] or 0)
    lifting_volume = float(row[1] or 0.0)

    # Cardio sessions & TSS
    result = await db.execute(
        select(
            func.count(Activity.id),
            func.coalesce(func.sum(Activity.tss), 0.0),
        )
        .where(
            Activity.user_id == uid,
            Activity.start_date >= monday,
            Activity.start_date <= sunday,
            Activity.sport_type.in_(["cycling", "running", "swimming"]),
        )
    )
    row = result.one()
    cardio_sessions = int(row[0] or 0)
    total_tss = float(row[1] or 0.0)

    # Avg recovery & HRV
    result = await db.execute(
        select(
            func.avg(DailyMetric.recovery_score),
            func.avg(DailyMetric.hrv_ms),
        )
        .where(DailyMetric.user_id == uid, DailyMetric.metric_date.between(monday, sunday))
    )
    row = result.one()
    avg_recovery = float(row[0]) if row[0] is not None else None
    avg_hrv = float(row[1]) if row[1] is not None else None

    # Avg sleep
    result = await db.execute(
        select(func.avg(SleepLog.total_sleep_seconds))
        .where(SleepLog.user_id == uid, SleepLog.sleep_date.between(monday, sunday))
    )
    avg_sleep_secs = result.scalar()
    avg_sleep_hours = round(avg_sleep_secs / 3600, 1) if avg_sleep_secs else None

    # New PRs
    result = await db.execute(
        select(func.count(PersonalRecord.id))
        .where(
            PersonalRecord.user_id == uid,
            PersonalRecord.achieved_date.between(monday, sunday),
        )
    )
    new_prs = int(result.scalar() or 0)

    return WeeklyReport(
        week_start=monday,
        week_end=sunday,
        lifting_sessions=lifting_sessions,
        lifting_volume_kg=lifting_volume,
        cardio_sessions=cardio_sessions,
        total_tss=total_tss,
        avg_recovery=avg_recovery,
        avg_hrv_ms=avg_hrv,
        avg_sleep_hours=avg_sleep_hours,
        new_prs=new_prs,
    )


@router.get("/whoop-weekly")
async def whoop_weekly_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a weekly Whoop health summary.

    Returns average recovery, sleep, strain, sleep consistency, and best/worst recovery day.
    """
    uid = current_user.id
    monday, sunday = _week_bounds()
    prev_monday, prev_sunday = _week_bounds(offset_weeks=1)

    # Current week metrics
    result = await db.execute(
        select(DailyMetric)
        .where(
            DailyMetric.user_id == uid,
            DailyMetric.metric_date.between(monday, sunday),
            DailyMetric.source == "whoop",
        )
        .order_by(DailyMetric.metric_date)
    )
    current_week = list(result.scalars().all())

    # Previous week metrics
    result = await db.execute(
        select(DailyMetric)
        .where(
            DailyMetric.user_id == uid,
            DailyMetric.metric_date.between(prev_monday, prev_sunday),
            DailyMetric.source == "whoop",
        )
        .order_by(DailyMetric.metric_date)
    )
    prev_week = list(result.scalars().all())

    def _avg(values: list):
        valid = [v for v in values if v is not None]
        return round(sum(valid) / len(valid), 1) if valid else None

    def _trend(current: float | None, previous: float | None) -> str | None:
        if current is None or previous is None:
            return None
        diff_pct = ((current - previous) / previous) * 100
        if diff_pct > 5:
            return "up"
        elif diff_pct < -5:
            return "down"
        return "stable"

    cur_recovery = [m.recovery_score for m in current_week if m.recovery_score is not None]
    prev_recovery = [m.recovery_score for m in prev_week if m.recovery_score is not None]
    avg_recovery = _avg(cur_recovery)
    prev_avg_recovery = _avg(prev_recovery)

    cur_strain = [m.strain for m in current_week if m.strain is not None]
    prev_strain = [m.strain for m in prev_week if m.strain is not None]
    total_strain = round(sum(cur_strain), 1) if cur_strain else None
    prev_total_strain = round(sum(prev_strain), 1) if prev_strain else None

    cur_sleep = [m.sleep_duration_minutes for m in current_week if m.sleep_duration_minutes is not None]
    prev_sleep = [m.sleep_duration_minutes for m in prev_week if m.sleep_duration_minutes is not None]
    avg_sleep_hours = round(_avg(cur_sleep) / 60, 1) if _avg(cur_sleep) else None
    prev_avg_sleep_hours = round(_avg(prev_sleep) / 60, 1) if _avg(prev_sleep) else None

    # Best/worst recovery day
    best_day = max(current_week, key=lambda m: m.recovery_score or 0) if cur_recovery else None
    worst_day = min(current_week, key=lambda m: m.recovery_score or 200) if cur_recovery else None

    # Sleep consistency
    sleep_result = await db.execute(
        select(SleepLog)
        .where(
            SleepLog.user_id == uid,
            SleepLog.sleep_start.isnot(None),
            SleepLog.sleep_date.between(monday, sunday),
        )
    )
    sleep_logs = list(sleep_result.scalars().all())
    from app.services.whoop import compute_sleep_consistency
    consistency = compute_sleep_consistency(sleep_logs, window_days=7)

    return {
        "week_start": monday.isoformat(),
        "week_end": sunday.isoformat(),
        "avg_recovery": avg_recovery,
        "avg_recovery_trend": _trend(avg_recovery, prev_avg_recovery),
        "total_strain": total_strain,
        "total_strain_trend": _trend(total_strain, prev_total_strain),
        "avg_sleep_hours": avg_sleep_hours,
        "avg_sleep_trend": _trend(avg_sleep_hours, prev_avg_sleep_hours),
        "sleep_consistency": consistency["score"],
        "best_recovery_day": {
            "date": best_day.metric_date.isoformat(),
            "score": best_day.recovery_score,
        } if best_day else None,
        "worst_recovery_day": {
            "date": worst_day.metric_date.isoformat(),
            "score": worst_day.recovery_score,
        } if worst_day else None,
        "days_with_data": len(current_week),
    }


@router.get("/monthly-summary", response_model=list[MonthlySummaryItem])
async def monthly_summary(
    months: int = Query(6, ge=1, le=24, description="Number of months to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get training stats aggregated by month for the last N months."""
    uid = current_user.id
    today = date.today()
    # Start from the first day of (months-1) months ago
    start_month = (today.replace(day=1) - timedelta(days=1))
    for _ in range(months - 2):
        start_month = (start_month.replace(day=1) - timedelta(days=1))
    start_date = start_month.replace(day=1)

    # Lifting volume + sessions per month
    result = await db.execute(
        select(
            func.to_char(LiftingSession.session_date, "YYYY-MM").label("month"),
            func.count(LiftingSession.id).label("sessions"),
            func.coalesce(func.sum(LiftingSession.total_volume_kg), 0.0).label("volume"),
        )
        .where(
            LiftingSession.user_id == uid,
            LiftingSession.session_date >= start_date,
        )
        .group_by(func.to_char(LiftingSession.session_date, "YYYY-MM"))
        .order_by(func.to_char(LiftingSession.session_date, "YYYY-MM"))
    )
    lifting_by_month: dict[str, dict] = {}
    for row in result.all():
        lifting_by_month[row.month] = {"sessions": int(row.sessions), "volume": float(row.volume)}

    # Activity (cardio) stats per month — Strava as source of truth
    result = await db.execute(
        select(
            func.to_char(Activity.start_date, "YYYY-MM").label("month"),
            func.count(Activity.id).label("sessions"),
            func.coalesce(func.sum(Activity.tss), 0.0).label("tss"),
            func.coalesce(func.sum(Activity.distance_meters), 0.0).label("distance"),
            func.coalesce(func.sum(Activity.duration_seconds), 0.0).label("time"),
        )
        .where(
            Activity.user_id == uid,
            Activity.source != "wahoo",
            Activity.start_date >= start_date,
        )
        .group_by(func.to_char(Activity.start_date, "YYYY-MM"))
        .order_by(func.to_char(Activity.start_date, "YYYY-MM"))
    )
    activity_by_month: dict[str, dict] = {}
    for row in result.all():
        activity_by_month[row.month] = {
            "sessions": int(row.sessions),
            "tss": float(row.tss),
            "distance": float(row.distance),
            "time": float(row.time),
        }

    # PRs per month
    result = await db.execute(
        select(
            func.to_char(PersonalRecord.achieved_date, "YYYY-MM").label("month"),
            func.count(PersonalRecord.id).label("prs"),
        )
        .where(
            PersonalRecord.user_id == uid,
            PersonalRecord.achieved_date >= start_date,
        )
        .group_by(func.to_char(PersonalRecord.achieved_date, "YYYY-MM"))
    )
    prs_by_month: dict[str, int] = {}
    for row in result.all():
        prs_by_month[row.month] = int(row.prs)

    # Average recovery per month
    result = await db.execute(
        select(
            func.to_char(DailyMetric.metric_date, "YYYY-MM").label("month"),
            func.avg(DailyMetric.recovery_score).label("avg_recovery"),
        )
        .where(
            DailyMetric.user_id == uid,
            DailyMetric.metric_date >= start_date,
            DailyMetric.recovery_score.isnot(None),
        )
        .group_by(func.to_char(DailyMetric.metric_date, "YYYY-MM"))
    )
    recovery_by_month: dict[str, float | None] = {}
    for row in result.all():
        recovery_by_month[row.month] = round(float(row.avg_recovery), 1) if row.avg_recovery else None

    # Build list of all months in the range
    months_list: list[MonthlySummaryItem] = []
    current = start_date
    while current <= today:
        month_key = current.strftime("%Y-%m")
        lifting = lifting_by_month.get(month_key, {})
        activity = activity_by_month.get(month_key, {})
        months_list.append(
            MonthlySummaryItem(
                month=month_key,
                total_tss=activity.get("tss", 0.0),
                lifting_volume_kg=lifting.get("volume", 0.0),
                total_distance_meters=activity.get("distance", 0.0),
                total_time_seconds=activity.get("time", 0.0),
                lifting_sessions=lifting.get("sessions", 0),
                cardio_sessions=activity.get("sessions", 0),
                pr_count=prs_by_month.get(month_key, 0),
                avg_recovery=recovery_by_month.get(month_key),
            )
        )
        # Advance to next month
        if current.month == 12:
            current = current.replace(year=current.year + 1, month=1)
        else:
            current = current.replace(month=current.month + 1)

    return months_list
