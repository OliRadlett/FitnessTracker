"""Dashboard API — today endpoint."""

from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.activity import Activity
from app.models.daily_metric import DailyMetric
from app.models.health_alert import HealthAlert
from app.models.lifting import LiftingSession
from app.models.sleep import SleepLog
from app.models.user import User
from app.schemas.dashboard import (
    TodayActivitySummary,
    TodayLiftingSummary,
    TodaySummary,
)
from app.services.auth import get_current_user

router = APIRouter()


def _safe_agg(val, default=0.0):
    """Convert a SQL aggregation result to a safe float, guarding against NaN/Inf."""
    import math
    if val is None:
        return default
    try:
        f = float(val)
        return default if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return default


@router.get("/today", response_model=TodaySummary)
async def dashboard_today(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get today's training data summary."""
    from app.services.cycling import compute_training_load, get_daily_tss

    today = date.today()
    uid = current_user.id

    # Today's activities
    result = await db.execute(
        select(Activity)
        .where(
            Activity.user_id == uid,
            func.date(Activity.start_date) == today,
        )
        .order_by(Activity.start_date.desc())
    )
    activities = result.scalars().all()
    today_activities = [
        TodayActivitySummary(
            id=a.id,
            name=a.name,
            sport_type=a.sport_type,
            start_date=a.start_date,
            duration_seconds=a.duration_seconds,
            distance_meters=a.distance_meters,
            average_power=a.average_power,
            normalized_power=a.normalized_power,
            average_heartrate=a.average_heartrate,
            tss=a.tss,
            calories=a.calories,
        )
        for a in activities
    ]

    # Today's lifting sessions
    from app.models.lifting import LiftingSet
    result = await db.execute(
        select(
            LiftingSession,
            func.count(LiftingSet.id).label("sets_count"),
        )
        .outerjoin(LiftingSet, LiftingSet.session_id == LiftingSession.id)
        .where(
            LiftingSession.user_id == uid,
            LiftingSession.session_date == today,
        )
        .group_by(LiftingSession.id)
        .order_by(LiftingSession.created_at.desc())
    )
    lifting_rows = result.all()
    today_lifting_sessions = [
        TodayLiftingSummary(
            id=session.id,
            session_date=session.session_date,
            focus=session.focus,
            duration_seconds=session.duration_seconds,
            rpe_session=session.rpe_session,
            total_volume_kg=session.total_volume_kg or 0.0,
            sets_count=sets_count,
        )
        for session, sets_count in lifting_rows
    ]

    # Aggregated today metrics
    result = await db.execute(
        select(
            func.coalesce(func.sum(Activity.tss), 0.0),
            func.coalesce(func.sum(Activity.distance_meters), 0.0),
            func.coalesce(func.sum(Activity.duration_seconds), 0),
        ).where(
            Activity.user_id == uid,
            func.date(Activity.start_date) == today,
        )
    )
    agg = result.one()
    today_tss = _safe_agg(agg[0])
    today_distance = _safe_agg(agg[1])
    today_duration = int(agg[2] or 0)

    # Lifting volume today
    result = await db.execute(
        select(func.coalesce(func.sum(LiftingSession.total_volume_kg), 0.0))
        .where(
            LiftingSession.user_id == uid,
            LiftingSession.session_date == today,
        )
    )
    today_volume = _safe_agg(result.scalar())

    # Latest recovery, HRV, strain from DailyMetric
    result = await db.execute(
        select(DailyMetric)
        .where(DailyMetric.user_id == uid)
        .order_by(DailyMetric.metric_date.desc())
        .limit(1)
    )
    latest_metric = result.scalar_one_or_none()
    latest_recovery = latest_metric.recovery_score if latest_metric else None
    latest_hrv = latest_metric.hrv_ms if latest_metric else None
    latest_strain = latest_metric.strain if latest_metric else None

    # Latest sleep hours
    result = await db.execute(
        select(SleepLog)
        .where(SleepLog.user_id == uid)
        .order_by(SleepLog.sleep_date.desc())
        .limit(1)
    )
    latest_sleep = result.scalar_one_or_none()
    latest_sleep_hours = (
        round(latest_sleep.total_sleep_seconds / 3600, 1)
        if latest_sleep and latest_sleep.total_sleep_seconds
        else None
    )

    # Training load (CTL / ATL / TSB)
    start_date = today - timedelta(days=90)
    daily_tss = await get_daily_tss(db, uid, start_date, today)
    load_data = compute_training_load(daily_tss, today, lookback_days=90)
    current_ctl = load_data[-1]["ctl"] if load_data else 0.0
    current_atl = load_data[-1]["atl"] if load_data else 0.0
    current_tsb = load_data[-1]["tsb"] if load_data else 0.0

    # Active alerts
    result = await db.execute(
        select(func.count(HealthAlert.id))
        .where(
            HealthAlert.user_id == uid,
            HealthAlert.status == "active",
        )
    )
    active_alerts = int(result.scalar() or 0)

    return TodaySummary(
        today_activities=today_activities,
        today_lifting_sessions=today_lifting_sessions,
        today_tss=today_tss,
        today_volume_kg=today_volume,
        today_distance_meters=today_distance,
        today_duration_seconds=today_duration,
        latest_recovery=latest_recovery,
        latest_hrv_ms=latest_hrv,
        latest_strain=latest_strain,
        latest_sleep_hours=latest_sleep_hours,
        current_ctl=current_ctl,
        current_atl=current_atl,
        current_tsb=current_tsb,
        active_alerts=active_alerts,
    )
