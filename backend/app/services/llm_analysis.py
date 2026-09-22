"""LLM Analysis service — compile domain stats and analyze with Google Gemini.

Domain-specific logic (compile_* and analyze_* functions) lives in this module.
Shared utilities (Gemini client, record storage, JSON serialization) are in
``app.services.llm_base``.
"""

import json
import logging
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.daily_metric import DailyMetric
from app.models.lifting import PersonalRecord
from app.models.llm_analysis import LlmAnalysis
from app.services.llm_base import (
    GEMINI_MODEL,
    GEMINI_TIMEOUT_S,
    _big_lift_pbs,
    _call_gemini,
    _make_json_serializable,
    _store_analysis,
    ensure_context_sufficient,
    logger,
)


async def compile_cycling_stats(db: AsyncSession, user_id: uuid.UUID) -> dict:
    """Compile a comprehensive JSON payload of the user's cycling stats for the last 4 weeks.

    Returns a dict with training load, FTP, power curve, VO2max, weekly summaries,
    recovery trends, recent PRs, and decoupling trends.
    """
    from app.services.cycling import (
        CTL_WARMUP_DAYS,
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
    # CTL needs a 210-day EWMA warm-up before the 90-day window (QW5: this
    # was previously an undefined name, silently nulling all load context).
    tss_fetch_start = today - timedelta(days=90 + CTL_WARMUP_DAYS)

    stats: dict = {}

    # 1. Training load (CTL/ATL/TSB)
    try:
        daily_tss = await get_daily_tss(db, user_id, tss_fetch_start, today)
        training_load = compute_training_load(daily_tss, today, lookback_days=90)
        # Only include the last 28 days for the LLM
        recent_load = training_load[-28:] if training_load else []
        # Convert date objects to ISO strings for JSON serialization
        stats["training_load"] = [
            {**entry, "date": entry["date"].isoformat()}
            if isinstance(entry.get("date"), date)
            else entry
            for entry in recent_load
        ]
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
        stats["ftp_watts"] = profile.ftp_watts if profile else None
        stats["weight_kg"] = profile.weight_kg if profile else None
        stats["lthr"] = profile.lactate_threshold_hr if profile else None
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

    # 5. Weekly summaries (last 4 weeks) — single grouped query
    try:
        from sqlalchemy import text as sa_text

        current_monday = today - timedelta(days=today.weekday())
        oldest_week_start = current_monday - timedelta(weeks=3)
        week_trunc = func.date_trunc(sa_text("'week'"), Activity.start_date)

        result = await db.execute(
            select(
                week_trunc.label("week_start"),
                func.count(Activity.id).label("ride_count"),
                func.coalesce(func.sum(Activity.tss), 0.0).label("total_tss"),
                func.coalesce(func.sum(Activity.distance_meters), 0.0).label(
                    "total_distance_m"
                ),
                func.coalesce(func.sum(Activity.duration_seconds), 0).label(
                    "total_duration_s"
                ),
                func.coalesce(func.sum(Activity.elevation_gain_meters), 0.0).label(
                    "total_elevation_m"
                ),
            )
            .where(
                Activity.user_id == user_id,
                Activity.sport_type == "cycling",
                Activity.start_date >= oldest_week_start,
            )
            .group_by(week_trunc)
            .order_by(week_trunc)
        )
        weekly_summaries = [
            {
                "week_start": str(
                    row.week_start.date() if row.week_start else oldest_week_start
                ),
                "week_end": str(
                    (row.week_start.date() + timedelta(days=6))
                    if row.week_start
                    else today
                ),
                "ride_count": row.ride_count,
                "total_tss": round(float(row.total_tss), 1),
                "total_distance_km": round(float(row.total_distance_m) / 1000, 1),
                "total_duration_hours": round(int(row.total_duration_s) / 3600, 1),
                "total_elevation_m": round(float(row.total_elevation_m), 1),
            }
            for row in result.all()
        ]
        stats["weekly_summaries"] = weekly_summaries  # oldest first
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

    # 7b. All-time big-lift PBs (historical strength context, any age)
    try:
        stats["big_lift_pbs"] = await _big_lift_pbs(db, user_id)
    except Exception as e:
        logger.warning("Failed to get big lift PBs: %s", e)
        stats["big_lift_pbs"] = []

    # 8. Decoupling trends
    try:
        decoupling = await compute_decoupling_history(
            db, user_id, days=28, min_duration_minutes=60
        )
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

    # ── Lifting Data ──────────────────────────────────────────────────────────

    from app.models.lifting import LiftingSession, LiftingSet

    # 9. Recent lifting sessions (last 4 weeks)
    try:
        result = await db.execute(
            select(LiftingSession)
            .where(
                LiftingSession.user_id == user_id,
                LiftingSession.session_date >= four_weeks_ago,
            )
            .order_by(LiftingSession.session_date.desc())
        )
        sessions = result.scalars().all()
        stats["recent_lifting_sessions"] = [
            {
                "date": str(s.session_date),
                "focus": s.focus,
                "total_volume_kg": s.total_volume_kg,
                "rpe_session": s.rpe_session,
                "duration_seconds": s.duration_seconds,
            }
            for s in sessions
        ]
        stats["lifting_session_count_4w"] = len(sessions)
    except Exception as e:
        logger.warning("Failed to get recent lifting sessions: %s", e)
        stats["recent_lifting_sessions"] = []
        stats["lifting_session_count_4w"] = 0

    # 10. Lifting volume trend (8 weeks)
    try:
        eight_weeks_ago = today - timedelta(days=56)
        from sqlalchemy import text as sa_text

        week_trunc = func.date_trunc(sa_text("'week'"), LiftingSession.session_date)
        result = await db.execute(
            select(
                week_trunc.label("week_start"),
                func.count(LiftingSession.id).label("session_count"),
                func.coalesce(func.sum(LiftingSession.total_volume_kg), 0.0).label(
                    "total_volume"
                ),
            )
            .where(
                LiftingSession.user_id == user_id,
                LiftingSession.session_date >= eight_weeks_ago,
            )
            .group_by(week_trunc)
            .order_by(week_trunc)
        )
        rows = result.all()
        stats["lifting_volume_trend"] = [
            {
                "week_start": str(row.week_start.date() if row.week_start else ""),
                "session_count": row.session_count,
                "total_volume_kg": round(float(row.total_volume), 1),
            }
            for row in rows
        ]
    except Exception as e:
        logger.warning("Failed to compute lifting volume trend: %s", e)
        stats["lifting_volume_trend"] = []

    # 11. Cross-sport correlation (days with both cycling and lifting in last 4 weeks)
    try:
        # Get dates with cycling
        cycling_dates_result = await db.execute(
            select(func.date(Activity.start_date).label("act_date"))
            .where(
                Activity.user_id == user_id,
                Activity.sport_type == "cycling",
                Activity.start_date >= four_weeks_ago,
            )
            .distinct()
        )
        cycling_dates = {str(r.act_date) for r in cycling_dates_result.all()}

        # Get dates with lifting
        lifting_dates_result = await db.execute(
            select(LiftingSession.session_date)
            .where(
                LiftingSession.user_id == user_id,
                LiftingSession.session_date >= four_weeks_ago,
            )
            .distinct()
        )
        lifting_dates = {str(r.session_date) for r in lifting_dates_result.all()}

        dual_sport_days = sorted(cycling_dates & lifting_dates)
        stats["cross_sport"] = {
            "cycling_days_count": len(cycling_dates),
            "lifting_days_count": len(lifting_dates),
            "dual_sport_days": dual_sport_days,
            "dual_sport_count": len(dual_sport_days),
        }
    except Exception as e:
        logger.warning("Failed to compute cross-sport correlation: %s", e)
        stats["cross_sport"] = {}

    # ── Health & Wellness Data ─────────────────────────────────────────────────

    from app.models.event import Event
    from app.models.health_alert import HealthAlert
    from app.models.sleep import SleepLog
    from app.models.weight import WeightLog

    # 12. Sleep trends (last 4 weeks)
    try:
        result = await db.execute(
            select(SleepLog)
            .where(
                SleepLog.user_id == user_id,
                SleepLog.sleep_date >= four_weeks_ago,
            )
            .order_by(SleepLog.sleep_date)
        )
        sleep_logs = result.scalars().all()
        sleep_data = []
        durations = []
        efficiencies = []
        for sl in sleep_logs:
            entry: dict = {"date": str(sl.sleep_date)}
            effective = sl.effective_total_sleep_seconds
            if effective is not None:
                hours = round(effective / 3600, 1)
                entry["sleep_hours"] = hours
                durations.append(hours)
            if sl.sleep_efficiency is not None:
                entry["efficiency"] = sl.sleep_efficiency
                efficiencies.append(sl.sleep_efficiency)
            if sl.deep_sleep_seconds is not None:
                entry["deep_sleep_hours"] = round(sl.deep_sleep_seconds / 3600, 1)
            sleep_data.append(entry)

        stats["sleep_trends"] = {
            "entries": sleep_data[-28:],  # last 28 entries max
            "avg_sleep_hours": round(sum(durations) / len(durations), 1)
            if durations
            else None,
            "avg_efficiency": round(sum(efficiencies) / len(efficiencies), 1)
            if efficiencies
            else None,
            "nights_tracked": len(sleep_data),
        }
    except Exception as e:
        logger.warning("Failed to get sleep trends: %s", e)
        stats["sleep_trends"] = {}

    # 13. Weight trend (last 4 weeks)
    try:
        result = await db.execute(
            select(WeightLog)
            .where(
                WeightLog.user_id == user_id,
                WeightLog.date >= four_weeks_ago,
            )
            .order_by(WeightLog.date)
        )
        weight_logs = result.scalars().all()
        weight_data = [
            {"date": str(wl.date), "weight_kg": round(wl.weight_kilogram, 1)}
            for wl in weight_logs
        ]
        stats["weight_trend"] = {
            "entries": weight_data,
            "latest_kg": weight_data[-1]["weight_kg"] if weight_data else None,
            "change_kg": round(
                weight_data[-1]["weight_kg"] - weight_data[0]["weight_kg"], 1
            )
            if len(weight_data) >= 2
            else None,
        }
    except Exception as e:
        logger.warning("Failed to get weight trend: %s", e)
        stats["weight_trend"] = {}

    # 14. Active health alerts
    try:
        result = await db.execute(
            select(HealthAlert)
            .where(
                HealthAlert.user_id == user_id,
                HealthAlert.status == "active",
            )
            .order_by(HealthAlert.detected_date.desc())
            .limit(10)
        )
        alerts = result.scalars().all()
        stats["health_alerts"] = [
            {
                "type": a.alert_type,
                "severity": a.severity,
                "title": a.title,
                "description": a.description,
                "detected_date": str(a.detected_date),
            }
            for a in alerts
        ]
    except Exception as e:
        logger.warning("Failed to get health alerts: %s", e)
        stats["health_alerts"] = []

    # ── Upcoming Events ───────────────────────────────────────────────────────

    # 15. Events in next 8 weeks
    try:
        eight_weeks_future = today + timedelta(days=56)
        result = await db.execute(
            select(Event)
            .where(
                Event.user_id == user_id,
                Event.event_date >= today,
                Event.event_date <= eight_weeks_future,
            )
            .order_by(Event.event_date)
        )
        events = result.scalars().all()
        stats["upcoming_events"] = [
            {
                "name": e.name,
                "event_type": e.event_type,
                "event_date": str(e.event_date),
                "days_until": (e.event_date - today).days,
                "taper_days": e.taper_days,
                "notes": e.notes,
            }
            for e in events
        ]
    except Exception as e:
        logger.warning("Failed to get upcoming events: %s", e)
        stats["upcoming_events"] = []

    # ── Deficiency / Weakness Analysis ──────────────────────────────────────────
    try:
        from app.services.deficiency import analyze_deficiencies

        deff_response = await analyze_deficiencies(db, user_id, weeks=8)
        stats["deficiency_analysis"] = {
            "weaknesses": [
                {
                    "category": w.category,
                    "type": w.type,
                    "metric": w.metric,
                    "value": w.value,
                    "unit": w.unit,
                    "severity": w.severity,
                    "detail": w.detail,
                    "recommendation": w.recommendation,
                }
                for w in deff_response.weaknesses
            ],
            "summary": {
                "total_weaknesses": deff_response.summary.total_weaknesses,
                "critical": deff_response.summary.critical,
                "high": deff_response.summary.high,
                "medium": deff_response.summary.medium,
                "low": deff_response.summary.low,
                "strengths": deff_response.summary.strengths,
            },
        }
    except Exception as e:
        logger.warning("Failed to get deficiency analysis: %s", e)
        stats["deficiency_analysis"] = {}

    # ── Active Goals ────────────────────────────────────────────────────────────
    try:
        from app.models.goal import Goal

        goal_result = await db.execute(
            select(Goal).where(
                Goal.user_id == user_id,
                Goal.status == "active",
            )
        )
        goals = goal_result.scalars().all()
        stats["goals"] = [
            {
                "metric": g.metric,
                "filter": g.filter_json,
                "target_value": g.target_value,
                "current_value": g.current_value,
                "target_date": str(g.target_date) if g.target_date else None,
                "notes": g.notes,
            }
            for g in goals
        ]
    except Exception as e:
        logger.warning("Failed to get active goals: %s", e)
        stats["goals"] = []

    # ── Active Training Plan + Upcoming Schedule ────────────────────────────────
    training_plan: dict = {}
    try:
        from app.models.training_plan import TrainingPlan, TrainingPlanDay

        plan_result = await db.execute(
            select(TrainingPlan).where(
                TrainingPlan.user_id == user_id,
                TrainingPlan.status == "active",
            )
        )
        plan = plan_result.scalar_one_or_none()
        if plan:
            training_plan["name"] = plan.name
            training_plan["plan_type"] = plan.plan_type
            training_plan["start_date"] = str(plan.start_date)
            training_plan["end_date"] = str(plan.end_date)

            # Upcoming scheduled sessions (next 14 days)
            fourteen_days_future = today + timedelta(days=14)
            day_result = await db.execute(
                select(TrainingPlanDay).where(
                    TrainingPlanDay.plan_id == plan.id,
                    TrainingPlanDay.day_date >= today,
                    TrainingPlanDay.day_date <= fourteen_days_future,
                ).order_by(TrainingPlanDay.day_date)
            )
            training_plan["upcoming_sessions"] = [
                {
                    "date": str(d.day_date),
                    "sport": d.sport,
                    "planned_type": d.planned_type,
                    "planned_focus": d.planned_focus,
                    "planned_tss": d.planned_tss,
                    "planned_rpe": d.planned_rpe,
                    "planned_zone": d.planned_zone,
                    "completed": d.completed,
                }
                for d in day_result.scalars().all()
            ]
    except Exception as e:
        logger.warning("Failed to get training plan context: %s", e)
        training_plan = {}

    stats["training_plan"] = training_plan

    return _make_json_serializable(stats)


async def analyze_with_gemini(stats_json: dict) -> str:
    """Call Google Gemini API to analyze cycling stats and return the analysis text."""
    prompt = f"""You are an expert cycling coach, strength coach, and sports scientist. Analyze the following comprehensive training data and provide a detailed performance assessment.

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

### Cross-Sport Balance
- How does lifting volume complement or interfere with cycling?
- Are there signs of interference effect from dual-sport training?
- Recommendations for balancing strength and endurance work
- Reference big_lift_pbs (all-time best estimated 1RMs with dates achieved) as strength context, even if those PBs are months old — comment on whether recent lifting work is consistent with maintaining/building that strength

### Health & Wellness
- Sleep quality and consistency trends
- Weight trend interpretation (if data available)
- NOTE: active health alerts are already diagnosed on the Health page with severity and evidence — do NOT re-diagnose them here. Only mention an alert if it directly constrains next week's training, in one line.

### Training Plan & Deficiency Analysis
- Is the rider following an active training plan? Reference plan name, type, and upcoming sessions for the next 2 weeks.
- Is the current training load (CTL) aligned with the plan's scheduled TSS? Are there upcoming hard days or recovery days?
- NOTE: the top weakness areas and their recommendations are already computed in the deficiency analysis above — do NOT invent additional weaknesses. Reference at most the top 2-3 by name and how they fit the next block.
- Are there any active goals the rider is working toward? Reference goal metrics, target values, and progress.

### Event Preparation
- If upcoming events exist, provide taper and preparation advice
- Current fitness relative to event demands
- Recommended training adjustments in the lead-up

### Specific Recommendations
- 3-5 actionable recommendations for the next training block
- Focus areas based on all available data (cycling, lifting, health, weaknesses, goals)
- Any warning signs to watch for

Be specific, reference actual numbers from the data, and provide science-backed explanations. Keep the total response under 1200 words."""

    return await _call_gemini(prompt, "cycling")


async def run_llm_analysis(db: AsyncSession, user_id: uuid.UUID) -> LlmAnalysis:
    """Orchestrate the full LLM analysis flow.

    1. Compile cycling stats
    2. Call Gemini for analysis
    3. Create and store LlmAnalysis record
    4. Return the record
    """
    stats = await compile_cycling_stats(db, user_id)
    ensure_context_sufficient(stats, "cycling")
    analysis_text = await analyze_with_gemini(stats)
    return await _store_analysis(db, user_id, "cycling", stats, analysis_text)


async def compile_activity_context(
    db: AsyncSession,
    user_id: uuid.UUID,
    activity_id: uuid.UUID,
) -> dict | None:
    """Compile ride-specific stats + recent training context for a single activity.

    Returns None if the activity doesn't exist or doesn't belong to the user.
       Returns a dict with:
       - activity summary (name, date, duration, distance, power, HR, weather, etc.)
       - static analysis (power zones, pacing, decoupling, climbing, etc.)
       - recent training context (CTL/ATL/TSB, last 7 days summary, recovery)
       - route context (route name, climb segments with effort data — "laps of a hill")
       - planned training (training plan day the activity fulfilled, if any)
       - personal records achieved on this activity
       - fuel plan (ride nutrition strategy, if any)
       - health overlay (pre-ride HRV, recovery, sleep)
     """
    from app.services.session_analysis import analyze_ride

    # 1. Fetch the activity
    result = await db.execute(
        select(Activity).where(
            Activity.id == activity_id,
            Activity.user_id == user_id,
        )
    )
    activity = result.scalar_one_or_none()
    if not activity:
        return None

    # 2. Activity summary
    activity_summary = {
        "name": activity.name,
        "sport_type": activity.sport_type,
        "start_date": activity.start_date.isoformat() if activity.start_date else None,
        "duration_seconds": activity.duration_seconds,
        "distance_meters": round(activity.distance_meters, 1)
        if activity.distance_meters
        else None,
        "elevation_gain_meters": round(activity.elevation_gain_meters, 1)
        if activity.elevation_gain_meters
        else None,
        "average_power": activity.average_power,
        "max_power": activity.max_power if hasattr(activity, "max_power") else None,
        "normalized_power": activity.normalized_power,
        "average_heartrate": activity.average_heartrate,
        "max_heartrate": activity.max_heartrate,
        "average_speed": activity.average_speed,
        "average_cadence": activity.average_cadence,
        "tss": activity.tss,
        "calories": activity.calories,
        "rpe": activity.rpe,
        "weather_temperature": activity.weather_temperature,
        "weather_conditions": activity.weather_conditions,
        "weather_wind_speed_kmh": activity.weather_wind_speed_kmh,
        "weather_wind_direction": activity.weather_wind_direction,
        "weather_precipitation_mm": activity.weather_precipitation_mm,
    }

    # 3. Static analysis (power zones, pacing, decoupling, etc.)
    static_analysis = await analyze_ride(db, user_id, activity_id)

    # 4. Recent training context (CTL/ATL/TSB, last 7 days)
    training_context: dict = {}

    # CTL/ATL/TSB
    try:
        from app.services.cycling import (
            CTL_WARMUP_DAYS,
            compute_training_load,
            get_daily_tss,
        )

        today = date.today()
        tss_fetch_start = today - timedelta(days=90 + CTL_WARMUP_DAYS)
        daily_tss = await get_daily_tss(db, user_id, tss_fetch_start, today)
        training_load = compute_training_load(daily_tss, today, lookback_days=90)
        if training_load:
            latest = training_load[-1]
            training_context["current_ctl"] = latest["ctl"]
            training_context["current_atl"] = latest["atl"]
            training_context["current_tsb"] = latest["tsb"]
            # Last 7 days for context
            recent = training_load[-7:]
            training_context["recent_tsb_trend"] = [
                {
                    "date": entry["date"].isoformat()
                    if isinstance(entry["date"], date)
                    else str(entry["date"]),
                    "tsb": entry["tsb"],
                    "ctl": entry["ctl"],
                    "atl": entry["atl"],
                }
                for entry in recent
            ]
    except Exception as e:
        logger.warning("Failed to compute training load for activity context: %s", e)
        training_context["current_ctl"] = None
        training_context["current_atl"] = None
        training_context["current_tsb"] = None

    # FTP
    try:
        from app.services.cycling import get_or_create_cycling_profile

        profile = await get_or_create_cycling_profile(db, user_id)
        training_context["ftp_watts"] = profile.ftp_watts if profile else None
        training_context["weight_kg"] = profile.weight_kg if profile else None
        training_context["lthr"] = profile.lactate_threshold_hr if profile else None
    except Exception as e:
        logger.warning("Failed to get cycling profile for activity context: %s", e)

    # Recent ride summaries (last 7 days, excluding this activity)
    try:
        seven_days_ago = date.today() - timedelta(days=7)
        result = await db.execute(
            select(Activity)
            .where(
                Activity.user_id == user_id,
                Activity.sport_type == "cycling",
                Activity.start_date >= seven_days_ago,
                Activity.id != activity_id,
            )
            .order_by(Activity.start_date.desc())
            .limit(10)
        )
        recent_rides = result.scalars().all()
        training_context["recent_rides"] = [
            {
                "name": r.name,
                "date": r.start_date.isoformat() if r.start_date else None,
                "duration_seconds": r.duration_seconds,
                "distance_meters": round(r.distance_meters, 1)
                if r.distance_meters
                else None,
                "tss": r.tss,
                "average_power": r.average_power,
            }
            for r in recent_rides
        ]
    except Exception as e:
        logger.warning("Failed to get recent rides for activity context: %s", e)
        training_context["recent_rides"] = []

    # Recovery data (last 3 days)
    try:
        three_days_ago = date.today() - timedelta(days=3)
        result = await db.execute(
            select(DailyMetric)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.metric_date >= three_days_ago,
            )
            .order_by(DailyMetric.metric_date.desc())
        )
        metrics = result.scalars().all()
        training_context["recent_recovery"] = []
        for m in metrics:
            entry: dict = {"date": str(m.metric_date)}
            if m.recovery_score is not None:
                entry["recovery_score"] = m.recovery_score
            if m.hrv_ms is not None:
                entry["hrv_ms"] = m.hrv_ms
            if m.resting_hr is not None:
                entry["resting_hr"] = m.resting_hr
            if m.sleep_duration_minutes is not None:
                entry["sleep_minutes"] = m.sleep_duration_minutes
            if m.strain is not None:
                entry["strain"] = m.strain
            if len(entry) > 1:
                training_context["recent_recovery"].append(entry)
    except Exception as e:
        logger.warning("Failed to get recovery data for activity context: %s", e)
        training_context["recent_recovery"] = []

    # ── Route Context (laps of a hill: climb segments + segment efforts) ──────
    route_context: dict = {}
    try:
        from app.models.route import Route
        from app.models.segment import Segment, SegmentEffort

        if activity.route_id:
            route_result = await db.execute(
                select(Route).where(Route.id == activity.route_id)
            )
            route = route_result.scalar_one_or_none()
            if route:
                route_context["name"] = route.name
                route_context["distance_meters"] = round(route.distance_meters, 1)
                route_context["elevation_gain_meters"] = (
                    round(route.elevation_gain_meters, 1)
                    if route.elevation_gain_meters
                    else None
                )
                route_context["is_loop"] = route.is_loop

                # Climb segments on this route
                seg_result = await db.execute(
                    select(Segment).where(Segment.route_id == route.id)
                )
                segments = seg_result.scalars().all()
                route_context["climb_segments"] = []
                for seg in segments:
                    seg_dict: dict = {
                        "name": seg.name,
                        "distance_m": round(seg.distance_m, 1),
                        "elevation_gain_m": round(seg.elevation_gain_m, 1),
                        "avg_gradient_pct": round(seg.avg_gradient_pct, 1),
                        "max_gradient_pct": round(seg.max_gradient_pct, 1)
                        if seg.max_gradient_pct
                        else None,
                        "climb_category": seg.climb_category,
                    }
                    # Look up this ride's effort on the segment (laps of the hill)
                    effort_result = await db.execute(
                        select(SegmentEffort).where(
                            SegmentEffort.segment_id == seg.id,
                            SegmentEffort.activity_id == activity_id,
                        )
                    )
                    effort = effort_result.scalar_one_or_none()
                    if effort:
                        seg_dict["effort"] = {
                            "elapsed_seconds": round(effort.elapsed_seconds, 1),
                            "avg_power_watts": effort.avg_power_watts,
                            "avg_hr": effort.avg_hr,
                            "avg_speed_mps": round(effort.avg_speed_mps, 2),
                            "vam": effort.effort_vam,
                            "is_pr": effort.is_pr,
                        }
                    route_context["climb_segments"].append(seg_dict)
    except Exception as e:
        logger.warning("Failed to get route context for activity: %s", e)

    # ── Planned Training (training plan day this activity fulfilled) ──────────
    planned_training: dict = {}
    try:
        from app.models.training_plan import TrainingPlan, TrainingPlanDay

        plan_result = await db.execute(
            select(TrainingPlanDay, TrainingPlan)
            .join(TrainingPlan, TrainingPlanDay.plan_id == TrainingPlan.id)
            .where(TrainingPlanDay.activity_id == activity_id)
            .limit(1)
        )
        plan_row = plan_result.first()
        if plan_row:
            day, plan = plan_row
            planned_training = {
                "plan_name": plan.name,
                "plan_type": plan.plan_type,
                "planned_type": day.planned_type,
                "planned_focus": day.planned_focus,
                "planned_tss": day.planned_tss,
                "planned_zone": day.planned_zone,
                "planned_power_watts": day.planned_power_watts,
                "workout_description": day.workout_description,
                "completed": day.completed,
            }
    except Exception as e:
        logger.warning("Failed to get training plan context for activity: %s", e)

    # ── Personal Records achieved on this activity ────────────────────────────
    personal_records: list = []
    try:
        pr_result = await db.execute(
            select(PersonalRecord).where(
                PersonalRecord.user_id == user_id,
                PersonalRecord.activity_id == activity_id,
            )
        )
        personal_records = [
            {
                "exercise_name": pr.exercise_name,
                "record_type": pr.record_type,
                "weight_kg": pr.weight_kg,
                "reps": pr.reps,
                "estimated_1rm": pr.estimated_1rm,
                "achieved_date": str(pr.achieved_date),
                "notes": pr.notes,
            }
            for pr in pr_result.scalars().all()
        ]
    except Exception as e:
        logger.warning("Failed to get PRs for activity context: %s", e)

    # ── Fuel Plan (ride nutrition) ──────────────────────────────────────────────
    fuel_plan: dict = {}
    try:
        from app.models.nutrition import RideFuelPlan

        fuel_result = await db.execute(
            select(RideFuelPlan).where(
                RideFuelPlan.user_id == user_id,
                RideFuelPlan.activity_id == activity_id,
            )
            .limit(1)
        )
        fuel_row = fuel_result.scalar_one_or_none()
        if fuel_row:
            fuel_plan = {
                "planned_duration_min": fuel_row.planned_duration_min,
                "pre_ride_carbs_g": fuel_row.pre_ride_carbs_g,
                "during_carbs_per_hour_g": fuel_row.during_carbs_per_hour_g,
                "source": fuel_row.source,
            }
    except Exception as e:
        logger.warning("Failed to get fuel plan for activity context: %s", e)

    # ── Health Overlay (pre-ride metrics: previous day HRV/recovery/sleep) ──────
    health_overlay: dict = {}
    try:
        prev_date = activity.start_date.date() - timedelta(days=1)
        dm_result = await db.execute(
            select(DailyMetric)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.metric_date == prev_date,
            )
            .order_by(DailyMetric.source)
            .limit(1)
        )
        dm = dm_result.scalar_one_or_none()
        if dm:
            health_overlay = {
                "date": str(prev_date),
                "hrv_ms": dm.hrv_ms,
                "recovery_score": dm.recovery_score,
                "resting_hr": dm.resting_hr,
                "sleep_duration_minutes": dm.sleep_duration_minutes,
                "sleep_efficiency": dm.sleep_efficiency,
                "strain": dm.strain,
            }
        else:
            from app.models.sleep import SleepLog

            sleep_result = await db.execute(
                select(SleepLog)
                .where(
                    SleepLog.user_id == user_id,
                    SleepLog.sleep_date == prev_date,
                )
                .order_by(SleepLog.source)
                .limit(1)
            )
            sleep = sleep_result.scalar_one_or_none()
            if sleep:
                health_overlay = {
                    "date": str(prev_date),
                    "sleep_duration_minutes": sleep.total_sleep_seconds / 60
                    if sleep.total_sleep_seconds
                    else None,
                    "sleep_efficiency": sleep.sleep_efficiency,
                }
    except Exception as e:
        logger.warning("Failed to get health overlay for activity context: %s", e)

    return _make_json_serializable(
        {
            "activity_summary": activity_summary,
            "static_analysis": static_analysis,
            "training_context": training_context,
            "route_context": route_context,
            "planned_training": planned_training,
            "personal_records": personal_records,
            "fuel_plan": fuel_plan,
            "health_overlay": health_overlay,
        }
    )


async def analyze_activity_with_gemini(context: dict) -> str:
    """Call Google Gemini API to analyze a single ride with training context."""
    prompt = f"""You are an expert cycling coach and sports scientist. Analyze the following individual ride data in the context of the rider's recent training.

## Ride Data
```json
{json.dumps(context["activity_summary"], indent=2, default=str)}
```

## Static Analysis (Power Zones, Pacing, Decoupling, Climbing)
```json
{json.dumps(context["static_analysis"], indent=2, default=str)}
```

## Training Context (Recent Load, Recovery, Other Rides)
```json
{json.dumps(context["training_context"], indent=2, default=str)}
```

## Route Context (Climb Segments — "Laps of a Hill")
```json
{json.dumps(context.get("route_context", {}), indent=2, default=str)}
```

## Planned Training (What the Plan Called For)
```json
{json.dumps(context.get("planned_training", {}), indent=2, default=str)}
```

## Personal Records Achieved
```json
{json.dumps(context.get("personal_records", []), indent=2, default=str)}
```

## Fuel Plan (Nutrition Strategy)
```json
{json.dumps(context.get("fuel_plan", {}), indent=2, default=str)}
```

## Health Overlay (Pre-Ride Readiness)
```json
{json.dumps(context.get("health_overlay", {}), indent=2, default=str)}
```

## Instructions
Provide a detailed analysis of THIS specific ride in the following structure:

### Pacing Analysis
- How was the power distributed across the ride?
- Was the pacing strategy effective? Any signs of going out too hard or fading?
- What does the variability index tell us about pacing consistency?

### Effort Classification
- What type of effort was this? (recovery, endurance, tempo, threshold, VO2max, sprint)
- Based on IF, TSS, and zone distribution, how hard was this ride?
- Was the effort appropriate given the rider's current training load (CTL/ATL/TSB)?

### Heart Rate vs Power Insights
- What does the decoupling tell us about aerobic fitness for this ride?
- How does efficiency factor compare to what we'd expect?
- Any signs of fatigue or dehydration from the HR/power relationship?

### Weather Impact
- How did the weather conditions (temperature, wind, precipitation) affect performance?
- Did headwinds or temperature impact power output or HR?
- Reference the specific weather values from ride data.

### Route & Climb Analysis (Laps of a Hill)
- Summarise each named climb segment: what was the gradient, how did the rider perform (power, VAM, time)?
- For each climb effort, did the rider improve on their previous best (PR efforts)?
- Was pacing on climbs sustainable, or did the rider fade on steeper sections?
- Reference specific climb names, gradients, and VAM values from the route context.

### Training Plan Fit
- Was this ride what the training plan called for? (Reference planned type/focus/TSS)
- Did the rider match the planned zone or power target?
- If there's a mismatch, was it intentional (adjustment) or a deviation?

### Pre-Ride Readiness
- How did the previous day's HRV, recovery score, and sleep affect today's performance?
- Was the rider well-prepared for this effort based on the health overlay?

### Nutrition & Fueling
- Was the fuel plan appropriate for this ride's duration and intensity?
- Are there recommendations for adjusting carb intake on similar future rides?

### Specific Recommendations
- 2-3 actionable takeaways from this ride
- What should the rider focus on in their next training session?
- Any concerns about recovery or training balance?

Be specific and reference actual numbers from the data. Keep the total response under 700 words."""

    return await _call_gemini(prompt, "activity")


async def run_activity_ai_analysis(
    db: AsyncSession,
    user_id: uuid.UUID,
    activity_id: uuid.UUID,
) -> LlmAnalysis:
    """Orchestrate the per-activity AI analysis flow.

    1. Compile ride-specific context
    2. Call Gemini for analysis
    3. Create and store LlmAnalysis record (with activity_id)
    4. Return the record

    Returns None if the activity doesn't exist.
    """
    context = await compile_activity_context(db, user_id, activity_id)
    if context is None:
        return None

    ensure_context_sufficient(context, "activity")
    analysis_text = await analyze_activity_with_gemini(context)
    return await _store_analysis(
        db, user_id, "activity", context, analysis_text, activity_id=activity_id
    )


# ── Per-Lifting-Session AI Analysis ──────────────────────────────────────────


async def compile_lifting_session_context(
    db: AsyncSession,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
) -> dict | None:
    """Compile lifting session data + recent trends + recovery for AI analysis.

    Returns None if the session doesn't exist or doesn't belong to the user.
       Returns a dict with:
       - session summary (date, focus, exercises, sets, volume, RPE)
       - static analysis (fatigue index, PR proximity, rep dropoff, etc.)
       - recent lifting context (volume trends, recent sessions, recovery)
       - video analysis (form scores, velocity, consistency, RPE estimates from lift videos)
       - planned training (training plan day the session fulfilled, with planned focus vs actual focus)
       - warmup template details (if associated with a plan day)
       - whoop enrichment (strain, HR, kilojoules if the session was enriched)
       - linked activity (Strava/Wahoo activity that enriched this session, if any)
     """
    from collections import defaultdict

    from sqlalchemy.orm import selectinload

    from app.models.daily_metric import DailyMetric
    from app.models.lifting import LiftingSession, LiftingSet, PersonalRecord
    from app.services.lifting import brzycki_1rm
    from app.services.session_analysis import analyze_lifting_session

    # 1. Fetch session with sets
    result = await db.execute(
        select(LiftingSession)
        .options(selectinload(LiftingSession.sets))
        .where(
            LiftingSession.id == session_id,
            LiftingSession.user_id == user_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        return None

    sets = session.sets or []
    working_sets = [s for s in sets if not s.is_warmup]

    # 2. Session summary
    total_volume = sum(s.weight_kg * s.reps for s in working_sets)
    exercises = list({s.exercise_name for s in sets})
    set_rpes = [s.rpe for s in working_sets if s.rpe is not None]
    avg_set_rpe = round(sum(set_rpes) / len(set_rpes), 1) if set_rpes else None

    session_summary = {
        "date": str(session.session_date),
        "focus": session.focus,
        "notes": session.notes,
        "duration_seconds": session.duration_seconds,
        "rpe_session": session.rpe_session,
        "avg_set_rpe": avg_set_rpe,
        "exercise_count": len(exercises),
        "working_sets_count": len(working_sets),
        "total_volume_kg": round(total_volume, 1),
        "exercises": [],
    }

    # Per-exercise breakdown
    sets_by_exercise: dict[str, list[LiftingSet]] = defaultdict(list)
    for s in working_sets:
        sets_by_exercise[s.exercise_name].append(s)

    for exercise_name, exercise_sets in sets_by_exercise.items():
        sorted_sets = sorted(exercise_sets, key=lambda x: x.set_number)
        ex_volume = sum(s.weight_kg * s.reps for s in sorted_sets)
        top_1rm = max(
            (brzycki_1rm(s.weight_kg, s.reps) for s in sorted_sets if s.reps > 0),
            default=0,
        )
        session_summary["exercises"].append(
            {
                "name": exercise_name,
                "sets": [
                    {
                        "set_number": s.set_number,
                        "weight_kg": s.weight_kg,
                        "reps": s.reps,
                        "rpe": s.rpe,
                        "estimated_1rm": round(brzycki_1rm(s.weight_kg, s.reps), 1)
                        if s.reps > 0
                        else None,
                    }
                    for s in sorted_sets
                ],
                "volume_kg": round(ex_volume, 1),
                "top_estimated_1rm": round(top_1rm, 1) if top_1rm > 0 else None,
            }
        )

    # 3. Static analysis
    static_analysis = await analyze_lifting_session(db, user_id, session_id)

    # 4. Recent lifting context
    lifting_context: dict = {}

    # Recent sessions (last 4 weeks, excluding this one)
    try:
        four_weeks_ago = date.today() - timedelta(days=28)
        result = await db.execute(
            select(LiftingSession)
            .where(
                LiftingSession.user_id == user_id,
                LiftingSession.session_date >= four_weeks_ago,
                LiftingSession.id != session_id,
            )
            .order_by(LiftingSession.session_date.desc())
            .limit(10)
        )
        recent_sessions = result.scalars().all()
        lifting_context["recent_sessions"] = [
            {
                "date": str(s.session_date),
                "focus": s.focus,
                "total_volume_kg": s.total_volume_kg,
                "rpe_session": s.rpe_session,
            }
            for s in recent_sessions
        ]
    except Exception as e:
        logger.warning("Failed to get recent lifting sessions: %s", e)
        lifting_context["recent_sessions"] = []

    # PRs for exercises in this session
    try:
        pr_exercises = list({s.exercise_name for s in working_sets})
        result = await db.execute(
            select(PersonalRecord).where(
                PersonalRecord.user_id == user_id,
                PersonalRecord.exercise_name.in_(pr_exercises),
                PersonalRecord.estimated_1rm.isnot(None),
            )
        )
        prs = result.scalars().all()
        pr_by_exercise: dict[str, list[dict]] = defaultdict(list)
        for pr in prs:
            pr_by_exercise[pr.exercise_name].append(
                {
                    "weight_kg": pr.weight_kg,
                    "reps": pr.reps,
                    "estimated_1rm": pr.estimated_1rm,
                    "achieved_date": str(pr.achieved_date),
                }
            )
        lifting_context["personal_records"] = dict(pr_by_exercise)
    except Exception as e:
        logger.warning("Failed to get PRs for lifting context: %s", e)
        lifting_context["personal_records"] = {}

    # All-time big-lift PBs (historical strength context, any age)
    try:
        lifting_context["big_lift_pbs"] = await _big_lift_pbs(db, user_id)
    except Exception as e:
        logger.warning("Failed to get big lift PBs for lifting context: %s", e)
        lifting_context["big_lift_pbs"] = []

    # Volume trends (last 8 weeks)
    try:
        from app.services.lifting import get_volume_trends

        volume_trends = await get_volume_trends(db, user_id, weeks=8)
        lifting_context["volume_trends"] = [
            {
                "week_start": str(v.week_start),
                "total_volume_kg": v.total_volume_kg,
                "session_count": v.session_count,
            }
            for v in volume_trends
        ]
    except Exception as e:
        logger.warning("Failed to get volume trends for lifting context: %s", e)
        lifting_context["volume_trends"] = []

    # Recovery data (last 3 days)
    try:
        three_days_ago = date.today() - timedelta(days=3)
        result = await db.execute(
            select(DailyMetric)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.metric_date >= three_days_ago,
            )
            .order_by(DailyMetric.metric_date.desc())
        )
        metrics = result.scalars().all()
        lifting_context["recent_recovery"] = []
        for m in metrics:
            entry: dict = {"date": str(m.metric_date)}
            if m.recovery_score is not None:
                entry["recovery_score"] = m.recovery_score
            if m.hrv_ms is not None:
                entry["hrv_ms"] = m.hrv_ms
            if m.resting_hr is not None:
                entry["resting_hr"] = m.resting_hr
            if m.sleep_duration_minutes is not None:
                entry["sleep_minutes"] = m.sleep_duration_minutes
            if m.strain is not None:
                entry["strain"] = m.strain
            if len(entry) > 1:
                lifting_context["recent_recovery"].append(entry)
    except Exception as e:
        logger.warning("Failed to get recovery data for lifting context: %s", e)
        lifting_context["recent_recovery"] = []

    # ── Video Analysis (form, velocity, consistency, RPE from lift videos) ──────
    video_analysis: list = []
    try:
        from app.models.lifting import LiftVideo

        video_result = await db.execute(
            select(LiftVideo).where(
                LiftVideo.user_id == user_id,
                LiftVideo.lifting_session_id == session_id,
            )
        )
        videos = video_result.scalars().all()
        for v in videos:
            entry: dict = {
                "exercise_name": v.exercise_name,
                "exercise_auto": v.exercise_auto,
                "reps_count": v.reps_count,
                "weight_kg": v.weight_kg,
                "confidence": v.confidence,
                "analysis_status": v.analysis_status,
                "analysis_text": v.analysis_text,
                # Form analysis (IPF standards)
                "form_score": v.form_score,
                "competition_valid": v.competition_valid,
                "form_deviations": v.form_deviations,
                "form_coaching_cues": v.form_coaching_cues,
                # Velocity tracking (VBT)
                "mean_concentric_velocity": v.mean_concentric_velocity,
                "peak_velocity": v.peak_velocity,
                "velocity_loss_pct": v.velocity_loss_pct,
                "vbt_zone": v.vbt_zone,
                # Consistency
                "rep_consistency_score": v.rep_consistency_score,
                # Setup analysis
                "setup_score": v.setup_score,
                "setup_duration_seconds": v.setup_duration_seconds,
                # Estimated RPE
                "estimated_rpe": v.estimated_rpe,
                "rpe_confidence": v.rpe_confidence,
            }
            video_analysis.append(entry)
    except Exception as e:
        logger.warning("Failed to get video analysis for lifting context: %s", e)

    # ── Planned Training (training plan day this session fulfilled) ────────────
    planned_training: dict = {}
    try:
        from sqlalchemy.orm import selectinload

        from app.models.training_plan import TrainingPlan, TrainingPlanDay

        plan_result = await db.execute(
            select(TrainingPlanDay, TrainingPlan)
            .join(TrainingPlan, TrainingPlanDay.plan_id == TrainingPlan.id)
            .where(TrainingPlanDay.lifting_session_id == session_id)
            .limit(1)
        )
        plan_row = plan_result.first()
        if plan_row:
            day, plan = plan_row
            planned_training = {
                "plan_name": plan.name,
                "plan_type": plan.plan_type,
                "planned_type": day.planned_type,
                "planned_focus": day.planned_focus,
                "planned_exercises": day.planned_exercises,
                "planned_volume_kg": day.planned_volume_kg,
                "planned_rpe": day.planned_rpe,
                "actual_focus": session.focus,
                "focus_matched": (
                    day.planned_focus.lower() in session.focus.lower()
                    if day.planned_focus and session.focus
                    else True
                ),
                "workout_description": day.workout_description,
                "completed": day.completed,
            }
    except Exception as e:
        logger.warning("Failed to get training plan context for lifting session: %s", e)

    # ── Warmup Template (if associated with the plan day) ──────────────────────
    warmup_template: dict = {}
    try:
        if planned_training.get("plan_name"):
            from app.models.lifting import WarmupTemplate, WarmupTemplateStep
            from app.models.training_plan import TrainingPlanDay

            ws_result = await db.execute(
                select(TrainingPlanDay)
                .where(TrainingPlanDay.lifting_session_id == session_id)
                .options(selectinload(TrainingPlanDay.warmup_template))
            )
            day_row = ws_result.scalar_one_or_none()
            if day_row and day_row.warmup_template:
                tmpl = day_row.warmup_template
                warmup_template = {
                    "name": tmpl.name,
                    "exercise_name": tmpl.exercise_name,
                    "steps": [
                        {
                            "step_number": s.step_number,
                            "weight_kg": s.weight_kg,
                            "reps": s.reps,
                            "notes": s.notes,
                        }
                        for s in sorted(tmpl.steps or [], key=lambda x: x.step_number)
                    ],
                }
    except Exception as e:
        logger.warning("Failed to get warmup template for lifting session: %s", e)

    # ── Whoop Enrichment (cardiovascular context) ──────────────────────────────
    whoop_data: dict = {}
    try:
        if session.whoop_strain is not None or session.whoop_avg_hr is not None:
            whoop_data = {
                "whoop_strain": session.whoop_strain,
                "whoop_avg_hr": session.whoop_avg_hr,
                "whoop_max_hr": session.whoop_max_hr,
                "whoop_kilojoules": session.whoop_kilojoules,
                "whoop_workout_id": session.whoop_workout_id,
            }
    except Exception as e:
        logger.warning("Failed to get whoop data for lifting session: %s", e)

    # ── Linked Activity (Strava/Wahoo activity that enriched this session) ─────
    linked_activity: dict = {}
    try:
        from app.models.activity import Activity

        if session.activity_id:
            act_result = await db.execute(
                select(Activity).where(Activity.id == session.activity_id)
            )
            act = act_result.scalar_one_or_none()
            if act:
                linked_activity = {
                    "name": act.name,
                    "source": act.source,
                    "sport_type": act.sport_type,
                    "start_date": act.start_date.isoformat() if act.start_date else None,
                    "duration_seconds": act.duration_seconds,
                    "distance_meters": round(act.distance_meters, 1)
                    if act.distance_meters
                    else None,
                    "average_heartrate": act.average_heartrate,
                    "max_heartrate": act.max_heartrate,
                    "calories": act.calories,
                    "tss": act.tss,
                }
    except Exception as e:
        logger.warning("Failed to get linked activity for lifting session: %s", e)

    return _make_json_serializable(
        {
            "session_summary": session_summary,
            "static_analysis": static_analysis,
            "lifting_context": lifting_context,
            "video_analysis": video_analysis,
            "planned_training": planned_training,
            "warmup_template": warmup_template,
            "whoop_data": whoop_data,
            "linked_activity": linked_activity,
        }
    )


async def analyze_lifting_session_with_gemini(context: dict) -> str:
    """Call Google Gemini API to analyze a single lifting session with training context."""
    focus = context.get("session_summary", {}).get("focus", "N/A")
    prompt = f"""You are an expert strength coach and sports scientist. Analyze the following lifting session data in the context of the athlete's recent training.

## Session Summary
```json
{json.dumps(context["session_summary"], indent=2, default=str)}
```

## Static Analysis (Fatigue Index, PR Proximity, Rep Dropoff, RPE Analysis)
```json
{json.dumps(context["static_analysis"], indent=2, default=str)}
```

## Training Context (Recent Sessions, Personal Records, Volume Trends, Recovery)
```json
{json.dumps(context["lifting_context"], indent=2, default=str)}
```

## Video Analysis (Form, Velocity, Setup, RPE — from lift videos)
```json
{json.dumps(context.get("video_analysis", []), indent=2, default=str)}
```

## Planned Training (Program vs Actual Focus)
```json
{json.dumps(context.get("planned_training", {}), indent=2, default=str)}
```

## Warmup Template
```json
{json.dumps(context.get("warmup_template", {}), indent=2, default=str)}
```

## Whoop Enrichment (Cardio Context)
```json
{json.dumps(context.get("whoop_data", {}), indent=2, default=str)}
```

## Linked Activity (Strava/Wahoo Enrichment)
```json
{json.dumps(context.get("linked_activity", {}), indent=2, default=str)}
```

## Instructions
Provide a detailed analysis of THIS specific lifting session in the following structure:

### Volume & Intensity Assessment
- How does the total volume compare to recent sessions?
- Was the intensity (weight/load) appropriate for the training goals?
- Were working set counts sufficient for hypertrophy/strength stimulus?

### Focus Alignment (Planned vs Actual)
- The session focus is \"{focus}\" — was this what the training plan called for?
- Reference the planned focus from the training plan and assess alignment.
- If there's a mismatch, was it appropriate (e.g., accessory focus after heavy squats) or a deviation?

### Fatigue Analysis
- What does the rep dropoff across sets tell us about rest periods and fatigue management?
- How does the RPE trend across sets indicate fatigue accumulation?
- Is the fatigue index concerning or within normal range?

### Video Form & Velocity Insights
- Summarise the form analysis: overall form score, competition validity, key deviations.
- If velocity data is available: what was the mean/peak concentric velocity and velocity loss?
- Are the velocity readings in an appropriate VBT zone for the weight used?
- Was the setup score good? Any coaching cues to prioritise?
- Compare the AI-estimated RPE (from video) to the user-entered RPE if both are present.

### PR Proximity Insights
- How close were the top sets to personal records?
- Are there any exercises approaching a PR breakthrough?
- Should the athlete attempt PRs soon or focus on volume?
- Reference big_lift_pbs (all-time best estimated 1RMs with dates achieved) as strength context, even if those PBs are old — e.g. how current performance compares to the athlete's best squat/bench/deadlift

### Progressive Overload Assessment
- How does this session compare to recent sessions for the same exercises?
- Is the athlete progressing appropriately (weight, reps, or volume)?
- Any signs of plateau or regression?

### Recovery & Recommendations
- Based on the session RPE and recovery data, how recovered is the athlete?
- If Whoop data is available, do the strain/HR figures corroborate the session intensity?
- What should the focus be for the next session?
- Any exercises that need more attention or deloading?
- 2-3 specific actionable recommendations

Be specific and reference actual numbers from the data. Keep the total response under 800 words."""

    return await _call_gemini(prompt, "lifting session")


async def run_lifting_session_ai_analysis(
    db: AsyncSession,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
) -> LlmAnalysis | None:
    """Orchestrate the per-lifting-session AI analysis flow.

    1. Compile lifting session context
    2. Call Gemini for analysis
    3. Create and store LlmAnalysis record (with lifting_session_id)
    4. Return the record

    Returns None if the session doesn't exist.
    """
    context = await compile_lifting_session_context(db, user_id, session_id)
    if context is None:
        return None

    ensure_context_sufficient(context, "lifting session")
    analysis_text = await analyze_lifting_session_with_gemini(context)
    return await _store_analysis(
        db,
        user_id,
        "lifting_session",
        context,
        analysis_text,
        lifting_session_id=session_id,
    )


# ── Health AI Analysis ──────────────────────────────────────────────────────


async def compile_health_stats(db: AsyncSession, user_id: uuid.UUID) -> dict:
    """Compile health-specific data for AI analysis.

    Returns a dict with HRV trends, resting HR, sleep, respiratory rate,
    health alerts, recovery scores, weight trend, strain trends,
    training load context (CTL/ATL/TSB), and recent activity intensity.
    """
    from app.models.health_alert import HealthAlert
    from app.models.sleep import SleepLog
    from app.models.weight import WeightLog

    today = date.today()
    four_weeks_ago = today - timedelta(days=28)
    stats: dict = {}

    # 1–4. Daily metric trends (HRV, resting HR, recovery, respiratory rate) —
    #      single query over the window, split per metric in Python.
    try:
        result = await db.execute(
            select(DailyMetric)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.metric_date >= four_weeks_ago,
                DailyMetric.hrv_ms.isnot(None)
                | DailyMetric.resting_hr.isnot(None)
                | DailyMetric.recovery_score.isnot(None)
                | DailyMetric.respiratory_rate.isnot(None),
            )
            .order_by(DailyMetric.metric_date)
        )
        all_metrics = list(result.scalars().all())

        hrv_data = [
            {"date": str(m.metric_date), "hrv_ms": m.hrv_ms}
            for m in all_metrics
            if m.hrv_ms is not None
        ]
        hrv_values = [m.hrv_ms for m in hrv_data]
        stats["hrv_trends"] = {
            "entries": hrv_data,
            "avg_hrv_ms": round(sum(hrv_values) / len(hrv_values), 1)
            if hrv_values
            else None,
            "latest_hrv_ms": hrv_values[-1] if hrv_values else None,
            "min_hrv_ms": min(hrv_values) if hrv_values else None,
            "max_hrv_ms": max(hrv_values) if hrv_values else None,
        }

        rhr_data = [
            {"date": str(m.metric_date), "resting_hr": m.resting_hr}
            for m in all_metrics
            if m.resting_hr is not None
        ]
        rhr_values = [m.resting_hr for m in rhr_data]
        stats["resting_hr_trends"] = {
            "entries": rhr_data,
            "avg_resting_hr": round(sum(rhr_values) / len(rhr_values), 1)
            if rhr_values
            else None,
            "latest_resting_hr": rhr_values[-1] if rhr_values else None,
        }

        recovery_data = [
            {"date": str(m.metric_date), "recovery_score": m.recovery_score}
            for m in all_metrics
            if m.recovery_score is not None
        ]
        recovery_values = [m.recovery_score for m in recovery_data]
        stats["recovery_scores"] = {
            "entries": recovery_data,
            "avg_recovery": round(sum(recovery_values) / len(recovery_values), 1)
            if recovery_values
            else None,
            "latest_recovery": recovery_values[-1] if recovery_values else None,
        }

        rr_data = [
            {"date": str(m.metric_date), "respiratory_rate": m.respiratory_rate}
            for m in all_metrics
            if m.respiratory_rate is not None
        ]
        rr_values = [m.respiratory_rate for m in rr_data]
        stats["respiratory_rate_trends"] = {
            "entries": rr_data,
            "avg_respiratory_rate": round(sum(rr_values) / len(rr_values), 2)
            if rr_values
            else None,
            "latest_respiratory_rate": rr_values[-1] if rr_values else None,
        }
    except Exception as e:
        logger.warning("Failed to compute daily metric trends: %s", e)
        stats["hrv_trends"] = {}
        stats["resting_hr_trends"] = {}
        stats["recovery_scores"] = {}
        stats["respiratory_rate_trends"] = {}

    # 5. Sleep trends (last 4 weeks)
    try:
        result = await db.execute(
            select(SleepLog)
            .where(
                SleepLog.user_id == user_id,
                SleepLog.sleep_date >= four_weeks_ago,
            )
            .order_by(SleepLog.sleep_date)
        )
        sleep_logs = result.scalars().all()
        sleep_data = []
        durations = []
        efficiencies = []
        for sl in sleep_logs:
            entry: dict = {"date": str(sl.sleep_date)}
            effective = sl.effective_total_sleep_seconds
            if effective is not None:
                hours = round(effective / 3600, 1)
                entry["sleep_hours"] = hours
                durations.append(hours)
            if sl.sleep_efficiency is not None:
                entry["efficiency"] = sl.sleep_efficiency
                efficiencies.append(sl.sleep_efficiency)
            if sl.deep_sleep_seconds is not None:
                entry["deep_sleep_hours"] = round(sl.deep_sleep_seconds / 3600, 1)
            if sl.rem_sleep_seconds is not None:
                entry["rem_sleep_hours"] = round(sl.rem_sleep_seconds / 3600, 1)
            sleep_data.append(entry)
        stats["sleep_trends"] = {
            "entries": sleep_data[-28:],
            "avg_sleep_hours": round(sum(durations) / len(durations), 1)
            if durations
            else None,
            "avg_efficiency": round(sum(efficiencies) / len(efficiencies), 1)
            if efficiencies
            else None,
            "nights_tracked": len(sleep_data),
        }
    except Exception as e:
        logger.warning("Failed to get sleep trends: %s", e)
        stats["sleep_trends"] = {}

    # 6. Weight trend (last 4 weeks)
    try:
        result = await db.execute(
            select(WeightLog)
            .where(
                WeightLog.user_id == user_id,
                WeightLog.date >= four_weeks_ago,
            )
            .order_by(WeightLog.date)
        )
        weight_logs = result.scalars().all()
        weight_data = [
            {"date": str(wl.date), "weight_kg": round(wl.weight_kilogram, 1)}
            for wl in weight_logs
        ]
        stats["weight_trend"] = {
            "entries": weight_data,
            "latest_kg": weight_data[-1]["weight_kg"] if weight_data else None,
            "change_kg": round(
                weight_data[-1]["weight_kg"] - weight_data[0]["weight_kg"], 1
            )
            if len(weight_data) >= 2
            else None,
        }
    except Exception as e:
        logger.warning("Failed to get weight trend: %s", e)
        stats["weight_trend"] = {}

    # 7. Active health alerts
    try:
        result = await db.execute(
            select(HealthAlert)
            .where(
                HealthAlert.user_id == user_id,
                HealthAlert.status == "active",
            )
            .order_by(HealthAlert.detected_date.desc())
            .limit(10)
        )
        alerts = result.scalars().all()
        stats["health_alerts"] = [
            {
                "type": a.alert_type,
                "severity": a.severity,
                "title": a.title,
                "description": a.description,
                "detected_date": str(a.detected_date),
            }
            for a in alerts
        ]
    except Exception as e:
        logger.warning("Failed to get health alerts: %s", e)
        stats["health_alerts"] = []

    # 8. Strain trends (last 4 weeks)
    try:
        result = await db.execute(
            select(DailyMetric)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.metric_date >= four_weeks_ago,
                DailyMetric.strain.isnot(None),
            )
            .order_by(DailyMetric.metric_date)
        )
        metrics = result.scalars().all()
        strain_data = [
            {"date": str(m.metric_date), "strain": m.strain} for m in metrics
        ]
        strain_values = [m.strain for m in metrics]
        stats["strain_trends"] = {
            "entries": strain_data,
            "avg_strain": round(sum(strain_values) / len(strain_values), 1)
            if strain_values
            else None,
            "max_strain": max(strain_values) if strain_values else None,
        }
    except Exception as e:
        logger.warning("Failed to get strain trends: %s", e)
        stats["strain_trends"] = {}

    # ── Training Load Context (correlate health metrics with training stress) ────
    try:
        from app.services.cycling import (
            CTL_WARMUP_DAYS,
            compute_training_load,
            get_daily_tss,
        )

        today = date.today()
        tss_fetch_start = today - timedelta(days=90 + CTL_WARMUP_DAYS)
        daily_tss = await get_daily_tss(db, user_id, tss_fetch_start, today)
        training_load = compute_training_load(daily_tss, today, lookback_days=90)
        if training_load:
            latest = training_load[-1]
            stats["current_ctl"] = latest["ctl"]
            stats["current_atl"] = latest["atl"]
            stats["current_tsb"] = latest["tsb"]
            # Last 14 days for trend context
            stats["training_load_trend"] = [
                {
                    "date": entry["date"].isoformat()
                    if isinstance(entry["date"], date)
                    else str(entry["date"]),
                    "ctl": entry["ctl"],
                    "atl": entry["atl"],
                    "tsb": entry["tsb"],
                }
                for entry in training_load[-14:]
            ]
        else:
            stats["current_ctl"] = None
            stats["current_atl"] = None
            stats["current_tsb"] = None
            stats["training_load_trend"] = []
    except Exception as e:
        logger.warning("Failed to compute training load for health context: %s", e)
        stats["current_ctl"] = None
        stats["current_atl"] = None
        stats["current_tsb"] = None
        stats["training_load_trend"] = []

    # ── Recent Activity Intensity (last 7 days of TSS by sport) ─────────────────
    try:
        from app.models.activity import Activity

        seven_days_ago = today - timedelta(days=7)
        act_result = await db.execute(
            select(
                Activity.sport_type,
                Activity.start_date,
                Activity.tss,
                Activity.duration_seconds,
                Activity.average_power,
            )
            .where(
                Activity.user_id == user_id,
                Activity.start_date >= seven_days_ago,
            )
            .order_by(Activity.start_date.desc())
            .limit(20)
        )
        stats["recent_activities"] = [
            {
                "sport_type": r.sport_type,
                "start_date": r.start_date.isoformat() if r.start_date else None,
                "tss": r.tss,
                "duration_seconds": r.duration_seconds,
                "average_power": r.average_power,
            }
            for r in act_result.all()
        ]
    except Exception as e:
        logger.warning("Failed to get recent activities for health context: %s", e)
        stats["recent_activities"] = []

    return _make_json_serializable(stats)


async def analyze_health_with_gemini(stats_json: dict) -> str:
    """Call Google Gemini API to analyze health data and return analysis text."""
    prompt = f"""You are an expert sports medicine physician and health data analyst. Analyze the following health and wellness data and provide a detailed interpretation.

## Health Data
```json
{json.dumps(stats_json, indent=2, default=str)}
```

## Instructions
Provide a narrative health interpretation (not just threshold alerts) in the following structure:

### HRV & Autonomic Nervous System
- Current HRV status and trend
- What the HRV pattern indicates about recovery capacity
- Comparison to typical athlete ranges

### Resting Heart Rate Analysis
- Resting HR trend and significance
- Potential causes of any changes
- Relationship to fitness and fatigue

### Sleep Quality Assessment
- Sleep duration and consistency
- Deep/REM sleep balance (if data available)
- Impact of sleep on recovery and performance

### Respiratory Rate & Recovery
- Respiratory rate trends
- Any elevation that might indicate stress or illness
- Overall recovery score interpretation

### Training Load Correlation
- How do HRV and recovery scores correlate with recent training load (CTL/ATL/TSB)?
- Is the current TSB (form) level too high or too low for the recovery metrics seen?
- Are there signs that the current training load is too much (e.g., declining HRV, elevated RHR, rising respiratory rate)?
- Reference the recent activities (TSS by sport) and correlate with health trends.

### Weight & Body Composition
- Weight trend analysis (if data available)
- Rate of change assessment
- Recommendations for nutrition timing

### Health Alerts Interpretation
- Analysis of any active health alerts
- Severity assessment and action items
- Underlying patterns causing alerts

### Overall Health Score & Recommendations
- Holistic health assessment (1-10 scale with justification)
- Top 3 health priorities to address
- Lifestyle modifications for improved recovery

Be specific, reference actual numbers from the data. Keep the total response under 800 words.
Formatting: use `- ` (dash) for bullet lists, never `*`. If a section has no
entries in the JSON, say so in one line and move on — never claim data is
missing when the JSON contains entries for it."""

    return await _call_gemini(prompt, "health")


async def run_health_ai_analysis(db: AsyncSession, user_id: uuid.UUID) -> LlmAnalysis:
    """Orchestrate health AI analysis flow.

    1. Compile health stats
    2. Call Gemini for analysis
    3. Create and store LlmAnalysis record with analysis_type='health'
    4. Return the record
    """
    from datetime import date as date_type

    stats = await compile_health_stats(db, user_id)
    ensure_context_sufficient(stats, "health")
    analysis_text = await analyze_health_with_gemini(stats)
    return await _store_analysis(db, user_id, "health", stats, analysis_text)


# ── Event AI Analysis ───────────────────────────────────────────────────────


async def compile_event_stats(
    db: AsyncSession,
    user_id: uuid.UUID,
    event_id: uuid.UUID,
) -> dict | None:
    """Compile event-specific data for AI analysis.

       Returns None if the event doesn't exist or doesn't belong to the user.
       Returns a dict with event details, current fitness (CTL/ATL/TSB), FTP,
       recent training, recovery, route details, weather forecast, historical
       performance, and linked training plan.
       """
    from app.models.event import Event

    # 1. Fetch the event
    result = await db.execute(
        select(Event).where(
            Event.id == event_id,
            Event.user_id == user_id,
        )
    )
    event = result.scalar_one_or_none()
    if not event:
        return None

    today = date.today()
    days_until = (event.event_date - today).days

    stats: dict = {
        "event": {
            "name": event.name,
            "event_type": event.event_type,
            "event_date": str(event.event_date),
            "days_until": max(0, days_until),
            "taper_days": event.taper_days,
            "target_tss": event.target_tss,
            "notes": event.notes,
        },
    }

    # 2. Current fitness (CTL/ATL/TSB)
    try:
        from app.services.cycling import (
            CTL_WARMUP_DAYS,
            compute_training_load,
            get_daily_tss,
        )

        tss_fetch_start = today - timedelta(days=90 + CTL_WARMUP_DAYS)
        daily_tss = await get_daily_tss(db, user_id, tss_fetch_start, today)
        training_load = compute_training_load(daily_tss, today, lookback_days=90)
        if training_load:
            latest = training_load[-1]
            stats["current_ctl"] = latest["ctl"]
            stats["current_atl"] = latest["atl"]
            stats["current_tsb"] = latest["tsb"]
            # Recent 14 days trend
            stats["recent_tsb_trend"] = [
                {
                    "date": entry["date"].isoformat()
                    if isinstance(entry["date"], date)
                    else str(entry["date"]),
                    "tsb": entry["tsb"],
                    "ctl": entry["ctl"],
                    "atl": entry["atl"],
                }
                for entry in training_load[-14:]
            ]
        else:
            stats["current_ctl"] = None
            stats["current_atl"] = None
            stats["current_tsb"] = None
    except Exception as e:
        logger.warning("Failed to compute training load for event context: %s", e)
        stats["current_ctl"] = None
        stats["current_atl"] = None
        stats["current_tsb"] = None

    # 3. FTP and cycling profile
    try:
        from app.services.cycling import get_or_create_cycling_profile

        profile = await get_or_create_cycling_profile(db, user_id)
        stats["ftp_watts"] = profile.ftp_watts if profile else None
        stats["weight_kg"] = profile.weight_kg if profile else None
        stats["lthr"] = profile.lactate_threshold_hr if profile else None
    except Exception as e:
        logger.warning("Failed to get cycling profile for event context: %s", e)

    # 4. Recent training (last 2 weeks)
    try:
        two_weeks_ago = today - timedelta(days=14)
        result = await db.execute(
            select(Activity)
            .where(
                Activity.user_id == user_id,
                Activity.sport_type == "cycling",
                Activity.start_date >= two_weeks_ago,
            )
            .order_by(Activity.start_date.desc())
        )
        recent_rides = result.scalars().all()
        stats["recent_rides"] = [
            {
                "name": r.name,
                "date": r.start_date.isoformat() if r.start_date else None,
                "duration_seconds": r.duration_seconds,
                "distance_meters": round(r.distance_meters, 1)
                if r.distance_meters
                else None,
                "tss": r.tss,
                "average_power": r.average_power,
            }
            for r in recent_rides
        ]
    except Exception as e:
        logger.warning("Failed to get recent rides for event context: %s", e)
        stats["recent_rides"] = []

    # 5. Recent recovery data (last 3 days)
    try:
        three_days_ago = today - timedelta(days=3)
        result = await db.execute(
            select(DailyMetric)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.metric_date >= three_days_ago,
            )
            .order_by(DailyMetric.metric_date.desc())
        )
        metrics = result.scalars().all()
        stats["recent_recovery"] = []
        for m in metrics:
            entry: dict = {"date": str(m.metric_date)}
            if m.recovery_score is not None:
                entry["recovery_score"] = m.recovery_score
            if m.hrv_ms is not None:
                entry["hrv_ms"] = m.hrv_ms
            if m.resting_hr is not None:
                entry["resting_hr"] = m.resting_hr
            if m.strain is not None:
                entry["strain"] = m.strain
            if len(entry) > 1:
                stats["recent_recovery"].append(entry)
    except Exception as e:
        logger.warning("Failed to get recovery data for event context: %s", e)
        stats["recent_recovery"] = []

    # ── Training Plan & Route Details (if event has a linked training plan) ─────
    training_plan_info: dict = {}
    route_details: dict = {}
    try:
        from app.models.route import Route
        from app.models.route_organize import RouteTag, RouteTagging
        from app.models.segment import Segment
        from app.models.training_plan import TrainingPlan, TrainingPlanDay

        plan_result = await db.execute(
            select(TrainingPlan)
            .where(
                TrainingPlan.user_id == user_id,
                TrainingPlan.event_id == event_id,
            )
        )
        plan = plan_result.scalar_one_or_none()
        if plan:
            training_plan_info = {
                "name": plan.name,
                "plan_type": plan.plan_type,
                "start_date": str(plan.start_date),
                "end_date": str(plan.end_date),
            }
            # Find the route associated with this plan
            route_day_result = await db.execute(
                select(TrainingPlanDay)
                .where(
                    TrainingPlanDay.plan_id == plan.id,
                    TrainingPlanDay.planned_route_id.isnot(None),
                )
                .order_by(TrainingPlanDay.day_date.desc())
                .limit(1)
            )
            day_row = route_day_result.scalar_one_or_none()
            if day_row and day_row.planned_route_id:
                route = await db.get(Route, day_row.planned_route_id)
                if route:
                    route_details = {
                        "name": route.name,
                        "distance_meters": round(route.distance_meters, 1),
                        "elevation_gain_meters": round(route.elevation_gain_meters, 1)
                        if route.elevation_gain_meters
                        else None,
                        "is_loop": route.is_loop,
                        "country": route.country,
                        "locality": route.locality,
                        "quality_score": route.quality_score,
                    }
                    # Climb segments on the route (the "laps of a hill")
                    seg_result = await db.execute(
                        select(Segment).where(Segment.route_id == route.id)
                    )
                    segments = seg_result.scalars().all()
                    if segments:
                        route_details["climb_segments"] = [
                            {
                                "name": seg.name,
                                "distance_m": round(seg.distance_m, 0),
                                "elevation_gain_m": round(seg.elevation_gain_m, 0),
                                "avg_gradient_pct": round(seg.avg_gradient_pct, 1),
                                "max_gradient_pct": round(seg.max_gradient_pct, 1)
                                if seg.max_gradient_pct
                                else None,
                                "climb_category": seg.climb_category,
                                "times_ridden": seg.times_ridden,
                                "has_pr": seg.has_pr,
                            }
                            for seg in segments
                        ]
                    # Route tags
                    tag_result = await db.execute(
                        select(RouteTag)
                        .join(RouteTagging, RouteTagging.tag_id == RouteTag.id)
                        .where(RouteTagging.route_id == route.id)
                    )
                    route_details["tags"] = [t.name for t in tag_result.scalars().all()]
    except Exception as e:
        logger.warning("Failed to get training plan/route context for event: %s", e)

    stats["training_plan"] = training_plan_info
    stats["route_details"] = route_details

    # ── Weather Forecast (for event date) ──────────────────────────────────────
    weather_forecast: dict = {}
    profile: object | None = None
    try:
        from app.models.cycling import CyclingProfile
        from app.models.weather import CachedWeather

        profile_result = await db.execute(
            select(CyclingProfile).where(CyclingProfile.user_id == user_id)
        )
        profile = profile_result.scalar_one_or_none()
        if profile and profile.home_lat is not None and profile.home_lng is not None:
            from app.services.weather import cache_coords

            forecast_day = event.event_date if days_until > 0 else today
            # Cache rows are keyed on 2-dp rounded coords (see cache_coords).
            rlat, rlng = cache_coords(profile.home_lat, profile.home_lng)
            # Look for cached forecast weather near the event date
            forecast_result = await db.execute(
                select(CachedWeather).where(
                    CachedWeather.user_id == user_id,
                    CachedWeather.weather_type == "forecast",
                    CachedWeather.latitude == rlat,
                    CachedWeather.longitude == rlng,
                )
                .order_by(CachedWeather.cached_at.desc())
                .limit(1)
            )
            cached = forecast_result.scalar_one_or_none()
            if cached and isinstance(cached.weather_data, dict):
                # Cache stores the normalized {"days": [...]} shape (see
                # _normalize_daily), not the raw Open-Meteo "daily" arrays.
                target_str = forecast_day.isoformat()
                for day in cached.weather_data.get("days", []) or []:
                    if isinstance(day, dict) and day.get("date") == target_str:
                        weather_forecast = {
                            "date": target_str,
                            "weather_code": day.get("weather_code"),
                            "conditions": day.get("conditions"),
                            "temperature_max": day.get("temp_max"),
                            "temperature_min": day.get("temp_min"),
                            "wind_speed": day.get("wind_speed_max"),
                            "precipitation": day.get("precipitation_sum"),
                        }
                        break
    except Exception as e:
        logger.warning("Failed to get weather forecast for event context: %s", e)

    stats["weather_forecast"] = weather_forecast

    # ── Historical Performance (past events + relevant PRs) ────────────────────
    historical_performance: dict = {}
    try:
        # Past events of the same type
        past_result = await db.execute(
            select(Event)
            .where(
                Event.user_id == user_id,
                Event.event_type == event.event_type,
                Event.event_date < event.event_date,
            )
            .order_by(Event.event_date.desc())
            .limit(5)
        )
        past_events = past_result.scalars().all()
        historical_performance["past_events"] = [
            {
                "name": e.name,
                "event_date": str(e.event_date),
                "result": e.result if isinstance(e.result, dict) else None,
            }
            for e in past_events
        ]

        # Relevant PRs for this event type
        if event.event_type in ("race", "ride"):
            # Cycling PRs: FTP-related power PRs
            if profile and hasattr(profile, "ftp_watts"):
                historical_performance["ftp"] = profile.ftp_watts
                historical_performance["weight_kg"] = profile.weight_kg
        # Lifting event: relevant big-3 PRs
        if event.event_type == "lift":
            from app.services.llm_base import _big_lift_pbs

            historical_performance["big_lift_pbs"] = await _big_lift_pbs(db, user_id)
    except Exception as e:
        logger.warning("Failed to get historical performance for event: %s", e)

    stats["historical_performance"] = historical_performance

    return _make_json_serializable(stats)


async def analyze_event_with_gemini(stats_json: dict) -> str:
    """Call Google Gemini API to analyze event preparation data."""
    prompt = f"""You are an expert cycling coach and race strategist. Analyze the following event and training data to provide a comprehensive race preparation plan.

## Event & Training Data
```json
{json.dumps(stats_json, indent=2, default=str)}
```

## Instructions
Provide a detailed race/event preparation analysis in the following structure:

### Event Assessment
- Event type and demands
- Days until event and current training phase
- Readiness evaluation based on current fitness

### Course Profile & Climb Analysis
- If route details are available, describe the course profile (distance, elevation, climbs)
- For each climb segment, reference the name, gradient, and elevation gain
- How should the rider approach each climb? (attack, tempo, conserve)
- Are there any steep or technical sections to prepare for?

### Weather Outlook
- If weather forecast data is available, reference the predicted temperature, wind, and precipitation for race day
- How should the rider adjust pacing, hydration, or clothing for these conditions?

### Historical Context
- If past events or PRs are available, compare current fitness to historical performance
- Set realistic performance expectations based on past results

### Taper Plan
- Recommended taper duration and intensity reduction
- Day-by-day guidance for the final week
- Key workouts to include or avoid

### Race-Day Strategy
- Power/pacing strategy based on current FTP
- Nutrition and hydration plan
- Warmup protocol recommendations

### Current Fitness vs Event Demands
- CTL/ATL/TSB interpretation for race readiness
- How recent training supports or undermines performance
- Any last-minute fitness adjustments

### Recovery & Readiness
- Current recovery status (HRV, resting HR, recovery scores)
- Sleep recommendations for the lead-up
- Stress management considerations

### Nutrition Tips
- Carb loading recommendations (if <3 days out)
- Race-day fueling strategy
- Post-event recovery nutrition

### Key Recommendations
- 3-5 critical action items for optimal performance
- Things to avoid in the final days
- Contingency planning for race-day challenges

Be specific, reference actual numbers from the data. Tailor advice to the days-until-event timeframe. Keep the total response under 900 words."""

    return await _call_gemini(prompt, "event")


async def run_event_ai_analysis(
    db: AsyncSession,
    user_id: uuid.UUID,
    event_id: uuid.UUID,
) -> LlmAnalysis | None:
    """Orchestrate event AI analysis flow.

    1. Compile event stats
    2. Call Gemini for analysis
    3. Create and store LlmAnalysis record with analysis_type='event' and event_id
    4. Return the record

    Returns None if the event doesn't exist.
    """
    stats = await compile_event_stats(db, user_id, event_id)
    if stats is None:
        return None

    ensure_context_sufficient(stats, "event")
    analysis_text = await analyze_event_with_gemini(stats)
    return await _store_analysis(
        db, user_id, "event", stats, analysis_text, event_id=event_id
    )


# ── Insight Explanations + Season Overview (Feature 7 / B-18) ────────────────


async def explain_insight_with_gemini(insight: dict) -> str:
    """Interpret one AthleteInsight row in plain language.

    The LLM reads the deterministic coefficients + sample sizes and explains
    what they plausibly mean — including confounders and deload-pattern
    matches. It interprets only; it never scores or prescribes.
    """
    prompt = f"""You are an expert endurance + strength coach interpreting a deterministic training-data insight. Explain the numbers below in plain language for the athlete.

## Observed insight (associations from their own history, not causation)
```json
{json.dumps(insight, indent=2, default=str)}
```

## Instructions
- Explain what the pattern most plausibly means in 3–6 sentences.
- Call out likely confounders explicitly (e.g. "hard sessions cluster on weekends when you also sleep less").
- Say whether this matches a known pattern (deload response, heat adaptation, freshness effect) or looks like noise.
- Do NOT restate every number; do NOT prescribe training changes; do NOT diagnose health.
- If sample sizes are small, say the pattern is preliminary.
"""
    return await _call_gemini(prompt, "insight explanation")


async def run_insight_explanation(
    db: AsyncSession, user_id: uuid.UUID, insight_type: str
) -> LlmAnalysis:
    """Generate (or refresh) the AI explanation for one insight type.

    Reads the latest AthleteInsight row; refuses when its data carries no
    analyzable signal (same guard as every other analysis path).
    """
    from app.models.athlete_insight import AthleteInsight

    result = await db.execute(
        select(AthleteInsight)
        .where(
            AthleteInsight.user_id == user_id,
            AthleteInsight.insight_type == insight_type,
        )
        .order_by(AthleteInsight.computed_at.desc())
        .limit(1)
    )
    insight = result.scalar_one_or_none()
    if insight is None:
        raise LookupError(f"No computed insight of type {insight_type!r} yet")
    payload = {
        "insight_type": insight.insight_type,
        "period": insight.period,
        "sample_size": insight.sample_size,
        "confidence": insight.confidence,
        "data": insight.data,
    }
    ensure_context_sufficient(payload, "insight explanation")
    analysis_text = await explain_insight_with_gemini(payload)
    return await _store_analysis(db, user_id, "insight_explanation", payload, analysis_text)


async def analyze_season_with_gemini(context: dict) -> str:
    """Big-picture cross-domain season brief over compiled contexts."""
    prompt = f"""You are an expert coach writing a season overview from training data across cycling, strength, recovery, sleep, and planning. Summarise the big picture — what is working, what is limiting progress, and what patterns deserve attention.

## Season context (all domains)
```json
{json.dumps(context, indent=2, default=str)}
```

## Instructions
- Lead with the 2–3 most important observations, grounded in the numbers.
- Cover each domain briefly (endurance, strength, recovery/sleep, planning adherence).
- Flag contradictions in the data (e.g. rising load with falling recovery).
- Do NOT prescribe specific workouts; do NOT diagnose health. Keep it under 400 words.
"""
    return await _call_gemini(prompt, "season overview")


async def run_season_overview_analysis(
    db: AsyncSession, user_id: uuid.UUID
) -> LlmAnalysis:
    """Compile every domain context + the insight table into one season brief."""
    from app.models.athlete_insight import AthleteInsight

    cycling = await compile_cycling_stats(db, user_id)
    health = await compile_health_stats(db, user_id)
    result = await db.execute(
        select(AthleteInsight)
        .where(AthleteInsight.user_id == user_id)
        .order_by(AthleteInsight.insight_type, AthleteInsight.computed_at.desc())
    )
    seen: set[str] = set()
    insights = []
    for row in result.scalars().all():
        if row.insight_type not in seen:
            seen.add(row.insight_type)
            insights.append(
                {
                    "insight_type": row.insight_type,
                    "sample_size": row.sample_size,
                    "confidence": row.confidence,
                    "data": row.data,
                }
            )
    context = {"cycling": cycling, "health": health, "insights": insights}
    ensure_context_sufficient(context, "season overview")
    analysis_text = await analyze_season_with_gemini(context)
    return await _store_analysis(
        db, user_id, "season_overview", context, analysis_text
    )
