"""Cycling analysis service — TSS calculation, CTL/ATL/TSB, power curve from streams, zones."""

import math
import uuid
from dataclasses import dataclass
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


@dataclass
class FtpEstimateResult:
    """Structured result from FTP estimation."""
    ftp: float
    confidence: float  # 0.0 - 1.0
    method: str  # human-readable method description
    source_duration: int  # duration in seconds that was the primary signal
    all_estimates: list[dict]  # all individual estimates for transparency


def estimate_ftp_from_power_curve(power_curve: dict[int, float]) -> float | None:
    """Estimate FTP from best power at various durations.

    Uses a tiered approach with established multipliers:
    1. Best 20-min power × 0.95 (gold standard)
    2. Best 8-min power × 0.90 × 0.95 (well-established fallback)
    3. Best 5-min power × 0.95 (rough estimate)
    4. Best 60-min power (directly equals FTP by definition)

    Also includes Riegel extrapolation from shorter efforts as an
    additional signal with lower confidence.
    """
    if not power_curve:
        return None

    result = estimate_ftp_from_power_curve_detailed(power_curve)
    return result.ftp if result else None


def _riegel_extrapolate(power: float, from_duration: int, to_duration: int = 3600) -> float:
    """Riegel endurance extrapolation: T2 = T1 × (D2/D1)^1.06.

    Given power at from_duration, extrapolate what power could be
    sustained at to_duration using Riegel's formula applied to power.
    We use: P2 = P1 × (D1/D2)^0.06 as an approximation.
    """
    if from_duration <= 0 or to_duration <= 0 or from_duration >= to_duration:
        return 0.0
    ratio = (from_duration / to_duration) ** 0.06
    return power * ratio


def estimate_ftp_from_power_curve_detailed(power_curve: dict[int, float]) -> FtpEstimateResult | None:
    """Estimate FTP with detailed result including confidence and method info.

    Uses a tiered approach with established multipliers plus Riegel
    extrapolation from shorter efforts as an additional signal.
    """
    if not power_curve:
        return None

    FTP_FACTOR = 0.95

    estimates: list[tuple[float, float, int, str]] = []  # (ftp, confidence, duration, method)

    # 60-min power ≈ FTP directly (by definition)
    if 3600 in power_curve and power_curve[3600] > 0:
        estimates.append((power_curve[3600], 0.9, 3600, "60-min power (direct)"))

    # 20-min power × 0.95 (gold standard test)
    if 1200 in power_curve and power_curve[1200] > 0:
        estimates.append((power_curve[1200] * FTP_FACTOR, 1.0, 1200, "20-min × 0.95"))

    # 30-min power × 0.95 (close to FTP)
    if 1800 in power_curve and power_curve[1800] > 0:
        estimates.append((power_curve[1800] * FTP_FACTOR, 0.95, 1800, "30-min × 0.95"))

    # 8-min power × 0.90 × 0.95 (well-established alternative)
    if 480 in power_curve and power_curve[480] > 0:
        estimates.append((power_curve[480] * 0.90 * FTP_FACTOR, 0.85, 480, "8-min × 0.855"))

    # 10-min power × 0.92 (between 8min and 20min factors)
    if 600 in power_curve and power_curve[600] > 0:
        estimates.append((power_curve[600] * 0.92 * FTP_FACTOR, 0.7, 600, "10-min × 0.92 × 0.95"))

    # 5-min power × 0.95 (rough estimate, lower confidence)
    if 300 in power_curve and power_curve[300] > 0:
        estimates.append((power_curve[300] * FTP_FACTOR, 0.5, 300, "5-min × 0.95"))

    # Riegel extrapolation from shorter efforts as additional signals
    riegel_sources = [
        (300, "5-min Riegel → 60min"),
        (600, "10-min Riegel → 60min"),
        (1200, "20-min Riegel → 60min"),
    ]
    for src_dur, method_label in riegel_sources:
        if src_dur in power_curve and power_curve[src_dur] > 0:
            riegel_ftp = round(_riegel_extrapolate(power_curve[src_dur], src_dur, 3600), 1)
            if 50 <= riegel_ftp <= 600:
                # Riegel extrapolation confidence decreases with distance
                if src_dur >= 1200:
                    confidence = 0.6
                elif src_dur >= 600:
                    confidence = 0.4
                else:
                    confidence = 0.3
                estimates.append((riegel_ftp, confidence, src_dur, method_label))

    if not estimates:
        return None

    # Weighted average
    total_weight = sum(c for _, c, _, _ in estimates)
    if total_weight <= 0:
        return None

    weighted_ftp = sum(ftp * c for ftp, c, _, _ in estimates) / total_weight

    # Sanity check: FTP should be reasonable (50-600W for most humans)
    if weighted_ftp < 50 or weighted_ftp > 600:
        return None

    # Overall confidence: based on best available data duration
    best_estimate = max(estimates, key=lambda e: e[1])  # highest confidence
    overall_confidence = round(best_estimate[1], 2)

    # Determine primary method (highest confidence)
    primary_method = best_estimate[3]
    primary_duration = best_estimate[2]

    all_estimate_dicts = [
        {
            "ftp": round(ftp, 1),
            "confidence": round(conf, 2),
            "source_duration": dur,
            "method": method,
        }
        for ftp, conf, dur, method in estimates
    ]

    return FtpEstimateResult(
        ftp=round(weighted_ftp, 1),
        confidence=overall_confidence,
        method=primary_method,
        source_duration=primary_duration,
        all_estimates=all_estimate_dicts,
    )


# ── Typical Ranges ───────────────────────────────────────────────────────────

TYPICAL_RANGES: dict[str, dict[str, tuple[float, float]]] = {
    "ftp_w_per_kg": {
        "untrained": (0, 2.0),
        "recreational": (2.0, 3.0),
        "trained": (3.0, 4.0),
        "competitive": (4.0, 5.0),
        "elite": (5.0, 10.0),
    },
    "ctl": {
        "detraining": (0, 30),
        "maintaining": (30, 60),
        "building": (60, 100),
        "high": (100, 500),
    },
    "vi": {
        "excellent": (1.0, 1.05),
        "good": (1.05, 1.10),
        "moderate": (1.10, 1.20),
        "variable": (1.20, 2.0),
    },
}


# Friendly display labels for range names
RANGE_LABELS: dict[str, str] = {
    "untrained": "Untrained",
    "recreational": "Recreational",
    "trained": "Trained",
    "competitive": "Competitive",
    "elite": "Elite",
    "detraining": "Detraining",
    "maintaining": "Maintaining",
    "building": "Building",
    "high": "High Load",
    "excellent": "Excellent",
    "good": "Good",
    "moderate": "Moderate",
    "variable": "Variable",
}


def classify_metric(value: float, metric_name: str) -> str | None:
    """Classify a metric value into a range label."""
    ranges = TYPICAL_RANGES.get(metric_name)
    if not ranges:
        return None
    for label, (low, high) in ranges.items():
        if low <= value < high:
            return label
    return None


def get_metric_benchmark(value: float, metric_name: str) -> dict | None:
    """Get a benchmark classification for a metric value.

    Returns a dict with 'label' and 'range' keys, or None if not classifiable.
    """
    label = classify_metric(value, metric_name)
    if not label:
        return None
    ranges = TYPICAL_RANGES.get(metric_name, {})
    low, high = ranges.get(label, (0, 0))
    return {
        "label": RANGE_LABELS.get(label, label),
        "range": f"{low}–{high}" if high < 500 else f"{low}+",
        "raw_label": label,
    }


# ── Heart Rate Zones ─────────────────────────────────────────────────────────

HR_ZONES = [
    ("Z1", "Active Recovery", 0.0, 0.68),
    ("Z2", "Endurance", 0.68, 0.83),
    ("Z3", "Tempo", 0.83, 0.95),
    ("Z4", "Threshold", 0.95, 1.05),
    ("Z5", "VO2max", 1.05, 1.18),
    ("Z6", "Anaerobic", 1.18, 5.0),
]

# LTHR-based HR zones (Andy Coggan model for HR)
LTHR_HR_ZONES = [
    ("Z1", "Recovery", 0.00, 0.80),
    ("Z2", "Aerobic", 0.80, 0.89),
    ("Z3", "Tempo", 0.89, 0.95),
    ("Z4", "Threshold", 0.95, 1.05),
    ("Z5", "VO2max", 1.05, 5.0),
]


def compute_hr_zones_from_lthr(lthr: float) -> list[dict]:
    """Compute HR zone boundaries from Lactate Threshold Heart Rate.

    Returns a list of zone dicts with zone id, name, lower/upper HR bounds.
    Pure function — no database access needed.
    """
    if not lthr or lthr <= 0:
        return []

    zones = []
    for zone_id, zone_name, lower_pct, upper_pct in LTHR_HR_ZONES:
        zones.append({
            "zone": zone_id,
            "zone_name": zone_name,
            "lower_bound_hr": round(lthr * lower_pct),
            "upper_bound_hr": round(lthr * upper_pct) if upper_pct < 5.0 else round(lthr * 1.3),
        })
    return zones


async def compute_hr_zones_from_streams(
    db: AsyncSession,
    user_id: uuid.UUID,
    lthr: float,
    days: int = 30,
) -> list[dict]:
    """Compute heart rate zone distribution from HR stream data.

    Uses LTHR (Lactate Threshold Heart Rate) based zones.
    """
    if not lthr or lthr <= 0:
        return []

    cutoff = date.today() - timedelta(days=days)

    result = await db.execute(
        select(Activity.id)
        .where(
            Activity.user_id == user_id,
            Activity.average_heartrate.isnot(None),
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
            ActivityStream.stream_type == "heartrate",
        )
    )
    streams = list(result.scalars().all())

    zone_times: dict[str, int] = {z[0]: 0 for z in HR_ZONES}

    for stream in streams:
        data = stream.data.get("data", []) if isinstance(stream.data, dict) else []
        resolution = stream.resolution or 1

        for val in data:
            if val is None:
                continue
            hr = float(val)
            if hr <= 0:
                continue

            pct_lthr = hr / lthr
            for zone_id, _, lower, upper in HR_ZONES:
                if lower <= pct_lthr < upper:
                    zone_times[zone_id] += resolution
                    break
            else:
                zone_times["Z6"] += resolution

    total_time = sum(zone_times.values()) or 1

    zones = []
    for zone_id, zone_name, lower, upper in HR_ZONES:
        time_s = zone_times.get(zone_id, 0)
        zones.append({
            "zone": zone_id,
            "zone_name": zone_name,
            "lower_bound_hr": round(lthr * lower),
            "upper_bound_hr": round(lthr * upper),
            "time_seconds": time_s,
            "percentage": round(time_s / total_time * 100, 1),
        })

    return zones


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


# Simple in-memory cache for power curves to avoid recomputing on every request
_power_curve_cache: dict[str, tuple[float, dict[int, float]]] = {}
_POWER_CURVE_CACHE_TTL_SEC = 3600  # 1 hour


async def compute_power_curve_from_streams(
    db: AsyncSession,
    user_id: uuid.UUID,
    days: int = 90,
) -> dict[int, float]:
    """Compute the best power curve from activity stream data.

    Uses cumulative sums for efficient per-stream best-power computation and
    maintains per-duration bests across all streams in a single pass.

    Results are cached in-memory for 1 hour to avoid recomputing on every request.

    Returns a dict mapping duration_seconds -> best_power_watts.
    """
    import time

    cache_key = f"{user_id}:{days}"
    now = time.monotonic()
    cached = _power_curve_cache.get(cache_key)
    if cached and (now - cached[0]) < _POWER_CURVE_CACHE_TTL_SEC:
        return cached[1]

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

    # Sort buckets by duration so shorter durations are processed first;
    # once a duration exceeds the data length we can break early.
    sorted_buckets = sorted(POWER_DURATION_BUCKETS, key=lambda b: b[0])

    for stream in streams:
        data = stream.data.get("data", []) if isinstance(stream.data, dict) else []
        if not data or len(data) < 2:
            continue

        # Filter out None/zero values and use only positive power
        power_data = [float(p) for p in data if p is not None and float(p) > 0]
        n = len(power_data)
        if n < 2:
            continue

        # Build prefix sums once per stream — O(n)
        prefix = [0.0] * (n + 1)
        for i in range(n):
            prefix[i + 1] = prefix[i] + power_data[i]

        # Single pass over all duration buckets using the prefix sums
        for duration_sec, _ in sorted_buckets:
            if duration_sec > n:
                break  # remaining buckets are even longer

            # Find the window [i, i+duration_sec) with the highest average
            max_window_sum = 0.0
            for i in range(n - duration_sec + 1):
                window_sum = prefix[i + duration_sec] - prefix[i]
                if window_sum > max_window_sum:
                    max_window_sum = window_sum

            best_avg = max_window_sum / duration_sec
            if duration_sec not in best_power or best_avg > best_power[duration_sec]:
                best_power[duration_sec] = round(best_avg, 1)

    _power_curve_cache[cache_key] = (now, best_power)
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
