"""Course service — Course → Route → Ride.

A course is the identity; a route is a concrete variant; an activity is a ride.
Grouping a route under a course is a non-destructive ``UPDATE`` and is audited
in ``course_link_log``. Strict duplicate merging remains in
``route_service.merge_routes``.

The existing ``activities.route_id`` links are WIP suggestions. Course history
reads ``confirmed`` links only; ``suggested`` is shown as context, never as a
completed ride.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.activity import Activity
from app.models.route import (
    Course,
    CourseLinkLog,
    CourseSuggestionDismissal,
    Route,
    RouteSimilarity,
)
from app.services.polyline_utils import extract_activity_polyline, preview_polyline


def _route_payload(
    route: Route,
    *,
    canonical_route_id: uuid.UUID | None,
    ride_count: int = 0,
    confirmed_ride_count: int = 0,
    suggested_ride_count: int = 0,
) -> dict[str, Any]:
    return {
        "id": route.id,
        "name": route.name,
        "sport_type": route.sport_type,
        "distance_meters": route.distance_meters,
        "elevation_gain_meters": route.elevation_gain_meters,
        "is_loop": route.is_loop,
        "preview_polyline": preview_polyline(route.encoded_polyline),
        "ride_count": ride_count,
        "confirmed_ride_count": confirmed_ride_count,
        "suggested_ride_count": suggested_ride_count,
        "is_canonical": canonical_route_id == route.id,
        "created_at": route.created_at,
    }


def _course_payload(
    course: Course, rides_by_route: dict[uuid.UUID, dict[str, Any]]
) -> dict[str, Any]:
    routes = list(course.routes)
    confirmed = sum(rides_by_route.get(r.id, {}).get("confirmed", 0) for r in routes)
    suggested = sum(rides_by_route.get(r.id, {}).get("suggested", 0) for r in routes)
    canonical = course.canonical_route or (routes[0] if routes else None)
    preview = preview_polyline(canonical.encoded_polyline) if canonical else None
    last_ridden = max(
        (
            rides_by_route[r.id]["last_confirmed"]
            for r in routes
            if rides_by_route.get(r.id, {}).get("last_confirmed") is not None
        ),
        default=None,
    )
    return {
        "id": course.id,
        "name": course.name,
        "sport_type": course.sport_type,
        "route_count": len(routes),
        "confirmed_ride_count": confirmed,
        "suggested_ride_count": suggested,
        "canonical_route_id": course.canonical_route_id,
        "canonical_name": canonical.name if canonical else None,
        "preview_polyline": preview,
        "identity_source": course.identity_source,
        "identity_confidence": course.identity_confidence,
        "last_ridden_date": last_ridden,
        "created_at": course.created_at,
        "updated_at": course.updated_at,
    }


def _course_routes(
    course: Course, rides_by_route: dict[uuid.UUID, dict[str, Any]]
) -> list[dict[str, Any]]:
    return [
        _route_payload(
            route,
            canonical_route_id=course.canonical_route_id,
            ride_count=rides_by_route.get(route.id, {}).get("total", 0),
            confirmed_ride_count=rides_by_route.get(route.id, {}).get("confirmed", 0),
            suggested_ride_count=rides_by_route.get(route.id, {}).get("suggested", 0),
        )
        for route in sorted(course.routes, key=lambda r: (r.distance_meters, r.name))
    ]


async def _rides_by_route(
    db: AsyncSession, user_id: uuid.UUID
) -> dict[uuid.UUID, dict[str, Any]]:
    rows = (
        await db.execute(
            select(
                Activity.route_id,
                Activity.route_link_status,
                Activity.start_date,
            ).where(Activity.user_id == user_id, Activity.route_id.isnot(None))
        )
    ).all()
    out: dict[uuid.UUID, dict[str, Any]] = {}
    for route_id, status, start_date in rows:
        bucket = out.setdefault(
            route_id,
            {
                "total": 0,
                "confirmed": 0,
                "suggested": 0,
                "rejected": 0,
                "last_confirmed": None,
            },
        )
        bucket["total"] += 1
        if status == "confirmed":
            bucket["confirmed"] += 1
            if start_date is not None and (
                bucket["last_confirmed"] is None
                or start_date > bucket["last_confirmed"]
            ):
                bucket["last_confirmed"] = start_date
        elif status == "suggested":
            bucket["suggested"] += 1
        elif status == "rejected":
            bucket["rejected"] += 1
    return out


async def list_courses(db: AsyncSession, user_id: uuid.UUID) -> list[dict[str, Any]]:
    courses = (
        (
            await db.execute(
                select(Course)
                .options(
                    selectinload(Course.routes),
                    selectinload(Course.canonical_route),
                )
                .where(Course.user_id == user_id)
                .order_by(Course.name, Course.created_at)
            )
        )
        .scalars()
        .all()
    )
    rides = await _rides_by_route(db, user_id)
    return [_course_payload(course, rides) for course in courses]


async def get_course(
    db: AsyncSession, user_id: uuid.UUID, course_id: uuid.UUID
) -> dict[str, Any] | None:
    course = (
        await db.execute(
            select(Course)
            .options(
                selectinload(Course.routes),
                selectinload(Course.canonical_route),
            )
            .where(Course.id == course_id, Course.user_id == user_id)
        )
    ).scalar_one_or_none()
    if course is None:
        return None

    rides = await _rides_by_route(db, user_id)
    route_ids = [r.id for r in course.routes]
    activities = []
    if route_ids:
        rows = (
            (
                await db.execute(
                    select(Activity)
                    .options(selectinload(Activity.sources))
                    .where(
                        Activity.user_id == user_id,
                        Activity.route_id.in_(route_ids),
                        Activity.route_link_status.in_(("confirmed", "suggested")),
                    )
                    .order_by(Activity.start_date.desc())
                )
            )
            .scalars()
            .all()
        )
        by_route = {r.id: r.name for r in course.routes}
        activities = [
            {
                "id": a.id,
                "name": a.name,
                "start_date": a.start_date,
                "distance_meters": a.distance_meters,
                "route_id": a.route_id,
                "route_name": by_route.get(a.route_id),
                "route_link_status": a.route_link_status,
                "preview_polyline": preview_polyline(
                    extract_activity_polyline(a, a.sources)
                ),
            }
            for a in rows
        ]

    payload = _course_payload(course, rides)
    payload["routes"] = _course_routes(course, rides)
    payload["activities"] = activities
    return payload


async def list_uncoursed_routes(
    db: AsyncSession, user_id: uuid.UUID
) -> list[dict[str, Any]]:
    routes = (
        (
            await db.execute(
                select(Route)
                .where(Route.user_id == user_id, Route.course_id.is_(None))
                .order_by(Route.name, Route.created_at)
            )
        )
        .scalars()
        .all()
    )
    rides = await _rides_by_route(db, user_id)
    return [
        _route_payload(
            route,
            canonical_route_id=None,
            ride_count=rides.get(route.id, {}).get("total", 0),
            confirmed_ride_count=rides.get(route.id, {}).get("confirmed", 0),
            suggested_ride_count=rides.get(route.id, {}).get("suggested", 0),
        )
        for route in routes
    ]


async def list_suggestions(
    db: AsyncSession, user_id: uuid.UUID, limit: int = 20
) -> list[dict[str, Any]]:
    """Review-tier course pair suggestions from the cached similarity graph.

    The cache is already ordered by score; this filters out pairs that are
    already in one course (a successful merge), pairs the user dismissed as
    "not the same course", and dedupes two route pairs that map to the same two
    courses. Nothing is auto-merged: the UI asks the user.
    """
    rows = (
        (
            await db.execute(
                select(RouteSimilarity)
                .where(RouteSimilarity.user_id == user_id)
                .order_by(RouteSimilarity.score.desc())
                .limit(max(limit * 3, limit))
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return []

    route_ids = {r.route_a_id for r in rows} | {r.route_b_id for r in rows}
    routes = (
        (
            await db.execute(
                select(Route).where(
                    Route.id.in_(route_ids),
                    Route.user_id == user_id,
                    Route.quarantined_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    by_id = {route.id: route for route in routes}

    dismissed_rows = (
        (
            await db.execute(
                select(CourseSuggestionDismissal).where(
                    CourseSuggestionDismissal.user_id == user_id
                )
            )
        )
        .scalars()
        .all()
    )
    dismissed: set[tuple[uuid.UUID, uuid.UUID]] = set()
    for d in dismissed_rows:
        dismissed.add((d.route_a_id, d.route_b_id))
        dismissed.add((d.route_b_id, d.route_a_id))

    out: list[dict[str, Any]] = []
    seen: set[tuple[str, ...]] = set()
    for row in rows:
        a = by_id.get(row.route_a_id)
        b = by_id.get(row.route_b_id)
        if a is None or b is None:
            continue
        if (a.id, b.id) in dismissed:
            continue
        if a.course_id is not None and a.course_id == b.course_id:
            continue
        if a.course_id is not None and b.course_id is not None:
            key = ("course", *sorted((str(a.course_id), str(b.course_id))))
        else:
            key = ("route", *sorted((str(a.id), str(b.id))))
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "route_a_id": a.id,
                "route_a_name": a.name,
                "route_a_course_id": a.course_id,
                "route_a_distance_meters": a.distance_meters,
                "route_a_preview_polyline": preview_polyline(a.encoded_polyline),
                "route_b_id": b.id,
                "route_b_name": b.name,
                "route_b_course_id": b.course_id,
                "route_b_distance_meters": b.distance_meters,
                "route_b_preview_polyline": preview_polyline(b.encoded_polyline),
                "score": row.score,
                "tier": row.tier,
                "breakdown": row.breakdown,
            }
        )
        if len(out) >= limit:
            break
    return out


async def list_dismissed_suggestions(
    db: AsyncSession, user_id: uuid.UUID
) -> list[dict[str, Any]]:
    """Dismissed pairs, newest first, so a wrong decision can be restored."""
    rows = (
        (
            await db.execute(
                select(CourseSuggestionDismissal)
                .where(CourseSuggestionDismissal.user_id == user_id)
                .order_by(CourseSuggestionDismissal.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return []

    route_ids = {r.route_a_id for r in rows} | {r.route_b_id for r in rows}
    routes = (
        (
            await db.execute(
                select(Route).where(Route.id.in_(route_ids), Route.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )
    by_id = {route.id: route for route in routes}

    out: list[dict[str, Any]] = []
    for row in rows:
        a = by_id.get(row.route_a_id)
        b = by_id.get(row.route_b_id)
        if a is None or b is None:
            continue
        out.append(
            {
                "route_a_id": a.id,
                "route_a_name": a.name,
                "route_a_distance_meters": a.distance_meters,
                "route_a_preview_polyline": preview_polyline(a.encoded_polyline),
                "route_b_id": b.id,
                "route_b_name": b.name,
                "route_b_distance_meters": b.distance_meters,
                "route_b_preview_polyline": preview_polyline(b.encoded_polyline),
                "dismissed_at": row.created_at,
            }
        )
    return out


async def dismiss_suggestion(
    db: AsyncSession,
    user_id: uuid.UUID,
    route_a_id: uuid.UUID,
    route_b_id: uuid.UUID,
) -> bool:
    """Persistently reject a course-pair suggestion.

    Idempotent and orientation-insensitive: dismissing ``(a, b)`` also hides
    ``(b, a)`` from the rebuilt cache.
    """
    if route_a_id == route_b_id:
        return False
    owned = (
        (
            await db.execute(
                select(Route.id).where(
                    Route.id.in_([route_a_id, route_b_id]),
                    Route.user_id == user_id,
                )
            )
        )
        .scalars()
        .all()
    )
    if len(set(owned)) != 2:
        return False

    existing = (
        await db.execute(
            select(CourseSuggestionDismissal.id).where(
                CourseSuggestionDismissal.user_id == user_id,
                or_(
                    (CourseSuggestionDismissal.route_a_id == route_a_id)
                    & (CourseSuggestionDismissal.route_b_id == route_b_id),
                    (CourseSuggestionDismissal.route_a_id == route_b_id)
                    & (CourseSuggestionDismissal.route_b_id == route_a_id),
                ),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return True

    db.add(
        CourseSuggestionDismissal(
            user_id=user_id, route_a_id=route_a_id, route_b_id=route_b_id
        )
    )
    await db.flush()
    return True


async def restore_suggestion(
    db: AsyncSession,
    user_id: uuid.UUID,
    route_a_id: uuid.UUID,
    route_b_id: uuid.UUID,
) -> bool:
    """Undo a suggestion dismissal (both orientations)."""
    result = await db.execute(
        delete(CourseSuggestionDismissal).where(
            CourseSuggestionDismissal.user_id == user_id,
            or_(
                (CourseSuggestionDismissal.route_a_id == route_a_id)
                & (CourseSuggestionDismissal.route_b_id == route_b_id),
                (CourseSuggestionDismissal.route_a_id == route_b_id)
                & (CourseSuggestionDismissal.route_b_id == route_a_id),
            ),
        )
    )
    await db.flush()
    return bool(result.rowcount)


async def _log_link(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    course_id: uuid.UUID,
    route_id: uuid.UUID,
    action: str,
    previous_course_id: uuid.UUID | None,
    score: float | None = None,
    breakdown: dict | None = None,
) -> None:
    db.add(
        CourseLinkLog(
            user_id=user_id,
            course_id=course_id,
            route_id=route_id,
            action=action,
            previous_course_id=previous_course_id,
            score=score,
            breakdown=breakdown,
        )
    )


async def create_course(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    name: str,
    sport_type: str = "cycling",
    route_ids: list[uuid.UUID] | None = None,
) -> dict[str, Any]:
    course = Course(
        user_id=user_id,
        name=name.strip(),
        sport_type=sport_type or "cycling",
        identity_source="manual",
    )
    db.add(course)
    await db.flush()

    for route_id in route_ids or []:
        route = (
            await db.execute(
                select(Route).where(Route.id == route_id, Route.user_id == user_id)
            )
        ).scalar_one_or_none()
        if route is None:
            continue
        previous = route.course_id
        route.course_id = course.id
        if course.canonical_route_id is None:
            course.canonical_route_id = route.id
        await _log_link(
            db,
            user_id=user_id,
            course_id=course.id,
            route_id=route.id,
            action="group",
            previous_course_id=previous,
        )
    await db.flush()
    return await get_course(db, user_id, course.id)  # type: ignore[return-value]


async def update_course(
    db: AsyncSession,
    user_id: uuid.UUID,
    course_id: uuid.UUID,
    *,
    name: str | None = None,
    sport_type: str | None = None,
) -> dict[str, Any] | None:
    course = (
        await db.execute(
            select(Course).where(Course.id == course_id, Course.user_id == user_id)
        )
    ).scalar_one_or_none()
    if course is None:
        return None
    if name is not None:
        cleaned = name.strip()
        if not cleaned:
            return None
        course.name = cleaned
    if sport_type is not None:
        course.sport_type = sport_type
    await db.flush()
    return await get_course(db, user_id, course_id)


async def group_route(
    db: AsyncSession,
    user_id: uuid.UUID,
    course_id: uuid.UUID,
    route_id: uuid.UUID,
    *,
    score: float | None = None,
    breakdown: dict | None = None,
) -> dict[str, Any] | None:
    course = (
        await db.execute(
            select(Course).where(Course.id == course_id, Course.user_id == user_id)
        )
    ).scalar_one_or_none()
    route = (
        await db.execute(
            select(Route).where(Route.id == route_id, Route.user_id == user_id)
        )
    ).scalar_one_or_none()
    if course is None or route is None:
        return None

    previous = route.course_id
    route.course_id = course.id
    if course.canonical_route_id is None:
        course.canonical_route_id = route.id
    await _log_link(
        db,
        user_id=user_id,
        course_id=course.id,
        route_id=route.id,
        action="group",
        previous_course_id=previous,
        score=score,
        breakdown=breakdown,
    )
    await db.flush()
    return await get_course(db, user_id, course_id)


async def ungroup_route(
    db: AsyncSession,
    user_id: uuid.UUID,
    course_id: uuid.UUID,
    route_id: uuid.UUID,
) -> dict[str, Any] | None:
    course = (
        await db.execute(
            select(Course).where(Course.id == course_id, Course.user_id == user_id)
        )
    ).scalar_one_or_none()
    route = (
        await db.execute(
            select(Route).where(Route.id == route_id, Route.user_id == user_id)
        )
    ).scalar_one_or_none()
    if course is None or route is None or route.course_id != course.id:
        return None

    route.course_id = None
    if course.canonical_route_id == route.id:
        course.canonical_route_id = None
    await _log_link(
        db,
        user_id=user_id,
        course_id=course.id,
        route_id=route.id,
        action="ungroup",
        previous_course_id=course.id,
    )
    await db.flush()
    return await get_course(db, user_id, course_id)


async def merge_courses(
    db: AsyncSession,
    user_id: uuid.UUID,
    target_course_id: uuid.UUID,
    source_course_id: uuid.UUID,
) -> dict[str, Any] | None:
    """Move every route of ``source`` into ``target`` and delete the empty source.

    Non-destructive for routes and rides: only ``routes.course_id`` changes.
    The move is logged per route on the target; the source course row is
    deleted because an empty course is noise after a consolidation. This is
    how the 1:1 backfill (one course per route) is collapsed into real courses.
    """
    if target_course_id == source_course_id:
        return None

    courses = (
        (
            await db.execute(
                select(Course).where(
                    Course.id.in_([target_course_id, source_course_id]),
                    Course.user_id == user_id,
                )
            )
        )
        .scalars()
        .all()
    )
    by_id = {course.id: course for course in courses}
    target = by_id.get(target_course_id)
    source = by_id.get(source_course_id)
    if target is None or source is None:
        return None

    source_routes = (
        (
            await db.execute(
                select(Route).where(
                    Route.user_id == user_id, Route.course_id == source.id
                )
            )
        )
        .scalars()
        .all()
    )
    for route in source_routes:
        route.course_id = target.id
        await _log_link(
            db,
            user_id=user_id,
            course_id=target.id,
            route_id=route.id,
            action="group",
            previous_course_id=source.id,
            breakdown={"merged_from": str(source.id), "source_name": source.name},
        )
    if target.canonical_route_id is None:
        target.canonical_route_id = source.canonical_route_id or (
            source_routes[0].id if source_routes else None
        )

    await db.flush()
    await db.delete(source)
    await db.flush()
    return await get_course(db, user_id, target.id)


async def set_route_link_status(
    db: AsyncSession,
    user_id: uuid.UUID,
    activity_id: uuid.UUID,
    status: str,
) -> dict[str, Any] | None:
    if status not in ("confirmed", "rejected"):
        raise ValueError("status must be 'confirmed' or 'rejected'")
    activity = (
        await db.execute(
            select(Activity).where(
                Activity.id == activity_id, Activity.user_id == user_id
            )
        )
    ).scalar_one_or_none()
    if activity is None or activity.route_id is None:
        return None
    activity.route_link_status = status
    activity.route_link_source = "manual"
    activity.route_link_confirmed_at = (
        datetime.now(UTC) if status == "confirmed" else None
    )
    await db.flush()
    return {
        "activity_id": activity.id,
        "route_id": activity.route_id,
        "status": activity.route_link_status,
    }
