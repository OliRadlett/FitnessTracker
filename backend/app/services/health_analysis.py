"""Health analysis service — composite scoring for overtraining, injury risk, and illness detection.

Combines multiple signals (recovery, HRV, sleep, training load, volume) into
weighted risk scores that produce actionable health alerts.
"""

import logging
import math
import statistics
import uuid
from datetime import date, timedelta

from sqlalchemy import Date, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.cycling import FtpHistory
from app.models.daily_metric import DailyMetric
from app.models.health_alert import HealthAlert
from app.models.lifting import LiftingSession
from app.models.sleep import SleepLog
from app.models.user import User

logger = logging.getLogger(__name__)


# ── Signal computation helpers ───────────────────────────────────────────────


def _tsb_signal(tsb_values: list[float]) -> float:
    """Score 0-100 based on consecutive negative TSB days.

    TSB < -35 for multiple days indicates heavy fatigue.
    -35 is more clearly maladaptive overreaching for powerlifters.
    """
    if not tsb_values:
        return 0.0
    consecutive_negative = 0
    for tsb in reversed(tsb_values):
        if tsb < -35:
            consecutive_negative += 1
        else:
            break
    if consecutive_negative >= 5:
        return 100.0
    elif consecutive_negative >= 3:
        return 70.0
    elif consecutive_negative >= 1:
        return 40.0
    return 0.0


def _recovery_signal(recovery_values: list[float | None]) -> float:
    """Score 0-100 based on consecutive low recovery days AND absolute severity.

    Considers both sustained low recovery (consecutive days below 40%) and
    acute recovery crashes (very low absolute values). Takes the higher score.
    """
    values = [v for v in recovery_values if v is not None]
    if not values:
        return 0.0

    # Absolute severity: very low recovery is alarming regardless of history
    latest = values[-1]
    absolute_score = 0.0
    if latest < 15:
        absolute_score = 100.0
    elif latest < 25:
        absolute_score = 70.0
    elif latest < 35:
        absolute_score = 40.0

    # Consecutive days below 40%
    consecutive_low = 0
    for r in reversed(values):
        if r < 40:
            consecutive_low += 1
        else:
            break
    if consecutive_low >= 4:
        consecutive_score = 100.0
    elif consecutive_low >= 3:
        consecutive_score = 70.0
    elif consecutive_low >= 2:
        consecutive_score = 40.0
    else:
        consecutive_score = 0.0

    return max(absolute_score, consecutive_score)


def _hrv_trend_signal(hrv_values: list[float | None]) -> float:
    """Score 0-100 based on HRV decline trend.

    Compares the most recent HRV value to the average of all prior values.
    Requires ≥3 data points to compute a meaningful trend.
    """
    values = [v for v in hrv_values if v is not None]
    if len(values) < 3:
        return 0.0

    # Last value vs average of all prior values
    recent = values[-1]
    prior_avg = sum(values[:-1]) / len(values[:-1])
    if prior_avg <= 0:
        return 0.0

    decline_pct = (prior_avg - recent) / prior_avg * 100
    if decline_pct > 20:
        return 100.0
    elif decline_pct > 15:
        return 70.0
    elif decline_pct > 10:
        return 40.0
    return 0.0


def _sleep_efficiency_signal(sleep_logs: list[SleepLog]) -> float:
    """Score 0-100 based on sleep efficiency using EWMA.

    Uses exponential weighting (2-day half-life) so a single bad
    night has meaningful impact on the score.
    """
    efficiencies = [
        l.sleep_efficiency for l in sleep_logs if l.sleep_efficiency is not None
    ]
    if not efficiencies:
        return 0.0

    # EWMA with 2-day half-life
    alpha = 1 - math.exp(-1 / 2)
    ewma = efficiencies[0]
    for eff in efficiencies[1:]:
        ewma = alpha * eff + (1 - alpha) * ewma

    if ewma < 70:
        return 100.0
    elif ewma < 78:
        return 70.0
    elif ewma < 83:
        return 40.0
    return 0.0


def _volume_spike_signal(
    current_week_volume: float,
    prior_week_volumes: list[float],
    prior_week_active: list[bool],
) -> float:
    """Score 0-100 based on volume increase vs EWMA of prior weeks.

    Only considers prior weeks where the user was active (had any
    training activity). Requires ≥2 prior active weeks before firing.
    Uses EWMA with 4-week half-life to reduce impact of old data.

    Args:
        current_week_volume: Total lifting volume kg for the most recent 7 days.
        prior_week_volumes: Lifting volume for each prior week [1..5].
        prior_week_active: Whether each prior week had any activity.
    """
    # Pair and filter to active prior weeks only
    active_volumes = [
        vol for vol, active in zip(prior_week_volumes, prior_week_active) if active
    ]

    # Minimum history gate
    if len(active_volumes) < 2:
        return 0.0

    # EWMA with 4-week half-life (alpha = 1 - e^(-1/half_life))
    alpha = 1 - math.exp(-1 / 4)
    ewma = active_volumes[0]  # seed with first actual value
    for vol in active_volumes[1:]:  # oldest first
        ewma = alpha * vol + (1 - alpha) * ewma

    if ewma <= 0:
        return 0.0

    increase_pct = (current_week_volume - ewma) / ewma * 100

    if increase_pct > 50:
        return 100.0
    elif increase_pct > 30:
        return 70.0
    elif increase_pct > 20:
        return 40.0
    return 0.0


def _rest_day_signal(training_days_in_row: int) -> float:
    """Score 0-100 based on consecutive training days without rest.

    7+ days = 100, 5-6 = 70, 4 = 40.
    """
    if training_days_in_row >= 7:
        return 100.0
    elif training_days_in_row >= 5:
        return 70.0
    elif training_days_in_row >= 4:
        return 40.0
    return 0.0


def _respiratory_rate_signal(
    current_rr: float | None,
    baseline_rr: float | None,
) -> float:
    """Score 0-100 based on respiratory rate elevation.

    > 10% above baseline = 100, > 7% = 70, > 5% = 40.
    """
    if not current_rr or not baseline_rr or baseline_rr <= 0:
        return 0.0
    elevation_pct = (current_rr - baseline_rr) / baseline_rr * 100
    if elevation_pct > 10:
        return 100.0
    elif elevation_pct > 7:
        return 70.0
    elif elevation_pct > 5:
        return 40.0
    return 0.0


def _unexplained_fatigue_signal(
    recovery_values: list[float | None],
    recent_meaningful_training_days: int,
) -> float:
    """Score 0-100 for low recovery without corresponding meaningful training.

    If recovery is low but the user hasn't been doing meaningful training
    (lifting session OR cardio >30 min), this suggests illness or other
    stressors. A light walk should not disable this signal.
    """
    values = [v for v in recovery_values if v is not None]
    if not values:
        return 0.0
    recent_recovery = values[-1]
    # Low recovery + no meaningful training = unexplained fatigue
    if recent_recovery < 35 and recent_meaningful_training_days == 0:
        return 100.0
    elif recent_recovery < 45 and recent_meaningful_training_days == 0:
        return 70.0
    return 0.0


def _recovery_illness_signal(recovery_values: list[float | None]) -> float:
    """Score 0-100 based on very low recovery scores.

    A single recovery score below 15% is a strong illness indicator.
    Below 35% is concerning. Distinct from the overtraining recovery
    signal which also considers consecutive days.
    """
    values = [v for v in recovery_values if v is not None]
    if not values:
        return 0.0
    latest = values[-1]
    if latest < 15:
        return 100.0
    elif latest < 25:
        return 70.0
    elif latest < 35:
        return 40.0
    return 0.0


# ── Severity classification ─────────────────────────────────────────────────


def _classify_severity(score: float) -> str:
    """Classify a composite score into severity levels."""
    if score >= 85:
        return "critical"
    elif score >= 65:
        return "warning"
    elif score >= 45:
        return "info"
    return "none"


# ── Main analysis functions ──────────────────────────────────────────────────


async def analyze_overtraining(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> dict | None:
    """Analyze overtraining risk by combining TSB, recovery, HRV, and sleep signals.

    Overtraining is training-load focused: TSB (40%) + Recovery (35%) = 75% of
    the composite. HRV (15%) and Sleep (10%) are reduced to avoid overlap with
    illness risk signals.

    Always returns a dict with score, severity, title, description, and evidence.
    Returns None only on unexpected errors.
    """
    cutoff_7d = date.today() - timedelta(days=7)

    # Get recent daily metrics
    result = await db.execute(
        select(DailyMetric)
        .where(
            DailyMetric.user_id == user_id,
            DailyMetric.metric_date >= cutoff_7d,
        )
        .order_by(DailyMetric.metric_date)
    )
    metrics = list(result.scalars().all())

    if len(metrics) < 3:
        return {
            "alert_type": "overtraining",
            "severity": "none",
            "title": "Overtraining Risk",
            "description": f"Not enough data yet — need at least 3 days of metrics (found {len(metrics)}). Connect a wearable or log daily metrics to enable this check.",
            "score": 0.0,
            "evidence": {
                "days_of_data": len(metrics),
                "minimum_required": 3,
            },
        }

    # Get TSB from activities
    from app.services.cycling import compute_training_load, get_daily_tss

    end_date = date.today()
    start_date = end_date - timedelta(days=49)
    daily_tss = await get_daily_tss(db, user_id, start_date, end_date)
    load_data = compute_training_load(daily_tss, end_date, lookback_days=7)
    tsb_values = [d["tsb"] for d in load_data[-7:]]

    # Get sleep logs
    result = await db.execute(
        select(SleepLog)
        .where(
            SleepLog.user_id == user_id,
            SleepLog.sleep_date >= cutoff_7d,
        )
        .order_by(SleepLog.sleep_date)
    )
    sleep_logs = list(result.scalars().all())

    # Compute signals
    recovery_values = [m.recovery_score for m in metrics]
    hrv_values = [m.hrv_ms for m in metrics]

    tsb_s = _tsb_signal(tsb_values)
    recovery_s = _recovery_signal(recovery_values)
    hrv_s = _hrv_trend_signal(hrv_values)
    sleep_s = _sleep_efficiency_signal(sleep_logs)

    # Weighted composite — training-load focused (TSB + Recovery = 75%)
    score = tsb_s * 0.40 + recovery_s * 0.35 + hrv_s * 0.15 + sleep_s * 0.10
    severity = _classify_severity(score)

    messages = {
        "none": "All clear — no overtraining signals detected. Your training load, recovery, HRV, and sleep are all within normal ranges.",
        "info": "Training load is high — monitor recovery closely.",
        "warning": "Overtraining risk elevated — consider a rest day or easy week.",
        "critical": "Significant overtraining risk — take 2-3 rest days immediately.",
    }

    # Build evidence with human-readable signal labels
    evidence = {
        "TSB (Training Stress Balance)": f"{'✅' if tsb_s == 0 else '⚠️'} Signal score: {tsb_s:.0f}/100",
        "Recovery Score": f"{'✅' if recovery_s == 0 else '⚠️'} Signal score: {recovery_s:.0f}/100",
        "HRV Trend": f"{'✅' if hrv_s == 0 else '⚠️'} Signal score: {hrv_s:.0f}/100",
        "Sleep Efficiency": f"{'✅' if sleep_s == 0 else '⚠️'} Signal score: {sleep_s:.0f}/100",
        "Composite Score": f"{score:.0f}/100",
    }

    # Add resting HR for context (display only, not scored)
    resting_hr_values = [m.resting_hr for m in metrics if m.resting_hr is not None]
    if resting_hr_values:
        current_rhr = resting_hr_values[-1]
        # 30-day baseline for comparison
        cutoff_30d = date.today() - timedelta(days=30)
        baseline_result = await db.execute(
            select(func.avg(DailyMetric.resting_hr)).where(
                DailyMetric.user_id == user_id,
                DailyMetric.resting_hr.isnot(None),
                DailyMetric.metric_date >= cutoff_30d,
            )
        )
        baseline_rhr = baseline_result.scalar()
        if baseline_rhr and baseline_rhr > 0:
            rhr_elevated = current_rhr > baseline_rhr * 1.05
            evidence["Resting HR"] = (
                f"{'⚠️' if rhr_elevated else '✅'} "
                f"{current_rhr:.0f} bpm (baseline: {baseline_rhr:.0f} bpm)"
            )

    return {
        "alert_type": "overtraining",
        "severity": severity,
        "title": "Overtraining Risk",
        "description": messages[severity],
        "score": round(score, 1),
        "evidence": evidence,
    }


async def analyze_injury_risk(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> dict | None:
    """Analyze injury risk from volume spikes, rest days, and training patterns.

    Uses activity-aware weeks to distinguish rest weeks from pre-tracking zeros.
    Volume spike uses EWMA with 4-week half-life and requires ≥2 prior active
    weeks before firing.

    Always returns a dict with score, severity, title, description, and evidence.
    """
    today = date.today()
    window_start = today - timedelta(weeks=6)

    # Aggregate the last 6 weeks into rolling 7-day buckets with two grouped
    # queries (was 18 per-user queries in the old per-week loop). The bucket for
    # a session aged N days is floor((N-1)/7), which matches the old
    # [today-W-itw, today-itw) window semantics exactly (a session exactly
    # 7k days old belongs to bucket k-1). PG integer division truncates toward
    # zero, so age 0 lands in bucket 0 just like the old week_start check.
    lifting_week = func.greatest(
        (cast(today, Date) - LiftingSession.session_date - 1) / 7, 0
    ).label("week_idx")
    result = await db.execute(
        select(
            lifting_week,
            func.coalesce(func.sum(LiftingSession.total_volume_kg), 0.0),
            func.count(LiftingSession.id),
        )
        .where(
            LiftingSession.user_id == user_id,
            LiftingSession.session_date >= window_start,
            LiftingSession.session_date <= today,
        )
        .group_by(lifting_week)
    )
    lifting_by_week = {
        int(idx): (float(volume), int(count)) for idx, volume, count in result.all()
    }

    activity_week = func.greatest(
        (cast(today, Date) - cast(Activity.start_date, Date) - 1) / 7, 0
    ).label("week_idx")
    result = await db.execute(
        select(activity_week, func.count(Activity.id))
        .where(
            Activity.user_id == user_id,
            Activity.start_date >= window_start,
            Activity.start_date <= today,
        )
        .group_by(activity_week)
    )
    activity_by_week = {int(idx): int(count) for idx, count in result.all()}

    week_volumes = []
    week_active = []
    for i in range(6):
        volume, lifting_count = lifting_by_week.get(i, (0.0, 0))
        week_volumes.append(volume)
        week_active.append((lifting_count + activity_by_week.get(i, 0)) > 0)

    current_week_vol = week_volumes[0] if week_volumes else 0
    prior_week_vols = week_volumes[1:] if len(week_volumes) > 1 else []
    prior_week_actives = week_active[1:] if len(week_active) > 1 else []

    # Get consecutive training days
    cutoff_14d = today - timedelta(days=14)
    result = await db.execute(
        select(LiftingSession.session_date)
        .where(
            LiftingSession.user_id == user_id,
            LiftingSession.session_date >= cutoff_14d,
        )
        .distinct()
        .order_by(LiftingSession.session_date.desc())
    )
    lifting_dates = [r[0] for r in result.all()]

    # Also check activity dates
    result = await db.execute(
        select(func.date(Activity.start_date))
        .where(
            Activity.user_id == user_id,
            Activity.start_date >= cutoff_14d,
        )
        .distinct()
    )
    activity_dates = {r[0] for r in result.all()}
    training_dates = sorted(set(lifting_dates) | activity_dates, reverse=True)

    # Count consecutive training days
    consecutive = 0
    if training_dates:
        for i, d in enumerate(training_dates):
            expected = today - timedelta(days=i)
            if d == expected:
                consecutive += 1
            else:
                break

    # Compute signals
    volume_s = _volume_spike_signal(
        current_week_vol, prior_week_vols, prior_week_actives
    )
    rest_s = _rest_day_signal(consecutive)

    score = volume_s * 0.55 + rest_s * 0.45
    severity = _classify_severity(score)

    messages = {
        "none": "All clear — training volume is stable and rest days are adequate. No elevated injury risk detected.",
        "info": "Training volume has increased — monitor for soreness and fatigue.",
        "warning": "Volume spike detected with limited rest — consider adding a rest day.",
        "critical": "High injury risk: rapid volume increase with no rest days. Take a recovery day.",
    }

    # Compute volume change for evidence
    active_vols = [
        vol for vol, active in zip(prior_week_vols, prior_week_actives) if active
    ]
    avg_prior = sum(active_vols) / len(active_vols) if active_vols else 0
    volume_change_pct = (
        ((current_week_vol - avg_prior) / avg_prior * 100) if avg_prior > 0 else 0
    )

    evidence = {
        "Volume Spike": f"{'✅' if volume_s == 0 else '⚠️'} Signal score: {volume_s:.0f}/100",
        "Rest Days": f"{'✅' if rest_s == 0 else '⚠️'} Signal score: {rest_s:.0f}/100",
        "Consecutive Training Days": consecutive,
        "Current Week Volume": f"{current_week_vol:.0f} kg",
        "Volume vs Average": f"{volume_change_pct:+.0f}%",
        "Composite Score": f"{score:.0f}/100",
    }

    return {
        "alert_type": "injury_risk",
        "severity": severity,
        "title": "Injury Risk",
        "description": messages[severity],
        "score": round(score, 1),
        "evidence": evidence,
    }


async def analyze_illness(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> dict | None:
    """Analyze illness risk by combining recovery score, respiratory rate, HRV, sleep, and unexplained fatigue.

    Illness risk is physiology-focused: Recovery Score (25%) + RR (20%) + HRV (25%)
    = 70% of the composite. When respiratory rate data is missing, its weight is
    redistributed to the other signals.

    Always returns a dict with score, severity, title, description, and evidence.
    Returns None only on unexpected errors.
    """
    cutoff_7d = date.today() - timedelta(days=7)
    cutoff_30d = date.today() - timedelta(days=30)

    # Get recent metrics
    result = await db.execute(
        select(DailyMetric)
        .where(
            DailyMetric.user_id == user_id,
            DailyMetric.metric_date >= cutoff_7d,
        )
        .order_by(DailyMetric.metric_date)
    )
    metrics = list(result.scalars().all())

    if len(metrics) < 3:
        return {
            "alert_type": "illness_risk",
            "severity": "none",
            "title": "Illness Risk",
            "description": f"Not enough data yet — need at least 3 days of metrics (found {len(metrics)}). Connect a wearable or log daily metrics to enable this check.",
            "score": 0.0,
            "evidence": {
                "days_of_data": len(metrics),
                "minimum_required": 3,
            },
        }

    # Get 30-day baseline for respiratory rate
    result = await db.execute(
        select(func.avg(DailyMetric.respiratory_rate)).where(
            DailyMetric.user_id == user_id,
            DailyMetric.respiratory_rate.isnot(None),
            DailyMetric.metric_date >= cutoff_30d,
        )
    )
    baseline_rr = result.scalar()

    # Recent respiratory rate
    rr_values = [m.respiratory_rate for m in metrics if m.respiratory_rate]
    current_rr = rr_values[-1] if rr_values else None

    # Count meaningful training days in past 3 days (lifting OR cardio >30 min)
    cutoff_3d = date.today() - timedelta(days=3)
    act_result = await db.execute(
        select(func.count(Activity.id)).where(
            Activity.user_id == user_id,
            Activity.start_date >= cutoff_3d,
            Activity.duration_seconds > 1800,  # >30 min
        )
    )
    cardio_meaningful = int(act_result.scalar() or 0)

    lift_result = await db.execute(
        select(func.count(LiftingSession.id)).where(
            LiftingSession.user_id == user_id,
            LiftingSession.session_date >= cutoff_3d,
        )
    )
    lifting_days = int(lift_result.scalar() or 0)

    recent_meaningful_training_days = cardio_meaningful + lifting_days

    # Compute signals
    recovery_values = [m.recovery_score for m in metrics]
    hrv_values = [m.hrv_ms for m in metrics]

    rr_s = _respiratory_rate_signal(current_rr, baseline_rr)
    hrv_s = _hrv_trend_signal(hrv_values)

    # Sleep quality
    result = await db.execute(
        select(SleepLog)
        .where(
            SleepLog.user_id == user_id,
            SleepLog.sleep_date >= cutoff_7d,
        )
        .order_by(SleepLog.sleep_date)
    )
    sleep_logs = list(result.scalars().all())
    sleep_s = _sleep_efficiency_signal(sleep_logs)

    fatigue_s = _unexplained_fatigue_signal(
        recovery_values, recent_meaningful_training_days
    )
    recovery_illness_s = _recovery_illness_signal(recovery_values)

    # Weighted composite — physiology focused
    # When respiratory rate data is missing, redistribute its weight
    has_rr_data = current_rr is not None and baseline_rr is not None
    if has_rr_data:
        score = (
            recovery_illness_s * 0.25
            + rr_s * 0.20
            + hrv_s * 0.25
            + sleep_s * 0.15
            + fatigue_s * 0.15
        )
    else:
        # Redistribute RR's 20% proportionally to the other 80%
        raw_total = (
            recovery_illness_s * 0.25 + hrv_s * 0.25 + sleep_s * 0.15 + fatigue_s * 0.15
        )
        score = raw_total / 0.80 * 100

    severity = _classify_severity(score)

    messages = {
        "none": "All clear — respiratory rate, HRV, sleep quality, and energy levels are all within normal ranges. No illness indicators detected.",
        "info": "Minor signals detected — prioritize sleep and hydration.",
        "warning": "Early illness indicators — consider reducing training intensity.",
        "critical": "Multiple illness signals detected — rest and monitor symptoms closely.",
    }

    rr_display = f"{current_rr:.1f} br/min" if current_rr else "No data"
    baseline_display = f"{baseline_rr:.1f} br/min" if baseline_rr else "No data"
    rr_change = ""
    if current_rr and baseline_rr and baseline_rr > 0:
        rr_pct = (current_rr - baseline_rr) / baseline_rr * 100
        rr_change = f" ({rr_pct:+.1f}% vs baseline)"

    evidence = {
        "Recovery Score": f"{'✅' if recovery_illness_s == 0 else '⚠️'} Signal score: {recovery_illness_s:.0f}/100",
        "Respiratory Rate": f"{'✅' if rr_s == 0 else '⚠️'} Current: {rr_display}{rr_change}",
        "Respiratory Baseline": baseline_display,
        "HRV Trend": f"{'✅' if hrv_s == 0 else '⚠️'} Signal score: {hrv_s:.0f}/100",
        "Sleep Quality": f"{'✅' if sleep_s == 0 else '⚠️'} Signal score: {sleep_s:.0f}/100",
        "Unexplained Fatigue": f"{'✅' if fatigue_s == 0 else '⚠️'} Signal score: {fatigue_s:.0f}/100",
        "Composite Score": f"{score:.0f}/100",
    }

    # Add resting HR for context (display only, not scored)
    resting_hr_values = [m.resting_hr for m in metrics if m.resting_hr is not None]
    if resting_hr_values:
        current_rhr = resting_hr_values[-1]
        baseline_rhr_result = await db.execute(
            select(func.avg(DailyMetric.resting_hr)).where(
                DailyMetric.user_id == user_id,
                DailyMetric.resting_hr.isnot(None),
                DailyMetric.metric_date >= cutoff_30d,
            )
        )
        baseline_rhr = baseline_rhr_result.scalar()
        if baseline_rhr and baseline_rhr > 0:
            rhr_elevated = current_rhr > baseline_rhr * 1.05
            evidence["Resting HR"] = (
                f"{'⚠️' if rhr_elevated else '✅'} "
                f"{current_rhr:.0f} bpm (baseline: {baseline_rhr:.0f} bpm)"
            )

    return {
        "alert_type": "illness_risk",
        "severity": severity,
        "title": "Illness Risk",
        "description": messages[severity],
        "score": round(score, 1),
        "evidence": evidence,
    }


async def upsert_alert(
    db: AsyncSession,
    user_id: uuid.UUID,
    analysis: dict,
) -> bool:
    """Create or update a health alert. Returns True if a new alert was created.

    Only creates alerts when severity is not "none" (i.e. actual risk detected).
    """
    if analysis is None or analysis.get("severity") == "none":
        return False

    # Check for existing active alert of this type
    result = await db.execute(
        select(HealthAlert).where(
            HealthAlert.user_id == user_id,
            HealthAlert.alert_type == analysis["alert_type"],
            HealthAlert.status == "active",
        )
    )
    existing = result.scalar_one_or_none()

    if existing:
        # Update existing alert if severity changed
        if existing.severity != analysis["severity"]:
            existing.severity = analysis["severity"]
            existing.title = analysis["title"]
            existing.description = analysis["description"]
            existing.evidence = analysis["evidence"]
            existing.detected_date = date.today()
        return False

    # Create new alert
    alert = HealthAlert(
        user_id=user_id,
        alert_type=analysis["alert_type"],
        severity=analysis["severity"],
        title=analysis["title"],
        description=analysis["description"],
        evidence=analysis["evidence"],
        detected_date=date.today(),
    )
    db.add(alert)
    # Fire an in-app notification for the new alert (idempotent via alert id).
    from app.services.notifications import notify

    severity_map = {"critical": "error", "warning": "warning", "info": "info"}
    await notify(
        db,
        user_id,
        type="health_alert",
        title=analysis["title"],
        body=analysis["description"],
        severity=severity_map.get(analysis["severity"], "warning"),
        link="/dashboard",
        dedup_key=f"alert:{alert.id}",
        metadata={"alert_type": analysis["alert_type"]},
    )
    return True


# ── §3.12 Alert tuning — new signals + per-user preferences ─────────────────

# Known alert types, including the legacy hrv_drop / sleep_decline /
# respiratory_rate_elevated checks that run in the scheduler.
HEALTH_ALERT_TYPES: list[str] = [
    "overtraining",
    "injury_risk",
    "illness",
    "performance_decline",
    "sleep_consistency",
    "resting_hr_elevation",
    "hrv_drop",
    "sleep_decline",
    "respiratory_rate_elevated",
]

# Default threshold specs for the three §3.12 signals. User overrides merge
# over these per field.
DEFAULT_HEALTH_THRESHOLDS: dict[str, dict] = {
    "performance_decline": {"drop_pct": 8.0, "critical_pct": 15.0},
    "sleep_consistency": {"stddev_min": 60.0, "critical_stddev_min": 120.0},
    "resting_hr_elevation": {"bpm": 5.0, "critical_bpm": 8.0},
}


def get_health_preferences(user: User) -> dict:
    """Return the effective health-alert prefs (disabled list, snoozes, thresholds)."""
    stored = user.health_preferences or {}
    disabled = [t for t in (stored.get("disabled") or []) if t in HEALTH_ALERT_TYPES]
    snoozed = {
        k: str(v)[:10]
        for k, v in (stored.get("snoozed") or {}).items()
        if k in HEALTH_ALERT_TYPES and v
    }
    thresholds: dict[str, dict] = {}
    for t, spec in DEFAULT_HEALTH_THRESHOLDS.items():
        thresholds[t] = {
            **spec,
            **((stored.get("thresholds") or {}).get(t) or {}),
        }
    return {
        "disabled": disabled,
        "snoozed": snoozed,
        "thresholds": thresholds,
        "signal_types": HEALTH_ALERT_TYPES,
    }


async def set_health_preferences(
    db: AsyncSession,
    user: User,
    updates: dict,
) -> dict:
    """Apply partial health-alert preference updates and return effective prefs."""
    stored = user.health_preferences or {}

    if updates.get("disabled") is not None:
        stored["disabled"] = [t for t in updates["disabled"] if t in HEALTH_ALERT_TYPES]

    if updates.get("snoozed") is not None:
        snoozed: dict[str, str] = {}
        for k, v in (updates["snoozed"] or {}).items():
            if k not in HEALTH_ALERT_TYPES or not v:
                continue
            try:
                iso = str(v)[:10]
                date.fromisoformat(iso)
                snoozed[k] = iso
            except ValueError:
                continue
        stored["snoozed"] = snoozed

    if updates.get("thresholds") is not None:
        known: dict[str, dict] = {}
        for t, spec in (updates["thresholds"] or {}).items():
            if t not in DEFAULT_HEALTH_THRESHOLDS or not isinstance(spec, dict):
                continue
            clean: dict[str, float] = {}
            for k in (
                "drop_pct",
                "critical_pct",
                "stddev_min",
                "critical_stddev_min",
                "bpm",
                "critical_bpm",
            ):
                if k in spec and spec[k] is not None:
                    try:
                        val = float(spec[k])
                        if val >= 0:
                            clean[k] = val
                    except (TypeError, ValueError):
                        continue
            if clean:
                known[t] = clean
        stored["thresholds"] = {
            **(stored.get("thresholds") or {}),
            **known,
        }

    user.health_preferences = stored
    await db.flush()
    return get_health_preferences(user)


async def _analyze_performance_decline(
    db: AsyncSession,
    user_id: uuid.UUID,
    cfg: dict,
) -> dict:
    """FTP drop vs recent history → performance decline signal.

    Compares the mean of the two most recent ``FtpHistory`` entries against the
    two before them. Needs ≥4 history rows.
    """
    today = date.today()
    result = await db.execute(
        select(FtpHistory)
        .where(
            FtpHistory.user_id == user_id,
            FtpHistory.effective_date <= today,
        )
        .order_by(FtpHistory.effective_date.desc())
        .limit(6)
    )
    entries = list(result.scalars().all())[::-1]  # chronological

    def _none(reason: str) -> dict:
        return {
            "alert_type": "performance_decline",
            "severity": "none",
            "title": "Performance Decline",
            "description": reason,
            "score": 0.0,
            "evidence": {"required_history_points": 4, "found": len(entries)},
        }

    if len(entries) < 4:
        return _none(
            f"Not enough FTP history yet — need at least 4 records (found {len(entries)})."
        )

    recent_avg = round(sum(e.ftp_watts for e in entries[-2:]) / 2, 1)
    baseline_avg = round(sum(e.ftp_watts for e in entries[-4:-2]) / 2, 1)
    if baseline_avg <= 0:
        return _none("FTP baseline is unavailable.")

    drop_pct = (baseline_avg - recent_avg) / baseline_avg * 100.0
    if drop_pct >= cfg["critical_pct"]:
        severity = "critical"
    elif drop_pct >= cfg["drop_pct"]:
        severity = "warning"
    else:
        severity = "none"

    return {
        "alert_type": "performance_decline",
        "severity": severity,
        "title": "Performance Decline Detected",
        "description": (
            f"Your FTP has dropped {drop_pct:.0f}% vs recent history "
            f"({recent_avg:.0f} W vs {baseline_avg:.0f} W baseline). "
            "Consider whether fatigue or illness is driving the drop."
            if severity != "none"
            else f"FTP holding steady ({recent_avg:.0f} W vs {baseline_avg:.0f} W baseline)."
        ),
        "score": round(min(max(drop_pct, 0.0), 100.0), 1),
        "evidence": {
            "recent_avg_watts": recent_avg,
            "baseline_avg_watts": baseline_avg,
            "drop_pct": round(max(drop_pct, 0.0), 1),
            "recent_dates": [e.effective_date.isoformat() for e in entries[-2:]],
            "baseline_dates": [e.effective_date.isoformat() for e in entries[-4:-2]],
            "threshold": cfg["drop_pct"],
        },
    }


async def _analyze_sleep_consistency(
    db: AsyncSession,
    user_id: uuid.UUID,
    cfg: dict,
) -> dict:
    """Nightly sleep-duration variability → consistency signal."""
    today = date.today()
    result = await db.execute(
        select(SleepLog)
        .where(
            SleepLog.user_id == user_id,
            SleepLog.sleep_date >= today - timedelta(days=7),
        )
        .order_by(SleepLog.sleep_date)
    )
    logs = list(result.scalars().all())
    durations_min = [
        round(s.effective_total_sleep_seconds / 60, 1)
        for s in logs
        if s.effective_total_sleep_seconds
    ]

    def _none(reason: str) -> dict:
        return {
            "alert_type": "sleep_consistency",
            "severity": "none",
            "title": "Sleep Consistency",
            "description": reason,
            "score": 0.0,
            "evidence": {"nights": len(durations_min), "required_nights": 3},
        }

    if len(durations_min) < 3:
        return _none(
            f"Not enough sleep data — need at least 3 nights in the last 7 days "
            f"(found {len(durations_min)})."
        )

    sd_min = round(statistics.pstdev(durations_min), 1)
    mean_min = round(sum(durations_min) / len(durations_min), 1)

    if sd_min >= cfg["critical_stddev_min"]:
        severity = "critical"
    elif sd_min >= cfg["stddev_min"]:
        severity = "warning"
    else:
        severity = "none"

    return {
        "alert_type": "sleep_consistency",
        "severity": severity,
        "title": "Irregular Sleep Pattern",
        "description": (
            f"Sleep duration varies by {sd_min:.0f} min across the last "
            f"{len(durations_min)} nights (avg {mean_min:.0f} min). Highly "
            "variable sleep is linked to fatigue and slower recovery."
            if severity != "none"
            else f"Sleep duration is consistent (σ {sd_min:.0f} min over "
            f"{len(durations_min)} nights, avg {mean_min:.0f} min)."
        ),
        "score": round(min(max(sd_min, 0.0), 100.0), 1),
        "evidence": {
            "stddev_min": sd_min,
            "mean_min": mean_min,
            "range_min": round(max(durations_min) - min(durations_min), 1),
            "nights": len(durations_min),
            "threshold_stddev_min": cfg["stddev_min"],
        },
    }


async def _analyze_resting_hr_elevation(
    db: AsyncSession,
    user_id: uuid.UUID,
    cfg: dict,
) -> dict:
    """Resting HR elevation vs 30-day baseline → recovery/stress signal."""
    today = date.today()
    baseline_result = await db.execute(
        select(DailyMetric.resting_hr, DailyMetric.metric_date)
        .where(
            DailyMetric.user_id == user_id,
            DailyMetric.resting_hr.isnot(None),
            DailyMetric.metric_date >= today - timedelta(days=30),
        )
        .order_by(DailyMetric.metric_date)
    )
    rows = list(baseline_result.all())
    if len(rows) < 5:
        return {
            "alert_type": "resting_hr_elevation",
            "severity": "none",
            "title": "Resting Heart Rate",
            "description": (
                f"Not enough resting-HR data — need at least 5 readings in the "
                f"last 30 days (found {len(rows)})."
            ),
            "score": 0.0,
            "evidence": {"readings_30d": len(rows), "required": 5},
        }

    # Recent = most recent 3 readings; baseline = the rest.
    recent = [r[0] for r in rows[-3:]]
    baseline = [r[0] for r in rows[:-3]]
    recent_avg = round(sum(recent) / len(recent), 1)
    baseline_avg = round(sum(baseline) / len(baseline), 1)
    elevation = round(recent_avg - baseline_avg, 1)

    if elevation >= cfg["critical_bpm"]:
        severity = "critical"
    elif elevation >= cfg["bpm"]:
        severity = "warning"
    else:
        severity = "none"

    return {
        "alert_type": "resting_hr_elevation",
        "severity": severity,
        "title": "Resting Heart Rate Elevated",
        "description": (
            f"Resting HR is {elevation:+.0f} bpm vs your 30-day baseline "
            f"({recent_avg:.0f} vs {baseline_avg:.0f} bpm). Elevated resting HR "
            "can signal insufficient recovery or mounting stress."
            if severity != "none"
            else f"Resting HR stable ({recent_avg:.0f} vs baseline {baseline_avg:.0f} bpm)."
        ),
        "score": round(min(max(elevation, 0.0), 20.0) * 5, 1),
        "evidence": {
            "recent_bpm": recent_avg,
            "baseline_bpm": baseline_avg,
            "elevation_bpm": elevation,
            "recent_days": [r[1].isoformat() for r in rows[-3:]],
            "threshold_bpm": cfg["bpm"],
        },
    }


async def analyze_regeneration_signals(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> list[dict]:
    """Run the three §3.12 regeneration signals for a user, honoring prefs.

    Returns a list of analysis dicts (one per signal type). Severity ``none``
    means no alert should be created (clear, disabled, or snoozed). Never
    raises for signal computation errors — those are logged and downgraded.
    """
    user = await db.get(User, user_id)
    stored = user.health_preferences if user else {}
    stored = stored or {}
    disabled = set(stored.get("disabled") or [])
    snoozed = stored.get("snoozed") or {}
    user_thresholds = stored.get("thresholds") or {}
    today = date.today()

    signal_fn = [
        ("performance_decline", _analyze_performance_decline),
        ("sleep_consistency", _analyze_sleep_consistency),
        ("resting_hr_elevation", _analyze_resting_hr_elevation),
    ]

    signals: list[dict] = []
    for signal_type, fn in signal_fn:
        if signal_type in disabled:
            signals.append(
                {
                    "alert_type": signal_type,
                    "severity": "none",
                    "title": "Disabled",
                    "description": "Disabled in health alert preferences.",
                    "score": 0.0,
                    "evidence": {"disabled": True},
                }
            )
            continue
        snooze_until = snoozed.get(signal_type)
        if snooze_until:
            try:
                if today < date.fromisoformat(str(snooze_until)[:10]):
                    signals.append(
                        {
                            "alert_type": signal_type,
                            "severity": "none",
                            "title": "Snoozed",
                            "description": f"Snoozed until {snooze_until}.",
                            "score": 0.0,
                            "evidence": {"snoozed_until": str(snooze_until)[:10]},
                        }
                    )
                    continue
            except ValueError:
                pass
        cfg = {
            **DEFAULT_HEALTH_THRESHOLDS.get(signal_type, {}),
            **(user_thresholds.get(signal_type) or {}),
        }
        try:
            result = await fn(db, user_id, cfg)
        except Exception as e:  # pragma: no cover - defensive
            logger.warning(
                "health_analysis %s failed for user %s: %s", signal_type, user_id, e
            )
            continue
        if result is not None:
            signals.append(result)

    return signals
