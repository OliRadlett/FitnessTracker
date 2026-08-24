"""Cycling service — VO2max estimation and decoupling analysis."""

import math
import uuid
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity, ActivityStream
from app.models.daily_metric import DailyMetric

# ── VO2max Estimation ─────────────────────────────────────────────────────


@dataclass
class Vo2maxEstimate:
    """VO2max estimation result."""

    vo2max: float  # ml/kg/min
    confidence: float  # 0.0 - 1.0
    method: str  # human-readable method description
    all_estimates: list[dict]  # individual estimates for transparency


def _classify_vo2max(vo2max: float) -> str:
    """Classify VO2max value into a fitness category.

    Based on general population norms (ml/kg/min):
    <35: Poor, 35-45: Below average, 45-55: Average, 55-65: Good, 65-75: Excellent, >75: Superior
    """
    if vo2max < 35:
        return "Poor"
    elif vo2max < 45:
        return "Below Average"
    elif vo2max < 55:
        return "Average"
    elif vo2max < 65:
        return "Good"
    elif vo2max < 75:
        return "Excellent"
    else:
        return "Superior"


async def estimate_vo2max(
    db: AsyncSession,
    user_id: uuid.UUID,
    days: int = 90,
) -> Vo2maxEstimate | None:
    """Estimate VO2max from power and/or heart rate data.

    Method 1 (Power-based): Uses ACSM cycling formula:
        VO2 (L/min) = (10.8 × watts) / body_mass_kg + 7
        Uses best 5-min power as proxy for VO2max power.
        Confidence: 0.7 if weight available, 0.5 without weight.

    Method 2 (HR-based): Uses Uth formula:
        VO2max = 15.3 × (HRmax / HRrest)
        HRmax from max_heartrate on activities, HRrest from daily metrics.
        Confidence: 0.6

    Returns the highest estimate with confidence level, or None if no data.
    """
    from app.services.cycling.power_curve import compute_power_curve_from_streams
    from app.services.cycling.training_load import get_or_create_cycling_profile

    estimates: list[tuple[float, float, str]] = []  # (vo2max, confidence, method)

    # ── Method 1: Power-based (ACSM) ──────────────────────────────────────
    # Get best 5-min power from streams
    best_power = await compute_power_curve_from_streams(db, user_id, days)
    power_5min = best_power.get(300)

    if power_5min and power_5min > 0:
        # Get weight from cycling profile
        profile = await get_or_create_cycling_profile(db, user_id)
        weight_kg = profile.weight_kg

        if weight_kg and weight_kg > 0:
            w_per_kg = power_5min / weight_kg
            # ACSM cycling equation: VO2 (L/min) = 10.8 × W / body_mass + 7
            # Convert to ml/kg/min: multiply by 1000 / body_mass
            vo2_l_min = (10.8 * power_5min) / weight_kg + 7
            # Wait — that's already in L/min for a person of that weight.
            # To get ml/kg/min: (vo2_l_min * 1000) / weight_kg
            vo2_ml_kg_min = (vo2_l_min * 1000) / weight_kg

            # Sanity check: VO2max between 20-90 ml/kg/min
            if 20 <= vo2_ml_kg_min <= 90:
                estimates.append(
                    (
                        round(vo2_ml_kg_min, 1),
                        0.7,
                        f"ACSM power-based (5-min: {power_5min}W, {w_per_kg:.1f} W/kg)",
                    )
                )
        else:
            # Without weight, estimate from power alone using typical weight assumptions
            # Use 75kg as default — very rough
            default_weight = 75.0
            w_per_kg = power_5min / default_weight
            vo2_l_min = (10.8 * power_5min) / default_weight + 7
            vo2_ml_kg_min = (vo2_l_min * 1000) / default_weight
            if 20 <= vo2_ml_kg_min <= 90:
                estimates.append(
                    (
                        round(vo2_ml_kg_min, 1),
                        0.4,
                        f"ACSM power-based (5-min: {power_5min}W, no weight — estimated with 75kg)",
                    )
                )

    # Also try best 8-min power as a secondary signal
    power_8min = best_power.get(480)
    if power_8min and power_8min > 0:
        profile = await get_or_create_cycling_profile(db, user_id)
        weight_kg = profile.weight_kg
        if weight_kg and weight_kg > 0:
            vo2_l_min = (10.8 * power_8min) / weight_kg + 7
            vo2_ml_kg_min = (vo2_l_min * 1000) / weight_kg
            if 20 <= vo2_ml_kg_min <= 90:
                estimates.append(
                    (
                        round(vo2_ml_kg_min, 1),
                        0.6,
                        f"ACSM power-based (8-min: {power_8min}W, {power_8min / weight_kg:.1f} W/kg)",
                    )
                )

    # ── Method 2: HR-based (Uth formula) ──────────────────────────────────
    # HRmax: get the highest max_heartrate from recent activities
    cutoff = date.today() - timedelta(days=days)
    result = await db.execute(
        select(func.max(Activity.max_heartrate)).where(
            Activity.user_id == user_id,
            Activity.max_heartrate.isnot(None),
            Activity.start_date >= cutoff,
        )
    )
    hr_max = result.scalar()

    # HRrest: get from the most recent daily_metric with resting_hr
    result = await db.execute(
        select(DailyMetric.resting_hr)
        .where(
            DailyMetric.user_id == user_id,
            DailyMetric.resting_hr.isnot(None),
        )
        .order_by(DailyMetric.metric_date.desc())
        .limit(1)
    )
    hr_rest_row = result.scalar_one_or_none()
    hr_rest = hr_rest_row

    if hr_max and hr_rest and hr_rest > 0 and hr_max > hr_rest:
        vo2max_hr = 15.3 * (hr_max / hr_rest)
        if 20 <= vo2max_hr <= 90:
            estimates.append(
                (
                    round(vo2max_hr, 1),
                    0.6,
                    f"Uth HR-based (HRmax: {hr_max:.0f}, HRrest: {hr_rest:.0f})",
                )
            )

    if not estimates:
        return None

    # Return the highest estimate
    best = max(estimates, key=lambda e: e[0])
    all_dicts = [
        {"vo2max": round(v, 1), "confidence": round(c, 2), "method": m}
        for v, c, m in estimates
    ]

    return Vo2maxEstimate(
        vo2max=best[0],
        confidence=best[1],
        method=best[2],
        all_estimates=all_dicts,
    )


async def compute_vo2max_history(
    db: AsyncSession,
    user_id: uuid.UUID,
    months: int = 12,
) -> list[dict]:
    """Compute VO2max estimates over time using monthly snapshots.

    Returns a list of dicts with 'date' and 'vo2max' keys.
    """
    from app.services.cycling.training_load import get_or_create_cycling_profile

    today = date.today()
    history = []

    for i in range(months, 0, -1):
        month_date = today.replace(day=1) - timedelta(days=(i - 1) * 30)
        if month_date > today:
            continue

        window_end = month_date + timedelta(days=30)
        window_start = window_end - timedelta(days=90)

        # Get best 5-min power in this window
        result = await db.execute(
            select(Activity.id).where(
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
            select(ActivityStream).where(
                ActivityStream.activity_id.in_(activity_ids),
                ActivityStream.stream_type == "watts",
            )
        )
        streams = list(result.scalars().all())

        best_5min = 0.0
        for stream in streams:
            data = stream.data.get("data", []) if isinstance(stream.data, dict) else []
            power_data = [float(p) for p in data if p is not None and float(p) > 0]
            if len(power_data) < 300:
                continue

            # Find best 5-min average
            prefix = [0.0] * (len(power_data) + 1)
            for k in range(len(power_data)):
                prefix[k + 1] = prefix[k] + power_data[k]

            max_sum = 0.0
            for k in range(len(power_data) - 299):
                s = prefix[k + 300] - prefix[k]
                max_sum = max(max_sum, s)
            avg = max_sum / 300
            best_5min = max(best_5min, avg)

        if best_5min <= 0:
            continue

        profile = await get_or_create_cycling_profile(db, user_id)
        weight_kg = profile.weight_kg or 75.0
        vo2_l_min = (10.8 * best_5min) / weight_kg + 7
        vo2_ml_kg_min = (vo2_l_min * 1000) / weight_kg

        if 20 <= vo2_ml_kg_min <= 90:
            history.append(
                {
                    "date": month_date,
                    "vo2max": round(vo2_ml_kg_min, 1),
                    "method": "power",
                }
            )

    return history


# ── Decoupling Analysis ─────────────────────────────────────────────────────


@dataclass
class DecouplingResult:
    """Decoupling analysis result for a single activity."""

    decoupling_pct: float  # percentage
    first_half_ratio: float  # power:HR ratio for 1st half
    second_half_ratio: float  # power:HR ratio for 2nd half
    classification: str  # "Excellent", "Acceptable", "Aerobic Deficiency"
    duration_seconds: int
    activity_id: uuid.UUID | None = None


def _classify_decoupling(pct: float) -> str:
    """Classify decoupling percentage.

    <5% = Excellent aerobic fitness
    5-8% = Acceptable
    >8% = Aerobic deficiency
    """
    if pct < 5:
        return "Excellent"
    elif pct <= 8:
        return "Acceptable"
    else:
        return "Aerobic Deficiency"


def compute_decoupling_from_streams(
    power_data: list[float],
    hr_data: list[float],
) -> dict | None:
    """Compute HR vs power decoupling from stream data.

    Splits the ride into two halves and computes power:HR ratio for each.
    Decoupling % = ((ratio_1st - ratio_2nd) / ratio_1st) × 100

    Both arrays must be the same length and contain valid data.
    Returns None if insufficient data.
    """
    if not power_data or not hr_data:
        return None

    # Ensure same length
    min_len = min(len(power_data), len(hr_data))
    if min_len < 60:  # need at least 1 minute of data
        return None

    power_data = power_data[:min_len]
    hr_data = hr_data[:min_len]

    # Filter to valid pairs (both power > 0 and HR > 0)
    valid_pairs = [
        (p, h)
        for p, h in zip(power_data, hr_data)
        if p is not None and h is not None and float(p) > 0 and float(h) > 0
    ]

    if len(valid_pairs) < 60:
        return None

    # Split into two halves
    mid = len(valid_pairs) // 2
    first_half = valid_pairs[:mid]
    second_half = valid_pairs[mid:]

    if len(first_half) < 30 or len(second_half) < 30:
        return None

    # Compute average power:HR ratio for each half
    ratio_1 = sum(p / h for p, h in first_half) / len(first_half)
    ratio_2 = sum(p / h for p, h in second_half) / len(second_half)

    if ratio_1 <= 0:
        return None

    decoupling_pct = ((ratio_1 - ratio_2) / ratio_1) * 100

    return {
        "decoupling_pct": round(decoupling_pct, 1),
        "first_half_ratio": round(ratio_1, 4),
        "second_half_ratio": round(ratio_2, 4),
        "classification": _classify_decoupling(decoupling_pct),
    }


async def compute_decoupling_for_activity(
    db: AsyncSession,
    activity_id: uuid.UUID,
    user_id: uuid.UUID | None = None,
) -> DecouplingResult | None:
    """Compute decoupling for a single activity by loading its power + HR streams.

    If *user_id* is provided, verifies the activity belongs to that user (BUG-008).
    """
    # Get the activity
    query = select(Activity).where(Activity.id == activity_id)
    if user_id is not None:
        query = query.where(Activity.user_id == user_id)
    result = await db.execute(query)
    activity = result.scalar_one_or_none()
    if not activity:
        return None

    # Get power stream
    result = await db.execute(
        select(ActivityStream)
        .where(
            ActivityStream.activity_id == activity_id,
            ActivityStream.stream_type == "watts",
        )
        .limit(1)
    )
    power_stream = result.scalar_one_or_none()

    # Get HR stream
    result = await db.execute(
        select(ActivityStream)
        .where(
            ActivityStream.activity_id == activity_id,
            ActivityStream.stream_type == "heartrate",
        )
        .limit(1)
    )
    hr_stream = result.scalar_one_or_none()

    if not power_stream or not hr_stream:
        return None

    power_data_raw = (
        power_stream.data.get("data", []) if isinstance(power_stream.data, dict) else []
    )
    hr_data_raw = (
        hr_stream.data.get("data", []) if isinstance(hr_stream.data, dict) else []
    )

    power_data = [float(p) for p in power_data_raw if p is not None]
    hr_data = [float(h) for h in hr_data_raw if h is not None]

    result = compute_decoupling_from_streams(power_data, hr_data)
    if not result:
        return None

    return DecouplingResult(
        decoupling_pct=result["decoupling_pct"],
        first_half_ratio=result["first_half_ratio"],
        second_half_ratio=result["second_half_ratio"],
        classification=result["classification"],
        duration_seconds=activity.duration_seconds or 0,
        activity_id=activity_id,
    )


async def compute_decoupling_history(
    db: AsyncSession,
    user_id: uuid.UUID,
    days: int = 90,
    min_duration_minutes: int = 60,
) -> list[dict]:
    """Compute decoupling for recent cycling activities with both power and HR streams.

    Only considers rides longer than min_duration_minutes (default 60 min)
    since short rides don't produce meaningful decoupling data.

    Returns a list of dicts with date, decoupling_pct, classification, activity_id.
    """
    cutoff = date.today() - timedelta(days=days)
    min_duration_s = min_duration_minutes * 60

    # Find activities with both power and HR that are long enough
    result = await db.execute(
        select(Activity.id, Activity.start_date, Activity.duration_seconds)
        .where(
            Activity.user_id == user_id,
            Activity.sport_type == "cycling",
            Activity.average_power.isnot(None),
            Activity.average_heartrate.isnot(None),
            Activity.duration_seconds >= min_duration_s,
            Activity.start_date >= cutoff,
        )
        .order_by(Activity.start_date)
    )
    activities = result.all()

    if not activities:
        return []

    # Batch-fetch all streams for these activities
    activity_ids = [a.id for a in activities]

    power_result = await db.execute(
        select(ActivityStream).where(
            ActivityStream.activity_id.in_(activity_ids),
            ActivityStream.stream_type == "watts",
        )
    )
    hr_result = await db.execute(
        select(ActivityStream).where(
            ActivityStream.activity_id.in_(activity_ids),
            ActivityStream.stream_type == "heartrate",
        )
    )

    power_streams = {s.activity_id: s for s in power_result.scalars().all()}
    hr_streams = {s.activity_id: s for s in hr_result.scalars().all()}

    history = []
    for act in activities:
        ps = power_streams.get(act.id)
        hs = hr_streams.get(act.id)
        if not ps or not hs:
            continue

        power_raw = ps.data.get("data", []) if isinstance(ps.data, dict) else []
        hr_raw = hs.data.get("data", []) if isinstance(hs.data, dict) else []

        power_data = [float(p) for p in power_raw if p is not None]
        hr_data = [float(h) for h in hr_raw if h is not None]

        dec_result = compute_decoupling_from_streams(power_data, hr_data)
        if dec_result:
            history.append(
                {
                    "date": act.start_date,
                    "activity_id": str(act.id),
                    "decoupling_pct": dec_result["decoupling_pct"],
                    "first_half_ratio": dec_result["first_half_ratio"],
                    "second_half_ratio": dec_result["second_half_ratio"],
                    "classification": dec_result["classification"],
                    "duration_seconds": act.duration_seconds or 0,
                }
            )

    return history
