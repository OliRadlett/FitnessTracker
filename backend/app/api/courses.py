"""Course API — Course → Route → Ride.

Grouping is non-destructive: ``POST /{course_id}/routes/{route_id}`` sets
``routes.course_id`` and writes ``course_link_log``. It never deletes a route.
Ride links are WIP suggestions until explicitly confirmed; course history uses
confirmed links only.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.course import (
    CourseCreate,
    CourseDetail,
    CourseRouteRead,
    CourseSummary,
    RideLinkResult,
)
from app.services import course_service
from app.services.auth import get_current_user

router = APIRouter()


@router.get("", response_model=list[CourseSummary])
async def list_courses(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List the user's courses with route and ride counts."""
    return await course_service.list_courses(db, current_user.id)


@router.post("", response_model=CourseDetail, status_code=201)
async def create_course(
    body: CourseCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a course and optionally group existing routes into it."""
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Course name is required")
    course = await course_service.create_course(
        db,
        current_user.id,
        name=name,
        sport_type=body.sport_type,
        route_ids=body.route_ids,
    )
    if course is None:  # pragma: no cover - create always returns the new course
        raise HTTPException(status_code=500, detail="Course could not be created")
    return course


@router.get("/uncoursed", response_model=list[CourseRouteRead])
async def list_uncoursed_routes(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Routes not yet grouped into a course.

    Registered before ``GET /{course_id}``: ``uncoursed`` is a single static
    segment and would otherwise be claimed by the dynamic route (pitfall 13).
    """
    return await course_service.list_uncoursed_routes(db, current_user.id)


@router.get("/{course_id}", response_model=CourseDetail)
async def get_course(
    course_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """A course, its route variants, and its confirmed/suggested rides."""
    course = await course_service.get_course(db, current_user.id, course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


@router.post("/{course_id}/routes/{route_id}", response_model=CourseDetail)
async def group_route(
    course_id: uuid.UUID,
    route_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Group a route under a course (non-destructive; audited)."""
    course = await course_service.group_route(db, current_user.id, course_id, route_id)
    if course is None:
        raise HTTPException(status_code=404, detail="Course or route not found")
    return course


@router.delete("/{course_id}/routes/{route_id}", response_model=CourseDetail)
async def ungroup_route(
    course_id: uuid.UUID,
    route_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a route from a course. The route and its rides are kept."""
    course = await course_service.ungroup_route(
        db, current_user.id, course_id, route_id
    )
    if course is None:
        raise HTTPException(
            status_code=404, detail="Course or route not found in this course"
        )
    return course


@router.post("/ride-links/{activity_id}/confirm", response_model=RideLinkResult)
async def confirm_ride_link(
    activity_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Confirm a WIP ride→route link so it can count as course history."""
    result = await course_service.set_route_link_status(
        db, current_user.id, activity_id, "confirmed"
    )
    if result is None:
        raise HTTPException(
            status_code=404, detail="Activity not found or has no route link"
        )
    return result


@router.post("/ride-links/{activity_id}/reject", response_model=RideLinkResult)
async def reject_ride_link(
    activity_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Reject a WIP ride→route link; the activity and route are kept."""
    result = await course_service.set_route_link_status(
        db, current_user.id, activity_id, "rejected"
    )
    if result is None:
        raise HTTPException(
            status_code=404, detail="Activity not found or has no route link"
        )
    return result
