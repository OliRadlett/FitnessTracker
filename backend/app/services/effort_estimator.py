"""Route effort estimation using a physics-based cycling power model.

Implements a simplified version of the Martin 2006 model for estimating
the mechanical power required to ride a given route at a target intensity.

Power components:
  P_total = P_aero + P_rolling + P_gravity + P_acceleration (ignored — steady state)

Inputs per route:
  - distance_meters (from polyline)
  - elevation_gain_meters (from elevation profile or model field)
  - surface_profile (affects rolling resistance)

Inputs per user:
  - ftp_watts (functional threshold power)
  - weight_kg (rider + bike mass)
"""

import logging

from app.models.route import Route

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

AIR_DENSITY = 1.225  # kg/m³ (sea level)
GRAVITY = 9.81  # m/s²

# Coefficient of rolling resistance × drivetrain loss by bike type
# (rolling resistance already includes bike + rider, but we'll layer surface)
_ROAD_CRRC = 0.004  # typical road tire on tarmac
_GRAVEL_CRRC = 0.006
_MTB_CRRC = 0.010

# Surface roughness multipliers (relative to road)
_SURFACE_ROUGHNESS = {
    "paved": 1.0,
    "compacted_gravel": 1.5,
    "gravel": 2.0,
    "dirt": 3.0,
    "grass": 4.0,
    "singletrack": 5.0,
    "trail": 4.5,
    "cobblestone": 3.5,
    "sand": 8.0,
}

# Drag area (CdA) by riding position, m²
_CDA = {
    "road": 0.32,  # drops
    "gravel": 0.35,  # more upright
    "mtb": 0.40,  # most upright
}

# Power distribution constants for TSS-like calculation
_TSS_KJ_PER_KG_PER_KM_FACTOR = 0.25  # rough: TSS ≈ 0.25 * kcal/kg/km


# ── Zone mappings ─�─────────────────────────────────────────────────────────────

INTENSITY_ZONES = {
    "endurance": {
        "name": "Endurance (Z2)",
        "factor": 0.55,  # 55% of FTP
        "description": "Comfortable pace, builds aerobic base.",
    },
    "tempo": {
        "name": "Tempo (Z3)",
        "factor": 0.75,
        "description": "Moderately hard, sustainable for 20-40 min.",
    },
    "threshold": {
        "name": "Threshold (Z4)",
        "factor": 0.975,
        "description": "Comfortably hard, sustainable for ~40 min at lactate threshold.",
    },
    "vo2max": {
        "name": "VO2 Max (Z5)",
        "factor": 1.05,
        "description": "Cannot sustain for more than ~8 min.",
    },
    "anaerobic": {
        "name": "Anaerobic (Z6)",
        "factor": 1.20,
        "description": "Maximum 5-minute effort.",
    },
}


def _get_effective_crr(route: Route, bike_type: str) -> float:
    """Compute the effective coefficient of rolling resistance.

    Uses bike-type baseline adjusted by the route's surface profile.
    """
    bike_crrc = {
        "road": _ROAD_CRRC,
        "gravel": _GRAVEL_CRRC,
        "mtb": _MTB_CRRC,
    }.get(bike_type, _ROAD_CRRC)

    if not route.surface_profile:
        return bike_crrc

    total = sum(route.surface_profile.values())
    if total <= 0:
        return bike_crrc

    # Weighted average roughness multiplier
    weighted_mult = 0.0
    for surface, fraction in route.surface_profile.items():
        roughness = _SURFACE_ROUGHNESS.get(surface, 2.0)
        weighted_mult += (fraction / total) * roughness

    return bike_crrc * max(weighted_mult, 1.0)


def estimate_required_power(
    route: Route,
    ftp_watts: float,
    weight_kg: float,
    bike_type: str = "road",
) -> dict:
    """Estimate the average power required to ride this route at a given pace.

    Uses the simplified Martin model with aero, rolling, and gravity components.

    Returns dict with:
      - power_watts: estimated average power
      - speed_kmh: estimated speed on the route
      - wpk: power-to-weight ratio
      - ftp_pct: percentage of FTP required
    """
    distance = route.distance_meters
    if distance <= 0:
        return {"power_watts": 0, "speed_kmh": 0, "wpk": 0, "ftp_pct": 0}

    elevation_gain = route.elevation_gain_meters or 0.0
    total_mass = weight_kg + 8.0  # rider + bike (kg)
    cda = _CDA.get(bike_type, _CDA["road"])
    effective_crr = _get_effective_crr(route, bike_type)
    grade = elevation_gain / distance if distance > 0 else 0.0

    # We solve iteratively for speed: given a power, compute speed, then
    # given speed, check if power matches. Start with a guess based on grade.
    # Power = (P_aero + P_rolling + P_gravity)
    # P_aero = 0.5 * rho * CdA * v³
    # P_rolling = Crr * m * g * v
    # P_gravity = m * g * grade * v
    #
    # At FTP, solve for v:
    # P = 0.5 * rho * CdA * v³ + (Crr * m * g + m * g * grade) * v
    # This is a cubic in v: 0.5*rho*CdA*v³ + (Crr*m*g + m*g*grade)*v - P = 0

    # For the estimate, we'll iterate: assume FTP is sustainable, find the speed
    available_power = ftp_watts  # speed at FTP is the reference for all zones
    # Use the target intensity factor if provided by caller context

    a = 0.5 * AIR_DENSITY * cda
    b = effective_crr * total_mass * GRAVITY + total_mass * GRAVITY * grade

    # Solve: a*v³ + b*v = available_power
    # Simple iterative solution
    v = 5.0  # initial guess m/s (~18 km/h)
    for _ in range(20):
        power = a * v**3 + b * v
        if abs(power - available_power) < 0.1:
            break
        # Newton-Raphson step
        deriv = 3 * a * v**2 + b
        if deriv > 0:
            v -= (power - available_power) / deriv
        v = max(v, 1.0)  # at least 1 m/s

    speed_kmh = v * 3.6
    power_watts = available_power  # this is the sustained FTP% power
    wpk = power_watts / weight_kg
    ftp_pct = (power_watts / ftp_watts) * 100 if ftp_watts > 0 else 0

    return {
        "power_watts": round(power_watts, 1),
        "speed_kmh": round(speed_kmh, 1),
        "wpk": round(wpk, 2),
        "ftp_pct": round(ftp_pct, 1),
    }


def estimate_effort(
    route: Route,
    ftp_watts: float,
    weight_kg: float,
    bike_type: str = "road",
    target_intensity: str = "threshold",
) -> dict:
    """Full effort estimate for a route at a target intensity.

    Returns:
        {
            "estimated_time_seconds": int,
            "estimated_tss": float,
            "intensity_factor": float,
            "normalized_power": float,
            "estimated_kcal": float,
            "zone_name": str,
            "description": str,
        }
    """
    zone = INTENSITY_ZONES.get(target_intensity, INTENSITY_ZONES["threshold"])
    intensity_factor = zone["factor"]

    # Get speed at threshold
    power_info = estimate_required_power(route, ftp_watts, weight_kg, bike_type)
    threshold_speed_ms = (
        power_info["speed_kmh"] / 3.6 if power_info["speed_kmh"] > 0 else 0
    )

    # At the target intensity, speed scales approximately linearly at lower
    # intensities but drops off at very high intensities due to aero drag.
    # For simplicity, scale speed by sqrt(intensity_factor) for sub-FTP efforts
    # and reduce for supra-threshold efforts.
    if intensity_factor <= 1.0:
        # Sub-FTP: speed scales roughly with sqrt of power ratio
        speed_ms = threshold_speed_ms * (intensity_factor**0.5)
    else:
        # Supra-FTP: speed gains diminish
        speed_ms = threshold_speed_ms * intensity_factor * (1 / intensity_factor**0.3)

    if speed_ms <= 0 or route.distance_meters <= 0:
        return {
            "estimated_time_seconds": 0,
            "estimated_tss": 0.0,
            "intensity_factor": intensity_factor,
            "normalized_power": 0.0,
            "estimated_kcal": 0.0,
            "zone_name": zone["name"],
            "description": zone["description"],
        }

    # Time = distance / speed
    estimated_time = route.distance_meters / speed_ms

    # Normalized Power (NP) — for a steady-state effort, NP ≈ average power
    # We approximate using the intensity factor
    target_power = ftp_watts * intensity_factor

    # TSS = (duration_seconds × NP × IF) / (FTP × 3600) × 100
    # Simplified: TSS ≈ (time_in_hours × NP × IF) / FTP × 100
    duration_hours = estimated_time / 3600.0
    tss = (
        duration_hours
        * target_power
        * intensity_factor
        / (ftp_watts * 3600 / 3600)
        * 100
    )
    tss = (duration_hours * target_power * intensity_factor / ftp_watts) * 100

    # Calories ≈ kJ × 1.1 (accounting for metabolic efficiency ~23%)
    # kJ = NP × duration_seconds / 1000
    kj = target_power * estimated_time / 1000
    kcal = kj * 1.1

    return {
        "estimated_time_seconds": int(round(estimated_time)),
        "estimated_tss": round(tss, 1),
        "intensity_factor": round(intensity_factor, 3),
        "normalized_power": round(target_power, 1),
        "estimated_kcal": round(kcal, 1),
        "zone_name": zone["name"],
        "description": zone["description"],
    }
