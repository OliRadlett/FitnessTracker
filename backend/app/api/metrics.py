"""Metrics API — readiness, sleep intelligence, respiratory rate, weight, health alerts endpoints."""

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.daily_metric import DailyMetric
from app.models.health_alert import HealthAlert
from app.models.sleep import SleepLog
from app.models.user import User
from app.models.weight import WeightLog
from app.services.auth import get_current_user
from app.services.whoop import (
    compute_readiness,
    compute_sleep_consistency,
    compute_sleep_debt,
    suggest_optimal_bedtime,
)

router = APIRouter()


# ── Readiness ───────────────────────────────────────────────────────────────


@router.get("/readiness")
async def get_readiness(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get training readiness based on latest Whoop recovery data.

    Returns readiness level (green/yellow/red), recovery score, HRV, resting HR.
    """
    result = await db.execute(
        select(DailyMetric)
        .where(
            DailyMetric.user_id == current_user.id,
            DailyMetric.recovery_score.isnot(None),
        )
        .order_by(DailyMetric.metric_date.desc())
        .limit(1)
    )
    latest = result.scalar_one_or_none()

    if not latest:
        return {
            "recovery_score": None,
            "readiness": "unknown",
            "hrv_ms": None,
            "resting_hr": None,
            "message": "No recovery data available. Connect Whoop to get readiness scores.",
        }

    readiness = compute_readiness(latest.recovery_score)

    return {
        "recovery_score": latest.recovery_score,
        "readiness": readiness["level"],
        "hrv_ms": latest.hrv_ms,
        "resting_hr": latest.resting_hr,
        "message": readiness["message"],
        "date": latest.metric_date.isoformat(),
    }


# ── Sleep Consistency ──────────────────────────────────────────────────────


@router.get("/sleep-consistency")
async def get_sleep_consistency(
    days: int = Query(7, ge=3, le=30),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get sleep consistency score (0-100) based on bedtime regularity."""
    cutoff = date.today() - timedelta(days=days)

    result = await db.execute(
        select(SleepLog)
        .where(
            SleepLog.user_id == current_user.id,
            SleepLog.sleep_start.isnot(None),
            SleepLog.sleep_date >= cutoff,
        )
        .order_by(SleepLog.sleep_date)
    )
    logs = list(result.scalars().all())

    consistency = compute_sleep_consistency(logs, window_days=days)

    return {
        "consistency_score": consistency["score"],
        "avg_bedtime": consistency["avg_bedtime"],
        "std_minutes": consistency["std_minutes"],
        "days_analyzed": consistency["days_analyzed"],
        "window_days": days,
    }


# ── Sleep Debt ─────────────────────────────────────────────────────────────


@router.get("/sleep-debt")
async def get_sleep_debt(
    target_hours: float = Query(8.0, ge=4.0, le=12.0),
    days: int = Query(7, ge=3, le=30),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get cumulative sleep debt over a rolling window."""
    cutoff = date.today() - timedelta(days=days)

    result = await db.execute(
        select(SleepLog)
        .where(
            SleepLog.user_id == current_user.id,
            SleepLog.total_sleep_seconds.isnot(None),
            SleepLog.sleep_date >= cutoff,
        )
        .order_by(SleepLog.sleep_date)
    )
    logs = list(result.scalars().all())

    debt = compute_sleep_debt(logs, needed_hours=target_hours, window_days=days)

    return {
        "debt_hours": debt["debt_hours"],
        "avg_sleep_hours": debt["avg_sleep_hours"],
        "days_below_target": debt["days_below_target"],
        "target_hours": target_hours,
        "window_days": days,
    }


# ── Optimal Bedtime ────────────────────────────────────────────────────────


@router.get("/optimal-bedtime")
async def get_optimal_bedtime(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Suggest optimal bedtime based on recovery-correlated sleep patterns."""
    cutoff = date.today() - timedelta(days=60)

    result = await db.execute(
        select(SleepLog)
        .where(
            SleepLog.user_id == current_user.id,
            SleepLog.sleep_start.isnot(None),
            SleepLog.sleep_date >= cutoff,
        )
        .order_by(SleepLog.sleep_date)
    )
    logs = list(result.scalars().all())

    # Get recovery scores for the same dates
    metric_result = await db.execute(
        select(DailyMetric)
        .where(
            DailyMetric.user_id == current_user.id,
            DailyMetric.recovery_score.isnot(None),
            DailyMetric.metric_date >= cutoff,
        )
        .order_by(DailyMetric.metric_date)
    )
    metrics = {m.metric_date: m for m in metric_result.scalars().all()}

    suggestion = suggest_optimal_bedtime(logs, metrics)

    return suggestion


# ── Respiratory Rate ───────────────────────────────────────────────────────


@router.get("/respiratory-rate")
async def get_respiratory_rate(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get respiratory rate trend and baseline comparison."""
    cutoff_30 = date.today() - timedelta(days=30)
    cutoff_7 = date.today() - timedelta(days=7)

    # 30-day baseline
    result = await db.execute(
        select(
            func.avg(DailyMetric.respiratory_rate).label("avg_rr"),
            func.stddev(DailyMetric.respiratory_rate).label("std_rr"),
        ).where(
            DailyMetric.user_id == current_user.id,
            DailyMetric.respiratory_rate.isnot(None),
            DailyMetric.metric_date >= cutoff_30,
        )
    )
    baseline = result.one()

    # Latest 7-day average
    result = await db.execute(
        select(func.avg(DailyMetric.respiratory_rate)).where(
            DailyMetric.user_id == current_user.id,
            DailyMetric.respiratory_rate.isnot(None),
            DailyMetric.metric_date >= cutoff_7,
        )
    )
    recent_avg = result.scalar()

    # Latest value
    result = await db.execute(
        select(DailyMetric)
        .where(
            DailyMetric.user_id == current_user.id,
            DailyMetric.respiratory_rate.isnot(None),
        )
        .order_by(DailyMetric.metric_date.desc())
        .limit(1)
    )
    latest = result.scalar_one_or_none()

    baseline_avg = float(baseline.avg_rr) if baseline.avg_rr else None
    recent = float(recent_avg) if recent_avg else None
    latest_rr = (
        float(latest.respiratory_rate) if latest and latest.respiratory_rate else None
    )

    # Trend arrow
    trend = "stable"
    if baseline_avg and recent:
        if recent > baseline_avg * 1.05:
            trend = "elevated"
        elif recent < baseline_avg * 0.95:
            trend = "low"

    return {
        "current_rr": latest_rr,
        "recent_avg_rr": recent,
        "baseline_avg_rr": baseline_avg,
        "trend": trend,
        "date": latest.metric_date.isoformat() if latest else None,
    }


# ── Weight ─────────────────────────────────────────────────────────────────


@router.get("/weight")
async def get_weight_history(
    days: int = Query(90, ge=7, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get weight history with 7-day rolling average."""
    cutoff = date.today() - timedelta(days=days)

    result = await db.execute(
        select(WeightLog)
        .where(
            WeightLog.user_id == current_user.id,
            WeightLog.date >= cutoff,
        )
        .order_by(WeightLog.date)
    )
    logs = list(result.scalars().all())

    if not logs:
        return {"entries": [], "rolling_avg": []}

    entries = [
        {
            "date": log.date.isoformat(),
            "weight_kg": log.weight_kilogram,
            "source": log.source,
        }
        for log in logs
    ]

    # Compute 7-day rolling average
    weights = [log.weight_kilogram for log in logs]
    rolling = []
    for i in range(len(weights)):
        window = weights[max(0, i - 6) : i + 1]
        rolling.append(round(sum(window) / len(window), 1))

    return {
        "entries": entries,
        "rolling_avg": [
            {"date": logs[i].date.isoformat(), "weight_kg": rolling[i]}
            for i in range(len(rolling))
        ],
    }


# ── Health Alerts ────────────────────────────────────────────────────────────


@router.get("/health-alerts")
async def get_health_alerts(
    status: str = Query(
        "active", description="Filter by status: active, acknowledged, dismissed, all"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get health alerts for the current user."""
    query = select(HealthAlert).where(HealthAlert.user_id == current_user.id)
    if status != "all":
        query = query.where(HealthAlert.status == status)
    query = query.order_by(HealthAlert.detected_date.desc())

    result = await db.execute(query)
    alerts = result.scalars().all()

    return [
        {
            "id": str(alert.id),
            "alert_type": alert.alert_type,
            "severity": alert.severity,
            "title": alert.title,
            "description": alert.description,
            "evidence": alert.evidence,
            "detected_date": alert.detected_date.isoformat(),
            "status": alert.status,
            "created_at": alert.created_at.isoformat() if alert.created_at else None,
        }
        for alert in alerts
    ]


@router.patch("/health-alerts/{alert_id}/dismiss")
async def dismiss_health_alert(
    alert_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Dismiss a health alert."""
    from datetime import date as date_type

    result = await db.execute(
        select(HealthAlert).where(
            HealthAlert.id == alert_id,
            HealthAlert.user_id == current_user.id,
        )
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    alert.status = "dismissed"
    alert.dismissed_date = date_type.today()
    await db.flush()
    return {"status": "dismissed"}


@router.post("/health-alerts/analyze")
async def run_health_analysis(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Run health analysis on-demand and return all results including signal scores."""
    from app.services.health_analysis import (
        analyze_illness,
        analyze_injury_risk,
        analyze_overtraining,
        upsert_alert,
    )

    all_results = []
    alerts_generated = 0

    try:
        overtraining = await analyze_overtraining(db, current_user.id)
        if overtraining:
            await upsert_alert(db, current_user.id, overtraining)
            alerts_generated += 1
        all_results.append(
            {
                "type": "overtraining",
                "label": "Overtraining Risk",
                "result": overtraining,
            }
        )
    except Exception as e:
        all_results.append(
            {"type": "overtraining", "label": "Overtraining Risk", "error": str(e)}
        )

    try:
        injury = await analyze_injury_risk(db, current_user.id)
        if injury:
            await upsert_alert(db, current_user.id, injury)
            alerts_generated += 1
        all_results.append(
            {
                "type": "injury_risk",
                "label": "Injury Risk",
                "result": injury,
            }
        )
    except Exception as e:
        all_results.append(
            {"type": "injury_risk", "label": "Injury Risk", "error": str(e)}
        )

    try:
        illness = await analyze_illness(db, current_user.id)
        if illness:
            await upsert_alert(db, current_user.id, illness)
            alerts_generated += 1
        all_results.append(
            {
                "type": "illness_risk",
                "label": "Illness Risk",
                "result": illness,
            }
        )
    except Exception as e:
        all_results.append(
            {"type": "illness_risk", "label": "Illness Risk", "error": str(e)}
        )

    await db.commit()

    return {
        "analysis_results": all_results,
        "alerts_generated": alerts_generated,
    }


# ── Health AI Analysis ──────────────────────────────────────────────────────


@router.post("/health-ai-analysis")
async def trigger_health_ai_analysis(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Trigger an on-demand LLM health analysis.

    Compiles health-specific data (HRV, resting HR, sleep, respiratory rate,
    health alerts, recovery scores) and sends to Gemini for interpretation.
    """
    from app.schemas.llm_analysis import LlmAnalysisRead
    from app.services.llm_analysis import run_health_ai_analysis

    try:
        analysis = await run_health_ai_analysis(db, current_user.id)
        await db.commit()
        return LlmAnalysisRead.model_validate(analysis)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Health analysis failed: {e!s}")


@router.get("/health-ai-analysis")
async def get_latest_health_ai_analysis(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the most recent cached health AI analysis for the current user."""
    from app.models.llm_analysis import LlmAnalysis as LlmAnalysisModel
    from app.schemas.llm_analysis import LlmAnalysisRead

    result = await db.execute(
        select(LlmAnalysisModel)
        .where(
            LlmAnalysisModel.user_id == current_user.id,
            LlmAnalysisModel.analysis_type == "health",
        )
        .order_by(LlmAnalysisModel.created_at.desc())
        .limit(1)
    )
    analysis = result.scalar_one_or_none()
    if not analysis:
        return None
    return LlmAnalysisRead.model_validate(analysis)
