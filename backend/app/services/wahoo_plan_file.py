"""Build a Wahoo ``plan.json`` structured-workout file from a plan day.

Pure computation — no DB, no network. See
https://cloud-api.wahooligan.com/docs/plan-json-format.pdf

The plan file is a single JSON object with ``header`` + ``intervals``. Bicycle
computers only honour the *first* target type of each interval, so the power
(``ftp``) target is always emitted first.

Training-plan cycle days carry a single steady target (zone and/or power)
rather than an interval structure, so we synthesise a three-step session:

    warmup (10%) -> main steady block (80%) -> cooldown (10%)

targets are expressed as fractions of the athlete's FTP.
"""

from __future__ import annotations

from app.services.workout_planner import WORKOUT_ZONES

PLAN_VERSION = "1.0.0"

# Default FTP-fraction bands for the framing intervals.
_WARMUP_LOW, _WARMUP_HIGH = 0.45, 0.65
_COOLDOWN_LOW, _COOLDOWN_HIGH = 0.40, 0.55
_MIN_INTERVAL_S = 60


def _normalise_zone(zone: str | None) -> str | None:
    if not zone:
        return None
    return zone.strip().lower()


def zone_if_band(zone: str | None) -> tuple[float, float] | None:
    """Map a zone id (e.g. ``"z2"``) to its IF (low, high) band."""
    z = _normalise_zone(zone)
    if not z:
        return None
    for zone_id, _name, if_low, if_high, _lthr_lo, _lthr_hi in WORKOUT_ZONES:
        if zone_id == z:
            return (float(if_low), float(if_high))
    return None


def _target_band(
    zone: str | None, power_watts: float | None, ftp: float
) -> tuple[float, float]:
    """Resolve the main-interval FTP-fraction band from zone/power."""
    band = zone_if_band(zone)
    if band:
        return band

    if power_watts and power_watts > 0:
        centre = power_watts / ftp
        return (max(0.30, centre - 0.05), min(1.30, centre + 0.05))

    # No explicit target — treat as endurance (z2).
    return (0.55, 0.75)


def _split_durations(duration_min: int) -> tuple[int, int, int]:
    """Return (warmup_s, main_s, cooldown_s), each at least ``_MIN_INTERVAL_S``."""
    total_s = max(_MIN_INTERVAL_S * 3, int(round(duration_min * 60)))
    warm = max(_MIN_INTERVAL_S, int(round(total_s * 0.10)))
    cool = max(_MIN_INTERVAL_S, int(round(total_s * 0.10)))
    main = max(_MIN_INTERVAL_S, total_s - warm - cool)
    return warm, main, cool


def build_plan_json(
    *,
    name: str,
    description: str | None,
    duration_min: int | None,
    zone: str | None,
    power_watts: float | None,
    ftp: float | None,
    workout_type_location: int,
) -> dict | None:
    """Build a Wahoo plan.json dict, or ``None`` when no FTP is available.

    ``workout_type_location`` is Wahoo's location enum
    (0 = indoor, 1 = outdoor).
    """
    if not ftp or ftp <= 0:
        return None

    main_low, main_high = _target_band(zone, power_watts, ftp)
    warm_s, main_s, cool_s = _split_durations(duration_min or 60)
    total_s = warm_s + main_s + cool_s

    def target(low: float, high: float) -> list[dict]:
        # Power target first — the only target a bike computer will show.
        return [{"type": "ftp", "low": round(low, 2), "high": round(high, 2)}]

    return {
        "header": {
            "name": name,
            "version": PLAN_VERSION,
            "description": description or name,
            "duration_s": total_s,
            "workout_type_family": 0,  # BIKING
            "workout_type_location": workout_type_location,
            "ftp": int(round(ftp)),
        },
        "intervals": [
            {
                "name": "Warmup",
                "exit_trigger_type": "time",
                "exit_trigger_value": warm_s,
                "intensity_type": "wu",
                "targets": target(_WARMUP_LOW, _WARMUP_HIGH),
            },
            {
                "name": description or "Main",
                "exit_trigger_type": "time",
                "exit_trigger_value": main_s,
                "intensity_type": "active",
                "targets": target(main_low, main_high),
            },
            {
                "name": "Cooldown",
                "exit_trigger_type": "time",
                "exit_trigger_value": cool_s,
                "intensity_type": "cd",
                "targets": target(_COOLDOWN_LOW, _COOLDOWN_HIGH),
            },
        ],
    }
