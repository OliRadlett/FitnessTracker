"""Push a training-plan cycle day to Wahoo as a planned workout and/or route.

Orchestrates the Wahoo write APIs:

* ``POST /v1/plans``      — structured workout definition (plan.json)
* ``POST /v1/workouts``   — scheduled instance on the athlete's calendar
* ``POST /v1/routes``     — FIT course upload

A single scheduled workout can reference both the plan and the route, so the
ELEMNT shows the structured targets *and* the navigation together.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, time

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.integrations.wahoo_client import (
    WAHOO_LOCATION_INDOOR,
    WAHOO_LOCATION_OUTDOOR,
    WAHOO_TYPE_BIKING_INDOOR,
    WAHOO_TYPE_BIKING_OUTDOOR,
    _iso_z,
    wahoo_client,
    wahoo_daycode,
)
from app.models.cycling import CyclingProfile
from app.models.route import Route
from app.models.training_plan import TrainingPlan, TrainingPlanDay
from app.services.fit_course import course_points_from_route, encode_course_fit
from app.services.wahoo import get_wahoo_connection, refresh_if_needed
from app.services.wahoo_plan_file import build_plan_json

logger = logging.getLogger(__name__)


class WahooPushError(Exception):
    """Actionable error from a Wahoo push attempt."""

    def __init__(self, message: str, status_code: int = 400, code: str = "push_failed"):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


async def _load_plan_day(
    db: AsyncSession, user_id: uuid.UUID, plan_id: uuid.UUID, day_id: uuid.UUID
) -> tuple[TrainingPlan, TrainingPlanDay]:
    result = await db.execute(
        select(TrainingPlan)
        .where(TrainingPlan.id == plan_id, TrainingPlan.user_id == user_id)
        .options(selectinload(TrainingPlan.days))
    )
    plan = result.scalar_one_or_none()
    if plan is None:
        raise WahooPushError("Training plan not found", 404, "not_found")
    day = next((d for d in plan.days if d.id == day_id), None)
    if day is None:
        raise WahooPushError("Training plan day not found", 404, "not_found")
    return plan, day


async def _get_ftp(db: AsyncSession, user_id: uuid.UUID) -> float | None:
    result = await db.execute(
        select(CyclingProfile).where(CyclingProfile.user_id == user_id)
    )
    profile = result.scalar_one_or_none()
    return profile.ftp_watts if profile and profile.ftp_watts else None


def _workout_name(plan: TrainingPlan, day: TrainingPlanDay) -> str:
    label = day.day_date.strftime("%b %d")
    return f"{plan.name} · {label}"[:255]


def _is_scope_error(exc: httpx.HTTPStatusError) -> bool:
    return exc.response.status_code == 403


async def _push_route(db: AsyncSession, token: str, route: Route) -> int:
    """Upload or update ``route`` on Wahoo; return the Wahoo route id."""
    if not route.encoded_polyline:
        raise WahooPushError("Route has no GPS data to push", 422, "route_no_gps")

    points = course_points_from_route(route)
    try:
        fit_bytes = encode_course_fit(route.name, points)
    except ValueError as e:
        raise WahooPushError(f"Cannot build route file: {e}", 422, "route_no_gps") from e

    meta = {
        "external_id": f"fittrack-route-{route.id}",
        "provider_updated_at": _iso_z(route.updated_at or datetime.now(UTC)),
        "name": route.name[:255],
        "workout_type_family_id": 0,  # BIKING
        "start_lat": route.start_lat,
        "start_lng": route.start_lng,
        "distance": int(round(route.distance_meters or 0)),
        "ascent": int(round(route.elevation_gain_meters or 0)),
    }

    try:
        if route.wahoo_route_id:
            data = await wahoo_client.update_route(
                token, route.wahoo_route_id, fit_bytes, meta
            )
        else:
            data = await wahoo_client.create_route(token, fit_bytes, meta)
    except httpx.HTTPStatusError as e:
        if _is_scope_error(e):
            raise WahooPushError(
                "Wahoo write access required — reconnect Wahoo to grant "
                "route upload permission.",
                403,
                "missing_scopes",
            ) from e
        raise WahooPushError(
            f"Wahoo rejected the route upload ({e.response.status_code}).",
            502,
            "route_upload_failed",
        ) from e

    wahoo_id = int(data.get("id")) if data and data.get("id") is not None else None
    if wahoo_id is None:
        raise WahooPushError("Wahoo did not return a route id", 502, "route_upload_failed")

    route.wahoo_route_id = wahoo_id
    route.wahoo_route_pushed_at = datetime.now(UTC)
    await db.flush()
    return wahoo_id


async def push_plan_day(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    day_id: uuid.UUID,
    *,
    push_workout: bool,
    push_route: bool,
) -> dict:
    """Push a cycle plan day to Wahoo. Returns a status dict."""
    plan, day = await _load_plan_day(db, user_id, plan_id, day_id)

    if day.sport != "cycle":
        raise WahooPushError("Only cycle days can be pushed to Wahoo", 400, "not_cycle")
    if not push_workout and not push_route:
        raise WahooPushError("Select the workout and/or route to push", 400, "nothing_selected")

    connection = await get_wahoo_connection(db, user_id)
    if connection is None:
        raise WahooPushError("No Wahoo connection found", 409, "no_connection")
    connection = await refresh_if_needed(db, connection)
    token = connection.access_token

    # ── Route (optional) ────────────────────────────────────────────────────
    wahoo_route_id = day.wahoo_route_id
    if push_route:
        if not day.planned_route_id:
            raise WahooPushError(
                "Assign a route to this day before pushing it",
                400,
                "no_route",
            )
        route = await db.get(Route, day.planned_route_id)
        if route is None or route.user_id != user_id:
            raise WahooPushError("Route not found", 404, "route_not_found")
        wahoo_route_id = await _push_route(db, token, route)
        day.wahoo_route_id = wahoo_route_id

    route_present = bool(day.planned_route_id) or bool(wahoo_route_id)
    location = WAHOO_LOCATION_OUTDOOR if route_present else WAHOO_LOCATION_INDOOR
    workout_type_id = (
        WAHOO_TYPE_BIKING_OUTDOOR if route_present else WAHOO_TYPE_BIKING_INDOOR
    )

    # ── Structured workout (optional) ───────────────────────────────────────
    if push_workout:
        ftp = await _get_ftp(db, user_id)
        plan_json = build_plan_json(
            name=_workout_name(plan, day),
            description=day.workout_description,
            duration_min=day.planned_duration_min,
            zone=day.planned_zone,
            power_watts=day.planned_power_watts,
            ftp=ftp,
            workout_type_location=location,
        )
        if plan_json is None:
            raise WahooPushError(
                "Set your FTP (Cycling profile) or a power/zone target to push "
                "a structured workout — or push the route only.",
                422,
                "no_ftp",
            )

        external_id = f"fittrack-plan-{plan.id}-day-{day.id}"
        try:
            if day.wahoo_plan_id:
                await wahoo_client.update_plan(
                    token, day.wahoo_plan_id, plan_json, _iso_z(datetime.now(UTC))
                )
                wahoo_plan_id = day.wahoo_plan_id
            else:
                plan_data = await wahoo_client.create_plan(
                    token, plan_json, external_id, _iso_z(datetime.now(UTC))
                )
                wahoo_plan_id = plan_data.get("id")
        except httpx.HTTPStatusError as e:
            if _is_scope_error(e):
                raise WahooPushError(
                    "Wahoo write access required — reconnect Wahoo to grant "
                    "workout upload permission.",
                    403,
                    "missing_scopes",
                ) from e
            raise WahooPushError(
                f"Wahoo rejected the plan upload ({e.response.status_code}).",
                502,
                "plan_upload_failed",
            ) from e

        if wahoo_plan_id is None:
            raise WahooPushError("Wahoo did not return a plan id", 502, "plan_upload_failed")
        day.wahoo_plan_id = int(wahoo_plan_id)

        starts = datetime.combine(day.day_date, time(9, 0), tzinfo=UTC)
        payload = {
            "name": _workout_name(plan, day),
            "workout_token": f"fittrack-plan-{plan.id}-day-{day.id}",
            "workout_type_id": workout_type_id,
            "starts": _iso_z(starts),
            "day_code": wahoo_daycode(day.day_date),
            "minutes": day.planned_duration_min or 60,
            "plan_id": day.wahoo_plan_id,
            "route_id": wahoo_route_id,
        }
        try:
            if day.wahoo_workout_id:
                await wahoo_client.update_workout(token, day.wahoo_workout_id, payload)
                workout_id = day.wahoo_workout_id
            else:
                workout_data = await wahoo_client.create_workout(token, payload)
                workout_id = workout_data.get("id")
        except httpx.HTTPStatusError as e:
            if _is_scope_error(e):
                raise WahooPushError(
                    "Wahoo write access required — reconnect Wahoo to grant "
                    "workout scheduling permission.",
                    403,
                    "missing_scopes",
                ) from e
            raise WahooPushError(
                f"Wahoo rejected the workout schedule ({e.response.status_code}).",
                502,
                "workout_upload_failed",
            ) from e

        if workout_id is None:
            raise WahooPushError(
                "Wahoo did not return a workout id", 502, "workout_upload_failed"
            )
        day.wahoo_workout_id = int(workout_id)

    day.wahoo_push_workout = bool(push_workout)
    day.wahoo_push_route = bool(wahoo_route_id)
    day.wahoo_pushed_at = datetime.now(UTC)
    await db.flush()

    logger.info(
        "Pushed plan day %s (plan=%s route=%s) to Wahoo for user %s",
        day.id,
        day.wahoo_plan_id,
        day.wahoo_route_id,
        user_id,
    )
    return {
        "pushed_at": day.wahoo_pushed_at,
        "push_workout": push_workout,
        "push_route": bool(push_route),
        "wahoo_plan_id": day.wahoo_plan_id,
        "wahoo_workout_id": day.wahoo_workout_id,
        "wahoo_route_id": day.wahoo_route_id,
    }


async def remove_plan_day_from_wahoo(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    day_id: uuid.UUID,
) -> dict:
    """Delete the scheduled Wahoo workout/plan for a day; keep the route library entry."""
    _plan, day = await _load_plan_day(db, user_id, plan_id, day_id)

    connection = await get_wahoo_connection(db, user_id)
    token = None
    if connection is not None:
        connection = await refresh_if_needed(db, connection)
        token = connection.access_token

    if token is not None:
        for delete, item_id in (
            (wahoo_client.delete_workout, day.wahoo_workout_id),
            (wahoo_client.delete_plan, day.wahoo_plan_id),
        ):
            if item_id is None:
                continue
            try:
                await delete(token, item_id)
            except httpx.HTTPStatusError as e:
                # 404 = already gone; anything else is a warning, not fatal.
                if e.response.status_code != 404:
                    logger.warning("Wahoo delete failed for id %s: %s", item_id, e)
            except Exception as e:
                logger.warning("Wahoo delete error for id %s: %s", item_id, e)

    day.wahoo_plan_id = None
    day.wahoo_workout_id = None
    day.wahoo_route_id = None
    day.wahoo_pushed_at = None
    day.wahoo_push_workout = False
    day.wahoo_push_route = False
    await db.flush()
    return {"removed": True}
