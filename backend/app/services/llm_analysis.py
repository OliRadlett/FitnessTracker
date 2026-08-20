"""LLM Analysis service — compile cycling stats and analyze with Google Gemini."""

import json
import logging
import uuid
from datetime import date, timedelta

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.cycling import CyclingProfile
from app.models.daily_metric import DailyMetric
from app.models.lifting import PersonalRecord
from app.models.llm_analysis import LlmAnalysis

logger = logging.getLogger(__name__)


async def compile_cycling_stats(db: AsyncSession, user_id: uuid.UUID) -> dict:
    """Compile a comprehensive JSON payload of the user's cycling stats for the last 4 weeks.

    Returns a dict with training load, FTP, power curve, VO2max, weekly summaries,
    recovery trends, recent PRs, and decoupling trends.
    """
    from app.services.cycling import (
        compute_decoupling_history,
        compute_power_curve_from_streams,
        compute_training_load,
        estimate_vo2max,
        get_daily_tss,
        get_or_create_cycling_profile,
    )

    today = date.today()
    four_weeks_ago = today - timedelta(days=28)
    ninety_days_ago = today - timedelta(days=90)

    stats: dict = {}

    # 1. Training load (CTL/ATL/TSB)
    try:
        daily_tss = await get_daily_tss(db, user_id, ninety_days_ago, today)
        training_load = compute_training_load(daily_tss, today, lookback_days=90)
        # Only include the last 28 days for the LLM
        stats["training_load"] = training_load[-28:] if training_load else []
        if training_load:
            latest = training_load[-1]
            stats["current_ctl"] = latest["ctl"]
            stats["current_atl"] = latest["atl"]
            stats["current_tsb"] = latest["tsb"]
    except Exception as e:
        logger.warning("Failed to compute training load: %s", e)
        stats["training_load"] = []
        stats["current_ctl"] = None
        stats["current_atl"] = None
        stats["current_tsb"] = None

    # 2. Current FTP
    try:
        profile = await get_or_create_cycling_profile(db, user_id)
        stats["ftp_watts"] = profile.ftp if profile else None
        stats["weight_kg"] = profile.weight_kg if profile else None
        stats["lthr"] = profile.lthr if profile else None
    except Exception as e:
        logger.warning("Failed to get cycling profile: %s", e)
        stats["ftp_watts"] = None
        stats["weight_kg"] = None
        stats["lthr"] = None

    # 3. Power curve
    try:
        power_curve = await compute_power_curve_from_streams(db, user_id, days=90)
        # Convert int keys to string for JSON serialization
        stats["power_curve"] = {str(k): v for k, v in power_curve.items()}
    except Exception as e:
        logger.warning("Failed to compute power curve: %s", e)
        stats["power_curve"] = {}

    # 4. VO2max estimate
    try:
        vo2max = await estimate_vo2max(db, user_id, days=90)
        if vo2max:
            stats["vo2max"] = {
                "value": vo2max.vo2max,
                "confidence": vo2max.confidence,
                "method": vo2max.method,
            }
        else:
            stats["vo2max"] = None
    except Exception as e:
        logger.warning("Failed to estimate VO2max: %s", e)
        stats["vo2max"] = None

    # 5. Weekly summaries (last 4 weeks)
    try:
        weekly_summaries = []
        for week_offset in range(4):
            week_start = today - timedelta(days=today.weekday()) - timedelta(weeks=week_offset)
            week_end = week_start + timedelta(days=6)
            # Clamp to today
            week_end = min(week_end, today)

            result = await db.execute(
                select(
                    func.count(Activity.id).label("ride_count"),
                    func.coalesce(func.sum(Activity.tss), 0.0).label("total_tss"),
                    func.coalesce(func.sum(Activity.distance_meters), 0.0).label("total_distance_m"),
                    func.coalesce(func.sum(Activity.duration_seconds), 0).label("total_duration_s"),
                    func.coalesce(func.sum(Activity.elevation_gain_meters), 0.0).label("total_elevation_m"),
                )
                .where(
                    Activity.user_id == user_id,
                    Activity.sport_type == "cycling",
                    Activity.start_date >= week_start,
                    Activity.start_date <= week_end,
                )
            )
            row = result.one()
            weekly_summaries.append({
                "week_start": str(week_start),
                "week_end": str(week_end),
                "ride_count": row.ride_count,
                "total_tss": round(float(row.total_tss), 1),
                "total_distance_km": round(float(row.total_distance_m) / 1000, 1),
                "total_duration_hours": round(int(row.total_duration_s) / 3600, 1),
                "total_elevation_m": round(float(row.total_elevation_m), 1),
            })
        stats["weekly_summaries"] = list(reversed(weekly_summaries))  # oldest first
    except Exception as e:
        logger.warning("Failed to compute weekly summaries: %s", e)
        stats["weekly_summaries"] = []

    # 6. Recovery trends (last 4 weeks)
    try:
        result = await db.execute(
            select(DailyMetric)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.metric_date >= four_weeks_ago,
            )
            .order_by(DailyMetric.metric_date)
        )
        metrics = result.scalars().all()
        recovery_data = []
        for m in metrics:
            entry = {"date": str(m.metric_date)}
            if m.recovery_score is not None:
                entry["recovery_score"] = m.recovery_score
            if m.hrv_ms is not None:
                entry["hrv_ms"] = m.hrv_ms
            if m.resting_hr is not None:
                entry["resting_hr"] = m.resting_hr
            if m.sleep_duration_minutes is not None:
                entry["sleep_minutes"] = m.sleep_duration_minutes
            if m.sleep_efficiency is not None:
                entry["sleep_efficiency"] = m.sleep_efficiency
            if m.strain is not None:
                entry["strain"] = m.strain
            if len(entry) > 1:  # has more than just the date
                recovery_data.append(entry)
        stats["recovery_trends"] = recovery_data
    except Exception as e:
        logger.warning("Failed to get recovery trends: %s", e)
        stats["recovery_trends"] = []

    # 7. Recent PRs (last 4 weeks)
    try:
        result = await db.execute(
            select(PersonalRecord)
            .where(
                PersonalRecord.user_id == user_id,
                PersonalRecord.achieved_date >= four_weeks_ago,
            )
            .order_by(PersonalRecord.achieved_date.desc())
        )
        prs = result.scalars().all()
        stats["recent_prs"] = [
            {
                "exercise": pr.exercise_name,
                "record_type": pr.record_type,
                "weight_kg": pr.weight_kg,
                "reps": pr.reps,
                "estimated_1rm": pr.estimated_1rm,
                "date": str(pr.achieved_date),
            }
            for pr in prs
        ]
    except Exception as e:
        logger.warning("Failed to get recent PRs: %s", e)
        stats["recent_prs"] = []

    # 8. Decoupling trends
    try:
        decoupling = await compute_decoupling_history(db, user_id, days=28, min_duration_minutes=60)
        stats["decoupling_trends"] = [
            {
                "date": str(d.get("date", "")),
                "decoupling_pct": d.get("decoupling_pct"),
                "classification": d.get("classification"),
            }
            for d in decoupling
        ]
    except Exception as e:
        logger.warning("Failed to compute decoupling trends: %s", e)
        stats["decoupling_trends"] = []

    return stats


async def analyze_with_gemini(stats_json: dict) -> str:
    """Call Google Gemini API to analyze cycling stats and return the analysis text."""
    from app.config import get_settings

    settings = get_settings()

    if not settings.gemini_api_key:
        raise ValueError("GEMINI_API_KEY not configured")

    prompt = f"""You are an expert cycling coach and sports scientist. Analyze the following cycling training data and provide a detailed performance assessment.

## Training Data
```json
{json.dumps(stats_json, indent=2, default=str)}
```

## Instructions
Provide your analysis in the following structure:

### Performance Assessment
- Overall trend (improving/plateauing/declining)
- Key strengths
- Areas for improvement

### Training Load Analysis
- Is the CTL/ATL/TSB balance appropriate?
- Are there signs of overtraining or undertraining?
- Recommendations for load management

### Power & Fitness Benchmarks
- How does the power curve look for the training volume?
- FTP assessment relative to training history
- VO2max interpretation

### Recovery & Readiness
- Recovery trend analysis
- Sleep quality impact on training
- Recommendations for recovery optimization

### Specific Recommendations
- 3-5 actionable recommendations for the next training block
- Focus areas based on the data
- Any warning signs to watch for

Be specific, reference actual numbers from the data, and provide science-backed explanations. Keep the total response under 800 words."""

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={settings.gemini_api_key}"

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 2048,
        },
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()
        result = response.json()

    # Extract text from Gemini response
    return result["candidates"][0]["content"]["parts"][0]["text"]


async def run_llm_analysis(db: AsyncSession, user_id: uuid.UUID) -> LlmAnalysis:
    """Orchestrate the full LLM analysis flow.

    1. Compile cycling stats
    2. Call Gemini for analysis
    3. Create and store LlmAnalysis record
    4. Return the record
    """
    from datetime import date as date_type

    stats = await compile_cycling_stats(db, user_id)
    analysis_text = await analyze_with_gemini(stats)

    record = LlmAnalysis(
        user_id=user_id,
        analysis_date=date_type.today(),
        stats_json=stats,
        analysis_text=analysis_text,
        model_used="gemini-2.0-flash",
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)
    return record
