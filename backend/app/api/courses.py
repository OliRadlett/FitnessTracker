"""Course API — Course → Route → Ride.

Grouping is non-destructive: ``POST /{course_id}/routes/{route_id}`` sets
``routes.course_id`` and writes ``course_link_log``. It never deletes a route.
Ride links are WIP suggestions until explicitly confirmed; course history uses
confirmed links only.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.course import (
    CourseCreate,
    CourseDetail,
    CourseMergeCandidate,
    CourseRouteRead,
    CourseSuggestion,
    CourseSummary,
    CourseUpdate,
    DismissedSuggestion,
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


@router.get("/suggestions", response_model=list[CourseSuggestion])
async def list_course_suggestions(
    # Default high enough to show the whole review queue: the production-copy
    # rescan produced 21 review pairs, and the page's "Show all" must not
    # silently hide the last one behind a 20-row API cap.
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Review-tier course pairs from the cached similarity graph.

    Registered before ``GET /{course_id}`` for the same reason as
    ``/uncoursed`` (single static segment, pitfall 13). Nothing is auto-merged.
    """
    return await course_service.list_suggestions(db, current_user.id, limit)


@router.get("/merge-candidates", response_model=list[CourseMergeCandidate])
async def list_course_merge_candidates(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Same-name courses the geometry scan is too strict to suggest.

    Registered before ``GET /{course_id}``: ``merge-candidates`` is a single
    static segment and would otherwise be claimed by the dynamic route
    (pitfall 13). This is review evidence only; nothing is merged automatically.
    """
    return await course_service.list_course_merge_candidates(db, current_user.id)


@router.get("/suggestions/dismissed", response_model=list[DismissedSuggestion])
async def list_dismissed_course_suggestions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Dismissed pairs, so a wrong "not the same" can be found and restored."""
    return await course_service.list_dismissed_suggestions(db, current_user.id)


@router.post("/suggestions/{route_a_id}/{route_b_id}/dismiss")
async def dismiss_course_suggestion(
    route_a_id: uuid.UUID,
    route_b_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Persistently hide a suggestion pair (both orientations)."""
    ok = await course_service.dismiss_suggestion(
        db, current_user.id, route_a_id, route_b_id
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Route pair not found")
    return {"dismissed": True}


@router.delete("/suggestions/{route_a_id}/{route_b_id}/dismiss")
async def restore_course_suggestion(
    route_a_id: uuid.UUID,
    route_b_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Undo a suggestion dismissal."""
    restored = await course_service.restore_suggestion(
        db, current_user.id, route_a_id, route_b_id
    )
    return {"restored": restored}


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


@router.patch("/{course_id}", response_model=CourseDetail)
async def update_course(
    course_id: uuid.UUID,
    body: CourseUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Rename a course or change its sport. Routes are untouched."""
    if body.name is not None and not body.name.strip():
        raise HTTPException(status_code=400, detail="Course name cannot be blank")
    course = await course_service.update_course(
        db,
        current_user.id,
        course_id,
        name=body.name,
        sport_type=body.sport_type,
    )
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


@router.post(
    "/{target_course_id}/merge/{source_course_id}", response_model=CourseDetail
)
async def merge_courses(
    target_course_id: uuid.UUID,
    source_course_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Move every route of ``source`` into ``target``; delete the empty source.

    Routes and rides are preserved. This is the consolidation path for the
    1:1 backfill (one course per route).
    """
    course = await course_service.merge_courses(
        db, current_user.id, target_course_id, source_course_id
    )
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
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
