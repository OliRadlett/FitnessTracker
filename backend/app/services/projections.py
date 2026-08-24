"""Projections & success prediction service — Phase 7.

Pure math functions (linear_regression, project_to_target, success_badge,
tsb_projection) are unit-testable without a database.  DB-backed functions
(compute_goal_projection, compute_metric_trend, compute_tsb_projection)
follow the ``(db, user_id, ...)`` convention.
"""

from __future__ import annotations

import logging
import math
import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cycling import FtpHistory
from app.models.daily_metric import DailyMetric
from app.models.goal import Goal, GoalCheckIn
from app.models.training_plan import TrainingPlan, TrainingPlanDay
from app.models.weight import WeightLog
from app.services.cycling.training_load import compute_training_load
from app.services.cycling.tss import get_daily_tss
from app.services.goal_metrics import METRIC_REGISTRY, resolve_metric
from app.services.goals import derive_direction

logger = logging.getLogger(__name__)

# ── Pure functions (unit-testable) ───────────────────────────────────────────


def linear_regression(
    points: list[tuple[date, float]],
) -> tuple[float, float, float, int]:
    """OLS regression on day-offsets.

    Returns ``(slope_per_day, intercept, r_squared, n)``.

    * ``slope_per_day``: positive = metric increasing, negative = decreasing.
    * ``r_squared``: 0–1, goodness of fit.
    * ``n``: number of data points.

    Raises ``ValueError`` if *n < 2*.
    """
    n = len(points)
    if n < 2:
        raise ValueError("Need at least 2 data points for regression")

    # Convert dates to day-offsets from the first date
    origin = points[0][0]
    xs = [(d - origin).days for d, _ in points]
    ys = [v for _, v in points]

    sum_x = sum(xs)
    sum_y = sum(ys)
    sum_xx = sum(x * x for x in xs)
    sum_xy = sum(x * y for x, y in zip(xs, ys))

    denom = n * sum_xx - sum_x * sum_x
    if denom == 0:
        # All x values identical — undefined slope
        return 0.0, ys[0], 0.0, n

    slope = (n * sum_xy - sum_x * sum_y) / denom
    intercept = (sum_y - slope * sum_x) / n

    # R² = SS_res / SS_tot  →  1 - SS_res/SS_tot
    ss_tot = sum((y - sum_y / n) ** 2 for y in ys)
    ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, ys))
    r_squared = 1.0 - (ss_res / ss_tot) if ss_tot > 0 else 0.0
    r_squared = max(0.0, min(1.0, r_squared))

    return slope, intercept, r_squared, n


def project_to_target(
    slope_per_day: float,
    intercept: float,
    current_date: date,
    current_value: float,
    target_value: float,
    direction: str,  # "increase" or "decrease"
) -> dict | None:
    """Extrapolate trend line to target crossing.

    Returns ``{"projected_date": date, "days_remaining": int}`` or ``None``
    if the slope is heading away from the target (wrong direction) or is zero.
    """
    if slope_per_day == 0:
        return None

    # Check direction alignment
    if direction == "increase" and slope_per_day <= 0:
        return None
    if direction == "decrease" and slope_per_day >= 0:
        return None

    # How many days from current_date until the trend line hits target?
    # trend(d) = intercept + slope * d  (d = day-offset from regression origin)
    # We need: intercept + slope * d = target_value
    # → d = (target_value - intercept) / slope
    # But we want days from *current_date*, so:
    # current_offset = (current_date - origin).days  ← unknown here
    # Instead: remaining = (target_value - current_value) / slope_per_day
    remaining = (target_value - current_value) / slope_per_day

    if remaining < 0:
        # Already past target (shouldn't happen if direction check passed,
        # but guard anyway)
        return None

    days_remaining = math.ceil(remaining)
    projected_date = current_date + timedelta(days=days_remaining)
    return {"projected_date": projected_date, "days_remaining": days_remaining}


def success_badge(
    slope_per_day: float,
    projected_date: date | None,
    target_date: date | None,
    n_points: int,
) -> str:
    """Badge only — no percentage.

    * ``"Not enough data"`` if n_points < 4
    * ``"On Track"`` if projected_date exists and projected_date <= target_date
    * ``"At Risk"`` if projected_date exists and projected_date <= target_date + 30 days
    * ``"Unlikely"`` if projected_date is None (slope wrong direction) or
      projected_date > target_date + 30 days
    * If no target_date: ``"On Track"`` if slope heading toward target, else ``"Unlikely"``
    """
    if n_points < 4:
        return "Not enough data"

    if projected_date is None:
        return "Unlikely"

    if target_date is None:
        # No deadline — heading toward target is enough
        return "On Track"

    if projected_date <= target_date:
        return "On Track"

    if projected_date <= target_date + timedelta(days=30):
        return "At Risk"

    return "Unlikely"


def tsb_projection(
    current_ctl: float,
    current_atl: float,
    planned_tss_per_day: list[tuple[date, float | None]],
) -> list[dict]:
    """Project CTL/ATL/TSB forward using planned TSS.

    Uses exponential moving average::

        CTL_new = CTL_old + (TSS - CTL_old) / 42
        ATL_new = ATL_old + (TSS - ATL_old) / 7

    Returns a list of ``{"date", "ctl", "atl", "tsb"}`` for each day.
    Days with ``None`` planned_tss use 0 (rest assumption).
    """
    CTL_DAYS = 42
    ATL_DAYS = 7

    ctl = current_ctl
    atl = current_atl
    result: list[dict] = []

    for day_date, raw_tss in planned_tss_per_day:
        tss = raw_tss if raw_tss is not None else 0.0
        ctl = ctl + (tss - ctl) / CTL_DAYS
        atl = atl + (tss - atl) / ATL_DAYS
        tsb = ctl - atl
        result.append(
            {
                "date": day_date,
                "ctl": round(ctl, 1),
                "atl": round(atl, 1),
                "tsb": round(tsb, 1),
            }
        )

    return result


# ── DB-backed functions ──────────────────────────────────────────────────────


async def compute_goal_projection(
    db: AsyncSession, user_id: uuid.UUID, goal_id: uuid.UUID
) -> dict:
    """Full projection for a goal.

    1. Load goal + validate ownership
    2. Fetch GoalCheckIns for this goal, last 12 weeks, ordered by date
    3. Resolve current value via goal_metrics.resolve_metric
    4. Run linear_regression on check-in (date, value) pairs
    5. project_to_target using goal.direction derived from starting_value vs target
    6. success_badge
    7. Build projection_line: [{date, value}] from first check-in to projected_date

    Returns dict matching GoalProjectionResponse schema.
    """
    # 1. Load goal
    result = await db.execute(
        select(Goal).where(Goal.id == goal_id, Goal.user_id == user_id)
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise LookupError("Goal not found")

    # 2. Fetch check-ins (last 12 weeks)
    twelve_weeks_ago = date.today() - timedelta(weeks=12)
    result = await db.execute(
        select(GoalCheckIn)
        .where(
            GoalCheckIn.goal_id == goal_id,
            GoalCheckIn.user_id == user_id,
            GoalCheckIn.check_in_date >= twelve_weeks_ago,
        )
        .order_by(GoalCheckIn.check_in_date.asc())
    )
    check_ins = list(result.scalars().all())

    # 3. Resolve current value
    current_value = await resolve_metric(db, user_id, goal.metric, goal.filter_json)

    # 4. Regression on check-in history
    points: list[tuple[date, float]] = [
        (ci.check_in_date, ci.value) for ci in check_ins
    ]

    trend = None
    projection = None
    badge = "Not enough data"
    projection_line: list[dict] = []

    direction = derive_direction(goal)

    if len(points) >= 2:
        slope, intercept, r_squared, n = linear_regression(points)

        trend = {
            "slope_per_day": round(slope, 6),
            "slope_per_week": round(slope * 7, 4),
            "r_squared": round(r_squared, 4),
            "data_points": n,
        }

        # 5. Project to target
        today = date.today()
        current = current_value if current_value is not None else points[-1][1]
        if direction:
            projection = project_to_target(
                slope, intercept, today, current, goal.target_value, direction
            )

        # 6. Badge
        badge = success_badge(
            slope_per_day=slope,
            projected_date=projection["projected_date"] if projection else None,
            target_date=goal.target_date,
            n_points=n,
        )

        # 7. Projection line: from first check-in to projected_date (or +90d max)
        end_date = (
            projection["projected_date"] if projection else today + timedelta(days=90)
        )
        # Cap at target_date + 60 days to avoid runaway lines
        if goal.target_date:
            end_date = min(end_date, goal.target_date + timedelta(days=60))

        line_start = points[0][0]
        line_end = min(end_date, today + timedelta(days=365))

        projection_line = []
        current_d = line_start
        while current_d <= line_end:
            val = intercept + slope * (current_d - points[0][0]).days
            projection_line.append({"date": current_d, "value": round(val, 2)})
            current_d += timedelta(days=1)

    elif len(points) == 1:
        # Single data point — no regression possible, but we can still show
        # current value and a "Not enough data" badge
        trend = None

    # Build history points
    history = [{"date": ci.check_in_date, "value": ci.value} for ci in check_ins]

    return {
        "goal_id": goal.id,
        "metric": goal.metric,
        "current_value": current_value,
        "target_value": goal.target_value,
        "target_date": goal.target_date,
        "direction": direction,
        "trend": trend,
        "projection": projection,
        "badge": badge,
        "history": history,
        "projection_line": projection_line,
    }


async def compute_metric_trend(
    db: AsyncSession,
    user_id: uuid.UUID,
    metric_key: str,
    filter_json: dict | None,
    months: int = 6,
) -> dict:
    """Trend for any metric in the registry.

    Fetches historical data points (reuse vo2max history for vo2max,
    FtpHistory for ftp_watts, WeightLog for body_weight,
    DailyMetric for resting_hr/hrv_ms).

    Returns ``{metric, current_value, trend, classification}``.
    """
    definition = METRIC_REGISTRY.get(metric_key)
    if definition is None:
        raise ValueError(f"Unknown metric: {metric_key!r}")

    cutoff = date.today() - timedelta(days=months * 30)
    points: list[tuple[date, float]] = []

    # Fetch historical data based on metric type
    if metric_key == "ftp_watts":
        result = await db.execute(
            select(FtpHistory.effective_date, FtpHistory.ftp_watts)
            .where(
                FtpHistory.user_id == user_id,
                FtpHistory.effective_date >= cutoff,
            )
            .order_by(FtpHistory.effective_date.asc())
        )
        points = [(row[0], float(row[1])) for row in result.all()]

    elif metric_key == "body_weight":
        result = await db.execute(
            select(WeightLog.date, WeightLog.weight_kilogram)
            .where(
                WeightLog.user_id == user_id,
                WeightLog.date >= cutoff,
            )
            .order_by(WeightLog.date.asc())
        )
        points = [(row[0], float(row[1])) for row in result.all()]

    elif metric_key == "resting_hr":
        result = await db.execute(
            select(DailyMetric.metric_date, DailyMetric.resting_hr)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.metric_date >= cutoff,
                DailyMetric.resting_hr.isnot(None),
            )
            .order_by(DailyMetric.metric_date.asc())
        )
        points = [(row[0], float(row[1])) for row in result.all()]

    elif metric_key == "hrv_ms":
        result = await db.execute(
            select(DailyMetric.metric_date, DailyMetric.hrv_ms)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.metric_date >= cutoff,
                DailyMetric.hrv_ms.isnot(None),
            )
            .order_by(DailyMetric.metric_date.asc())
        )
        points = [(row[0], float(row[1])) for row in result.all()]

    # Resolve current value
    current_value = await resolve_metric(db, user_id, metric_key, filter_json)

    # Compute trend
    trend = None
    classification = None

    if len(points) >= 2:
        slope, intercept, r_squared, n = linear_regression(points)
        trend = {
            "slope_per_day": round(slope, 6),
            "slope_per_week": round(slope * 7, 4),
            "r_squared": round(r_squared, 4),
            "data_points": n,
        }

        # Classify trend direction
        if slope > 0:
            classification = (
                "increasing"
                if definition.default_direction == "increase"
                else "increasing (against goal)"
            )
        elif slope < 0:
            classification = (
                "decreasing"
                if definition.default_direction == "decrease"
                else "decreasing (against goal)"
            )
        else:
            classification = "stable"

    return {
        "metric": metric_key,
        "current_value": current_value,
        "trend": trend,
        "classification": classification,
    }


async def compute_tsb_projection(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    days_ahead: int = 14,
) -> dict:
    """TSB projection for event-linked plans only.

    1. Load plan, validate ownership, check event_id is set (else 400)
    2. Get current CTL/ATL from training_load service
    3. Get planned TSS for next N days from TrainingPlanDay
    4. Run tsb_projection
    5. Compute race-day TSB (last entry)

    Returns ``{plan_id, event_date, current_tsb, race_day_tsb,
    projection, freshness_assessment}``.
    """
    # 1. Load plan
    result = await db.execute(
        select(TrainingPlan).where(
            TrainingPlan.id == plan_id, TrainingPlan.user_id == user_id
        )
    )
    plan = result.scalar_one_or_none()
    if not plan:
        raise LookupError("Training plan not found")

    if not plan.event_id:
        raise ValueError("Training plan is not linked to an event")

    # Get event date
    from app.models.event import Event

    result = await db.execute(select(Event.event_date).where(Event.id == plan.event_id))
    event_date = result.scalar_one_or_none()

    # 2. Get current CTL/ATL
    today = date.today()
    daily_tss = await get_daily_tss(db, user_id, today - timedelta(days=90), today)

    current_ctl = 0.0
    current_atl = 0.0
    current_tsb = 0.0

    if daily_tss:
        load_data = compute_training_load(daily_tss, today, lookback_days=90)
        if load_data:
            last = load_data[-1]
            current_ctl = last["ctl"]
            current_atl = last["atl"]
            current_tsb = last["tsb"]

    # 3. Get planned TSS for next N days
    result = await db.execute(
        select(TrainingPlanDay.day_date, TrainingPlanDay.planned_tss)
        .where(
            TrainingPlanDay.plan_id == plan_id,
            TrainingPlanDay.day_date >= today,
            TrainingPlanDay.day_date <= today + timedelta(days=days_ahead),
        )
        .order_by(TrainingPlanDay.day_date.asc())
    )
    planned_rows = result.all()

    # Build a full date range, filling gaps with None (rest assumption)
    planned_tss_map: dict[date, float | None] = {
        row[0]: float(row[1]) if row[1] is not None else None for row in planned_rows
    }
    planned_tss_per_day: list[tuple[date, float | None]] = []
    for i in range(days_ahead + 1):
        d = today + timedelta(days=i)
        planned_tss_per_day.append((d, planned_tss_map.get(d)))

    # 4. Run projection
    projection_data = tsb_projection(current_ctl, current_atl, planned_tss_per_day)

    # 5. Race-day TSB
    race_day_tsb = projection_data[-1]["tsb"] if projection_data else None

    # Freshness assessment
    freshness = None
    if race_day_tsb is not None:
        if race_day_tsb > 5:
            freshness = "Optimal freshness"
        elif race_day_tsb >= -5:
            freshness = "Neutral"
        elif race_day_tsb >= -10:
            freshness = "Slightly fatigued"
        else:
            freshness = "Fatigued"

    return {
        "plan_id": plan.id,
        "event_date": event_date,
        "current_tsb": round(current_tsb, 1),
        "race_day_tsb": race_day_tsb,
        "freshness_assessment": freshness,
        "projection": projection_data,
    }
