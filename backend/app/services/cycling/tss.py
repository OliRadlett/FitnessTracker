"""Cycling service — TSS calculation functions."""

import math
import uuid
from datetime import date

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

    Uses the % of HR reserve method.
    hrTSS = (duration_s / 3600) * (avg_hr_%HRR / threshold_%HRR) * 100
    """
    if not threshold_hr or threshold_hr <= resting_hr:
        return 0.0
    if not avg_hr or avg_hr <= resting_hr:
        return 0.0

    hr_range = threshold_hr - resting_hr
    avg_hrr = (avg_hr - resting_hr) / hr_range
    threshold_hrr = 1.0  # threshold is 100% HRR by definition

    hours = duration_seconds / 3600
    return round(hours * (avg_hrr / threshold_hrr) * 100, 1)


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
    """
    if not power_data or len(power_data) < 30:
        return None

    clean = [float(p) for p in power_data if p is not None and float(p) > 0]
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

    Priority: power-based TSS (if FTP available), else None.
    Returns the computed TSS or None.
    """
    if activity.tss is not None:
        return activity.tss

    if not ftp or ftp <= 0:
        return None

    # Use normalized_power if available, else average_power
    np = activity.normalized_power or activity.average_power
    if not np or not activity.duration_seconds:
        return None

    tss = calculate_power_tss(activity.duration_seconds, np, ftp)
    if tss > 0:
        activity.tss = tss
        return tss

    return None
