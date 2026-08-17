"""Cycling analysis service — TSS calculation, CTL/ATL/TSB, power curve from streams, zones."""

import math
import uuid
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity, ActivityStream
from app.models.cycling import CyclingProfile, FtpHistory


# ── Constants ────────────────────────────────────────────────────────────────

CTL_DAYS = 42  # Chronic Training Load time constant
ATL_DAYS = 7   # Acute Training Load time constant

# Power zones as % of FTP (Andy Coggan model)
POWER_ZONES = [
    ("Z1", "Active Recovery", 0.0, 0.55),
    ("Z2", "Endurance", 0.55, 0.75),
    ("Z3", "Tempo", 0.75, 0.90),
    ("Z4", "Threshold", 0.90, 1.05),
    ("Z5", "VO2max", 1.05, 1.20),
    ("Z6", "Anaerobic", 1.20, 1.50),
    ("Z7", "Neuromuscular", 1.50, 5.0),
]

# Power duration buckets (seconds) for the power curve
POWER_DURATION_BUCKETS = [
    (5, "5s"),
    (10, "10s"),
    (15, "15s"),
    (30, "30s"),
    (60, "1min"),
    (120, "2min"),
    (300, "5min"),
    (600, "10min"),
    (1200, "20min"),
    (1800, "30min"),
    (2700, "45min"),
    (3600, "60min"),
    (5400, "90min"),
    (7200, "120min"),
]


# ── TSS Calculation ──────────────────────────────────────────────────────────


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


def calculate_variability_index(normalized_power: float, avg_power: float) -> float | None:
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

    return round((sum(v ** 4 for v in rolling) / len(rolling)) ** 0.25, 1)


def calculate_vam(elevation_gain_m: float, duration_seconds: int) -> float | None:
    """VAM = elevation_gain / (duration_hours). Vertical ascent meters per hour."""
    if not elevation_gain_m or not duration_seconds or duration_seconds <= 0:
        return None
    return round(elevation_gain_m / (duration_seconds / 3600), 1)


def estimate_ftp_from_power_curve(power_curve: dict[int, float]) -> float | None:
    """Estimate FTP from best power at various durations.

    Uses the best approach available:
    1. Best 20-min power × 0.95 (standard)
    2. Best 8-min power × 0.90 × 0.95 (fallback)
    3. Best 5-min power × 0.95 (rough estimate)
    """
    if 1200 in power_curve:  # 20 min
        return round(power_curve[1200] * 0.95, 1)
    if 480 in power_curve:  # 8 min
        return round(power_curve[480] * 0.90 * 0.95, 1)
    if 300 in power_curve:  # 5 min
        return round(power_curve[300] * 0.95, 1)
    return None


# ── CTL / ATL / TSB ─────────────────────────────────────────────────────────


def compute_training_load(
    daily_tss: dict[date, float],
    end_date: date,
    lookback_days: int = 90,
) -> list[dict]:
    """Compute CTL, ATL, and TSB for each day over a lookback period.

    Uses exponentially weighted moving averages:
    CTL_t = CTL_{t-1} + (TSS_t - CTL_{t-1}) × (1 - e^(-1/42))
    ATL_t = ATL_{t-1} + (TSS_t - ATL_{t-1}) × (1 - e^(-1/7))
    TSB_t = CTL_t - ATL_t

    Returns a list of dicts with keys: date, tss, ctl, atl, tsb.
    """
    start_date = end_date - timedelta(days=lookback_days)
    ctl_decay = 1 - math.exp(-1 / CTL_DAYS)
    atl_decay = 1 - math.exp(-1 / ATL_DAYS)

    result = []
    ctl = 0.0
    atl = 0.0

    current = start_date
    while current <= end_date:
        tss = daily_tss.get(current, 0.0)
        ctl = ctl + (tss - ctl) * ctl_decay
        atl = atl + (tss - atl) * atl_decay
        tsb = ctl - atl

        result.append({
            "date": current,
            "tss": round(tss, 1),
            "ctl": round(ctl, 1),
            "atl": round(atl, 1),
            "tsb": round(tsb, 1),
        })
        current += timedelta(days=1)

    return result


# ── Power Curve from Streams ─────────────────────────────────────────────────


async def compute_power_curve_from_streams(
    db: AsyncSession,
    user_id: uuid.UUID,
    days: int = 90,
) -> dict[int, float]:
    """Compute the best power curve from activity stream data.

    For each activity with power stream data, computes the best average power
    at each duration bucket using a rolling average approach.

    Returns a dict mapping duration_seconds -> best_power_watts.
    """
    cutoff = date.today() - timedelta(days=days)

    # Get all cycling activities with power data in the time range
    result = await db.execute(
        select(Activity.id)
        .where(
            Activity.user_id == user_id,
            Activity.sport_type == "cycling",
            Activity.average_power.isnot(None),
            Activity.start_date >= cutoff,
        )
    )
    activity_ids = [row[0] for row in result.all()]

    if not activity_ids:
        return {}

    # Fetch power streams for these activities
    result = await db.execute(
        select(ActivityStream)
        .where(
            ActivityStream.activity_id.in_(activity_ids),
            ActivityStream.stream_type == "watts",
        )
    )
    streams = list(result.scalars().all())

    best_power: dict[int, float] = {}

    for stream in streams:
        data = stream.data.get("data", []) if isinstance(stream.data, dict) else []
        if not data or len(data) < 2:
            continue

        # Filter out None/zero values and use only positive power
        power_data = [float(p) for p in data if p is not None and float(p) > 0]
        if len(power_data) < 2:
            continue

        # For each duration bucket, compute best average power
        for duration_sec, _ in POWER_DURATION_BUCKETS:
            if duration_sec > len(power_data):
                continue

            # Rolling average over the window
            best_avg = 0.0
            window_sum = sum(power_data[:duration_sec])
            best_avg = window_sum / duration_sec

            for i in range(1, len(power_data) - duration_sec + 1):
                window_sum = window_sum - power_data[i - 1] + power_data[i + duration_sec - 1]
                avg = window_sum / duration_sec
                if avg > best_avg:
                    best_avg = avg

            if duration_sec not in best_power or best_avg > best_power[duration_sec]:
                best_power[duration_sec] = round(best_avg, 1)

    return best_power


async def compute_power_zones_from_streams(
    db: AsyncSession,
    user_id: uuid.UUID,
    ftp: float,
    days: int = 30,
) -> list[dict]:
    """Compute power zone distribution from stream data.

    Returns time spent in each zone as seconds and percentage.
    """
    if not ftp or ftp <= 0:
        return []

    cutoff = date.today() - timedelta(days=days)

    result = await db.execute(
        select(Activity.id)
        .where(
            Activity.user_id == user_id,
            Activity.sport_type == "cycling",
            Activity.average_power.isnot(None),
            Activity.start_date >= cutoff,
        )
    )
    activity_ids = [row[0] for row in result.all()]

    if not activity_ids:
        return []

    result = await db.execute(
        select(ActivityStream)
        .where(
            ActivityStream.activity_id.in_(activity_ids),
            ActivityStream.stream_type == "watts",
        )
    )
    streams = list(result.scalars().all())

    # Zone time counters (in seconds, each sample = 1 second assuming 1s resolution)
    zone_times: dict[str, int] = {z[0]: 0 for z in POWER_ZONES}

    for stream in streams:
        data = stream.data.get("data", []) if isinstance(stream.data, dict) else []
        resolution = stream.resolution or 1

        for val in data:
            if val is None:
                continue
            power = float(val)
            if power <= 0:
                continue

            pct_ftp = power / ftp
            for zone_id, _, lower, upper in POWER_ZONES:
                if lower <= pct_ftp < upper:
                    zone_times[zone_id] += resolution
                    break
            else:
                # Above Z7
                zone_times["Z7"] += resolution

    total_time = sum(zone_times.values()) or 1

    zones = []
    for zone_id, zone_name, lower, upper in POWER_ZONES:
        time_s = zone_times.get(zone_id, 0)
        zones.append({
            "zone": zone_id,
            "zone_name": zone_name,
            "lower_bound_watts": round(ftp * lower, 1),
            "upper_bound_watts": round(ftp * upper, 1),
            "time_seconds": time_s,
            "percentage": round(time_s / total_time * 100, 1),
        })

    return zones


# ── Helpers ──────────────────────────────────────────────────────────────────


async def get_or_create_cycling_profile(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> CyclingProfile:
    """Get or create a cycling profile for the user."""
    result = await db.execute(
        select(CyclingProfile).where(CyclingProfile.user_id == user_id)
    )
    profile = result.scalar_one_or_none()
    if profile:
        return profile

    profile = CyclingProfile(user_id=user_id)
    db.add(profile)
    await db.flush()
    return profile


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
    return {row.day: float(row.total_tss) for row in rows}


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


# ── FTP Estimation Backfill ──────────────────────────────────────────────────


async def backfill_ftp_estimates(
    db: AsyncSession,
    user_id: uuid.UUID,
    months: int = 12,
) -> list[dict]:
    """Estimate FTP for historical monthly snapshots and create FTP history entries.

    For each month going back `months` months, computes the best power curve
    from stream data in that period and estimates FTP. Creates FtpHistory entries
    with source="estimated" for each month that yields a valid estimate.

    Returns a list of created entries as dicts.
    """
    from app.models.activity import Activity, ActivityStream

    today = date.today()
    created_entries = []

    for i in range(months, 0, -1):
        month_date = today.replace(day=1) - timedelta(days=(i - 1) * 30)
        if month_date > today:
            continue

        window_end = month_date + timedelta(days=30)
        window_start = window_end - timedelta(days=90)

        result = await db.execute(
            select(Activity.id)
            .where(
                Activity.user_id == user_id,
                Activity.sport_type == "cycling",
                Activity.average_power.isnot(None),
                Activity.start_date >= window_start,
                Activity.start_date < window_end,
            )
        )
        activity_ids = [row[0] for row in result.all()]

        if not activity_ids:
            continue

        result = await db.execute(
            select(ActivityStream)
            .where(
                ActivityStream.activity_id.in_(activity_ids),
                ActivityStream.stream_type == "watts",
            )
        )
        streams = list(result.scalars().all())

        best_power: dict[int, float] = {}
        for stream in streams:
            data = stream.data.get("data", []) if isinstance(stream.data, dict) else []
            if not data or len(data) < 2:
                continue
            power_data = [float(p) for p in data if p is not None and float(p) > 0]
            if len(power_data) < 2:
                continue

            for duration_sec, _ in POWER_DURATION_BUCKETS:
                if duration_sec > len(power_data):
                    continue
                window_sum = sum(power_data[:duration_sec])
                best_avg = window_sum / duration_sec
                for j in range(1, len(power_data) - duration_sec + 1):
                    window_sum = window_sum - power_data[j - 1] + power_data[j + duration_sec - 1]
                    avg = window_sum / duration_sec
                    if avg > best_avg:
                        best_avg = avg
                if duration_sec not in best_power or best_avg > best_power[duration_sec]:
                    best_power[duration_sec] = round(best_avg, 1)

        estimated_ftp = estimate_ftp_from_power_curve(best_power)
        if not estimated_ftp:
            continue

        existing = await db.execute(
            select(FtpHistory).where(
                FtpHistory.user_id == user_id,
                FtpHistory.effective_date == month_date,
            )
        )
        if existing.scalar_one_or_none() is not None:
            continue

        source_method = None
        if 1200 in best_power:
            source_method = f"20-min: {best_power[1200]} W × 0.95"
        elif 480 in best_power:
            source_method = f"8-min: {best_power[480]} W × 0.855"
        elif 300 in best_power:
            source_method = f"5-min: {best_power[300]} W × 0.95"

        entry = FtpHistory(
            user_id=user_id,
            ftp_watts=estimated_ftp,
            effective_date=month_date,
            source="estimated",
            notes=f"Backfill: {source_method}" if source_method else "Backfill from power data",
        )
        db.add(entry)
        created_entries.append({
            "effective_date": month_date.isoformat(),
            "ftp_watts": estimated_ftp,
            "source_method": source_method,
        })

    await db.flush()
    return created_entries
