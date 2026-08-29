"""LLM Analysis service — compile cycling stats and analyze with Google Gemini."""

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

logger = logging.getLogger(__name__)

# Canonical Gemini model name — used for all API calls and stored in model_used field.
GEMINI_MODEL = "gemini-3.6-flash"

# Timeout (seconds) for Gemini API calls.
GEMINI_TIMEOUT_S = 60


def _make_json_serializable(obj):
    """Recursively convert date/datetime objects to ISO strings."""
    if isinstance(obj, dict):
        return {k: _make_json_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_make_json_serializable(item) for item in obj]
    elif isinstance(obj, (date, datetime)):
        return obj.isoformat()
    return obj


async def _big_lift_pbs(db: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    """All-time best estimated-1RM PR per big lift, with the date achieved.

    Gives the LLM historical strength context even when the PBs are months old
    (recent_prs only covers the last 4 weeks).
    """
    from app.services.exercise_db import BIG_3_ORDER

    result = await db.execute(
        select(PersonalRecord).where(
            PersonalRecord.user_id == user_id,
            PersonalRecord.exercise_name.in_(BIG_3_ORDER),
            PersonalRecord.record_type == "1rm",
            PersonalRecord.estimated_1rm.isnot(None),
        )
    )
    best: dict[str, PersonalRecord] = {}
    for pr in result.scalars().all():
        current = best.get(pr.exercise_name)
        if current is None or (pr.estimated_1rm or 0) > (current.estimated_1rm or 0):
            best[pr.exercise_name] = pr

    pbs = []
    for lift in BIG_3_ORDER:
        pr = best.get(lift)
        if pr is not None:
            pbs.append(
                {
                    "exercise": pr.exercise_name,
                    "weight_kg": pr.weight_kg,
                    "reps": pr.reps,
                    "estimated_1rm": round(pr.estimated_1rm, 1)
                    if pr.estimated_1rm is not None
                    else None,
                    "date_achieved": str(pr.achieved_date),
                }
            )
    return pbs


async def _store_analysis(
    db: AsyncSession,
    user_id: uuid.UUID,
    analysis_type: str,
    stats: dict,
    analysis_text: str,
    **extra_fields,
) -> LlmAnalysis:
    """Create and store an LlmAnalysis record, then return it."""
    from datetime import date as date_type

    record = LlmAnalysis(
        user_id=user_id,
        analysis_type=analysis_type,
        analysis_date=date_type.today(),
        stats_json=_make_json_serializable(stats),
        analysis_text=analysis_text,
        model_used=GEMINI_MODEL,
        **extra_fields,
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)
    return record


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

    # 5. Weekly summaries (last 4 weeks)
    try:
        weekly_summaries = []
        for week_offset in range(4):
            week_start = (
                today - timedelta(days=today.weekday()) - timedelta(weeks=week_offset)
            )
            week_end = week_start + timedelta(days=6)
            # Clamp to today
            week_end = min(week_end, today)

            result = await db.execute(
                select(
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
                ).where(
                    Activity.user_id == user_id,
                    Activity.sport_type == "cycling",
                    Activity.start_date >= week_start,
                    Activity.start_date <= week_end,
                )
            )
            row = result.one()
            weekly_summaries.append(
                {
                    "week_start": str(week_start),
                    "week_end": str(week_end),
                    "ride_count": row.ride_count,
                    "total_tss": round(float(row.total_tss), 1),
                    "total_distance_km": round(float(row.total_distance_m) / 1000, 1),
                    "total_duration_hours": round(int(row.total_duration_s) / 3600, 1),
                    "total_elevation_m": round(float(row.total_elevation_m), 1),
                }
            )
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

    return _make_json_serializable(stats)


async def analyze_with_gemini(stats_json: dict) -> str:
    """Call Google Gemini API to analyze cycling stats and return the analysis text."""
    from google import genai
    from google.genai import types

    from app.config import get_settings

    settings = get_settings()

    if not settings.gemini_api_key:
        raise ValueError("GEMINI_API_KEY not configured")

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
- Any health alerts and their significance

### Event Preparation
- If upcoming events exist, provide taper and preparation advice
- Current fitness relative to event demands
- Recommended training adjustments in the lead-up

### Specific Recommendations
- 3-5 actionable recommendations for the next training block
- Focus areas based on all available data (cycling, lifting, health)
- Any warning signs to watch for

Be specific, reference actual numbers from the data, and provide science-backed explanations. Keep the total response under 1000 words."""

    client = genai.Client(api_key=settings.gemini_api_key)

    try:
        response = await client.aio.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.7,
                max_output_tokens=4096,
                http_options=types.HttpOptions(timeout=GEMINI_TIMEOUT_S * 1000),
            ),
        )
    except Exception as e:
        error_msg = str(e).lower()
        if "rate limit" in error_msg or "429" in error_msg:
            logger.error("Gemini API rate limit hit: %s", e)
            raise ValueError(
                "AI analysis rate limit exceeded. Please try again in a few minutes."
            ) from e
        if "timeout" in error_msg or "deadline" in error_msg:
            logger.error("Gemini API timeout: %s", e)
            raise ValueError(
                "AI analysis timed out. The service may be overloaded — please try again."
            ) from e
        logger.error("Gemini API call failed: %s", e)
        raise ValueError(f"AI analysis failed: {e!s}") from e

    if not response.text:
        raise ValueError("Gemini returned an empty response. Please try again.")

    # Log if response was truncated due to token limit
    try:
        if response.candidates and response.candidates[0].finish_reason:
            finish = str(response.candidates[0].finish_reason)
            if "MAX" in finish.upper():
                logger.warning(
                    "Gemini cycling analysis truncated (finish_reason=%s)", finish
                )
    except Exception as e:
        logger.debug("Gemini response parsing failed (non-critical): %s", e)

    return response.text


async def run_llm_analysis(db: AsyncSession, user_id: uuid.UUID) -> LlmAnalysis:
    """Orchestrate the full LLM analysis flow.

    1. Compile cycling stats
    2. Call Gemini for analysis
    3. Create and store LlmAnalysis record
    4. Return the record
    """
    stats = await compile_cycling_stats(db, user_id)
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
      - activity summary (name, date, duration, distance, power, HR, etc.)
      - static analysis (power zones, pacing, decoupling, climbing, etc.)
      - recent training context (CTL/ATL/TSB, last 7 days summary, recovery)
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
    }

    # 3. Static analysis (power zones, pacing, decoupling, etc.)
    static_analysis = await analyze_ride(db, user_id, activity_id)

    # 4. Recent training context (CTL/ATL/TSB, last 7 days)
    training_context: dict = {}

    # CTL/ATL/TSB
    try:
        from app.services.cycling import compute_training_load, get_daily_tss

        today = date.today()
        ninety_days_ago = today - timedelta(days=90)
        daily_tss = await get_daily_tss(db, user_id, ninety_days_ago, today)
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

    return _make_json_serializable(
        {
            "activity_summary": activity_summary,
            "static_analysis": static_analysis,
            "training_context": training_context,
        }
    )


async def analyze_activity_with_gemini(context: dict) -> str:
    """Call Google Gemini API to analyze a single ride with training context."""
    from google import genai
    from google.genai import types

    from app.config import get_settings

    settings = get_settings()

    if not settings.gemini_api_key:
        raise ValueError("GEMINI_API_KEY not configured")

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

### Training Load Context
- How does this ride fit into the rider's recent training?
- Is the current TSB (form) suggesting they should be fresh or fatigued?
- Does this ride contribute positively to their training progression?

### Specific Recommendations
- 2-3 actionable takeaways from this ride
- What should the rider focus on in their next training session?
- Any concerns about recovery or training balance?

Be specific and reference actual numbers from the data. Keep the total response under 600 words."""

    client = genai.Client(api_key=settings.gemini_api_key)

    try:
        response = await client.aio.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.7,
                max_output_tokens=4096,
                http_options=types.HttpOptions(timeout=GEMINI_TIMEOUT_S * 1000),
            ),
        )
    except Exception as e:
        error_msg = str(e).lower()
        if "rate limit" in error_msg or "429" in error_msg:
            logger.error("Gemini API rate limit hit: %s", e)
            raise ValueError(
                "AI analysis rate limit exceeded. Please try again in a few minutes."
            ) from e
        if "timeout" in error_msg or "deadline" in error_msg:
            logger.error("Gemini API timeout: %s", e)
            raise ValueError(
                "AI analysis timed out. The service may be overloaded — please try again."
            ) from e
        logger.error("Gemini API call failed: %s", e)
        raise ValueError(f"AI analysis failed: {e!s}") from e

    if not response.text:
        raise ValueError("Gemini returned an empty response. Please try again.")

    try:
        if response.candidates and response.candidates[0].finish_reason:
            finish = str(response.candidates[0].finish_reason)
            if "MAX" in finish.upper():
                logger.warning(
                    "Gemini activity analysis truncated (finish_reason=%s)", finish
                )
    except Exception as e:
        logger.debug("Gemini response parsing failed (non-critical): %s", e)

    return response.text


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
    from datetime import date as date_type

    context = await compile_activity_context(db, user_id, activity_id)
    if context is None:
        return None

    analysis_text = await analyze_activity_with_gemini(context)
    return await _store_analysis(db, user_id, "activity", context, analysis_text, activity_id=activity_id)


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

    return _make_json_serializable(
        {
            "session_summary": session_summary,
            "static_analysis": static_analysis,
            "lifting_context": lifting_context,
        }
    )


async def analyze_lifting_session_with_gemini(context: dict) -> str:
    """Call Google Gemini API to analyze a single lifting session with training context."""
    from google import genai
    from google.genai import types

    from app.config import get_settings

    settings = get_settings()

    if not settings.gemini_api_key:
        raise ValueError("GEMINI_API_KEY not configured")

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

## Instructions
Provide a detailed analysis of THIS specific lifting session in the following structure:

### Volume & Intensity Assessment
- How does the total volume compare to recent sessions?
- Was the intensity (weight/load) appropriate for the training goals?
- Were working set counts sufficient for hypertrophy/strength stimulus?

### Fatigue Analysis
- What does the rep dropoff across sets tell us about rest periods and fatigue management?
- How does the RPE trend across sets indicate fatigue accumulation?
- Is the fatigue index concerning or within normal range?

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
- What should the focus be for the next session?
- Any exercises that need more attention or deloading?
- 2-3 specific actionable recommendations

Be specific and reference actual numbers from the data. Keep the total response under 600 words."""

    client = genai.Client(api_key=settings.gemini_api_key)

    try:
        response = await client.aio.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.7,
                max_output_tokens=4096,
                http_options=types.HttpOptions(timeout=GEMINI_TIMEOUT_S * 1000),
            ),
        )
    except Exception as e:
        error_msg = str(e).lower()
        if "rate limit" in error_msg or "429" in error_msg:
            logger.error("Gemini API rate limit hit: %s", e)
            raise ValueError(
                "AI analysis rate limit exceeded. Please try again in a few minutes."
            ) from e
        if "timeout" in error_msg or "deadline" in error_msg:
            logger.error("Gemini API timeout: %s", e)
            raise ValueError(
                "AI analysis timed out. The service may be overloaded — please try again."
            ) from e
        logger.error("Gemini API call failed: %s", e)
        raise ValueError(f"AI analysis failed: {e!s}") from e

    if not response.text:
        raise ValueError("Gemini returned an empty response. Please try again.")

    try:
        if response.candidates and response.candidates[0].finish_reason:
            finish = str(response.candidates[0].finish_reason)
            if "MAX" in finish.upper():
                logger.warning(
                    "Gemini lifting analysis truncated (finish_reason=%s)", finish
                )
    except Exception as e:
        logger.debug("Gemini response parsing failed (non-critical): %s", e)

    return response.text


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
    from datetime import date as date_type

    context = await compile_lifting_session_context(db, user_id, session_id)
    if context is None:
        return None

    analysis_text = await analyze_lifting_session_with_gemini(context)
    return await _store_analysis(db, user_id, "lifting_session", context, analysis_text, lifting_session_id=session_id)


# ── Health AI Analysis ──────────────────────────────────────────────────────


async def compile_health_stats(db: AsyncSession, user_id: uuid.UUID) -> dict:
    """Compile health-specific data for AI analysis.

    Returns a dict with HRV trends, resting HR, sleep, respiratory rate,
    health alerts, recovery scores, and weight trend.
    """
    from app.models.health_alert import HealthAlert
    from app.models.sleep import SleepLog
    from app.models.weight import WeightLog

    today = date.today()
    four_weeks_ago = today - timedelta(days=28)
    stats: dict = {}

    # 1. HRV trends (last 4 weeks)
    try:
        result = await db.execute(
            select(DailyMetric)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.metric_date >= four_weeks_ago,
                DailyMetric.hrv_ms.isnot(None),
            )
            .order_by(DailyMetric.metric_date)
        )
        metrics = result.scalars().all()
        hrv_data = [{"date": str(m.metric_date), "hrv_ms": m.hrv_ms} for m in metrics]
        hrv_values = [m.hrv_ms for m in metrics]
        stats["hrv_trends"] = {
            "entries": hrv_data,
            "avg_hrv_ms": round(sum(hrv_values) / len(hrv_values), 1)
            if hrv_values
            else None,
            "latest_hrv_ms": hrv_values[-1] if hrv_values else None,
            "min_hrv_ms": min(hrv_values) if hrv_values else None,
            "max_hrv_ms": max(hrv_values) if hrv_values else None,
        }
    except Exception as e:
        logger.warning("Failed to get HRV trends: %s", e)
        stats["hrv_trends"] = {}

    # 2. Resting HR trends (last 4 weeks)
    try:
        result = await db.execute(
            select(DailyMetric)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.metric_date >= four_weeks_ago,
                DailyMetric.resting_hr.isnot(None),
            )
            .order_by(DailyMetric.metric_date)
        )
        metrics = result.scalars().all()
        rhr_data = [
            {"date": str(m.metric_date), "resting_hr": m.resting_hr} for m in metrics
        ]
        rhr_values = [m.resting_hr for m in metrics]
        stats["resting_hr_trends"] = {
            "entries": rhr_data,
            "avg_resting_hr": round(sum(rhr_values) / len(rhr_values), 1)
            if rhr_values
            else None,
            "latest_resting_hr": rhr_values[-1] if rhr_values else None,
        }
    except Exception as e:
        logger.warning("Failed to get resting HR trends: %s", e)
        stats["resting_hr_trends"] = {}

    # 3. Recovery scores (last 4 weeks)
    try:
        result = await db.execute(
            select(DailyMetric)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.metric_date >= four_weeks_ago,
                DailyMetric.recovery_score.isnot(None),
            )
            .order_by(DailyMetric.metric_date)
        )
        metrics = result.scalars().all()
        recovery_data = [
            {"date": str(m.metric_date), "recovery_score": m.recovery_score}
            for m in metrics
        ]
        recovery_values = [m.recovery_score for m in metrics]
        stats["recovery_scores"] = {
            "entries": recovery_data,
            "avg_recovery": round(sum(recovery_values) / len(recovery_values), 1)
            if recovery_values
            else None,
            "latest_recovery": recovery_values[-1] if recovery_values else None,
        }
    except Exception as e:
        logger.warning("Failed to get recovery scores: %s", e)
        stats["recovery_scores"] = {}

    # 4. Respiratory rate trends (last 4 weeks)
    try:
        result = await db.execute(
            select(DailyMetric)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.metric_date >= four_weeks_ago,
                DailyMetric.respiratory_rate.isnot(None),
            )
            .order_by(DailyMetric.metric_date)
        )
        metrics = result.scalars().all()
        rr_data = [
            {"date": str(m.metric_date), "respiratory_rate": m.respiratory_rate}
            for m in metrics
        ]
        rr_values = [m.respiratory_rate for m in metrics]
        stats["respiratory_rate_trends"] = {
            "entries": rr_data,
            "avg_respiratory_rate": round(sum(rr_values) / len(rr_values), 2)
            if rr_values
            else None,
            "latest_respiratory_rate": rr_values[-1] if rr_values else None,
        }
    except Exception as e:
        logger.warning("Failed to get respiratory rate trends: %s", e)
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

    return _make_json_serializable(stats)


async def analyze_health_with_gemini(stats_json: dict) -> str:
    """Call Google Gemini API to analyze health data and return analysis text."""
    from google import genai
    from google.genai import types

    from app.config import get_settings

    settings = get_settings()

    if not settings.gemini_api_key:
        raise ValueError("GEMINI_API_KEY not configured")

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

Be specific, reference actual numbers from the data. Keep the total response under 800 words."""

    client = genai.Client(api_key=settings.gemini_api_key)

    try:
        response = await client.aio.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.7,
                max_output_tokens=4096,
                http_options=types.HttpOptions(timeout=GEMINI_TIMEOUT_S * 1000),
            ),
        )
    except Exception as e:
        error_msg = str(e).lower()
        if "rate limit" in error_msg or "429" in error_msg:
            logger.error("Gemini API rate limit hit: %s", e)
            raise ValueError(
                "AI analysis rate limit exceeded. Please try again in a few minutes."
            ) from e
        if "timeout" in error_msg or "deadline" in error_msg:
            logger.error("Gemini API timeout: %s", e)
            raise ValueError(
                "AI analysis timed out. The service may be overloaded — please try again."
            ) from e
        logger.error("Gemini API call failed: %s", e)
        raise ValueError(f"AI analysis failed: {e!s}") from e

    if not response.text:
        raise ValueError("Gemini returned an empty response. Please try again.")

    try:
        if response.candidates and response.candidates[0].finish_reason:
            finish = str(response.candidates[0].finish_reason)
            if "MAX" in finish.upper():
                logger.warning(
                    "Gemini health analysis truncated (finish_reason=%s)", finish
                )
    except Exception as e:
        logger.debug("Gemini response parsing failed (non-critical): %s", e)

    return response.text


async def run_health_ai_analysis(db: AsyncSession, user_id: uuid.UUID) -> LlmAnalysis:
    """Orchestrate health AI analysis flow.

    1. Compile health stats
    2. Call Gemini for analysis
    3. Create and store LlmAnalysis record with analysis_type='health'
    4. Return the record
    """
    from datetime import date as date_type

    stats = await compile_health_stats(db, user_id)
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
    recent training, and days until event.
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
        from app.services.cycling import compute_training_load, get_daily_tss

        ninety_days_ago = today - timedelta(days=90)
        daily_tss = await get_daily_tss(db, user_id, ninety_days_ago, today)
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

    return _make_json_serializable(stats)


async def analyze_event_with_gemini(stats_json: dict) -> str:
    """Call Google Gemini API to analyze event preparation data."""
    from google import genai
    from google.genai import types

    from app.config import get_settings

    settings = get_settings()

    if not settings.gemini_api_key:
        raise ValueError("GEMINI_API_KEY not configured")

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

Be specific, reference actual numbers from the data. Tailor advice to the days-until-event timeframe. Keep the total response under 800 words."""

    client = genai.Client(api_key=settings.gemini_api_key)

    try:
        response = await client.aio.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.7,
                max_output_tokens=4096,
                http_options=types.HttpOptions(timeout=GEMINI_TIMEOUT_S * 1000),
            ),
        )
    except Exception as e:
        error_msg = str(e).lower()
        if "rate limit" in error_msg or "429" in error_msg:
            logger.error("Gemini API rate limit hit: %s", e)
            raise ValueError(
                "AI analysis rate limit exceeded. Please try again in a few minutes."
            ) from e
        if "timeout" in error_msg or "deadline" in error_msg:
            logger.error("Gemini API timeout: %s", e)
            raise ValueError(
                "AI analysis timed out. The service may be overloaded — please try again."
            ) from e
        logger.error("Gemini API call failed: %s", e)
        raise ValueError(f"AI analysis failed: {e!s}") from e

    if not response.text:
        raise ValueError("Gemini returned an empty response. Please try again.")

    try:
        if response.candidates and response.candidates[0].finish_reason:
            finish = str(response.candidates[0].finish_reason)
            if "MAX" in finish.upper():
                logger.warning(
                    "Gemini event analysis truncated (finish_reason=%s)", finish
                )
    except Exception as e:
        logger.debug("Gemini response parsing failed (non-critical): %s", e)

    return response.text


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

    analysis_text = await analyze_event_with_gemini(stats)
    return await _store_analysis(db, user_id, "event", stats, analysis_text, event_id=event_id)
