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
from app.schemas.dashboard import DashboardSummary, WeeklyReport
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
