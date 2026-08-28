"""Route quality scoring — computes composite scores for each route.

Called nightly by Celery task `compute_route_quality_scores`.
Factors (weights sum to 1.0):
  - completeness_score  (30%): has elevation profile, surface profile, time estimate
  - popularity_score    (20%): ride count (log-scaled), last ridden recency
  - surface_quality     (25%): paved / packed surface fraction vs. technical
  - effort_match_score  (25%): estimated effort vs. user's FTP profile

The overall_score is a weighted average clamped to 0–100.
"""

import logging
import math
from datetime import UTC, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.cycling import CyclingProfile
from app.models.route import Route
from app.models.route_organize import RouteQuality

logger = logging.getLogger(__name__)

# ── Weighting ──────────────────────────────────────────────────────────────────

WEIGHTS = {
    "completeness": 0.30,
    "popularity": 0.20,
    "surface_quality": 0.25,
    "effort_match": 0.25,
}

# Surface types ranked from best (paved) to worst (technical)
_SURFACE_RANKINGS = {
    "paved": 1.0,
    "compacted_gravel": 0.85,
    "gravel": 0.70,
    "dirt": 0.50,
    "grass": 0.40,
    "singletrack": 0.35,
    "trail": 0.30,
    "cobblestone": 0.65,
    "sand": 0.10,
}


def compute_completeness_score(route: Route) -> float:
    """Score 0–100 based on presence of enriching data fields."""
    checks = []
    # Elevation profile present
    has_elevation = bool(route.elevation_profile)
    checks.append(has_elevation)

    # Surface profile present
    has_surface = bool(route.surface_profile)
    checks.append(has_surface)

    # Estimated time present
    has_time_estimate = route.estimated_time_seconds is not None
    checks.append(has_time_estimate)

    # Has multiple sources (more reliable)
    has_multiple_sources = len(route.sources) >= 2
    checks.append(has_multiple_sources)

    # At least 1km distance computed
    has_min_distance = route.distance_meters >= 1000
    checks.append(has_min_distance)

    return (sum(checks) / len(checks)) * 100.0


def compute_popularity_score(ride_count: int, last_ridden: datetime | None) -> float:
    """Score 0–100 based on ride frequency and recency.

    Uses log scaling so routes ridden 10× and 1000× don't dominate the scale.
    Recency bonus: ridden within 30 days → up to +10 points.
    """
    # Log-scaled ride count: log10(1) = 0 → 0, log10(1000+) ≈ 1 → 100
    if ride_count <= 0:
        base = 0.0
    else:
        raw = min(math.log10(ride_count + 1), 3.0) / 3.0  # 0 → 1
        base = raw * 90.0

    # Recency bonus (up to 10 additional points)
    recency_bonus = 0.0
    if last_ridden is not None:
        days_since = (datetime.now(UTC) - last_ridden).total_seconds() / 86400
        if days_since <= 7:
            recency_bonus = 10.0
        elif days_since <= 30:
            recency_bonus = 10.0 * (1 - (days_since - 7) / 23)

    return min(100.0, base + recency_bonus)


def compute_surface_quality_score(route: Route) -> float:
    """Score 0–100 based on surface composition.

    Paved/road surfaces score highest. Technical trails, sand score lowest.
    Falls back to 50 (neutral) if no surface data.
    """
    if not route.surface_profile:
        return 50.0

    total = sum(route.surface_profile.values())
    if total <= 0:
        return 50.0

    score = 0.0
    for surface, fraction in route.surface_profile.items():
        ranking = _SURFACE_RANKINGS.get(surface, 0.5)
        score += (fraction / total) * ranking

    return score * 100.0


def compute_effort_match_score(route: Route, cycling_profile: CyclingProfile) -> float:
    """Score 0–100 based on how well the route matches the user's capability.

    Uses distance + elevation to estimate a raw difficulty, then compares
    against the user's FTP and weight to determine if the route is
    "appropriately challenging" (not too easy, not beyond reach).

    Returns 50 (neutral) if insufficient data.
    """
    if not cycling_profile.ftp_watts or not cycling_profile.weight_kg:
        return 50.0

    if route.distance_meters <= 0:
        return 50.0

    ftp_watts = cycling_profile.ftp_watts
    weight_kg = cycling_profile.weight_kg

    # Estimate required average power using a simplified model:
    # P = a*kg + b*v + c*v³ + grade_resistance
    # Simplified: base power (watts/kg * weight) + rolling + elevation
    distance_km = route.distance_meters / 1000.0
    elevation_gain = route.elevation_gain_meters or 0.0

    # Estimate speed (km/h) — assume 20 km/h for flat, drops with elevation
    flat_speed = 20.0
    # Rough speed reduction from elevation (1 km/h per 200m of climbing)
    elevation_factor = elevation_gain / max(distance_km, 0.001)
    est_speed = max(flat_speed - elevation_factor / 200, 12.0)

    # Power estimate (watts) using a simplified model
    # P = 0.5 * CdA * rho * v³ + mass * g * (grade) * v + rolling_resistance
    # Simplified constants:
    cd_a = 0.4  # drag area (typical cycling position)
    rho = 1.225  # air density
    v_ms = est_speed / 3.6  # m/s
    mass_total = weight_kg + 8  # rider + bike
    g = 9.81
    grade = elevation_gain / max(route.distance_meters, 1)

    aero_power = 0.5 * cd_a * rho * (v_ms**3)
    rolling_power = 0.005 * mass_total * g * v_ms
    climbing_power = mass_total * g * grade * v_ms
    total_power = aero_power + rolling_power + climbing_power

    # Power-to-weight ratio in W/kg
    wpk = total_power / weight_kg

    # FTP in W/kg
    ftp_wpk = ftp_watts / weight_kg

    if ftp_wpk <= 0:
        return 50.0

    # Ratio: route difficulty vs user capability
    # 1.0 = exactly at FTP (threshold effort)
    # < 0.5 = too easy, > 1.5 = too hard
    ratio = wpk / ftp_wpk

    # Score: peaks at ratio=1.0 (threshold effort), drops off for too easy/hard
    # Use a bell curve centered at 1.0
    if ratio < 0.3:
        # Way too easy
        score = 30.0 + (ratio / 0.3) * 30.0  # 30 → 60
    elif ratio < 0.7:
        # Moderately easy
        score = 60.0 + ((ratio - 0.3) / 0.4) * 25.0  # 60 → 85
    elif ratio <= 1.3:
        # Ideal zone (threshold)
        score = 85.0 + (1.0 - abs(ratio - 1.0) / 0.3) * 15.0  # 70 → 100 → 85
    elif ratio < 1.8:
        # Challenging but doable
        score = 85.0 - ((ratio - 1.3) / 0.5) * 40.0  # 85 → 45
    else:
        # Probably too hard
        score = 20.0

    return max(0.0, min(100.0, score))


def compute_overall_score(scores: dict[str, float | None]) -> float | None:
    """Compute weighted overall score from component scores."""
    total_weight = 0.0
    weighted_sum = 0.0

    for key, weight in WEIGHTS.items():
        val = scores.get(key)
        if val is not None:
            weighted_sum += val * weight
            total_weight += weight

    if total_weight == 0:
        return None

    return round(weighted_sum / total_weight, 1)


async def compute_and_store_quality(
    db: AsyncSession,
    route: Route,
    user_id,
) -> float | None:
    """Compute all quality scores for a route and persist to RouteQuality."""
    # Fetch cycling profile for effort match
    profile_result = await db.execute(
        select(CyclingProfile).where(CyclingProfile.user_id == user_id)
    )
    profile = profile_result.scalar_one_or_none()

    # Get ride count and last ridden date
    stats_result = await db.execute(
        select(
            func.coalesce(func.count(Activity.id), 0),
            func.max(Activity.start_date),
        ).where(
            Activity.route_id == route.id,
            Activity.user_id == user_id,
        )
    )
    row = stats_result.one_or_none()
    ride_count = int(row[0]) if row else 0
    last_ridden = row[1] if row and row[1] else None

    # Compute component scores
    completeness = compute_completeness_score(route)
    popularity = compute_popularity_score(ride_count, last_ridden)
    surface_q = compute_surface_quality_score(route)

    effort_match = None
    if profile is not None:
        effort_match = compute_effort_match_score(route, profile)

    scores = {
        "completeness": completeness,
        "popularity": popularity,
        "surface_quality": surface_q,
        "effort_match": effort_match,
    }
    overall = compute_overall_score(scores)

    # Persist or update RouteQuality
    result = await db.execute(
        select(RouteQuality).where(RouteQuality.route_id == route.id)
    )
    existing = result.scalar_one_or_none()

    if existing:
        existing.completeness_score = completeness
        existing.popularity_score = popularity
        existing.surface_quality_score = surface_q
        existing.effort_match_score = effort_match
        existing.overall_score = overall
        existing.computed_at = datetime.now(UTC)
    else:
        quality = RouteQuality(
            route_id=route.id,
            user_id=user_id,
            completeness_score=completeness,
            popularity_score=popularity,
            surface_quality_score=surface_q,
            effort_match_score=effort_match,
            overall_score=overall,
        )
        db.add(quality)

    # Also update the denormalized quality_score on the Route for fast filtering
    route.quality_score = overall

    return overall
