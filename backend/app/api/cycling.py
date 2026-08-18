"""Cycling API — Power analysis, training load, FTP management, cycling metrics."""

import math
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.activity import Activity
from app.models.cycling import FtpHistory
from app.models.user import User
from app.schemas.cycling import (
    CyclingMetricsSummary,
    CyclingProfileRead,
    CyclingProfileUpdate,
    DailyLoadPoint,
    DecouplingActivityPoint,
    DecouplingHistoryResponse,
    DecouplingSingleResponse,
    FtpEstimateDetail,
    FtpEstimateResponse,
    FtpHistoryCreate,
    FtpHistoryRead,
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
    TrainingLoadResponse,
    Vo2maxDetail,
    Vo2maxHistoryPoint,
    Vo2maxHistoryResponse,
    Vo2maxResponse,
)
from app.services.auth import get_current_user
from app.services.cycling import (
    POWER_DURATION_BUCKETS,
    _classify_vo2max,
    auto_compute_tss_for_activity,
    backfill_ftp_estimates,
    compute_decoupling_for_activity,
    compute_decoupling_history,
    compute_normalized_power,
    compute_power_curve_from_streams,
    compute_power_zones_from_streams,
    compute_training_load,
    compute_vo2max_history,
    estimate_ftp_from_power_curve,
    estimate_ftp_from_power_curve_detailed,
    estimate_vo2max,
    get_daily_tss,
    get_metric_benchmark,
    get_or_create_cycling_profile,
)

router = APIRouter()


# ── Cycling Profile ──────────────────────────────────────────────────────────


@router.get("/profile", response_model=CyclingProfileRead)
async def get_cycling_profile(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the current user's cycling profile (FTP, weight)."""
    profile = await get_or_create_cycling_profile(db, current_user.id)
    await db.refresh(profile)
    return CyclingProfileRead.model_validate(profile)


@router.patch("/profile", response_model=CyclingProfileRead)
async def update_cycling_profile(
    payload: CyclingProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update the current user's cycling profile. If FTP changes, also records history."""
    profile = await get_or_create_cycling_profile(db, current_user.id)

    if payload.ftp_watts is not None and payload.ftp_watts != profile.ftp_watts:
        # Record FTP history
        ftp_entry = FtpHistory(
            user_id=current_user.id,
            ftp_watts=payload.ftp_watts,
            effective_date=date.today(),
            source="manual",
        )
        db.add(ftp_entry)
        profile.ftp_watts = payload.ftp_watts

    if payload.weight_kg is not None:
        profile.weight_kg = payload.weight_kg

    if payload.lactate_threshold_hr is not None:
        profile.lactate_threshold_hr = payload.lactate_threshold_hr

    if payload.auto_estimate_ftp is not None:
        profile.auto_estimate_ftp = payload.auto_estimate_ftp

    await db.flush()
    await db.refresh(profile)
    return CyclingProfileRead.model_validate(profile)


# ── FTP History ──────────────────────────────────────────────────────────────


@router.get("/ftp-history", response_model=list[FtpHistoryRead])
async def get_ftp_history(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the user's FTP history."""
    result = await db.execute(
        select(FtpHistory)
        .where(FtpHistory.user_id == current_user.id)
        .order_by(FtpHistory.effective_date.desc())
    )
    entries = result.scalars().all()
    return [FtpHistoryRead.model_validate(e) for e in entries]


@router.post("/ftp-history", response_model=FtpHistoryRead)
async def create_ftp_history_entry(
    payload: FtpHistoryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Manually add an FTP history entry."""
    entry = FtpHistory(
        user_id=current_user.id,
        ftp_watts=payload.ftp_watts,
        effective_date=payload.effective_date,
        source=payload.source,
        notes=payload.notes,
    )
    db.add(entry)

    # Also update the cycling profile if this is the latest FTP
    profile = await get_or_create_cycling_profile(db, current_user.id)
    if not profile.ftp_watts or payload.effective_date >= date.today():
        profile.ftp_watts = payload.ftp_watts

    await db.flush()
    return FtpHistoryRead.model_validate(entry)


# ── Training Load (CTL / ATL / TSB) ─────────────────────────────────────────


@router.get("/training-load", response_model=TrainingLoadResponse)
async def get_training_load(
    days: int = Query(90, ge=7, le=365, description="Lookback period in days"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get training load data (CTL, ATL, TSB) over time.

    CTL = Chronic Training Load (fitness) — 42-day EWMA of TSS
    ATL = Acute Training Load (fatigue) — 7-day EWMA of TSS
    TSB = Training Stress Balance (form) = CTL - ATL
    """
    end_date = date.today()
    start_date = end_date - timedelta(days=days + 42)  # extra buffer for CTL ramp-up

    daily_tss = await get_daily_tss(db, current_user.id, start_date, end_date)
    load_data = compute_training_load(daily_tss, end_date, lookback_days=days)

    points = [DailyLoadPoint(**d) for d in load_data]
    current = points[-1] if points else DailyLoadPoint(date=end_date, tss=0, ctl=0, atl=0, tsb=0)

    return TrainingLoadResponse(
        data=points,
        current_ctl=current.ctl,
        current_atl=current.atl,
        current_tsb=current.tsb,
    )


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
        data.append(PowerDurationPoint(
            duration_label=label,
            duration_seconds=duration_sec,
            best_power_watts=best_power.get(duration_sec),
        ))

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
        raise HTTPException(status_code=400, detail="FTP not set. Set your FTP in the cycling profile first.")

    zones = await compute_power_zones_from_streams(db, current_user.id, profile.ftp_watts, days)
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

    zones = await compute_hr_zones_from_streams(db, current_user.id, profile.lactate_threshold_hr, days)
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
            act.average_power and act.average_heartrate
            and math.isfinite(act.average_power) and math.isfinite(act.average_heartrate)
        ):
            data.append(PowerVsHrPoint(
                power=act.average_power,
                heart_rate=act.average_heartrate,
                date=act.start_date.date(),
            ))

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
    cutoff_90d = date.today() - timedelta(days=90)

    # Recent cycling stats (7 days)
    result = await db.execute(
        select(
            func.count(Activity.id).label("ride_count"),
            func.coalesce(func.sum(Activity.tss), 0.0).label("total_tss"),
            func.coalesce(func.sum(Activity.distance_meters), 0.0).label("total_distance"),
            func.coalesce(func.sum(Activity.duration_seconds), 0).label("total_time"),
            func.coalesce(func.sum(Activity.elevation_gain_meters), 0.0).label("total_elevation"),
        )
        .where(
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
        select(Activity.normalized_power, Activity.average_power)
        .where(
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
    vi_rows = [r for r in ride_rows if r.normalized_power and r.average_power and r.average_power > 0]
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
            return MetricTrend(current_value=current, baseline_value=baseline, direction="stable")
        ratio = current / baseline
        if ratio > 1.05:
            direction = "up"
        elif ratio < 0.95:
            direction = "down"
        else:
            direction = "stable"
        return MetricTrend(current_value=round(current, 2), baseline_value=round(baseline, 2), direction=direction)

    # 28-day stats for baseline (4 weekly averages)
    result_28d = await db.execute(
        select(
            func.count(Activity.id).label("ride_count"),
            func.coalesce(func.sum(Activity.tss), 0.0).label("total_tss"),
            func.coalesce(func.sum(Activity.distance_meters), 0.0).label("total_distance"),
            func.coalesce(func.sum(Activity.duration_seconds), 0).label("total_time"),
            func.coalesce(func.sum(Activity.elevation_gain_meters), 0.0).label("total_elevation"),
        )
        .where(
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
        select(Activity.normalized_power, Activity.average_power)
        .where(
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
    vi_rows_28d = [r for r in ride_rows_28d if r.normalized_power and r.average_power and r.average_power > 0]
    if vi_rows_28d:
        baseline_vi = sum(r.normalized_power / r.average_power for r in vi_rows_28d) / len(vi_rows_28d)

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
        distance_trend=_trend(round(_nan0(row.total_distance) / 1000, 1), baseline_distance),
        time_trend=_trend(round(_nan0_int(row.total_time) / 3600, 1), baseline_time),
        elevation_trend=_trend(round(_nan0(row.total_elevation), 0), baseline_elevation),
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
    best_power = await compute_power_curve_from_streams(db, current_user.id, days=3650)  # ~10 years
    profile = await get_or_create_cycling_profile(db, current_user.id)

    pbs = []
    for duration_sec, label in POWER_DURATION_BUCKETS:
        power = best_power.get(duration_sec)
        pbs.append({
            "duration_label": label,
            "duration_seconds": duration_sec,
            "best_power_watts": power,
            "pct_ftp": round(power / profile.ftp_watts * 100, 1) if power and profile.ftp_watts else None,
        })

    return {
        "pbs": pbs,
        "ftp_watts": profile.ftp_watts,
        "weight_kg": profile.weight_kg,
    }


# ── Recalculate TSS ─────────────────────────────────────────────────────────


@router.post("/recalculate-tss")
async def recalculate_tss(
    days: int = Query(365, ge=1, le=3650),
    force: bool = Query(False, description="If true, recalculate all activities even if TSS is already set"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Recalculate TSS for cycling activities.

    Uses FTP from the user's cycling profile.
    By default only updates activities with missing TSS.
    Pass force=true to recalculate all activities (e.g. after FTP change).
    """
    profile = await get_or_create_cycling_profile(db, current_user.id)
    if not profile.ftp_watts:
        raise HTTPException(status_code=400, detail="FTP not set. Set your FTP first.")

    cutoff = date.today() - timedelta(days=days)
    conditions = [
        Activity.user_id == current_user.id,
        Activity.sport_type == "cycling",
        Activity.average_power.isnot(None),
        Activity.start_date >= cutoff,
    ]
    if not force:
        conditions.append(Activity.tss.is_(None))

    result = await db.execute(select(Activity).where(*conditions))
    activities = list(result.scalars().all())

    # Also backfill normalized_power from stream data for activities missing it
    activity_ids = [a.id for a in activities if not a.normalized_power]
    np_map: dict = {}
    if activity_ids:
        from app.models.activity import ActivityStream
        np_result = await db.execute(
            select(ActivityStream)
            .where(
                ActivityStream.activity_id.in_(activity_ids),
                ActivityStream.stream_type == "watts",
            )
        )
        for stream in np_result.scalars().all():
            data = stream.data.get("data", []) if isinstance(stream.data, dict) else []
            if data:
                np_val = compute_normalized_power(data)
                if np_val:
                    np_map[stream.activity_id] = np_val

    updated = 0
    for activity in activities:
        # Backfill normalized_power from stream data
        if not activity.normalized_power and activity.id in np_map:
            activity.normalized_power = np_map[activity.id]

        # Clear existing TSS if forcing recalculation
        if force:
            activity.tss = None
        tss = await auto_compute_tss_for_activity(db, activity, profile.ftp_watts)
        if tss is not None:
            updated += 1

    await db.flush()
    return {"updated": updated, "total_checked": len(activities)}


# ── FTP Estimation ───────────────────────────────────────────────────────────


@router.post("/estimate-ftp", response_model=FtpEstimateResponse)
async def estimate_ftp(
    days: int = Query(90, ge=30, le=365),
    accept: bool = Query(False, description="If true, automatically save the estimate as the user's FTP"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Estimate FTP from best power data and optionally save it.

    Uses a weighted multi-method approach:
    - 20-min × 0.95 (gold standard, confidence 1.0)
    - 30-min × 0.95, 8-min × 0.855, 10-min × 0.92 (well-established)
    - 5-min × 0.95 (rough estimate)
    - Riegel extrapolation from shorter efforts (lower confidence)
    """
    best_power = await compute_power_curve_from_streams(db, current_user.id, days)
    if not best_power:
        raise HTTPException(
            status_code=400,
            detail="No power stream data available. Sync activities with power data from Strava first.",
        )

    detailed = estimate_ftp_from_power_curve_detailed(best_power)
    if not detailed:
        raise HTTPException(
            status_code=400,
            detail="Insufficient data for FTP estimation. Need at least a 5-min all-out effort with power data.",
        )

    # Human-readable source method
    source_method = f"{detailed.method}: {detailed.source_duration}s power → FTP (confidence: {detailed.confidence:.0%})"

    result = FtpEstimateResponse(
        estimated_ftp=detailed.ftp,
        confidence=detailed.confidence,
        method=detailed.method,
        source_duration=detailed.source_duration,
        all_estimates=[FtpEstimateDetail(**e) for e in detailed.all_estimates],
        source_method=source_method,
        best_power_available={
            "5s": best_power.get(5),
            "1min": best_power.get(60),
            "5min": best_power.get(300),
            "8min": best_power.get(480),
            "10min": best_power.get(600),
            "20min": best_power.get(1200),
            "30min": best_power.get(1800),
            "60min": best_power.get(3600),
        },
        days_analyzed=days,
        accepted=False,
    )

    if accept:
        profile = await get_or_create_cycling_profile(db, current_user.id)
        old_ftp = profile.ftp_watts
        profile.ftp_watts = detailed.ftp

        # Record in FTP history
        ftp_entry = FtpHistory(
            user_id=current_user.id,
            ftp_watts=detailed.ftp,
            effective_date=date.today(),
            source="estimated",
            notes=f"Auto-estimated: {source_method}",
        )
        db.add(ftp_entry)
        await db.flush()
        await db.refresh(profile)
        result.accepted = True
        result.previous_ftp = old_ftp

    return result


# ── Backfill Streams ─────────────────────────────────────────────────────────


@router.post("/backfill-streams")
async def backfill_streams(
    days: int = Query(90, ge=7, le=365),
    limit: int = Query(20, ge=1, le=100),
    force: bool = Query(False, description="Delete existing streams and re-fetch at high resolution"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Fetch power streams for existing cycling activities that are missing them.

    This is useful for backfilling stream data for activities that were synced
    before the stream-fetching feature was added.
    Use force=true to delete existing low-res streams and re-fetch at high resolution.
    """
    from app.integrations.strava_client import strava_client
    from app.models.activity import ActivityStream
    from app.services.strava import get_strava_connection, refresh_if_needed

    cutoff = date.today() - timedelta(days=days)

    # Find cycling activities with average_power
    result = await db.execute(
        select(Activity.id, Activity.provider_activity_id)
        .where(
            Activity.user_id == current_user.id,
            Activity.sport_type == "cycling",
            Activity.source == "strava",
            Activity.average_power.isnot(None),
            Activity.start_date >= cutoff,
            Activity.provider_activity_id.isnot(None),
        )
        .order_by(Activity.start_date.desc())
        .limit(limit * 3)  # fetch extra to filter
    )
    all_activities = result.all()

    activity_ids = [row[0] for row in all_activities]
    if not activity_ids:
        return {"backfilled": 0, "total_checked": 0, "message": "No cycling activities with power data found."}

    if force:
        # Force mode: re-fetch all activities (delete old streams per-activity after success)
        need_streams = [(row[0], row[1]) for row in all_activities][:limit]
    else:
        # Filter to those without watts stream
        result = await db.execute(
            select(ActivityStream.activity_id)
            .where(
                ActivityStream.activity_id.in_(activity_ids),
                ActivityStream.stream_type == "watts",
            )
        )
        already_have_streams = set(result.scalars().all())

        need_streams = [
            (row[0], row[1]) for row in all_activities
            if row[0] not in already_have_streams
        ][:limit]

        if not need_streams:
            return {"backfilled": 0, "total_checked": len(all_activities), "message": "All activities already have stream data."}

    # Get Strava connection
    connection = await get_strava_connection(db, current_user.id)
    if not connection:
        raise HTTPException(status_code=400, detail="No Strava connection found.")
    connection = await refresh_if_needed(db, connection)

    backfilled = 0
    for activity_id, provider_id in need_streams:
        try:
            streams = await strava_client.get_activity_streams(
                connection.access_token, int(provider_id)
            )
            if not streams:
                continue
            # In force mode, delete old streams for this activity before inserting new ones
            if force:
                await db.execute(
                    ActivityStream.__table__.delete().where(
                        ActivityStream.activity_id == activity_id
                    )
                )
            for stream_type, stream_data in streams.items():
                if "data" in stream_data:
                    # Strava may return resolution as "high"/"low" strings — convert to int or None
                    raw_res = stream_data.get("resolution")
                    resolution = None
                    if isinstance(raw_res, int):
                        resolution = raw_res
                    elif isinstance(raw_res, str) and raw_res.isdigit():
                        resolution = int(raw_res)

                    stream = ActivityStream(
                        activity_id=activity_id,
                        stream_type=stream_type,
                        data={"data": stream_data["data"]},
                        resolution=resolution,
                    )
                    db.add(stream)
            backfilled += 1
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Stream backfill failed for activity {provider_id}: {e}")
            continue  # Skip activities that fail

    await db.flush()

    return {
        "backfilled": backfilled,
        "total_checked": len(all_activities),
        "remaining": len(need_streams) - backfilled,
    }


# ── Backfill FTP History ────────────────────────────────────────────────────


@router.post("/backfill-ftp-history")
async def backfill_ftp_history_endpoint(
    months: int = Query(12, ge=3, le=24, description="Number of months to backfill"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Estimate FTP for historical monthly periods and create FTP history entries.

    Goes back `months` months, computes the best power curve for each 90-day
    window, estimates FTP, and creates FtpHistory entries with source="estimated".
    Skips months that already have an FTP history entry.
    """
    entries = await backfill_ftp_estimates(db, current_user.id, months=months)

    # Update the user's cycling profile FTP if we created entries and current
    # profile doesn't have an FTP set (or use the latest backfilled value)
    if entries:
        profile = await get_or_create_cycling_profile(db, current_user.id)
        latest = max(entries, key=lambda e: e["effective_date"])
        if not profile.ftp_watts:
            profile.ftp_watts = latest["ftp_watts"]
            await db.flush()

    return {
        "created": len(entries),
        "entries": entries,
        "months_analyzed": months,
    }


# ── VO2max Estimation ──────────────────────────────────────────────────────


@router.get("/vo2max", response_model=Vo2maxResponse)
async def get_vo2max_estimate(
    days: int = Query(90, ge=7, le=365, description="Lookback period in days"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Estimate VO2max from power and HR data.

    Uses ACSM power-based formula (best 5-min power) and Uth HR-based formula.
    Returns the highest estimate with classification.
    """
    result = await estimate_vo2max(db, current_user.id, days)
    if not result:
        raise HTTPException(status_code=404, detail="Insufficient data to estimate VO2max. Need cycling activities with power streams or heart rate data.")

    return Vo2maxResponse(
        vo2max=result.vo2max,
        confidence=result.confidence,
        method=result.method,
        classification=_classify_vo2max(result.vo2max),
        all_estimates=[Vo2maxDetail(**e) for e in result.all_estimates],
    )


@router.get("/vo2max-history", response_model=Vo2maxHistoryResponse)
async def get_vo2max_history(
    months: int = Query(12, ge=3, le=24, description="Number of months to analyze"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get VO2max trend over time from monthly power data snapshots."""
    history = await compute_vo2max_history(db, current_user.id, months=months)

    data = [Vo2maxHistoryPoint(date=h["date"], vo2max=h["vo2max"], method=h["method"]) for h in history]

    current_vo2max = data[-1].vo2max if data else None
    current_classification = _classify_vo2max(current_vo2max) if current_vo2max else None

    return Vo2maxHistoryResponse(
        data=data,
        current_vo2max=current_vo2max,
        current_classification=current_classification,
    )


# ── Decoupling Analysis ────────────────────────────────────────────────────


@router.get("/decoupling", response_model=DecouplingHistoryResponse)
async def get_decoupling_history(
    days: int = Query(90, ge=7, le=365, description="Lookback period in days"),
    min_duration: int = Query(60, ge=20, le=600, description="Minimum ride duration in minutes"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get HR vs power decoupling trend for recent long rides.

    Decoupling measures aerobic fitness — how much power:HR ratio declines
    in the second half of a ride. <5% = excellent, 5-8% = acceptable, >8% = aerobic deficiency.
    """
    history = await compute_decoupling_history(db, current_user.id, days=days, min_duration_minutes=min_duration)

    data = [
        DecouplingActivityPoint(
            date=h["date"].date() if hasattr(h["date"], "date") else h["date"],
            activity_id=h["activity_id"],
            decoupling_pct=h["decoupling_pct"],
            first_half_ratio=h["first_half_ratio"],
            second_half_ratio=h["second_half_ratio"],
            classification=h["classification"],
            duration_seconds=h["duration_seconds"],
        )
        for h in history
    ]

    avg_pct = None
    classification = None
    if data:
        avg_pct = round(sum(d.decoupling_pct for d in data) / len(data), 1)
        from app.services.cycling import _classify_decoupling
        classification = _classify_decoupling(avg_pct)

    return DecouplingHistoryResponse(
        data=data,
        avg_decoupling_pct=avg_pct,
        classification=classification,
    )


@router.get("/decoupling/{activity_id}", response_model=DecouplingSingleResponse)
async def get_decoupling_for_activity(
    activity_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get decoupling analysis for a specific activity."""
    import uuid as uuid_mod
    try:
        act_uuid = uuid_mod.UUID(activity_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid activity ID")

    result = await compute_decoupling_for_activity(db, act_uuid)
    if not result:
        raise HTTPException(status_code=404, detail="No power and heart rate stream data available for this activity")

    return DecouplingSingleResponse(
        decoupling_pct=result.decoupling_pct,
        first_half_ratio=result.first_half_ratio,
        second_half_ratio=result.second_half_ratio,
        classification=result.classification,
        duration_seconds=result.duration_seconds,
        activity_id=str(result.activity_id) if result.activity_id else None,
    )
