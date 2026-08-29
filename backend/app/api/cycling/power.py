"""Cycling API — Power curve, power zones, HR zones, power vs HR, metrics summary, suggested cycle."""

import math
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.activity import Activity
from app.models.daily_metric import DailyMetric
from app.models.user import User
from app.schemas.cycling import (
    CyclingMetricsSummary,
    HrZoneDistribution,
    HrZonesResponse,
    MetricBenchmark,
    MetricTrend,
    PowerCurveResponse,
    PowerDurationPoint,
    PowerVsHrPoint,
    PowerVsHrResponse,
    PowerZoneDistribution,
    PowerZonesResponse,
    SuggestedCycleResponse,
    SuggestedDay,
)
from app.services.auth import get_current_user
from app.services.cycling import (
    POWER_DURATION_BUCKETS,
    compute_power_curve_from_streams,
    compute_power_zones_from_streams,
    compute_training_load,
    estimate_ftp_from_power_curve,
    get_daily_tss,
    get_metric_benchmark,
    get_or_create_cycling_profile,
)

router = APIRouter()


# ── Power Curve (from stream data) ──────────────────────────────────────────


@router.get("/power-curve", response_model=PowerCurveResponse)
async def get_power_curve(
    days: int = Query(90, ge=7, le=365, description="Lookback period in days"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the best power curve from actual power stream data.

    For each duration bucket (5s to 120min), finds the best average power
    using a rolling average over power streams.
    """
    best_power = await compute_power_curve_from_streams(db, current_user.id, days)

    profile = await get_or_create_cycling_profile(db, current_user.id)
    ftp = profile.ftp_watts

    data = []
    for duration_sec, label in POWER_DURATION_BUCKETS:
        data.append(
            PowerDurationPoint(
                duration_label=label,
                duration_seconds=duration_sec,
                best_power_watts=best_power.get(duration_sec),
            )
        )

    return PowerCurveResponse(data=data, ftp_watts=ftp)


# ── Power Zones ──────────────────────────────────────────────────────────────


@router.get("/power-zones", response_model=PowerZonesResponse)
async def get_power_zones(
    days: int = Query(30, ge=7, le=180, description="Lookback period in days"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get power zone distribution based on FTP.

    Uses the Coggan 7-zone model. Requires FTP to be set.
    """
    profile = await get_or_create_cycling_profile(db, current_user.id)
    if not profile.ftp_watts:
        raise HTTPException(
            status_code=400,
            detail="FTP not set. Set your FTP in the cycling profile first.",
        )

    zones = await compute_power_zones_from_streams(
        db, current_user.id, profile.ftp_watts, days
    )
    total_time = sum(z["time_seconds"] for z in zones)

    return PowerZonesResponse(
        ftp_watts=profile.ftp_watts,
        zones=[PowerZoneDistribution(**z) for z in zones],
        total_time_seconds=total_time,
    )


# ── Heart Rate Zones ────────────────────────────────────────────────────────


@router.get("/hr-zones", response_model=HrZonesResponse)
async def get_hr_zones(
    days: int = Query(30, ge=7, le=180, description="Lookback period in days"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get heart rate zone distribution based on LTHR.

    Uses the Coggan 6-zone model for HR. Requires LTHR to be set in cycling profile.
    """
    from app.services.cycling import compute_hr_zones_from_streams

    profile = await get_or_create_cycling_profile(db, current_user.id)
    if not profile.lactate_threshold_hr:
        raise HTTPException(
            status_code=400,
            detail="LTHR not set. Set your Lactate Threshold Heart Rate in the cycling profile first.",
        )

    zones = await compute_hr_zones_from_streams(
        db, current_user.id, profile.lactate_threshold_hr, days
    )
    total_time = sum(z["time_seconds"] for z in zones)

    return HrZonesResponse(
        lthr=profile.lactate_threshold_hr,
        zones=[HrZoneDistribution(**z) for z in zones],
        total_time_seconds=total_time,
    )


# ── Power vs HR Scatter ─────────────────────────────────────────────────────


@router.get("/power-vs-hr", response_model=PowerVsHrResponse)
async def get_power_vs_hr(
    days: int = Query(90, ge=7, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get power vs heart rate data points for correlation analysis."""
    cutoff = date.today() - timedelta(days=days)

    result = await db.execute(
        select(Activity)
        .where(
            Activity.user_id == current_user.id,
            Activity.sport_type == "cycling",
            Activity.average_power.isnot(None),
            Activity.average_heartrate.isnot(None),
            Activity.start_date >= cutoff,
        )
        .order_by(Activity.start_date)
    )
    activities = list(result.scalars().all())

    data = []
    for act in activities:
        if (
            act.average_power
            and act.average_heartrate
            and math.isfinite(act.average_power)
            and math.isfinite(act.average_heartrate)
        ):
            data.append(
                PowerVsHrPoint(
                    power=act.average_power,
                    heart_rate=act.average_heartrate,
                    date=act.start_date.date(),
                )
            )

    return PowerVsHrResponse(data=data)


# ── Cycling Metrics Summary ──────────────────────────────────────────────────


@router.get("/metrics-summary", response_model=CyclingMetricsSummary)
async def get_cycling_metrics_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a summary of cycling-specific metrics for the last 7 days with trend indicators."""
    uid = current_user.id
    cutoff_7d = date.today() - timedelta(days=7)
    cutoff_28d = date.today() - timedelta(days=28)

    # Recent cycling stats (7 days)
    result = await db.execute(
        select(
            func.count(Activity.id).label("ride_count"),
            func.coalesce(func.sum(Activity.tss), 0.0).label("total_tss"),
            func.coalesce(func.sum(Activity.distance_meters), 0.0).label(
                "total_distance"
            ),
            func.coalesce(func.sum(Activity.duration_seconds), 0).label("total_time"),
            func.coalesce(func.sum(Activity.elevation_gain_meters), 0.0).label(
                "total_elevation"
            ),
        ).where(
            Activity.user_id == uid,
            Activity.sport_type == "cycling",
            Activity.start_date >= cutoff_7d,
        )
    )
    row = result.one()

    # Guard against PostgreSQL NaN from COALESCE(SUM(NaN), 0.0)
    def _nan0(val):
        if val is None:
            return 0.0
        f = float(val)
        return 0.0 if (math.isnan(f) or math.isinf(f)) else f

    def _nan0_int(val):
        if val is None:
            return 0
        f = float(val)
        return 0 if (math.isnan(f) or math.isinf(f)) else int(val)

    profile = await get_or_create_cycling_profile(db, uid)
    ftp = profile.ftp_watts

    # Average IF and VI over recent rides — use NP if available, else fall back to avg power
    # IF = NP / FTP (or avg_power / FTP as fallback)
    # VI = NP / AP (only meaningful when NP is available)
    result_rides = await db.execute(
        select(Activity.normalized_power, Activity.average_power).where(
            Activity.user_id == uid,
            Activity.sport_type == "cycling",
            Activity.start_date >= cutoff_7d,
            Activity.average_power.isnot(None),
        )
    )
    ride_rows = result_rides.all()

    avg_if = None
    if ftp and ftp > 0 and ride_rows:
        ifs = []
        for r in ride_rows:
            power = r.normalized_power or r.average_power
            if power and math.isfinite(power):
                ifs.append(power / ftp)
        if ifs:
            avg_if = round(sum(ifs) / len(ifs), 3)

    avg_vi = None
    vi_rows = [
        r
        for r in ride_rows
        if r.normalized_power and r.average_power and r.average_power > 0
    ]
    if vi_rows:
        vis = [r.normalized_power / r.average_power for r in vi_rows]
        avg_vi = round(sum(vis) / len(vis), 3)

    # Best 20-min power in last 90 days
    best_20min = None
    best_power = await compute_power_curve_from_streams(db, uid, days=90)
    if 1200 in best_power:
        best_20min = best_power[1200]

    estimated_ftp = estimate_ftp_from_power_curve(best_power)

    power_to_weight = None
    effective_ftp = ftp or estimated_ftp
    if effective_ftp and profile.weight_kg and profile.weight_kg > 0:
        power_to_weight = round(effective_ftp / profile.weight_kg, 2)

    # ── Trend computation: compare 7-day values against 28-day weekly averages ──
    def _trend(current: float | None, baseline: float | None) -> MetricTrend | None:
        """Compute trend direction comparing current 7d value to 28d weekly average."""
        if current is None or baseline is None or baseline == 0:
            return MetricTrend(
                current_value=current, baseline_value=baseline, direction="stable"
            )
        ratio = current / baseline
        if ratio > 1.05:
            direction = "up"
        elif ratio < 0.95:
            direction = "down"
        else:
            direction = "stable"
        return MetricTrend(
            current_value=round(current, 2),
            baseline_value=round(baseline, 2),
            direction=direction,
        )

    # 28-day stats for baseline (4 weekly averages)
    result_28d = await db.execute(
        select(
            func.count(Activity.id).label("ride_count"),
            func.coalesce(func.sum(Activity.tss), 0.0).label("total_tss"),
            func.coalesce(func.sum(Activity.distance_meters), 0.0).label(
                "total_distance"
            ),
            func.coalesce(func.sum(Activity.duration_seconds), 0).label("total_time"),
            func.coalesce(func.sum(Activity.elevation_gain_meters), 0.0).label(
                "total_elevation"
            ),
        ).where(
            Activity.user_id == uid,
            Activity.sport_type == "cycling",
            Activity.start_date >= cutoff_28d,
        )
    )
    row_28d = result_28d.one()

    # Convert 28-day totals to weekly averages (divide by 4)
    baseline_tss = _nan0(row_28d.total_tss) / 4
    baseline_distance = _nan0(row_28d.total_distance) / 1000 / 4
    baseline_time = _nan0(row_28d.total_time) / 3600 / 4
    baseline_elevation = _nan0(row_28d.total_elevation) / 4
    baseline_rides = _nan0_int(row_28d.ride_count) / 4

    # 28-day IF/VI baselines
    result_rides_28d = await db.execute(
        select(Activity.normalized_power, Activity.average_power).where(
            Activity.user_id == uid,
            Activity.sport_type == "cycling",
            Activity.start_date >= cutoff_28d,
            Activity.average_power.isnot(None),
        )
    )
    ride_rows_28d = result_rides_28d.all()

    baseline_if = None
    if ftp and ftp > 0 and ride_rows_28d:
        ifs_28d = []
        for r in ride_rows_28d:
            power = r.normalized_power or r.average_power
            if power and math.isfinite(power):
                ifs_28d.append(power / ftp)
        if ifs_28d:
            baseline_if = sum(ifs_28d) / len(ifs_28d)

    baseline_vi = None
    vi_rows_28d = [
        r
        for r in ride_rows_28d
        if r.normalized_power and r.average_power and r.average_power > 0
    ]
    if vi_rows_28d:
        baseline_vi = sum(
            r.normalized_power / r.average_power for r in vi_rows_28d
        ) / len(vi_rows_28d)

    # Benchmark classifications
    ftp_wkg_benchmark = None
    if power_to_weight and power_to_weight > 0:
        bench = get_metric_benchmark(power_to_weight, "ftp_w_per_kg")
        if bench:
            ftp_wkg_benchmark = MetricBenchmark(**bench)

    ctl_benchmark = None
    # Compute CTL for benchmark classification
    end_date = date.today()
    start_date = end_date - timedelta(days=90 + 42)
    daily_tss_data = await get_daily_tss(db, uid, start_date, end_date)
    load_data = compute_training_load(daily_tss_data, end_date, lookback_days=90)
    current_ctl = load_data[-1]["ctl"] if load_data else None
    if current_ctl and current_ctl > 0:
        bench = get_metric_benchmark(current_ctl, "ctl")
        if bench:
            ctl_benchmark = MetricBenchmark(**bench)

    vi_benchmark = None
    if avg_vi and avg_vi > 0:
        bench = get_metric_benchmark(avg_vi, "vi")
        if bench:
            vi_benchmark = MetricBenchmark(**bench)

    return CyclingMetricsSummary(
        recent_tss=_nan0(row.total_tss),
        recent_distance_km=round(_nan0(row.total_distance) / 1000, 1),
        recent_time_hours=round(_nan0_int(row.total_time) / 3600, 1),
        recent_elevation_m=round(_nan0(row.total_elevation), 0),
        recent_rides=_nan0_int(row.ride_count),
        avg_intensity_factor=avg_if,
        avg_variability_index=avg_vi,
        best_20min_power=best_20min,
        estimated_ftp=estimated_ftp,
        ftp_watts=ftp,
        weight_kg=profile.weight_kg,
        power_to_weight=power_to_weight,
        # Trend indicators
        tss_trend=_trend(_nan0(row.total_tss), baseline_tss),
        distance_trend=_trend(
            round(_nan0(row.total_distance) / 1000, 1), baseline_distance
        ),
        time_trend=_trend(round(_nan0_int(row.total_time) / 3600, 1), baseline_time),
        elevation_trend=_trend(
            round(_nan0(row.total_elevation), 0), baseline_elevation
        ),
        rides_trend=_trend(_nan0_int(row.ride_count), baseline_rides),
        if_trend=_trend(avg_if, baseline_if),
        vi_trend=_trend(avg_vi, baseline_vi),
        # Benchmarks
        ftp_wkg_benchmark=ftp_wkg_benchmark,
        ctl_benchmark=ctl_benchmark,
        vi_benchmark=vi_benchmark,
    )


# ── Lifetime Power PBs ──────────────────────────────────────────────────────


@router.get("/lifetime-pbs")
async def get_lifetime_power_pbs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get lifetime best power records at each duration bucket.

    Uses all-time power stream data (no date filter).
    """
    best_power = await compute_power_curve_from_streams(
        db, current_user.id, days=3650
    )  # ~10 years
    profile = await get_or_create_cycling_profile(db, current_user.id)

    pbs = []
    for duration_sec, label in POWER_DURATION_BUCKETS:
        power = best_power.get(duration_sec)
        pbs.append(
            {
                "duration_label": label,
                "duration_seconds": duration_sec,
                "best_power_watts": power,
                "pct_ftp": round(power / profile.ftp_watts * 100, 1)
                if power and profile.ftp_watts
                else None,
            }
        )

    return {
        "pbs": pbs,
        "ftp_watts": profile.ftp_watts,
        "weight_kg": profile.weight_kg,
    }


# ── Suggested Training Cycle ────────────────────────────────────────────────


@router.get("/suggested-cycle", response_model=SuggestedCycleResponse)
async def get_suggested_cycle(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Compute a suggested 7-day training cycle based on recovery, training load, and recent activity.

    Uses current TSB, latest Whoop recovery score, and recent ride frequency to
    recommend workout types for each day of the coming week.
    """
    today = date.today()

    # 1. Get training load (CTL/ATL/TSB)
    ninety_days_ago = today - timedelta(days=90)
    daily_tss = await get_daily_tss(db, current_user.id, ninety_days_ago, today)
    training_load = compute_training_load(daily_tss, today, lookback_days=90)

    current_ctl = current_atl = current_tsb = None
    if training_load:
        latest = training_load[-1]
        current_ctl = latest["ctl"]
        current_atl = latest["atl"]
        current_tsb = latest["tsb"]

    # 2. Get latest recovery data
    result = await db.execute(
        select(DailyMetric)
        .where(
            DailyMetric.user_id == current_user.id,
            DailyMetric.recovery_score.isnot(None),
        )
        .order_by(DailyMetric.metric_date.desc())
        .limit(1)
    )
    latest_metric = result.scalar_one_or_none()
    latest_recovery = latest_metric.recovery_score if latest_metric else None
    latest_hrv = latest_metric.hrv_ms if latest_metric else None

    # 3. Determine readiness
    if latest_recovery is not None:
        if latest_recovery >= 67:
            readiness = "green"
            readiness_msg = "Ready to train hard — recovery is strong"
        elif latest_recovery >= 34:
            readiness = "yellow"
            readiness_msg = "Moderate recovery — listen to your body, mix intensity"
        else:
            readiness = "red"
            readiness_msg = "Low recovery — prioritize rest and easy movement"
    elif current_tsb is not None:
        if current_tsb > -10:
            readiness = "green"
            readiness_msg = "Training load is manageable — no recovery data available"
        elif current_tsb > -30:
            readiness = "yellow"
            readiness_msg = "Building fatigue — no recovery data available"
        else:
            readiness = "red"
            readiness_msg = "High fatigue — no recovery data available, consider rest"
    else:
        readiness = "yellow"
        readiness_msg = (
            "Insufficient data — start logging activities for personalized suggestions"
        )

    # 4. Count recent rides (last 7 days)
    seven_days_ago = today - timedelta(days=7)
    result = await db.execute(
        select(func.count(Activity.id)).where(
            Activity.user_id == current_user.id,
            Activity.sport_type == "cycling",
            Activity.start_date >= seven_days_ago,
        )
    )
    recent_ride_count = int(result.scalar() or 0)

    # 5. Count recent lifting sessions (last 7 days)
    from app.models.lifting import LiftingSession

    result = await db.execute(
        select(func.count(LiftingSession.id)).where(
            LiftingSession.user_id == current_user.id,
            LiftingSession.session_date >= seven_days_ago,
        )
    )
    recent_lift_count = int(result.scalar() or 0)

    # 6. Check for upcoming events (next 14 days)
    from app.models.event import Event

    fourteen_days = today + timedelta(days=14)
    result = await db.execute(
        select(Event)
        .where(
            Event.user_id == current_user.id,
            Event.event_date >= today,
            Event.event_date <= fourteen_days,
        )
        .order_by(Event.event_date)
    )
    upcoming_events = list(result.scalars().all())
    has_upcoming_event = len(upcoming_events) > 0
    days_to_event = (
        (upcoming_events[0].event_date - today).days if upcoming_events else None
    )

    # 7. Build the7-day plan
    days: list[SuggestedDay] = []

    # Determine the weekly pattern based on readiness and recent load
    # Pattern: Mon=ride, Tue=lift, Wed=ride, Thu=lift/rest, Fri=ride, Sat=long ride, Sun=rest
    # Adjust based on readiness
    day_names = [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
    ]

    for i in range(7):
        d = today + timedelta(days=i)
        day_name = day_names[d.weekday()]

        # Default pattern
        if d == today:
            # Today — most important recommendation
            if readiness == "red":
                workout_type = "rest"
                label = "Rest Day"
                description = "Your body needs recovery. Take a complete rest day or do light walking. Focus on sleep, hydration, and nutrition."
                target_tss = 0
                intensity = "none"
                icon = "🛌"
            elif readiness == "yellow":
                if recent_ride_count >= 5:
                    workout_type = "recovery"
                    label = "Easy Spin"
                    description = "You've been training hard. Keep it easy today — Zone 1-2 only, under 60 minutes. Focus on pedaling technique."
                    target_tss = 25
                    intensity = "low"
                    icon = "🟢"
                else:
                    workout_type = "endurance"
                    label = "Steady Endurance"
                    description = "Moderate recovery allows a Zone 2 endurance ride. Keep it controlled — 60-90 minutes at conversational pace."
                    target_tss = 55
                    intensity = "moderate"
                    icon = "🚴"
            else:  # green
                if current_tsb is not None and current_tsb > 15:
                    workout_type = "threshold"
                    label = "Threshold Intervals"
                    description = "You're fresh and ready for quality work. Do 2-3×12min at FTP (Zone 4) with 5min recovery. Great for building fitness."
                    target_tss = 80
                    intensity = "high"
                    icon = "🔥"
                elif recent_ride_count < 3:
                    workout_type = "endurance"
                    label = "Endurance Ride"
                    description = "Good recovery and room to build. Aim for 90-120 minutes at Zone 2-3. Build your aerobic base."
                    target_tss = 65
                    intensity = "moderate"
                    icon = "🚴"
                else:
                    workout_type = "tempo"
                    label = "Tempo Ride"
                    description = "Solid recovery allows a tempo session. Try 2×20min at Zone 3 (sweet spot). Good balance of stimulus and recovery."
                    target_tss = 70
                    intensity = "moderate"
                    icon = "⚡"
        elif d.weekday() == 0:  # Monday
            workout_type = "endurance"
            label = "Endurance Ride"
            description = (
                "Start the week with a steady Zone 2 ride. Build your aerobic engine."
            )
            target_tss = 55
            intensity = "moderate"
            icon = "🚴"
        elif d.weekday() == 1:  # Tuesday
            if recent_lift_count < 2:
                workout_type = "strength"
                label = "Strength Training"
                description = "Hit the gym for a lifting session. Focus on compound movements — squats, deadlifts, presses."
                target_tss = None
                intensity = "moderate"
                icon = "🏋️"
            else:
                workout_type = "recovery"
                label = "Active Recovery"
                description = "Easy spin or walk. Keep heart rate low. Recovery between hard days."
                target_tss = 20
                intensity = "low"
                icon = "🟢"
        elif d.weekday() == 2:  # Wednesday
            if readiness == "red":
                workout_type = "recovery"
                label = "Easy Spin"
                description = "Keep it light — Zone 1-2 only. Recovery is the priority."
                target_tss = 25
                intensity = "low"
                icon = "🟢"
            else:
                workout_type = "tempo"
                label = "Tempo / Sweet Spot"
                description = "Mid-week quality session. 2×20min at 88-93% FTP. Builds threshold without excessive fatigue."
                target_tss = 70
                intensity = "moderate"
                icon = "⚡"
        elif d.weekday() == 3:  # Thursday
            if recent_lift_count < 2:
                workout_type = "strength"
                label = "Strength Training"
                description = "Second lifting session of the week. Upper body focus or full body depending on your program."
                target_tss = None
                intensity = "moderate"
                icon = "🏋️"
            else:
                workout_type = "rest"
                label = "Rest Day"
                description = "Full rest day. Let your body absorb the training from earlier in the week."
                target_tss = 0
                intensity = "none"
                icon = "🛌"
        elif d.weekday() == 4:  # Friday
            if readiness == "red" or (current_tsb is not None and current_tsb < -25):
                workout_type = "recovery"
                label = "Easy Spin"
                description = (
                    "Keep it easy before the weekend. Zone 1-2, under 45 minutes."
                )
                target_tss = 20
                intensity = "low"
                icon = "🟢"
            else:
                workout_type = "vo2max"
                label = "VO2max Intervals"
                description = "High-intensity session: 5×4min at 105-120% FTP with 4min recovery. Key for raising your ceiling."
                target_tss = 85
                intensity = "high"
                icon = "🔥"
        elif d.weekday() == 5:  # Saturday
            if has_upcoming_event and days_to_event is not None and days_to_event <= 7:
                workout_type = "endurance"
                label = "Pre-Event Ride"
                description = f"Event in {days_to_event} days. Keep it easy — Zone 2, 60-90 minutes. Stay sharp without adding fatigue."
                target_tss = 40
                intensity = "low"
                icon = "🏁"
            else:
                workout_type = "endurance"
                label = "Long Ride"
                description = "Weekend long ride. 2-3 hours at Zone 2. Build endurance and fat oxidation. Include some tempo efforts if feeling good."
                target_tss = 100
                intensity = "moderate"
                icon = "🚴"
        else:  # Sunday
            workout_type = "rest"
            label = "Rest Day"
            description = "Complete rest or light stretching/yoga. Let your body recover and prepare for next week."
            target_tss = 0
            intensity = "none"
            icon = "🛌"

        days.append(
            SuggestedDay(
                day_name=day_name,
                date=d.isoformat(),
                workout_type=workout_type,
                label=label,
                description=description,
                target_tss=target_tss,
                intensity=intensity,
                icon=icon,
            )
        )

    # 8. Build summary
    if readiness == "red":
        summary = (
            "Your recovery is low. This week should focus on rest and easy movement. "
            "Avoid high-intensity sessions until recovery improves. "
            "Prioritize sleep (8+ hours), hydration, and nutrition."
        )
    elif readiness == "yellow":
        summary = (
            "Moderate recovery allows a balanced week. Mix easy endurance rides with "
            "one quality session mid-week. Keep Saturday's long ride controlled. "
            "Listen to your body — if fatigue builds, swap a hard day for recovery."
        )
    else:
        if current_tsb is not None and current_tsb > 15:
            summary = (
                "You're fresh and ready for a quality training week. "
                "Include threshold and VO2max work to maximize fitness gains. "
                "Your TSB indicates you can handle higher intensity — take advantage of it."
            )
        elif current_tsb is not None and current_tsb < -15:
            summary = (
                "Good recovery but accumulating fatigue. Focus on endurance and tempo "
                "rather than all-out efforts. A solid week of Zone 2-3 work will build "
                "fitness without overreaching."
            )
        else:
            summary = (
                "Strong recovery and balanced training load. You can handle a mix of "
                "endurance, tempo, and one high-intensity session. "
                "Aim for consistency over heroics."
            )

    return SuggestedCycleResponse(
        readiness=readiness,
        readiness_message=readiness_msg,
        current_tsb=round(current_tsb, 1) if current_tsb is not None else None,
        current_ctl=round(current_ctl, 1) if current_ctl is not None else None,
        current_atl=round(current_atl, 1) if current_atl is not None else None,
        latest_recovery=round(latest_recovery, 1)
        if latest_recovery is not None
        else None,
        latest_hrv=round(latest_hrv, 1) if latest_hrv is not None else None,
        days=days,
        summary=summary,
    )
