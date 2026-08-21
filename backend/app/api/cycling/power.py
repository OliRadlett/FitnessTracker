"""Cycling API — Power curve, power zones, HR zones, power vs HR, metrics summary."""

import math
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.activity import Activity
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
