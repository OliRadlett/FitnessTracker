"""Cycling service — TSS calculation functions."""

import math
import uuid
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity


def calculate_power_tss(
    duration_seconds: int,
    normalized_power: float,
    ftp: float,
) -> float:
    """Calculate power-based Training Stress Score (TSS).

    TSS = (duration_s * NP * IF) / (FTP * 3600) * 100
    where IF = NP / FTP
    """
    if not ftp or ftp <= 0 or not normalized_power or normalized_power <= 0:
        return 0.0
    if not duration_seconds or duration_seconds <= 0:
        return 0.0

    intensity_factor = normalized_power / ftp
    tss = (duration_seconds * normalized_power * intensity_factor) / (ftp * 3600) * 100
    return round(tss, 1)


def calculate_hr_tss(
    duration_seconds: int,
    avg_hr: float,
    threshold_hr: float,
    resting_hr: float = 60,
) -> float:
    """Calculate heart rate-based TSS (hrTSS).

    Uses the % of HR reserve method (TrainingPeaks convention — quadratic
    in intensity, like power TSS):
    hrTSS = (duration_s / 3600) * (avg_hr_%HRR / threshold_%HRR)^2 * 100
    """
    if not threshold_hr or threshold_hr <= resting_hr:
        return 0.0
    if not avg_hr or avg_hr <= resting_hr:
        return 0.0

    hr_range = threshold_hr - resting_hr
    avg_hrr = (avg_hr - resting_hr) / hr_range
    threshold_hrr = 1.0  # threshold is 100% HRR by definition

    hours = duration_seconds / 3600
    return round(hours * (avg_hrr / threshold_hrr) ** 2 * 100, 1)


def calculate_intensity_factor(normalized_power: float, ftp: float) -> float | None:
    """IF = NP / FTP."""
    if not ftp or ftp <= 0 or not normalized_power:
        return None
    return round(normalized_power / ftp, 3)


def calculate_variability_index(
    normalized_power: float, avg_power: float
) -> float | None:
    """VI = NP / AP. Lower is better (more steady)."""
    if not avg_power or avg_power <= 0 or not normalized_power:
        return None
    return round(normalized_power / avg_power, 3)


def compute_normalized_power(power_data: list[float]) -> float | None:
    """Compute Normalized Power from per-second power data.

    Standard algorithm:30-second rolling average → 4th power mean → 4th root.
    Zero-watt samples (coasting) are valid data and must be kept — dropping
    them compresses the timeline and inflates NP. Only None/non-finite
    samples are discarded.
    """
    if not power_data or len(power_data) < 30:
        return None

    clean = [
        float(p) for p in power_data if p is not None and math.isfinite(float(p))
    ]
    if len(clean) < 30:
        return None

    # 30-second rolling average
    rolling = []
    s = sum(clean[:30])
    rolling.append(s / 30)
    for i in range(1, len(clean) - 29):
        s = s - clean[i - 1] + clean[i + 29]
        rolling.append(s / 30)

    if not rolling:
        return None

    return round((sum(v**4 for v in rolling) / len(rolling)) ** 0.25, 1)


def calculate_vam(elevation_gain_m: float, duration_seconds: int) -> float | None:
    """VAM = elevation_gain / (duration_hours). Vertical ascent meters per hour."""
    if not elevation_gain_m or not duration_seconds or duration_seconds <= 0:
        return None
    return round(elevation_gain_m / (duration_seconds / 3600), 1)


async def get_daily_tss(
    db: AsyncSession,
    user_id: uuid.UUID,
    start_date: date,
    end_date: date,
) -> dict[date, float]:
    """Aggregate daily TSS from all activities for a user."""
    result = await db.execute(
        select(
            func.date(Activity.start_date).label("day"),
            func.coalesce(func.sum(Activity.tss), 0.0).label("total_tss"),
        )
        .where(
            Activity.user_id == user_id,
            Activity.tss.isnot(None),
            Activity.start_date >= start_date,
            Activity.start_date <= end_date,
        )
        .group_by(func.date(Activity.start_date))
    )
    rows = result.all()
    return {
        row.day: (v if math.isfinite(v := float(row.total_tss)) else 0.0)
        for row in rows
    }


async def auto_compute_tss_for_activity(
    db: AsyncSession,
    activity: Activity,
    ftp: float | None,
) -> float | None:
    """Auto-compute TSS for an activity if not already set.

    Priority: power-based TSS (if FTP available), else hrTSS from average HR
    (if LTHR + recent resting HR are available), else None.
    Returns the computed TSS or None.
    """
    if activity.tss is not None:
        return activity.tss

    if ftp and ftp > 0:
        # Use normalized_power if available, else average_power
        np = activity.normalized_power or activity.average_power
        if np and activity.duration_seconds:
            tss = calculate_power_tss(activity.duration_seconds, np, ftp)
            if tss > 0:
                activity.tss = tss
                return tss

    # Fallback: HR-based TSS for power-meter-less rides.
    hr_tss = await auto_compute_hr_tss_for_activity(db, activity)
    if hr_tss:
        activity.tss = hr_tss
        return hr_tss

    return None


async def auto_compute_hr_tss_for_activity(
    db: AsyncSession,
    activity: Activity,
) -> float | None:
    """HR-based TSS fallback for activities without usable power data.

    Needs the profile LTHR and a recent resting HR (≤30 days old); returns
    None when either is missing so no fabricated load is recorded.
    """
    from app.models.cycling import CyclingProfile
    from app.models.daily_metric import DailyMetric

    if not activity.average_heartrate or not activity.duration_seconds:
        return None

    result = await db.execute(
        select(CyclingProfile.lactate_threshold_hr).where(
            CyclingProfile.user_id == activity.user_id
        )
    )
    lthr = result.scalar_one_or_none()
    if not lthr or lthr <= 0:
        return None

    cutoff = date.today() - timedelta(days=30)
    result = await db.execute(
        select(DailyMetric.resting_hr)
        .where(
            DailyMetric.user_id == activity.user_id,
            DailyMetric.resting_hr.isnot(None),
            DailyMetric.metric_date >= cutoff,
        )
        .order_by(DailyMetric.metric_date.desc())
        .limit(1)
    )
    resting_hr = result.scalar_one_or_none()
    if not resting_hr or resting_hr <= 0:
        return None

    tss = calculate_hr_tss(
        activity.duration_seconds,
        activity.average_heartrate,
        lthr,
        resting_hr,
    )
    return tss if tss > 0 else None
