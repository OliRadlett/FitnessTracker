"""Velocity-based training (VBT) analytics.

With metric bar velocity (m/s, from ``bar_velocity_from_world``) and a known
load, each analysed set is a point on the lifter's **load–velocity line**.
That line does two useful things:

* predicts the load at a minimal velocity threshold (MVT) → an **estimated
  1RM** without a true max attempt, and
* its slope/intercept track the lifter's strength–velocity profile over time.

Pure functions only — no DB, no Modal — so they are cheap to unit test.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

# Mean concentric velocity at 1RM (m/s), by lift. General VBT practice
# (Squat ~0.30, Bench ~0.15, Deadlift ~0.15–0.20). Used to read 1RM off the
# load–velocity line: the load where the fitted velocity crosses the MVT.
MIN_VELOCITY_THRESHOLD: dict[str, float] = {
    "squat": 0.30,
    "front squat": 0.30,
    "back squat": 0.30,
    "bench press": 0.15,
    "deadlift": 0.15,
    "conventional deadlift": 0.15,
    "sumo deadlift": 0.15,
    "overhead press": 0.20,
}
DEFAULT_MVT = 0.20

# Regression is only reported once there is a real spread of loads; 2 points
# give a line but no confidence, and all-same-load gives no slope at all.
MIN_PROFILE_POINTS = 2
MIN_DISTINCT_LOADS = 2


def mvt_for(exercise: str | None) -> float:
    """Minimal velocity threshold (m/s) for a lift."""
    return MIN_VELOCITY_THRESHOLD.get((exercise or "").strip().lower(), DEFAULT_MVT)


def _linear_fit(xs: list[float], ys: list[float]) -> tuple[float, float, float] | None:
    """Least-squares fit y = slope·x + intercept, plus R². None if degenerate."""
    n = len(xs)
    if n < 2:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return None
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    slope = sxy / sxx
    intercept = my - slope * mx
    ss_tot = sum((y - my) ** 2 for y in ys)
    ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, ys))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    return slope, intercept, r2


@dataclass
class LoadVelocityProfile:
    exercise: str | None
    n: int
    mvt: float
    slope: float | None = None        # m/s per kg (negative = normal)
    intercept: float | None = None    # m/s at 0 kg
    r2: float | None = None
    est_1rm_kg: float | None = None
    load_min_kg: float | None = None
    load_max_kg: float | None = None
    confidence: str = "insufficient"  # insufficient | low | medium | high

    def as_dict(self) -> dict:
        return asdict(self)


def load_velocity_profile(
    points: list[tuple[float, float]],
    exercise: str | None = None,
    mvt: float | None = None,
) -> LoadVelocityProfile:
    """Fit a load–velocity profile from ``(load_kg, velocity_ms)`` points.

    ``est_1rm_kg`` is the load where the fitted line crosses the MVT. It is
    only returned for a physically sensible (negative) slope — a heavier load
    must move slower. Confidence scales with point count, distinct loads and
    fit quality.
    """
    mvt = mvt if mvt is not None else mvt_for(exercise)
    pts = [(float(load), float(vel)) for load, vel in points if load and vel]
    profile = LoadVelocityProfile(exercise=exercise, n=len(pts), mvt=mvt)
    if len(pts) < MIN_PROFILE_POINTS:
        return profile

    loads = [p[0] for p in pts]
    vels = [p[1] for p in pts]
    profile.load_min_kg = round(min(loads), 1)
    profile.load_max_kg = round(max(loads), 1)
    if len(set(loads)) < MIN_DISTINCT_LOADS:
        return profile

    fit = _linear_fit(loads, vels)
    if fit is None:
        return profile
    slope, intercept, r2 = fit
    profile.slope = round(slope, 5)
    profile.intercept = round(intercept, 3)
    profile.r2 = round(r2, 3)

    if slope < 0:
        est = (mvt - intercept) / slope
        # Reject absurd extrapolations far outside the observed load range.
        if profile.load_max_kg * 0.5 <= est <= profile.load_max_kg * 2.5:
            profile.est_1rm_kg = round(est, 1)

    if len(pts) >= 6 and len(set(loads)) >= 4 and r2 >= 0.8:
        profile.confidence = "high"
    elif len(pts) >= 4 and len(set(loads)) >= 3 and r2 >= 0.5:
        profile.confidence = "medium"
    elif len(pts) >= 3:
        profile.confidence = "low"
    return profile


def load_for_velocity(
    profile: LoadVelocityProfile, target_velocity: float
) -> float | None:
    """Load predicted to move at ``target_velocity`` m/s on the L-V line.

    This is the autoregulation read: pick the velocity you want for the day
    (e.g. a fast/explosive 0.7 m/s or a grind 0.4 m/s) and the line says what
    to load. None when the profile has no usable negative slope or the result
    falls absurdly outside the observed load range.
    """
    if profile.slope is None or profile.intercept is None or profile.slope >= 0:
        return None
    if not target_velocity or target_velocity <= 0:
        return None
    load = (target_velocity - profile.intercept) / profile.slope
    ceiling = (profile.load_max_kg or 0) * 2.5
    if load <= 0 or load > ceiling:
        return None
    return round(load, 1)
