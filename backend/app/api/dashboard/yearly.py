"""Dashboard API — yearly summary endpoint."""

from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.activity import Activity
from app.models.cycling import CyclingPowerRecord
from app.models.daily_metric import DailyMetric
from app.models.lifting import LiftingSession, PersonalRecord
from app.models.user import User
from app.schemas.dashboard import (
    BestActivity,
    MonthlySummaryItem,
    PRHighlight,
    YearlyHighlights,
    YearlySummary,
    YearOverYearComparison,
)
from app.services.auth import get_current_user
from app.services.charts import ChartService

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
        ).where(
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
        ).where(
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
        ).where(
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
    year_lifting_prs = list(result.scalars().all())

    # Also fetch cycling power PRs in the same year
    result = await db.execute(
        select(CyclingPowerRecord)
        .where(
            CyclingPowerRecord.user_id == uid,
            CyclingPowerRecord.achieved_date >= year_start,
            CyclingPowerRecord.achieved_date <= effective_end,
        )
        .order_by(CyclingPowerRecord.achieved_date.desc())
    )
    year_cycling_prs = list(result.scalars().all())

    total_prs = len(year_lifting_prs) + len(year_cycling_prs)

    # Top PR highlights by improvement % — lifting first, then cycling
    pr_highlights: list[PRHighlight] = []
    for pr in year_lifting_prs[:5]:
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
        if (
            prev_pr
            and prev_pr.estimated_1rm
            and prev_pr.estimated_1rm > 0
            and pr.estimated_1rm
        ):
            improvement_pct = round(
                ((pr.estimated_1rm - prev_pr.estimated_1rm) / prev_pr.estimated_1rm)
                * 100,
                1,
            )

        pr_highlights.append(
            PRHighlight(
                exercise_name=pr.exercise_name,
                record_type=pr.record_type,
                weight_kg=pr.weight_kg,
                reps=pr.reps,
                estimated_1rm=pr.estimated_1rm,
                achieved_date=pr.achieved_date,
                improvement_pct=improvement_pct,
                pr_type="lifting",
            )
        )

    # Add top cycling PR highlights (by improvement_pct, then power_watts)
    cycling_sorted = sorted(
        year_cycling_prs[:5],
        key=lambda p: (p.improvement_pct or 0, p.power_watts),
        reverse=True,
    )
    for pr in cycling_sorted:
        pr_highlights.append(
            PRHighlight(
                exercise_name=f"{pr.duration_label} Power",
                record_type="power",
                weight_kg=pr.power_watts,
                reps=pr.duration_seconds,
                estimated_1rm=pr.w_per_kg,
                achieved_date=pr.achieved_date,
                improvement_pct=pr.improvement_pct,
                pr_type="cycling",
                power_watts=pr.power_watts,
                w_per_kg=pr.w_per_kg,
                duration_label=pr.duration_label,
            )
        )

    # Sort highlights by achieved_date descending (most recent first)
    pr_highlights.sort(key=lambda h: h.achieved_date, reverse=True)
    pr_highlights = pr_highlights[:10]

    # ── Monthly breakdown ────────────────────────────────────────────────
    # Shared with the weekly summary via ChartService.monthly_breakdown, which
    # owns the grouping, the standalone-Wahoo exclusion, the PR merge across
    # lifting and cycling power, and the dense fill of empty months.
    #
    # Bounded by year-end rather than ``effective_end`` (= min(year_end, today))
    # on purpose. The original filled all twelve months of the year with zeros
    # for the ones that had not happened yet, and the "best month" highlights and
    # the frontend both expect twelve slots; bounding by today would return only
    # the months elapsed so far and change the shape of the response. The one
    # consequence is that a future-dated activity inside the current year is now
    # counted — which is what the twelve-month fill always implied anyway.
    months_list: list[MonthlySummaryItem] = [
        MonthlySummaryItem(**row)
        for row in await ChartService(db).monthly_breakdown(
            uid, start=year_start, end=date(year, 12, 31)
        )
    ]

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
            start_date=longest_act.start_date.date()
            if hasattr(longest_act.start_date, "date")
            else longest_act.start_date,
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
            LiftingSet.is_warmup.is_(False),
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
        select(func.count(Activity.id)).where(
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
            ).where(
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
            ).where(
                LiftingSession.user_id == uid,
                LiftingSession.session_date >= prev_year_start,
                LiftingSession.session_date <= prev_year_end,
            )
        )
        prev_lift_row = result.one()
        prev_lifting_sessions = int(prev_lift_row[0] or 0)
        prev_lifting_volume = _safe_agg(prev_lift_row[1])

        result = await db.execute(
            select(func.count(PersonalRecord.id)).where(
                PersonalRecord.user_id == uid,
                PersonalRecord.achieved_date >= prev_year_start,
                PersonalRecord.achieved_date <= prev_year_end,
            )
        )
        prev_prs = int(result.scalar() or 0)

        # Also count previous year's cycling power PRs
        result = await db.execute(
            select(func.count(CyclingPowerRecord.id)).where(
                CyclingPowerRecord.user_id == uid,
                CyclingPowerRecord.achieved_date >= prev_year_start,
                CyclingPowerRecord.achieved_date <= prev_year_end,
            )
        )
        prev_prs += int(result.scalar() or 0)

        result = await db.execute(
            select(func.avg(DailyMetric.recovery_score)).where(
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
