"""Nutrition service — ride fuel planning for cycling activities.

Generates research-backed fuel schedules (carbs/hydration/sodium timing)
from ride duration and intensity factor (IF = NP/FTP).

Targets by duration × intensity:
    | Duration  | IF<0.75 | 0.75-0.85 | >0.85 |
    | <60 min   | -       | optional  | snack |
    | 60-120    | 30      | 40        | 50    |  g carbs/hour
    | 120-180   | 50      | 60        | 70    |
    | 180-300   | 60      | 80        | 90    |
    | >300      | 80      | 90        | 100   |

Hydration: 500-800 ml/hr. Sodium: 300-900 mg/hr.
Pre-ride (2h before): ~1.5 g carbs/kg. Post-ride (<30 min): ~1.2 g carbs/kg + 0.3 g protein/kg.
"""

import logging
import math
import uuid
from datetime import UTC, datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.cycling import CyclingProfile
from app.models.nutrition import RideFuelPlan

logger = logging.getLogger(__name__)

DEFAULT_WEIGHT_KG = 75.0


# ── Pure computation helpers (unit-tested) ──────────────────────────────────


def _intensity_band(intensity_factor: float) -> str:
    """Classify IF into low/medium/high."""
    if intensity_factor < 0.75:
        return "low"
    if intensity_factor <= 0.85:
        return "medium"
    return "high"


def _carbs_per_hour(duration_min: int, intensity_factor: float) -> float:
    """Carb target in g/hour by duration x intensity band."""
    band = _intensity_band(intensity_factor)
    if duration_min < 60:
        return 0.0
    if duration_min <= 120:
        return {"low": 30.0, "medium": 40.0, "high": 50.0}[band]
    if duration_min <= 180:
        return {"low": 50.0, "medium": 60.0, "high": 70.0}[band]
    if duration_min <= 300:
        return {"low": 60.0, "medium": 80.0, "high": 90.0}[band]
    return {"low": 80.0, "medium": 90.0, "high": 100.0}[band]


def _hydration_ml_per_hour(duration_min: int, intensity_factor: float) -> float:
    """Hydration target in ml/hour, adjusted for intensity and duration."""
    target = 500.0
    if intensity_factor > 0.85:
        target += 100.0
    if duration_min >= 180:
        target += 150.0
    return min(target, 800.0)


def _sodium_mg_per_hour(duration_min: int, intensity_factor: float) -> float:
    """Sodium target in mg/hour: 300 base, more for long/hard rides."""
    target = 300.0
    if duration_min >= 120:
        target += 300.0
    if intensity_factor > 0.85:
        target += 150.0
    return min(target, 900.0)


def _feeding_interval_min(carbs_per_hour: float) -> int:
    """Feed every 45 min at moderate rates, 30 min at high rates."""
    return 45 if carbs_per_hour <= 60 else 30


def _feed_suggestion(carbs_g: float) -> str:
    """Human food suggestion sized to the carb load."""
    if carbs_g <= 15:
        return "Water or a few sips of sports drink"
    if carbs_g <= 32:
        return "Energy gel + water"
    if carbs_g <= 48:
        return "Banana or energy bar + electrolyte drink"
    return "Energy bar + energy gel + electrolyte drink"


def _build_during_ride_schedule(
    duration_min: int,
    carbs_per_hour: float,
    hydration_ml_per_hour: float,
    sodium_mg_per_hour: float,
) -> list[dict]:
    """Timed during-ride fueling schedule.

    Rides under an hour get no scheduled feeds (just hydrate); longer rides
    get evenly spaced feeds stopping ~10 min before the end.
    """
    if duration_min < 60:
        return []

    interval = _feeding_interval_min(carbs_per_hour)
    per_feed_carbs = round(carbs_per_hour * interval / 60)
    per_feed_ml = round(hydration_ml_per_hour * interval / 60)
    per_feed_sodium = round(sodium_mg_per_hour * interval / 60)

    entries: list[dict] = []
    t = interval
    while t <= duration_min - 10:
        entries.append(
            {
                "time_min": t,
                "carbs_g": per_feed_carbs,
                "hydration_ml": per_feed_ml,
                "sodium_mg": per_feed_sodium,
                "suggestion": _feed_suggestion(per_feed_carbs),
            }
        )
        t += interval
    return entries


def compute_fuel_targets(
    duration_min: int,
    intensity_factor: float,
    weight_kg: float,
) -> dict:
    """Compute all fuel targets plus the timed schedule for a ride."""
    carbs_per_hour = _carbs_per_hour(duration_min, intensity_factor)
    hydration = _hydration_ml_per_hour(duration_min, intensity_factor)
    sodium = _sodium_mg_per_hour(duration_min, intensity_factor)

    pre_carbs = round(1.5 * weight_kg)
    post_carbs = round(1.2 * weight_kg)
    post_protein = round(0.3 * weight_kg)

    return {
        "pre_ride_carbs_g": float(pre_carbs),
        "during_carbs_per_hour_g": carbs_per_hour,
        "during_hydration_ml_per_hour": hydration,
        "during_sodium_mg_per_hour": sodium,
        "post_ride_carbs_g": float(post_carbs),
        "post_ride_protein_g": float(post_protein),
        "schedule": _build_during_ride_schedule(
            duration_min, carbs_per_hour, hydration, sodium
        ),
        "weight_used_kg": weight_kg,
    }


def estimate_intensity_factor(
    normalized_power: float | None,
    average_power: float | None,
    tss: float | None,
    ftp_watts: float | None,
    duration_seconds: int | None,
) -> float:
    """Estimate IF for an activity: prefer NP/FTP, fall back to AP/FTP then TSS-derived.

    Returns 0.75 (moderate) as a neutral fallback when nothing is usable.
    """
    if ftp_watts and ftp_watts > 0:
        power = normalized_power or average_power
        if power and power > 0:
            return round(power / ftp_watts, 2)
    if tss and tss > 0 and duration_seconds and duration_seconds > 0:
        # TSS = hours * IF^2 * 100  =>  IF = sqrt(TSS / (hours * 100))
        hours = duration_seconds / 3600
        derived = math.sqrt(tss / (hours * 100))
        return round(min(max(derived, 0.4), 1.3), 2)
    return 0.75


# ── DB-backed service functions ─────────────────────────────────────────────


async def _get_weight_kg(db: AsyncSession, user_id: uuid.UUID) -> float:
    result = await db.execute(
        select(CyclingProfile.weight_kg).where(CyclingProfile.user_id == user_id)
    )
    weight = result.scalar_one_or_none()
    return weight if weight and weight > 0 else DEFAULT_WEIGHT_KG


async def generate_fuel_plan(
    db: AsyncSession,
    user_id: uuid.UUID,
    activity_id: uuid.UUID | None = None,
    planned_duration_min: int | None = None,
    planned_if: float | None = None,
) -> RideFuelPlan:
    """Create (or replace, for the same activity) a fuel plan.

    If *activity_id* is given, duration/IF are derived from the completed ride;
    otherwise the planned values are used (at least one must be provided).
    """
    duration_min = planned_duration_min
    intensity_factor = planned_if

    if activity_id is not None:
        result = await db.execute(
            select(Activity).where(
                Activity.id == activity_id, Activity.user_id == user_id
            )
        )
        activity = result.scalar_one_or_none()
        if not activity:
            raise ValueError("Activity not found")

        # Replace any existing plan for this activity (regeneration)
        existing = await get_plan_for_activity(db, user_id, activity_id)
        if existing:
            await db.delete(existing)
            await db.flush()

        if duration_min is None and activity.duration_seconds:
            duration_min = max(1, round(activity.duration_seconds / 60))
        if intensity_factor is None:
            ftp_result = await db.execute(
                select(CyclingProfile.ftp_watts).where(
                    CyclingProfile.user_id == user_id
                )
            )
            ftp = ftp_result.scalar_one_or_none()
            intensity_factor = estimate_intensity_factor(
                activity.normalized_power,
                activity.average_power,
                activity.tss,
                ftp,
                activity.duration_seconds,
            )

    if not duration_min or duration_min <= 0:
        raise ValueError("A planned duration (or a linked activity) is required")

    duration_min = min(int(duration_min), 24 * 60)
    if intensity_factor is None:
        intensity_factor = 0.75
    intensity_factor = min(max(float(intensity_factor), 0.4), 1.3)

    weight_kg = await _get_weight_kg(db, user_id)
    targets = compute_fuel_targets(duration_min, intensity_factor, weight_kg)

    plan = RideFuelPlan(
        user_id=user_id,
        activity_id=activity_id,
        planned_duration_min=duration_min,
        planned_if=intensity_factor,
        pre_ride_carbs_g=targets["pre_ride_carbs_g"],
        during_carbs_per_hour_g=targets["during_carbs_per_hour_g"],
        during_hydration_ml_per_hour=targets["during_hydration_ml_per_hour"],
        during_sodium_mg_per_hour=targets["during_sodium_mg_per_hour"],
        post_ride_carbs_g=targets["post_ride_carbs_g"],
        post_ride_protein_g=targets["post_ride_protein_g"],
        schedule_json=targets["schedule"],
        source="auto",
    )
    db.add(plan)
    await db.flush()
    await db.refresh(plan)
    logger.info(
        f"Fuel plan generated for user {user_id}: {duration_min}min @ IF "
        f"{intensity_factor}, {targets['during_carbs_per_hour_g']}g carbs/hr"
    )
    return plan


async def get_fuel_plan(
    db: AsyncSession, user_id: uuid.UUID, plan_id: uuid.UUID
) -> RideFuelPlan | None:
    result = await db.execute(
        select(RideFuelPlan).where(
            RideFuelPlan.id == plan_id, RideFuelPlan.user_id == user_id
        )
    )
    return result.scalar_one_or_none()


async def get_plan_for_activity(
    db: AsyncSession, user_id: uuid.UUID, activity_id: uuid.UUID
) -> RideFuelPlan | None:
    result = await db.execute(
        select(RideFuelPlan).where(
            RideFuelPlan.user_id == user_id,
            RideFuelPlan.activity_id == activity_id,
        )
    )
    return result.scalar_one_or_none()


async def update_fuel_plan_actuals(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    actual_pre: str | None = None,
    actual_during: str | None = None,
    actual_post: str | None = None,
) -> RideFuelPlan | None:
    """Log what was actually consumed. Only non-None fields are updated."""
    plan = await get_fuel_plan(db, user_id, plan_id)
    if not plan:
        return None
    if actual_pre is not None:
        plan.actual_pre_ride_notes = actual_pre[:1000]
    if actual_during is not None:
        plan.actual_during_notes = actual_during[:1000]
    if actual_post is not None:
        plan.actual_post_ride_notes = actual_post[:1000]
    plan.updated_at = datetime.now(UTC)
    await db.flush()
    await db.refresh(plan)
    return plan


async def delete_fuel_plan(
    db: AsyncSession, user_id: uuid.UUID, plan_id: uuid.UUID
) -> bool:
    plan = await get_fuel_plan(db, user_id, plan_id)
    if not plan:
        return False
    await db.delete(plan)
    await db.flush()
    return True
