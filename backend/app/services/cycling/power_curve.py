"""Cycling service — power curve computation from streams and FTP estimation."""

import math
import uuid
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity, ActivityStream
from app.models.cycling import FtpHistory

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


# ── FTP Estimation ──────────────────────────────────────────────────────────


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
                max_window_sum = max(max_window_sum, window_sum)

            best_avg = max_window_sum / duration_sec
            if duration_sec not in best_power or best_avg > best_power[duration_sec]:
                best_power[duration_sec] = round(best_avg, 1)

    _power_curve_cache[cache_key] = (now, best_power)
    return best_power


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
                    best_avg = max(best_avg, avg)
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
