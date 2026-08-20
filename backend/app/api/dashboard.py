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
    latest_sleep_hours = latest_sleep.total_sleep_hours if latest_sleep else None

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
            HealthAlert.is_active.is_(True),
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
    lifting_volume = _safe_agg(row[1])

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
    total_tss = _safe_agg(row[1])

    # Avg recovery & HRV
    result = await db.execute(
        select(
            func.avg(DailyMetric.recovery_score),
            func.avg(DailyMetric.hrv_ms),
        )
        .where(DailyMetric.user_id == uid, DailyMetric.metric_date.between(monday, sunday))
    )
    row = result.one()
    avg_recovery = _safe_agg(row[0], default=None)
    avg_hrv = _safe_agg(row[1], default=None)

    # Avg sleep
    result = await db.execute(
        select(func.avg(SleepLog.total_sleep_seconds))
        .where(SleepLog.user_id == uid, SleepLog.sleep_date.between(monday, sunday))
    )
    avg_sleep_secs = _safe_agg(result.scalar(), default=None)
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
        lifting_by_month[row.month] = {"sessions": int(row.sessions), "volume": _safe_agg(row.volume)}

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
            "tss": _safe_agg(row.tss),
            "distance": _safe_agg(row.distance),
            "time": _safe_agg(row.time),
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
        safe = _safe_agg(row.avg_recovery, default=None)
        recovery_by_month[row.month] = round(safe, 1) if safe is not None else None

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


@router.get("/streaks", response_model=TrainingStreaks)
async def training_streaks(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get training streak and consistency metrics.

    Combines lifting sessions and activities to compute:
    - Current streak: consecutive days with any training
    - Longest streak: all-time record
    - Weekly consistency: % of last 12 weeks with >=3 training days
    - Monthly sessions: per-month session count for last 6 months
    """
    uid = current_user.id
    today = date.today()

    # Collect all distinct training dates (last 365 days for streak calculation)
    one_year_ago = today - timedelta(days=365)

    # Lifting dates
    lifting_dates_result = await db.execute(
        select(LiftingSession.session_date)
        .where(LiftingSession.user_id == uid, LiftingSession.session_date >= one_year_ago)
        .distinct()
    )
    training_dates: set[date] = set(lifting_dates_result.scalars().all())

    # Activity dates (Strava as source of truth)
    activity_dates_result = await db.execute(
        select(func.date(Activity.start_date).label("d"))
        .where(Activity.user_id == uid, Activity.source != "wahoo", Activity.start_date >= one_year_ago)
        .distinct()
    )
    for row in activity_dates_result.all():
        training_dates.add(row.d)

    if not training_dates:
        return TrainingStreaks()

    # Sort dates descending for streak calculation
    sorted_dates = sorted(training_dates, reverse=True)

    # Current streak: count consecutive days from today (or yesterday if no training today)
    current_streak = 0
    check_date = today
    # Allow streak to continue if trained today or yesterday
    if sorted_dates[0] < today - timedelta(days=1):
        current_streak = 0
    else:
        for d in sorted_dates:
            if d == check_date:
                current_streak += 1
                check_date -= timedelta(days=1)
            elif d < check_date:
                break

    # Longest streak
    longest_streak = 0
    if sorted_dates:
        sorted_asc = sorted(training_dates)
        streak = 1
        for i in range(1, len(sorted_asc)):
            if sorted_asc[i] == sorted_asc[i - 1] + timedelta(days=1):
                streak += 1
            else:
                longest_streak = max(longest_streak, streak)
                streak = 1
        longest_streak = max(longest_streak, streak)

    # Weekly consistency: % of last 12 weeks with >= 3 training days
    weeks_with_data = 0
    for w in range(12):
        week_start = today - timedelta(days=today.weekday()) - timedelta(weeks=w)
        week_end = week_start + timedelta(days=6)
        days_in_week = sum(1 for d in training_dates if week_start <= d <= week_end)
        if days_in_week >= 3:
            weeks_with_data += 1
    weekly_consistency_pct = round((weeks_with_data / 12) * 100, 1)

    # Monthly sessions for last 6 months
    six_months_ago = (today.replace(day=1) - timedelta(days=1))
    for _ in range(4):
        six_months_ago = (six_months_ago.replace(day=1) - timedelta(days=1))
    start_month = six_months_ago.replace(day=1)

    monthly_result = await db.execute(
        select(
            func.to_char(LiftingSession.session_date, "YYYY-MM").label("month"),
            func.count(LiftingSession.id).label("count"),
        )
        .where(LiftingSession.user_id == uid, LiftingSession.session_date >= start_month)
        .group_by(func.to_char(LiftingSession.session_date, "YYYY-MM"))
        .order_by(func.to_char(LiftingSession.session_date, "YYYY-MM"))
    )
    lifting_by_month: dict[str, int] = {row.month: int(row.count) for row in monthly_result.all()}

    activity_monthly_result = await db.execute(
        select(
            func.to_char(Activity.start_date, "YYYY-MM").label("month"),
            func.count(Activity.id).label("count"),
        )
        .where(Activity.user_id == uid, Activity.source != "wahoo", Activity.start_date >= start_month)
        .group_by(func.to_char(Activity.start_date, "YYYY-MM"))
        .order_by(func.to_char(Activity.start_date, "YYYY-MM"))
    )
    activity_by_month: dict[str, int] = {row.month: int(row.count) for row in activity_monthly_result.all()}

    monthly_sessions = []
    current = start_month
    while current <= today:
        month_key = current.strftime("%Y-%m")
        total = lifting_by_month.get(month_key, 0) + activity_by_month.get(month_key, 0)
        monthly_sessions.append({"month": month_key, "sessions": total})
        if current.month == 12:
            current = current.replace(year=current.year + 1, month=1)
        else:
            current = current.replace(month=current.month + 1)

    return TrainingStreaks(
        current_streak_days=current_streak,
        longest_streak_days=longest_streak,
        weekly_consistency_pct=weekly_consistency_pct,
        monthly_sessions=monthly_sessions,
    )


@router.get("/yearly-summary/{year}", response_model=YearlySummary)
async def yearly_summary(
    year: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a comprehensive yearly training review with monthly breakdown and year-over-year comparison."""
    uid = current_user.id
    year_start = date(year, 1, 1)
    year_end = date(year, 12, 31)
    today = date.today()
    # Don't query beyond today if it's the current year
    effective_end = min(year_end, today)

    # ── Totals ───────────────────────────────────────────────────────────
    CARDIO_SPORT_TYPES = ["cycling", "running", "swimming", "walking", "hiking"]

    # Total activities (cardio, Strava as source of truth)
    result = await db.execute(
        select(
            func.count(Activity.id),
            func.coalesce(func.sum(Activity.distance_meters), 0.0),
            func.coalesce(func.sum(Activity.duration_seconds), 0.0),
            func.coalesce(func.sum(Activity.tss), 0.0),
        )
        .where(
            Activity.user_id == uid,
            Activity.source != "wahoo",
            Activity.start_date >= year_start,
            Activity.start_date <= effective_end,
        )
    )
    row = result.one()
    total_activities = int(row[0] or 0)
    total_distance_m = _safe_agg(row[1])
    total_time_s = _safe_agg(row[2])
    total_tss = _safe_agg(row[3])

    # Total lifting sessions and volume
    result = await db.execute(
        select(
            func.count(LiftingSession.id),
            func.coalesce(func.sum(LiftingSession.total_volume_kg), 0.0),
        )
        .where(
            LiftingSession.user_id == uid,
            LiftingSession.session_date >= year_start,
            LiftingSession.session_date <= effective_end,
        )
    )
    row = result.one()
    total_lifting_sessions = int(row[0] or 0)
    total_lifting_volume_kg = _safe_agg(row[1])

    # ── Averages ─────────────────────────────────────────────────────────
    result = await db.execute(
        select(
            func.avg(DailyMetric.recovery_score),
            func.avg(DailyMetric.hrv_ms),
        )
        .where(
            DailyMetric.user_id == uid,
            DailyMetric.metric_date >= year_start,
            DailyMetric.metric_date <= effective_end,
        )
    )
    row = result.one()
    safe_ar = _safe_agg(row[0], default=None)
    avg_recovery = round(safe_ar, 1) if safe_ar is not None else None
    safe_ah = _safe_agg(row[1], default=None)
    avg_hrv = round(safe_ah, 1) if safe_ah is not None else None

    # ── PR count and highlights ──────────────────────────────────────────
    result = await db.execute(
        select(PersonalRecord)
        .where(
            PersonalRecord.user_id == uid,
            PersonalRecord.achieved_date >= year_start,
            PersonalRecord.achieved_date <= effective_end,
        )
        .order_by(PersonalRecord.achieved_date.desc())
    )
    year_prs = list(result.scalars().all())
    total_prs = len(year_prs)

    # Top 5 PR highlights by improvement % — compute from previous PRs if available
    pr_highlights: list[PRHighlight] = []
    for pr in year_prs[:5]:
        # Try to find previous PR for same exercise & record type to compute improvement
        prev_result = await db.execute(
            select(PersonalRecord)
            .where(
                PersonalRecord.user_id == uid,
                PersonalRecord.exercise_name == pr.exercise_name,
                PersonalRecord.record_type == pr.record_type,
                PersonalRecord.achieved_date < pr.achieved_date,
            )
            .order_by(PersonalRecord.achieved_date.desc())
            .limit(1)
        )
        prev_pr = prev_result.scalar_one_or_none()
        improvement_pct = None
        if prev_pr and prev_pr.estimated_1rm and prev_pr.estimated_1rm > 0 and pr.estimated_1rm:
            improvement_pct = round(
                ((pr.estimated_1rm - prev_pr.estimated_1rm) / prev_pr.estimated_1rm) * 100, 1
            )

        pr_highlights.append(PRHighlight(
            exercise_name=pr.exercise_name,
            record_type=pr.record_type,
            weight_kg=pr.weight_kg,
            reps=pr.reps,
            estimated_1rm=pr.estimated_1rm,
            achieved_date=pr.achieved_date,
            improvement_pct=improvement_pct,
        ))

    # ── Monthly breakdown ────────────────────────────────────────────────
    # Lifting by month
    result = await db.execute(
        select(
            func.to_char(LiftingSession.session_date, "YYYY-MM").label("month"),
            func.count(LiftingSession.id).label("sessions"),
            func.coalesce(func.sum(LiftingSession.total_volume_kg), 0.0).label("volume"),
        )
        .where(
            LiftingSession.user_id == uid,
            LiftingSession.session_date >= year_start,
            LiftingSession.session_date <= effective_end,
        )
        .group_by(func.to_char(LiftingSession.session_date, "YYYY-MM"))
        .order_by(func.to_char(LiftingSession.session_date, "YYYY-MM"))
    )
    lifting_by_month: dict[str, dict] = {}
    for row in result.all():
        lifting_by_month[row.month] = {"sessions": int(row.sessions), "volume": _safe_agg(row.volume)}

    # Activity by month
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
            Activity.start_date >= year_start,
            Activity.start_date <= effective_end,
        )
        .group_by(func.to_char(Activity.start_date, "YYYY-MM"))
        .order_by(func.to_char(Activity.start_date, "YYYY-MM"))
    )
    activity_by_month: dict[str, dict] = {}
    for row in result.all():
        activity_by_month[row.month] = {
            "sessions": int(row.sessions),
            "tss": _safe_agg(row.tss),
            "distance": _safe_agg(row.distance),
            "time": _safe_agg(row.time),
        }

    # PRs by month
    result = await db.execute(
        select(
            func.to_char(PersonalRecord.achieved_date, "YYYY-MM").label("month"),
            func.count(PersonalRecord.id).label("prs"),
        )
        .where(
            PersonalRecord.user_id == uid,
            PersonalRecord.achieved_date >= year_start,
            PersonalRecord.achieved_date <= effective_end,
        )
        .group_by(func.to_char(PersonalRecord.achieved_date, "YYYY-MM"))
    )
    prs_by_month: dict[str, int] = {}
    for row in result.all():
        prs_by_month[row.month] = int(row.prs)

    # Recovery by month
    result = await db.execute(
        select(
            func.to_char(DailyMetric.metric_date, "YYYY-MM").label("month"),
            func.avg(DailyMetric.recovery_score).label("avg_recovery"),
        )
        .where(
            DailyMetric.user_id == uid,
            DailyMetric.metric_date >= year_start,
            DailyMetric.metric_date <= effective_end,
            DailyMetric.recovery_score.isnot(None),
        )
        .group_by(func.to_char(DailyMetric.metric_date, "YYYY-MM"))
    )
    recovery_by_month: dict[str, float | None] = {}
    for row in result.all():
        safe = _safe_agg(row.avg_recovery, default=None)
        recovery_by_month[row.month] = round(safe, 1) if safe is not None else None

    # Build 12-month list
    months_list: list[MonthlySummaryItem] = []
    for m in range(1, 13):
        month_key = f"{year}-{m:02d}"
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

    # ── Highlights ───────────────────────────────────────────────────────
    # Best month by TSS
    best_month_tss: str | None = None
    best_month_tss_value: float = 0.0
    for item in months_list:
        if item.total_tss > best_month_tss_value:
            best_month_tss_value = item.total_tss
            best_month_tss = item.month

    # Longest ride
    result = await db.execute(
        select(Activity)
        .where(
            Activity.user_id == uid,
            Activity.source != "wahoo",
            Activity.sport_type.in_(CARDIO_SPORT_TYPES),
            Activity.start_date >= year_start,
            Activity.start_date <= effective_end,
        )
        .order_by(Activity.distance_meters.desc())
        .limit(1)
    )
    longest_act = result.scalar_one_or_none()
    longest_ride = None
    if longest_act and longest_act.distance_meters:
        longest_ride = BestActivity(
            id=longest_act.id,
            name=longest_act.name,
            sport_type=longest_act.sport_type,
            start_date=longest_act.start_date.date() if hasattr(longest_act.start_date, 'date') else longest_act.start_date,
            value=round(longest_act.distance_meters / 1000, 1),
            unit="km",
        )

    # Heaviest lift (by weight in any set)
    from app.models.lifting import LiftingSet
    result = await db.execute(
        select(LiftingSet, LiftingSession)
        .join(LiftingSession, LiftingSet.session_id == LiftingSession.id)
        .where(
            LiftingSession.user_id == uid,
            LiftingSession.session_date >= year_start,
            LiftingSession.session_date <= effective_end,
            LiftingSet.is_warmup == False,
        )
        .order_by(LiftingSet.weight_kg.desc())
        .limit(1)
    )
    heaviest_row = result.one_or_none()
    heaviest_lift = None
    if heaviest_row:
        heavy_set, heavy_session = heaviest_row
        heaviest_lift = BestActivity(
            id=heavy_session.id,
            name=f"{heavy_set.exercise_name} — {heavy_set.weight_kg}kg × {heavy_set.reps}",
            sport_type="powerlifting",
            start_date=heavy_session.session_date,
            value=heavy_set.weight_kg,
            unit="kg",
        )

    highlights = YearlyHighlights(
        best_month_tss=best_month_tss,
        best_month_tss_value=best_month_tss_value,
        longest_ride=longest_ride,
        heaviest_lift=heaviest_lift,
        total_prs=total_prs,
        pr_highlights=pr_highlights,
    )

    # ── Year-over-year comparison ────────────────────────────────────────
    yoy: YearOverYearComparison | None = None
    prev_year = year - 1
    prev_year_start = date(prev_year, 1, 1)
    prev_year_end = date(prev_year, 12, 31)

    # Check if previous year has any data
    result = await db.execute(
        select(func.count(Activity.id))
        .where(
            Activity.user_id == uid,
            Activity.source != "wahoo",
            Activity.start_date >= prev_year_start,
            Activity.start_date <= prev_year_end,
        )
    )
    prev_activity_count = int(result.scalar() or 0)

    if prev_activity_count > 0:
        # Previous year totals
        result = await db.execute(
            select(
                func.count(Activity.id),
                func.coalesce(func.sum(Activity.distance_meters), 0.0),
                func.coalesce(func.sum(Activity.duration_seconds), 0.0),
                func.coalesce(func.sum(Activity.tss), 0.0),
            )
            .where(
                Activity.user_id == uid,
                Activity.source != "wahoo",
                Activity.start_date >= prev_year_start,
                Activity.start_date <= prev_year_end,
            )
        )
        prev_row = result.one()
        prev_activities = int(prev_row[0] or 0)
        prev_distance = _safe_agg(prev_row[1])
        prev_time = _safe_agg(prev_row[2])
        prev_tss = _safe_agg(prev_row[3])

        result = await db.execute(
            select(
                func.count(LiftingSession.id),
                func.coalesce(func.sum(LiftingSession.total_volume_kg), 0.0),
            )
            .where(
                LiftingSession.user_id == uid,
                LiftingSession.session_date >= prev_year_start,
                LiftingSession.session_date <= prev_year_end,
            )
        )
        prev_lift_row = result.one()
        prev_lifting_sessions = int(prev_lift_row[0] or 0)
        prev_lifting_volume = _safe_agg(prev_lift_row[1])

        result = await db.execute(
            select(func.count(PersonalRecord.id))
            .where(
                PersonalRecord.user_id == uid,
                PersonalRecord.achieved_date >= prev_year_start,
                PersonalRecord.achieved_date <= prev_year_end,
            )
        )
        prev_prs = int(result.scalar() or 0)

        result = await db.execute(
            select(func.avg(DailyMetric.recovery_score))
            .where(
                DailyMetric.user_id == uid,
                DailyMetric.metric_date >= prev_year_start,
                DailyMetric.metric_date <= prev_year_end,
                DailyMetric.recovery_score.isnot(None),
            )
        )
        prev_avg_recovery_raw = result.scalar()
        safe_prev_ar = _safe_agg(prev_avg_recovery_raw, default=None)
        prev_avg_recovery = round(safe_prev_ar, 1) if safe_prev_ar is not None else None

        def _pct(current: float, prev: float) -> float | None:
            if prev == 0:
                return None
            return round(((current - prev) / prev) * 100, 1)

        yoy = YearOverYearComparison(
            activities_delta=total_activities - prev_activities,
            distance_delta_m=total_distance_m - prev_distance,
            time_delta_s=total_time_s - prev_time,
            tss_delta=total_tss - prev_tss,
            lifting_volume_delta_kg=total_lifting_volume_kg - prev_lifting_volume,
            lifting_sessions_delta=total_lifting_sessions - prev_lifting_sessions,
            prs_delta=total_prs - prev_prs,
            avg_recovery_delta=(
                round(avg_recovery - prev_avg_recovery, 1)
                if avg_recovery is not None and prev_avg_recovery is not None
                else None
            ),
            activities_pct=_pct(total_activities, prev_activities),
            distance_pct=_pct(total_distance_m, prev_distance),
            time_pct=_pct(total_time_s, prev_time),
            tss_pct=_pct(total_tss, prev_tss),
            lifting_volume_pct=_pct(total_lifting_volume_kg, prev_lifting_volume),
        )

    return YearlySummary(
        year=year,
        total_activities=total_activities,
        total_distance_m=total_distance_m,
        total_time_s=total_time_s,
        total_tss=total_tss,
        total_lifting_sessions=total_lifting_sessions,
        total_lifting_volume_kg=total_lifting_volume_kg,
        avg_recovery=avg_recovery,
        avg_hrv_ms=avg_hrv,
        months=months_list,
        highlights=highlights,
        year_over_year=yoy,
    )
