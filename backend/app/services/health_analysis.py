"""Health analysis service — composite scoring for overtraining, injury risk, and illness detection.

Combines multiple signals (recovery, HRV, sleep, training load, volume) into
weighted risk scores that produce actionable health alerts.
"""

import uuid
import logging
from datetime import date, timedelta

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.daily_metric import DailyMetric
from app.models.health_alert import HealthAlert
from app.models.lifting import LiftingSession
from app.models.sleep import SleepLog

logger = logging.getLogger(__name__)


# ── Signal computation helpers ───────────────────────────────────────────────


def _tsb_signal(tsb_values: list[float]) -> float:
    """Score 0-100 based on consecutive negative TSB days.

    TSB < -30 for multiple days indicates heavy fatigue.
    """
    if not tsb_values:
        return 0.0
    consecutive_negative = 0
    for tsb in reversed(tsb_values):
        if tsb < -30:
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
    """Score 0-100 based on consecutive low recovery days.

    Recovery < 50% for multiple days while training is concerning.
    """
    values = [v for v in recovery_values if v is not None]
    if not values:
        return 0.0
    consecutive_low = 0
    for r in reversed(values):
        if r < 50:
            consecutive_low += 1
        else:
            break
    if consecutive_low >= 4:
        return 100.0
    elif consecutive_low >= 3:
        return 70.0
    elif consecutive_low >= 2:
        return 40.0
    return 0.0


def _hrv_trend_signal(hrv_values: list[float | None]) -> float:
    """Score 0-100 based on HRV decline trend over 7 days.

    Compares recent 3-day average to prior 4-day average.
    """
    values = [v for v in hrv_values if v is not None]
    if len(values) < 5:
        return 0.0
    recent_3 = sum(values[-3:]) / 3
    prior_4 = sum(values[-7:-3]) / min(4, len(values) - 3) if len(values) > 3 else sum(values) / len(values)
    if prior_4 <= 0:
        return 0.0
    decline_pct = (prior_4 - recent_3) / prior_4 * 100
    if decline_pct > 20:
        return 100.0
    elif decline_pct > 15:
        return 70.0
    elif decline_pct > 10:
        return 40.0
    return 0.0


def _sleep_efficiency_signal(sleep_logs: list[SleepLog]) -> float:
    """Score 0-100 based on sleep efficiency decline.

    Average efficiency < 85% over recent nights is concerning.
    """
    efficiencies = [l.sleep_efficiency for l in sleep_logs if l.sleep_efficiency is not None]
    if not efficiencies:
        return 0.0
    avg_eff = sum(efficiencies) / len(efficiencies)
    if avg_eff < 75:
        return 100.0
    elif avg_eff < 80:
        return 70.0
    elif avg_eff < 85:
        return 40.0
    return 0.0


def _volume_spike_signal(
    current_week_volume: float,
    prior_week_volumes: list[float],
) -> float:
    """Score 0-100 based on volume increase vs prior weeks.

    > 50% spike = 100, > 30% = 70, > 20% = 40.
    """
    if not prior_week_volumes or all(v == 0 for v in prior_week_volumes):
        return 0.0
    avg_prior = sum(prior_week_volumes) / len(prior_week_volumes)
    if avg_prior <= 0:
        return 0.0
    increase_pct = (current_week_volume - avg_prior) / avg_prior * 100
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
    recent_tss: float,
) -> float:
    """Score 0-100 for low recovery without corresponding high training load.

    If recovery is low but training wasn't particularly hard, this suggests
    illness or other stressors.
    """
    values = [v for v in recovery_values if v is not None]
    if not values:
        return 0.0
    recent_recovery = values[-1] if values else None
    if recent_recovery is None:
        return 0.0
    # Low recovery + low/moderate training = unexplained fatigue
    if recent_recovery < 40 and recent_tss < 200:
        return 100.0
    elif recent_recovery < 50 and recent_tss < 150:
        return 70.0
    return 0.0


# ── Severity classification ─────────────────────────────────────────────────


def _classify_severity(score: float) -> str:
    """Classify a composite score into severity levels."""
    if score >= 80:
        return "critical"
    elif score >= 60:
        return "warning"
    elif score >= 40:
        return "info"
    return "none"


# ── Main analysis functions ──────────────────────────────────────────────────


async def analyze_overtraining(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> dict | None:
    """Analyze overtraining risk by combining TSB, recovery, HRV, and sleep signals.

    Always returns a dict with score, severity, title, description, and evidence
    so the UI can show contributing data even when everything looks OK.
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

    # Get TSB from activities (simplified: use CTL/ATL from cycling service)
    from app.services.cycling import get_daily_tss, compute_training_load
    end_date = date.today()
    start_date = end_date - timedelta(days=49)  # 7 days + 42 buffer
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

    # Weighted composite
    score = tsb_s * 0.30 + recovery_s * 0.30 + hrv_s * 0.25 + sleep_s * 0.15
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

    Always returns a dict with score, severity, title, description, and evidence
    so the UI can show contributing data even when everything looks OK.
    """
    today = date.today()

    # Get weekly lifting volumes for last 5 weeks
    week_volumes = []
    for i in range(5):
        week_start = today - timedelta(weeks=i + 1)
        week_end = today - timedelta(weeks=i)
        result = await db.execute(
            select(func.coalesce(func.sum(LiftingSession.total_volume_kg), 0.0))
            .where(
                LiftingSession.user_id == user_id,
                LiftingSession.session_date >= week_start,
                LiftingSession.session_date < week_end,
            )
        )
        week_volumes.append(float(result.scalar() or 0))

    current_week_vol = week_volumes[0] if week_volumes else 0
    prior_week_vols = week_volumes[1:] if len(week_volumes) > 1 else []

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
    volume_s = _volume_spike_signal(current_week_vol, prior_week_vols)
    rest_s = _rest_day_signal(consecutive)

    score = volume_s * 0.55 + rest_s * 0.45
    severity = _classify_severity(score)

    messages = {
        "none": "All clear — training volume is stable and rest days are adequate. No elevated injury risk detected.",
        "info": "Training volume has increased — monitor for soreness and fatigue.",
        "warning": "Volume spike detected with limited rest — consider adding a rest day.",
        "critical": "High injury risk: rapid volume increase with no rest days. Take a recovery day.",
    }

    avg_prior = sum(prior_week_vols) / len(prior_week_vols) if prior_week_vols else 0
    volume_change_pct = ((current_week_vol - avg_prior) / avg_prior * 100) if avg_prior > 0 else 0

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
    """Analyze illness risk by combining respiratory rate, HRV, sleep, and unexplained fatigue.

    Always returns a dict with score, severity, title, description, and evidence
    so the UI can show contributing data even when everything looks OK.
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
        select(func.avg(DailyMetric.respiratory_rate))
        .where(
            DailyMetric.user_id == user_id,
            DailyMetric.respiratory_rate.isnot(None),
            DailyMetric.metric_date >= cutoff_30d,
        )
    )
    baseline_rr = result.scalar()

    # Recent respiratory rate
    rr_values = [m.respiratory_rate for m in metrics if m.respiratory_rate]
    current_rr = rr_values[-1] if rr_values else None

    # Recent TSS (for unexplained fatigue detection)
    cutoff_3d = date.today() - timedelta(days=3)
    result = await db.execute(
        select(func.coalesce(func.sum(Activity.tss), 0.0))
        .where(
            Activity.user_id == user_id,
            Activity.start_date >= cutoff_3d,
        )
    )
    recent_tss = float(result.scalar() or 0)

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

    fatigue_s = _unexplained_fatigue_signal(recovery_values, recent_tss)

    score = rr_s * 0.35 + hrv_s * 0.30 + sleep_s * 0.20 + fatigue_s * 0.15
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
        "Respiratory Rate": f"{'✅' if rr_s == 0 else '⚠️'} Current: {rr_display}{rr_change}",
        "Respiratory Baseline": baseline_display,
        "HRV Trend": f"{'✅' if hrv_s == 0 else '⚠️'} Signal score: {hrv_s:.0f}/100",
        "Sleep Quality": f"{'✅' if sleep_s == 0 else '⚠️'} Signal score: {sleep_s:.0f}/100",
        "Unexplained Fatigue": f"{'✅' if fatigue_s == 0 else '⚠️'} Signal score: {fatigue_s:.0f}/100",
        "Composite Score": f"{score:.0f}/100",
    }

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
    return True
