"""Workout Planner service — zone computation, target derivation, route matching.

Pure computation layer. All functions take primitive inputs and return dicts/dataclasses.
"""

import math
import uuid
from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.route import Route

# ── Zone Definitions ──────────────────────────────────────────────────────────

# Each zone: (id, name, if_low, if_high, lthr_pct_low, lthr_pct_high)
WORKOUT_ZONES = [
    ("z1", "Very Easy", 0.00, 0.55, 0.00, 0.80),
    ("z2", "Easy", 0.55, 0.75, 0.80, 0.89),
    ("z3", "Moderate", 0.75, 0.90, 0.89, 0.95),
    ("z4", "Hard", 0.90, 1.05, 0.95, 1.05),
    ("z5", "Very Hard", 1.05, 1.20, 1.05, 1.20),
]

# TSS per hour at midpoint IF: TSS/hr = IF_mid^2 * 100
# Used for display only; actual TSS is duration-dependent.

# Zone color palette for frontend
ZONE_COLORS = {
    "z1": "#22c55e",  # green
    "z2": "#3b82f6",  # blue
    "z3": "#eab308",  # yellow
    "z4": "#f97316",  # orange
    "z5": "#ef4444",  # red
}


@dataclass
class WorkoutZone:
    zone: str
    name: str
    color: str
    if_low: float
    if_high: float
    power_low: float
    power_high: float
    hr_low: int
    hr_high: int
    tss_per_hour_low: float
    tss_per_hour_high: float


@dataclass
class ReadinessInfo:
    current_ctl: float
    current_atl: float
    current_tsb: float
    recommended_max_zone: str  # zone id like "z3"
    readiness_note: str
    is_fatigued: bool


@dataclass
class WorkoutZonesResult:
    zones: list[WorkoutZone]
    readiness: ReadinessInfo
    ftp_watts: float | None
    lthr: float | None


# ── Zone Computation ──────────────────────────────────────────────────────────


def compute_workout_zones(
    ftp: float | None,
    lthr: float | None,
    ctl: float = 0.0,
    atl: float = 0.0,
    tsb: float = 0.0,
) -> WorkoutZonesResult:
    """Compute all workout zones from current FTP and LTHR.

    Returns zone definitions with power/HR/TSS ranges, plus a readiness
    recommendation based on current CTL/TSB.
    """
    zones = []
    for zone_id, name, if_low, if_high, lthr_pct_low, lthr_pct_high in WORKOUT_ZONES:
        power_low = round(ftp * if_low) if ftp and ftp > 0 else 0
        power_high = round(ftp * if_high) if ftp and ftp > 0 else 0

        hr_low = round(lthr * lthr_pct_low) if lthr and lthr > 0 else 0
        hr_high = round(lthr * lthr_pct_high) if lthr and lthr > 0 else 0

        # TSS/hr = IF^2 * 100 (for a 1-hour ride)
        tss_low = round(if_low**2 * 100, 1)
        tss_high = round(if_high**2 * 100, 1)

        zones.append(
            WorkoutZone(
                zone=zone_id,
                name=name,
                color=ZONE_COLORS.get(zone_id, "#888888"),
                if_low=if_low,
                if_high=if_high,
                power_low=power_low,
                power_high=power_high,
                hr_low=hr_low,
                hr_high=hr_high,
                tss_per_hour_low=tss_low,
                tss_per_hour_high=tss_high,
            )
        )

    readiness = get_readiness_recommendation(ctl, atl, tsb)

    return WorkoutZonesResult(
        zones=zones,
        readiness=readiness,
        ftp_watts=ftp,
        lthr=lthr,
    )


def get_readiness_recommendation(
    ctl: float,
    atl: float,
    tsb: float,
) -> ReadinessInfo:
    """Determine recommended max workout zone based on training stress balance.

    TSB = CTL - ATL
    - Very fresh (TSB > 25): All zones, consider hard sessions
    - Fresh (5 to 25): All zones available
    - Neutral (-10 to 5): Moderate and below recommended
    - Fatigued (-30 to -10): Easy and below, avoid Z5
    - Very fatigued (< -30): Recovery only
    """
    if tsb > 25:
        return ReadinessInfo(
            current_ctl=round(ctl, 1),
            current_atl=round(atl, 1),
            current_tsb=round(tsb, 1),
            recommended_max_zone="z5",
            readiness_note="Very fresh — great time for a hard session!",
            is_fatigued=False,
        )
    elif tsb > 5:
        return ReadinessInfo(
            current_ctl=round(ctl, 1),
            current_atl=round(atl, 1),
            current_tsb=round(tsb, 1),
            recommended_max_zone="z5",
            readiness_note="Fresh — all intensity levels available.",
            is_fatigued=False,
        )
    elif tsb > -10:
        return ReadinessInfo(
            current_ctl=round(ctl, 1),
            current_atl=round(atl, 1),
            current_tsb=round(tsb, 1),
            recommended_max_zone="z3",
            readiness_note="Neutral — moderate intensity recommended. Hard efforts OK if well-recovered.",
            is_fatigued=False,
        )
    elif tsb > -30:
        return ReadinessInfo(
            current_ctl=round(ctl, 1),
            current_atl=round(atl, 1),
            current_tsb=round(tsb, 1),
            recommended_max_zone="z2",
            readiness_note="Fatigued — stick to easy endurance rides. Avoid threshold and above.",
            is_fatigued=True,
        )
    else:
        return ReadinessInfo(
            current_ctl=round(ctl, 1),
            current_atl=round(atl, 1),
            current_tsb=round(tsb, 1),
            recommended_max_zone="z1",
            readiness_note="Very fatigued — active recovery only. Consider a rest day.",
            is_fatigued=True,
        )


# ── Workout Target Planning ──────────────────────────────────────────────────


@dataclass
class WorkoutTargets:
    difficulty: str
    zone_id: str
    zone_name: str
    duration_minutes: int
    target_power_low: int
    target_power_high: int
    target_if_low: float
    target_if_high: float
    target_hr_low: int
    target_hr_high: int
    target_tss_low: float
    target_tss_high: float
    estimated_calories_low: int
    estimated_calories_high: int


def plan_workout(
    ftp: float | None,
    lthr: float | None,
    weight_kg: float | None,
    difficulty: str,
    duration_minutes: int,
) -> WorkoutTargets | None:
    """Compute concrete workout targets for a given difficulty and duration.

    Returns None if FTP is not set (can't compute meaningful targets).
    """
    if not ftp or ftp <= 0:
        return None

    # Find matching zone
    zone_def = None
    for zid, name, if_low, if_high, _, _ in WORKOUT_ZONES:
        if zid == difficulty:
            zone_def = (zid, name, if_low, if_high)
            break

    if not zone_def:
        return None

    zone_id, zone_name, if_low, if_high = zone_def

    # Power targets
    power_low = round(ftp * if_low)
    power_high = round(ftp * if_high)

    # HR targets
    lthr_pct_low = next(z[4] for z in WORKOUT_ZONES if z[0] == difficulty)
    lthr_pct_high = next(z[5] for z in WORKOUT_ZONES if z[0] == difficulty)
    hr_low = round(lthr * lthr_pct_low) if lthr and lthr > 0 else 0
    hr_high = round(lthr * lthr_pct_high) if lthr and lthr > 0 else 0

    # TSS targets: TSS = (duration_s * NP * IF) / (FTP * 3600) * 100
    # Simplified: TSS = duration_hours * IF^2 * 100
    duration_hours = duration_minutes / 60
    tss_low = round(duration_hours * if_low**2 * 100, 1)
    tss_high = round(duration_hours * if_high**2 * 100, 1)

    # Calorie estimation: ~3.6 * watts * hours (mechanical) / 0.25 (human efficiency)
    # Simplified: ~4 * watts * hours * 60 (kJ to kcal approximation)
    cal_factor = 4.0  # kJ to kcal rough multiplier (accounts for ~25% efficiency)
    cal_low = round(power_low * duration_hours * cal_factor)
    cal_high = round(power_high * duration_hours * cal_factor)

    return WorkoutTargets(
        difficulty=difficulty,
        zone_id=zone_id,
        zone_name=zone_name,
        duration_minutes=duration_minutes,
        target_power_low=power_low,
        target_power_high=power_high,
        target_if_low=round(if_low, 2),
        target_if_high=round(if_high, 2),
        target_hr_low=hr_low,
        target_hr_high=hr_high,
        target_tss_low=tss_low,
        target_tss_high=tss_high,
        estimated_calories_low=cal_low,
        estimated_calories_high=cal_high,
    )


# ── Route TSS Estimation (for unridden routes) ──────────────────────────────


def estimate_route_tss(
    distance_m: float,
    elevation_m: float | None,
    duration_s: int | None,
    ftp: float,
) -> float:
    """Estimate TSS for an unridden route from geometry data.

    Uses a baseline IF of 0.70 (moderate endurance) adjusted for elevation.
    Higher elevation → slightly higher effort estimate.
    """
    if not ftp or ftp <= 0 or not distance_m or distance_m <= 0:
        return 0.0

    # Estimate duration if not provided: assume 25 km/h average
    if not duration_s or duration_s <= 0:
        speed_mps = 25 * 1000 / 3600  # 25 km/h in m/s
        duration_s = int(distance_m / speed_mps)

    # Baseline IF for a typical ride
    base_if = 0.70

    # Adjust for elevation: +0.02 IF per 500m elevation per 50km
    if elevation_m and elevation_m > 0:
        distance_km = distance_m / 1000
        elevation_factor = (elevation_m / 500) * (50 / max(distance_km, 1))
        base_if += min(0.15, elevation_factor * 0.02)  # cap adjustment at +0.15

    base_if = min(base_if, 1.2)  # cap at very hard

    # TSS = duration_hours * IF^2 * 100
    duration_hours = duration_s / 3600
    tss = duration_hours * base_if**2 * 100

    return round(tss, 1)


# ── Route Matching ────────────────────────────────────────────────────────────


@dataclass
class RouteMatch:
    route_id: uuid.UUID
    route_name: str
    distance_meters: float
    elevation_gain_meters: float | None
    is_loop: bool
    match_score: float  # 0.0 - 1.0
    avg_tss: float | None
    avg_power: float | None
    avg_hr: float | None
    avg_duration_min: float | None
    ride_count: int
    is_estimated: bool  # True for unridden routes
    confidence: float  # 0.0 - 1.0


@dataclass
class RouteMatchResult:
    matches: list[RouteMatch]


async def find_matching_routes(
    db: AsyncSession,
    user_id: uuid.UUID,
    ftp: float | None,
    difficulty: str,
    duration_minutes: int | None,
    target_tss_low: float,
    target_tss_high: float,
    target_power_low: int,
    target_power_high: int,
    target_hr_low: int,
    target_hr_high: int,
    max_results: int = 10,
) -> RouteMatchResult:
    """Find routes that best match the planned workout targets.

    Two paths:
    1. Ridden routes: Use actual historical activity stats
    2. Unridden routes: Estimate TSS from route geometry
    """
    matches: list[RouteMatch] = []

    # ── 1. Ridden routes ──────────────────────────────────────────────────
    # Get routes with activity stats
    activity_stats = await db.execute(
        select(
            Activity.route_id,
            func.count(Activity.id).label("ride_count"),
            func.avg(Activity.tss).label("avg_tss"),
            func.avg(Activity.average_power).label("avg_power"),
            func.avg(Activity.average_heartrate).label("avg_hr"),
            func.avg(Activity.duration_seconds).label("avg_duration"),
        )
        .where(
            Activity.user_id == user_id,
            Activity.route_id.isnot(None),
            Activity.sport_type == "cycling",
        )
        .group_by(Activity.route_id)
    )
    stats_rows = activity_stats.all()

    # Get route details for ridden routes
    ridden_route_ids = [row.route_id for row in stats_rows if row.route_id]
    ridden_routes: dict[uuid.UUID, Route] = {}
    if ridden_route_ids:
        route_result = await db.execute(
            select(Route).where(
                Route.id.in_(ridden_route_ids),
                Route.user_id == user_id,
            )
        )
        ridden_routes = {r.id: r for r in route_result.scalars().all()}

    target_tss_mid = (target_tss_low + target_tss_high) / 2
    target_power_mid = (target_power_low + target_power_high) / 2
    target_hr_mid = (target_hr_low + target_hr_high) / 2 if target_hr_high > 0 else 0

    for row in stats_rows:
        if not row.route_id or row.route_id not in ridden_routes:
            continue

        route = ridden_routes[row.route_id]
        avg_tss = float(row.avg_tss) if row.avg_tss else None
        avg_power = float(row.avg_power) if row.avg_power else None
        avg_hr = float(row.avg_hr) if row.avg_hr else None
        avg_duration_s = float(row.avg_duration) if row.avg_duration else None
        avg_duration_min = round(avg_duration_s / 60, 1) if avg_duration_s else None

        score = _compute_route_match_score(
            avg_tss=avg_tss,
            avg_power=avg_power,
            avg_hr=avg_hr,
            avg_duration_min=avg_duration_min,
            target_tss_mid=target_tss_mid,
            target_power_mid=target_power_mid,
            target_hr_mid=target_hr_mid,
            target_duration_min=duration_minutes,
        )

        matches.append(
            RouteMatch(
                route_id=route.id,
                route_name=route.name,
                distance_meters=route.distance_meters,
                elevation_gain_meters=route.elevation_gain_meters,
                is_loop=route.is_loop,
                match_score=round(score, 3),
                avg_tss=round(avg_tss, 1) if avg_tss else None,
                avg_power=round(avg_power, 1) if avg_power else None,
                avg_hr=round(avg_hr, 1) if avg_hr else None,
                avg_duration_min=avg_duration_min,
                ride_count=int(row.ride_count),
                is_estimated=False,
                confidence=min(
                    1.0, int(row.ride_count) / 5
                ),  # full confidence at 5+ rides
            )
        )

    # ── 2. Unridden routes ────────────────────────────────────────────────
    if ftp and ftp > 0:
        # Get unridden route IDs
        ridden_ids_set = set(ridden_route_ids)
        unridden_result = await db.execute(
            select(Route).where(
                Route.user_id == user_id,
                Route.sport_type == "cycling",
            )
        )
        all_routes = unridden_result.scalars().all()

        for route in all_routes:
            if route.id in ridden_ids_set:
                continue

            # Estimate TSS from route geometry
            est_tss = estimate_route_tss(
                distance_m=route.distance_meters,
                elevation_m=route.elevation_gain_meters,
                duration_s=route.estimated_time_seconds,
                ftp=ftp,
            )

            # Estimate duration
            if route.estimated_time_seconds:
                est_duration_min = round(route.estimated_time_seconds / 60, 1)
            else:
                speed_mps = 25 * 1000 / 3600
                est_duration_min = round((route.distance_meters / speed_mps) / 60, 1)

            # Estimate power from TSS: TSS = hours * IF^2 * 100
            # IF = sqrt(TSS / (hours * 100))
            # Power = IF * FTP
            est_hours = est_duration_min / 60 if est_duration_min > 0 else 1
            if est_tss > 0 and est_hours > 0:
                est_if = math.sqrt(est_tss / (est_hours * 100))
                est_power = round(est_if * ftp, 1)
            else:
                est_power = None

            # No HR data for unridden routes
            est_hr = None

            score = _compute_route_match_score(
                avg_tss=est_tss,
                avg_power=est_power,
                avg_hr=est_hr,
                avg_duration_min=est_duration_min,
                target_tss_mid=target_tss_mid,
                target_power_mid=target_power_mid,
                target_hr_mid=target_hr_mid,
                target_duration_min=duration_minutes,
            )

            matches.append(
                RouteMatch(
                    route_id=route.id,
                    route_name=route.name,
                    distance_meters=route.distance_meters,
                    elevation_gain_meters=route.elevation_gain_meters,
                    is_loop=route.is_loop,
                    match_score=round(score * 0.85, 3),  # penalize estimates by 15%
                    avg_tss=round(est_tss, 1) if est_tss else None,
                    avg_power=est_power,
                    avg_hr=None,
                    avg_duration_min=est_duration_min,
                    ride_count=0,
                    is_estimated=True,
                    confidence=0.3,  # low confidence for estimates
                )
            )

    # Sort by match score descending
    matches.sort(key=lambda m: m.match_score, reverse=True)

    return RouteMatchResult(matches=matches[:max_results])


def _compute_route_match_score(
    avg_tss: float | None,
    avg_power: float | None,
    avg_hr: float | None,
    avg_duration_min: float | None,
    target_tss_mid: float,
    target_power_mid: float,
    target_hr_mid: float,
    target_duration_min: int | None,
) -> float:
    """Score how well a route's historical stats match workout targets.

    Returns 0.0 - 1.0. Uses weighted proximity scoring.
    Weights: TSS 35%, duration 25%, power 25%, HR 15%.
    """
    score = 0.0
    total_weight = 0.0

    # TSS match (35%)
    if avg_tss is not None and target_tss_mid > 0:
        # Give some leniency: within 50% is still decent
        tss_score = max(0, 1 - abs(avg_tss - target_tss_mid) / target_tss_mid)
        score += tss_score * 0.35
        total_weight += 0.35

    # Duration match (25%)
    if avg_duration_min is not None and target_duration_min and target_duration_min > 0:
        dur_score = max(
            0, 1 - abs(avg_duration_min - target_duration_min) / target_duration_min
        )
        score += dur_score * 0.25
        total_weight += 0.25

    # Power match (25%)
    if avg_power is not None and target_power_mid > 0:
        power_score = max(0, 1 - abs(avg_power - target_power_mid) / target_power_mid)
        score += power_score * 0.25
        total_weight += 0.25

    # HR match (15%)
    if avg_hr is not None and target_hr_mid > 0:
        hr_score = max(0, 1 - abs(avg_hr - target_hr_mid) / target_hr_mid)
        score += hr_score * 0.15
        total_weight += 0.15

    # Normalize by actual weights used
    if total_weight > 0:
        return score / total_weight

    return 0.0
