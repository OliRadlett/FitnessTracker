"""Workout Planner API — zone definitions, workout planning, route matching."""

from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.workout_planner import (
    RouteMatchRequest,
    RouteMatchResponse,
    WorkoutPlanRequest,
    WorkoutPlanResponse,
    WorkoutZone,
    WorkoutZonesResponse,
)
from app.services.auth import get_current_user
from app.services.cycling import (
    compute_training_load,
    get_daily_tss,
    get_or_create_cycling_profile,
)
from app.services.workout_planner import (
    WorkoutTargets,
    compute_workout_zones,
    find_matching_routes,
    plan_workout,
)

router = APIRouter()


@router.get("/zones", response_model=WorkoutZonesResponse)
async def get_workout_zones(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all workout intensity zones derived from current FTP and LTHR.

    Includes a readiness recommendation based on current CTL/TSB.
    Zones auto-update as FTP changes over time.
    """
    profile = await get_or_create_cycling_profile(db, current_user.id)
    await db.refresh(profile)

    ftp = profile.ftp_watts
    lthr = profile.lactate_threshold_hr

    # Compute current CTL/ATL/TSB
    today = date.today()
    lookback = today - timedelta(days=90)
    daily_tss = await get_daily_tss(db, current_user.id, lookback, today)
    load_data = compute_training_load(daily_tss, today, lookback_days=90)

    ctl = load_data[-1]["ctl"] if load_data else 0.0
    atl = load_data[-1]["atl"] if load_data else 0.0
    tsb = load_data[-1]["tsb"] if load_data else 0.0

    result = compute_workout_zones(ftp=ftp, lthr=lthr, ctl=ctl, atl=atl, tsb=tsb)

    return WorkoutZonesResponse(
        zones=[
            WorkoutZone(
                zone=z.zone,
                name=z.name,
                color=z.color,
                if_low=z.if_low,
                if_high=z.if_high,
                power_low=z.power_low,
                power_high=z.power_high,
                hr_low=z.hr_low,
                hr_high=z.hr_high,
                tss_per_hour_low=z.tss_per_hour_low,
                tss_per_hour_high=z.tss_per_hour_high,
            )
            for z in result.zones
        ],
        readiness=result.readiness,
        ftp_watts=result.ftp_watts,
        lthr=result.lthr,
    )


@router.post("/plan", response_model=WorkoutPlanResponse | None)
async def plan_workout_endpoint(
    payload: WorkoutPlanRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Plan a workout with concrete targets based on difficulty and duration.

    Returns target power, TSS, heart rate, IF, and calorie estimates.
    Returns null if FTP is not set.
    """
    profile = await get_or_create_cycling_profile(db, current_user.id)
    await db.refresh(profile)

    targets = plan_workout(
        ftp=profile.ftp_watts,
        lthr=profile.lactate_threshold_hr,
        weight_kg=profile.weight_kg,
        difficulty=payload.difficulty,
        duration_minutes=payload.duration_minutes,
    )

    if not targets:
        return None

    return _targets_to_response(targets)


@router.post("/match-routes", response_model=RouteMatchResponse)
async def match_routes_endpoint(
    payload: RouteMatchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Find routes that best match a planned workout.

    Scores ridden routes by historical avg TSS/power/HR proximity to targets.
    Also estimates unridden routes from distance + elevation.
    """
    profile = await get_or_create_cycling_profile(db, current_user.id)
    await db.refresh(profile)

    ftp = profile.ftp_watts

    # Compute workout targets for matching
    targets = plan_workout(
        ftp=ftp,
        lthr=profile.lactate_threshold_hr,
        weight_kg=profile.weight_kg,
        difficulty=payload.difficulty,
        duration_minutes=payload.duration_minutes or 60,  # default 1hr for matching
    )

    if not targets:
        return RouteMatchResponse(matches=[], workout_target=None)

    result = await find_matching_routes(
        db=db,
        user_id=current_user.id,
        ftp=ftp,
        difficulty=payload.difficulty,
        duration_minutes=payload.duration_minutes,
        target_tss_low=targets.target_tss_low,
        target_tss_high=targets.target_tss_high,
        target_power_low=targets.target_power_low,
        target_power_high=targets.target_power_high,
        target_hr_low=targets.target_hr_low,
        target_hr_high=targets.target_hr_high,
        max_results=payload.max_results,
    )

    return RouteMatchResponse(
        matches=result.matches,
        workout_target=_targets_to_response(targets),
    )


def _targets_to_response(targets: WorkoutTargets) -> WorkoutPlanResponse:
    """Convert service dataclass to Pydantic schema."""
    return WorkoutPlanResponse(
        difficulty=targets.difficulty,
        zone_id=targets.zone_id,
        zone_name=targets.zone_name,
        duration_minutes=targets.duration_minutes,
        target_power_low=targets.target_power_low,
        target_power_high=targets.target_power_high,
        target_if_low=targets.target_if_low,
        target_if_high=targets.target_if_high,
        target_hr_low=targets.target_hr_low,
        target_hr_high=targets.target_hr_high,
        target_tss_low=targets.target_tss_low,
        target_tss_high=targets.target_tss_high,
        estimated_calories_low=targets.estimated_calories_low,
        estimated_calories_high=targets.estimated_calories_high,
    )
