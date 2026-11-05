"""Calendar view assembly.

One dense read for the month/agenda surface. It joins plan days, activities,
lifting sessions, daily metrics, sleep, events and goal target dates for a
bounded range — and it deliberately reports what it cannot compare.

Rules encoded here (see ``plans/calendar-production-plan-2026-11.md``):

- **No invented load.** A plan day with ``planned_tss is None`` stays null.
  ``coverage`` says how many sessions actually carry a target; a strength day
  without one is not zero.
- **Dedupe the strength activity.** A strength ``Activity`` and a
  ``LiftingSession`` on the same date describe one session; the lift carries
  the sets. Load is not double-counted.
- **Bounded.** The range is capped at 62 days and lifting sessions are fetched
  by date, never all-time.
- **Degrade per section.** A goals/events/current-load failure is reported in
  ``unavailable`` and never 500s the calendar.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import Date, cast, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.daily_metric import DailyMetric
from app.models.event import Event
from app.models.goal import Goal
from app.models.lifting import LiftingSession
from app.models.sleep import SleepLog
from app.models.training_plan import TrainingPlan, TrainingPlanDay
from app.schemas.calendar import (
    CalendarActivity,
    CalendarCoverage,
    CalendarCurrent,
    CalendarDay,
    CalendarEvent,
    CalendarGoal,
    CalendarLift,
    CalendarLiftSet,
    CalendarMetric,
    CalendarPlan,
    CalendarPlanDay,
    CalendarRange,
    CalendarResponse,
    CalendarSleep,
    CalendarWeek,
)
from app.services.activity_context import context_to_ride_metrics
from app.services.cycling import CTL_WARMUP_DAYS, compute_training_load, get_daily_tss
from app.services.lifting import list_sessions

logger = logging.getLogger(__name__)

MAX_RANGE_DAYS = 62


def _validate_range(start: date, end: date) -> None:
    if end < start:
        raise ValueError("end must be on or after start")
    if (end - start).days > MAX_RANGE_DAYS:
        raise ValueError(f"range must be {MAX_RANGE_DAYS} days or fewer")


def _monday(value: date) -> date:
    return value - timedelta(days=value.weekday())


def _plan_day(day: TrainingPlanDay) -> CalendarPlanDay:
    return CalendarPlanDay(
        id=day.id,
        date=day.day_date,
        sport=day.sport,
        planned_type=day.planned_type,
        planned_tss=day.planned_tss,
        planned_duration_min=day.planned_duration_min,
        planned_focus=day.planned_focus,
        planned_exercises=day.planned_exercises,
        planned_volume_kg=day.planned_volume_kg,
        planned_rpe=day.planned_rpe,
        planned_power_watts=day.planned_power_watts,
        planned_zone=day.planned_zone,
        workout_description=day.workout_description,
        completed=bool(day.completed),
        actual_activity_id=day.activity_id,
        actual_lifting_session_id=day.lifting_session_id,
    )


def _metric(metric: DailyMetric) -> CalendarMetric:
    return CalendarMetric(
        date=metric.metric_date,
        recovery_score=metric.recovery_score,
        hrv_ms=metric.hrv_ms,
        strain=metric.strain,
        sleep_duration_minutes=metric.sleep_duration_minutes,
        sleep_efficiency=metric.sleep_efficiency,
        resting_hr=metric.resting_hr,
        respiratory_rate=metric.respiratory_rate,
    )


def _sleep(log: SleepLog) -> CalendarSleep:
    return CalendarSleep(
        date=log.sleep_date,
        source=log.source,
        total_sleep_seconds=log.total_sleep_seconds,
        deep_sleep_seconds=log.deep_sleep_seconds,
        rem_sleep_seconds=log.rem_sleep_seconds,
        light_sleep_seconds=log.light_sleep_seconds,
        awake_seconds=log.awake_seconds,
        sleep_efficiency=log.sleep_efficiency,
        sleep_start=log.sleep_start,
        sleep_end=log.sleep_end,
    )


def _lift(session: LiftingSession) -> CalendarLift:
    sets = sorted(
        session.sets or [],
        key=lambda s: (getattr(s, "order_index", 0) or 0, s.set_number, str(s.id)),
    )
    return CalendarLift(
        id=session.id,
        date=session.session_date,
        focus=session.focus,
        program_name=session.program_name,
        duration_seconds=session.duration_seconds,
        total_volume_kg=session.total_volume_kg,
        estimated_tss=session.estimated_tss,
        rpe_session=session.rpe_session,
        set_count=len(sets),
        session_split=session.session_split,
        session_class=session.session_class,
        sets=[
            CalendarLiftSet(
                exercise_name=s.exercise_name,
                set_number=s.set_number,
                weight_kg=s.weight_kg,
                reps=s.reps,
                rpe=s.rpe,
                is_warmup=bool(s.is_warmup),
                is_amrap=bool(s.is_amrap),
            )
            for s in sets
        ],
    )


async def _load_plan(
    db: AsyncSession,
    user_id: uuid.UUID,
    start: date,
    end: date,
    plan_id: uuid.UUID | None,
) -> tuple[TrainingPlan | None, list[TrainingPlanDay]]:
    if plan_id is not None:
        result = await db.execute(
            select(TrainingPlan).where(
                TrainingPlan.user_id == user_id,
                TrainingPlan.id == plan_id,
            )
        )
        plan = result.scalar_one_or_none()
        if plan is None:
            raise ValueError("Training plan not found")
    else:
        result = await db.execute(
            select(TrainingPlan)
            .where(
                TrainingPlan.user_id == user_id,
                TrainingPlan.status == "active",
            )
            .order_by(TrainingPlan.start_date.desc())
            .limit(1)
        )
        plan = result.scalar_one_or_none()

    if plan is None:
        return None, []

    result = await db.execute(
        select(TrainingPlanDay)
        .where(
            TrainingPlanDay.plan_id == plan.id,
            TrainingPlanDay.day_date >= start,
            TrainingPlanDay.day_date <= end,
        )
        .order_by(TrainingPlanDay.day_date, TrainingPlanDay.sport)
    )
    return plan, list(result.scalars().all())


async def _load_activities(
    db: AsyncSession, user_id: uuid.UUID, start: date, end: date
) -> list[CalendarActivity]:
    """Activity summaries for the range.

    No streams, GPS, route names or source rows: the calendar only needs the
    load and the headline metrics. ``Activity.source != 'wahoo'`` mirrors the
    activity list’s single-source rule (Wahoo rows are purged, but the rule is
    kept consistent with the rest of the API).
    """
    result = await db.execute(
        select(
            Activity.id,
            cast(Activity.start_date, Date).label("date"),
            Activity.start_date,
            Activity.sport_type,
            Activity.name,
            Activity.duration_seconds,
            Activity.distance_meters,
            Activity.tss,
            Activity.tss_source,
            Activity.average_power,
            Activity.normalized_power,
            Activity.average_heartrate,
            Activity.max_heartrate,
            Activity.elevation_gain_meters,
            Activity.calories,
            Activity.source,
            Activity.context,
        )
        .where(
            Activity.user_id == user_id,
            cast(Activity.start_date, Date) >= start,
            cast(Activity.start_date, Date) <= end,
            Activity.source != "wahoo",
        )
        .order_by(Activity.start_date)
    )
    out: list[CalendarActivity] = []
    for row in result.all():
        out.append(
            CalendarActivity(
                id=row.id,
                date=row.date,
                start_date=row.start_date,
                sport_type=row.sport_type,
                name=row.name,
                duration_seconds=row.duration_seconds,
                distance_meters=row.distance_meters,
                tss=row.tss,
                tss_source=row.tss_source,
                average_power=row.average_power,
                normalized_power=row.normalized_power,
                average_heartrate=row.average_heartrate,
                max_heartrate=row.max_heartrate,
                elevation_gain_meters=row.elevation_gain_meters,
                calories=row.calories,
                source=row.source,
                ride_context=context_to_ride_metrics(row.context, row.tss_source),
            )
        )
    return out


async def _load_metrics(
    db: AsyncSession, user_id: uuid.UUID, start: date, end: date
) -> dict[date, DailyMetric]:
    result = await db.execute(
        select(DailyMetric)
        .where(
            DailyMetric.user_id == user_id,
            DailyMetric.metric_date >= start,
            DailyMetric.metric_date <= end,
        )
        .order_by(DailyMetric.metric_date)
    )
    by_date: dict[date, DailyMetric] = {}
    for metric in result.scalars().all():
        existing = by_date.get(metric.metric_date)
        # Same rule as the old calendar endpoint: Whoop is the most complete.
        if existing is None or metric.source == "whoop":
            by_date[metric.metric_date] = metric
    return by_date


async def _load_sleep(
    db: AsyncSession, user_id: uuid.UUID, start: date, end: date
) -> dict[date, SleepLog]:
    result = await db.execute(
        select(SleepLog)
        .where(
            SleepLog.user_id == user_id,
            SleepLog.sleep_date >= start,
            SleepLog.sleep_date <= end,
        )
        .order_by(SleepLog.sleep_date)
    )
    by_date: dict[date, SleepLog] = {}
    for log in result.scalars().all():
        existing = by_date.get(log.sleep_date)
        if existing is None or log.source == "whoop":
            by_date[log.sleep_date] = log
    return by_date


async def _load_current(
    db: AsyncSession, user_id: uuid.UUID, today: date
) -> CalendarCurrent:
    """Today's CTL/ATL/TSB + recovery, best-effort.

    The calendar must still render if the load series is unavailable; callers
    catch and record ``unavailable['current']``.
    """
    current = CalendarCurrent()

    daily_tss = await get_daily_tss(
        db, user_id, today - timedelta(days=90 + CTL_WARMUP_DAYS), today
    )
    if daily_tss:
        series = compute_training_load(daily_tss, today, lookback_days=90)
        if series:
            last = series[-1]
            current = CalendarCurrent(
                ctl=round(float(last["ctl"]), 1),
                atl=round(float(last["atl"]), 1),
                tsb=round(float(last["tsb"]), 1),
            )

    latest_result = await db.execute(
        select(DailyMetric)
        .where(DailyMetric.user_id == user_id)
        .order_by(DailyMetric.metric_date.desc())
        .limit(1)
    )
    latest = latest_result.scalar_one_or_none()
    if latest is not None:
        current.recovery = latest.recovery_score
        current.strain = latest.strain
        if latest.sleep_duration_minutes:
            current.sleep_hours = round(latest.sleep_duration_minutes / 60, 2)

    if current.sleep_hours is None:
        sleep_result = await db.execute(
            select(SleepLog)
            .where(SleepLog.user_id == user_id)
            .order_by(SleepLog.sleep_date.desc())
            .limit(1)
        )
        latest_sleep = sleep_result.scalar_one_or_none()
        if latest_sleep is not None and latest_sleep.total_sleep_seconds:
            current.sleep_hours = round(latest_sleep.total_sleep_seconds / 3600, 2)

    return current


def _is_strength(day: TrainingPlanDay) -> bool:
    return day.sport == "strength"


def _coverage(plan_days: list[TrainingPlanDay]) -> CalendarCoverage:
    non_rest = [d for d in plan_days if d.sport != "rest"]
    targets = [d for d in non_rest if d.planned_tss is not None]
    return CalendarCoverage(
        planned_sessions=len(non_rest),
        target_sessions=len(targets),
        planned_tss=round(sum(d.planned_tss or 0.0 for d in targets), 1),
        strength_targets_missing=sum(
            1 for d in non_rest if _is_strength(d) and d.planned_tss is None
        ),
    )


def _weeks(
    start: date,
    end: date,
    plan_days: list[TrainingPlanDay],
    activities_by_date: dict[date, list[CalendarActivity]],
    lifts_by_date: dict[date, list[CalendarLift]],
) -> list[CalendarWeek]:
    linked_activity_ids = {
        d.activity_id for d in plan_days if d.activity_id is not None
    }
    linked_lift_ids = {
        d.lifting_session_id for d in plan_days if d.lifting_session_id is not None
    }

    plan_by_date: dict[date, list[TrainingPlanDay]] = {}
    for day in plan_days:
        plan_by_date.setdefault(day.day_date, []).append(day)

    out: list[CalendarWeek] = []
    cursor = _monday(start)
    while cursor <= end:
        week_end = cursor + timedelta(days=6)
        dates = [
            cursor + timedelta(days=i)
            for i in range(7)
            if start <= cursor + timedelta(days=i) <= end
        ]
        days_plan = [d for dt in dates for d in plan_by_date.get(dt, [])]
        non_rest = [d for d in days_plan if d.sport != "rest"]
        targets = [d for d in non_rest if d.planned_tss is not None]

        actual_tss = 0.0
        unplanned = 0
        for dt in dates:
            day_activities = activities_by_date.get(dt, [])
            day_lifts = lifts_by_date.get(dt, [])
            actual_tss += sum(a.tss or 0.0 for a in day_activities)
            actual_tss += sum(lift.estimated_tss or 0.0 for lift in day_lifts)
            for activity in day_activities:
                if activity.id in linked_activity_ids:
                    continue
                # Paired strength activity + lift is one session; the lift
                # carries the sets and already counts as one unplanned actual.
                if activity.sport_type == "strength" and day_lifts:
                    continue
                unplanned += 1
            for lift in day_lifts:
                if lift.id not in linked_lift_ids:
                    unplanned += 1

        out.append(
            CalendarWeek(
                week_start=cursor,
                week_end=week_end,
                iso_week=cursor.isocalendar().week,
                planned_sessions=len(non_rest),
                completed_sessions=sum(1 for d in non_rest if d.completed),
                target_sessions=len(targets),
                planned_tss=round(sum(d.planned_tss or 0.0 for d in targets), 1),
                actual_tss=round(actual_tss, 1),
                unplanned_actuals=unplanned,
            )
        )
        cursor += timedelta(days=7)
    return out


async def get_calendar(
    db: AsyncSession,
    user_id: uuid.UUID,
    start: date,
    end: date,
    plan_id: uuid.UUID | None = None,
) -> CalendarResponse:
    """Assemble a dense calendar range for one user.

    Raises ``ValueError`` for an invalid range or an explicit unknown plan;
    the router maps those to 422/404. Everything else degrades per section.
    """
    _validate_range(start, end)
    today = date.today()

    plan, plan_days = await _load_plan(db, user_id, start, end, plan_id)
    activities = await _load_activities(db, user_id, start, end)
    lifts_raw = await list_sessions(
        db,
        user_id,
        limit=500,
        offset=0,
        start_date=start,
        end_date=end,
    )
    lifts = [_lift(session) for session in lifts_raw]
    metrics = await _load_metrics(db, user_id, start, end)
    sleeps = await _load_sleep(db, user_id, start, end)

    unavailable: dict[str, str] = {}

    events: list[CalendarEvent] = []
    try:
        result = await db.execute(
            select(Event)
            .where(
                Event.user_id == user_id,
                Event.event_date >= start,
                Event.event_date <= end,
            )
            .order_by(Event.event_date)
        )
        events = [
            CalendarEvent(
                id=e.id,
                date=e.event_date,
                name=e.name,
                event_type=e.event_type,
                target_tss=e.target_tss,
            )
            for e in result.scalars().all()
        ]
    except Exception as exc:  # section must not kill the page
        logger.warning("Calendar events unavailable: %s", exc)
        # Never put the raw exception in a user-facing payload (the app has a
        # history of leaking backend strings); the log has the detail.
        unavailable["events"] = "temporarily unavailable"

    goals: list[CalendarGoal] = []
    try:
        result = await db.execute(
            select(Goal)
            .where(
                Goal.user_id == user_id,
                Goal.status == "active",
                Goal.target_date.is_not(None),
                Goal.target_date >= start,
                Goal.target_date <= end,
            )
            .order_by(Goal.target_date)
        )
        goals = [
            CalendarGoal(
                id=g.id,
                metric=g.metric,
                target_value=g.target_value,
                target_date=g.target_date,
                status=g.status,
            )
            for g in result.scalars().all()
        ]
    except Exception as exc:
        logger.warning("Calendar goals unavailable: %s", exc)
        unavailable["goals"] = "temporarily unavailable"

    current: CalendarCurrent | None = None
    try:
        current = await _load_current(db, user_id, today)
    except Exception as exc:
        logger.warning("Calendar current load unavailable: %s", exc)
        unavailable["current"] = "temporarily unavailable"

    activities_by_date: dict[date, list[CalendarActivity]] = {}
    for activity in activities:
        activities_by_date.setdefault(activity.date, []).append(activity)
    lifts_by_date: dict[date, list[CalendarLift]] = {}
    for lift in lifts:
        lifts_by_date.setdefault(lift.date, []).append(lift)
    plan_by_date: dict[date, list[CalendarPlanDay]] = {}
    for day in plan_days:
        plan_by_date.setdefault(day.day_date, []).append(_plan_day(day))

    days: list[CalendarDay] = []
    cursor = start
    while cursor <= end:
        days.append(
            CalendarDay(
                date=cursor,
                plan=sorted(plan_by_date.get(cursor, []), key=lambda d: d.sport),
                activities=activities_by_date.get(cursor, []),
                lifts=lifts_by_date.get(cursor, []),
                metric=_metric(metrics[cursor]) if cursor in metrics else None,
                sleep=_sleep(sleeps[cursor]) if cursor in sleeps else None,
            )
        )
        cursor += timedelta(days=1)

    return CalendarResponse(
        range=CalendarRange(start=start, end=end),
        today=today,
        plan=(
            CalendarPlan(
                id=plan.id,
                name=plan.name,
                start_date=plan.start_date,
                end_date=plan.end_date,
                status=plan.status,
            )
            if plan is not None
            else None
        ),
        coverage=_coverage(plan_days),
        days=days,
        weeks=_weeks(start, end, plan_days, activities_by_date, lifts_by_date),
        events=events,
        goals=goals,
        current=current,
        unavailable=unavailable,
    )
