"""Dashboard API — summary and weekly report endpoints."""

import math
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
from app.models.training_plan import TrainingPlan, TrainingPlanDay
from app.models.user import User
from app.schemas.dashboard import (
    BestActivity,
    DashboardSummary,
    MonthlySummaryItem,
    PRHighlight,
    RestDaySuggestion,
    TodayActivitySummary,
    TodayLiftingSummary,
    TodaySummary,
    TrainingStreaks,
    WeeklyReport,
    YearlyHighlights,
    YearlySummary,
    YearOverYearComparison,
)
from app.services.auth import get_current_user

router = APIRouter()


def _safe_agg(val, default=0.0):
    """Convert a SQL aggregation result to a safe float, guarding against NaN/Inf."""
    if val is None:
        return default
    try:
        f = float(val)
        return default if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return default


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
    weekly_volume = _safe_agg(result.scalar())

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
    weekly_tss = _safe_agg(result.scalar())

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
    weekly_distance = _safe_agg(result.scalar())

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

    # ── Rest day suggestion ─────────────────────────────────────────────
    rest_suggestion = await _suggest_rest_days(db, uid, latest_recovery)

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
        rest_day_suggestion=rest_suggestion,
    )


async def _suggest_rest_days(
    db: AsyncSession,
    user_id,
    latest_recovery: float | None,
) -> RestDaySuggestion:
    """Suggest rest days based on TSB, recovery, and training history."""
    reasons: list[str] = []
    should_rest = False
    current_tsb = None

    # 1. Check TSB
    from app.services.cycling import compute_training_load, get_daily_tss
    end_date = date.today()
    start_date = end_date - timedelta(days=90)
    daily_tss = await get_daily_tss(db, user_id, start_date, end_date)
    load_data = compute_training_load(daily_tss, end_date, lookback_days=90)
    if load_data:
        current_tsb = load_data[-1]["tsb"]
        if current_tsb < -25:
            should_rest = True
            reasons.append(f"TSB is {current_tsb:.0f} (threshold: -25)")

    # 2. Check recovery
    if latest_recovery is not None and latest_recovery < 40:
        # Check if recovery has been low for 2+ days
        result = await db.execute(
            select(DailyMetric.recovery_score)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.recovery_score.isnot(None),
                DailyMetric.recovery_score < 40,
            )
            .order_by(DailyMetric.metric_date.desc())
            .limit(3)
        )
        low_recovery_days = result.scalars().all()
        if len(low_recovery_days) >= 2:
            should_rest = True
            reasons.append(f"Recovery below 40% for {len(low_recovery_days)} consecutive days ({latest_recovery:.0f}%)")
        else:
            reasons.append(f"Low recovery: {latest_recovery:.0f}%")

    # 3. Check consecutive training days
    today = date.today()
    consecutive = 0
    for i in range(14):
        check_date = today - timedelta(days=i)
        # Check activities
        act_result = await db.execute(
            select(func.count(Activity.id))
            .where(
                Activity.user_id == user_id,
                Activity.source != "wahoo",
                func.date(Activity.start_date) == check_date,
            )
        )
        act_count = int(act_result.scalar() or 0)

        # Check lifting sessions
        lift_result = await db.execute(
            select(func.count(LiftingSession.id))
            .where(
                LiftingSession.user_id == user_id,
                LiftingSession.session_date == check_date,
            )
        )
        lift_count = int(lift_result.scalar() or 0)

        if act_count > 0 or lift_count > 0:
            consecutive += 1
        else:
            break

    if consecutive >= 6:
        should_rest = True
        reasons.append(f"{consecutive} consecutive training days (threshold: 6)")

    # 4. Check training plan rest day
    result = await db.execute(
        select(TrainingPlanDay)
        .join(TrainingPlan)
        .where(
            TrainingPlan.user_id == user_id,
            TrainingPlan.status == "active",
            TrainingPlanDay.day_date == today,
            TrainingPlanDay.planned_type == "rest",
        )
        .limit(1)
    )
    plan_rest = result.scalar_one_or_none()
    if plan_rest:
        should_rest = True
        reasons.append("Rest day scheduled in your training plan")

    return RestDaySuggestion(
        should_rest=should_rest,
        reasons=reasons,
        current_tsb=current_tsb,
        latest_recovery=latest_recovery,
        consecutive_training_days=consecutive,
    )


# Include sub-routers
from app.api.dashboard.today import router as today_router
from app.api.dashboard.weekly import router as weekly_router
from app.api.dashboard.yearly import router as yearly_router

router.include_router(today_router)
router.include_router(weekly_router)
router.include_router(yearly_router)
