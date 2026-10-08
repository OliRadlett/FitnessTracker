"""Ride segments API (§3.13) — climb segments + leaderboard-of-self."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.segment import Segment
from app.models.user import User
from app.schemas.segment import (
    ClimbDetail,
    SegmentDetail,
    SegmentEffortRead,
    SegmentRead,
)
from app.services import segments as segment_service
from app.services.auth import get_current_user

router = APIRouter()


def _segment_read(seg, *, geo_cluster_size: int = 1) -> SegmentRead:
    return SegmentRead(
        id=seg.id,
        route_id=seg.route_id,
        route_name=seg.route.name if seg.route else None,
        name=seg.name,
        start_dist_m=seg.start_dist_m,
        end_dist_m=seg.end_dist_m,
        distance_m=seg.distance_m,
        elevation_gain_m=seg.elevation_gain_m,
        avg_gradient_pct=seg.avg_gradient_pct,
        max_gradient_pct=seg.max_gradient_pct,
        peak_elevation_m=seg.peak_elevation_m,
        start_lat=seg.start_lat,
        start_lng=seg.start_lng,
        end_lat=seg.end_lat,
        end_lng=seg.end_lng,
        climb_category=seg.climb_category,
        pr_seconds=seg.pr_seconds,
        best_avg_power_watts=seg.best_avg_power_watts,
        times_ridden=seg.times_ridden,
        has_pr=seg.has_pr,
        effort_count=len(seg.efforts or []),
        cluster_id=seg.cluster_id,
        geo_cluster_id=seg.geo_cluster_id,
        geo_cluster_size=geo_cluster_size,
        climb_type=seg.climb_type,
        sustainedness=seg.sustainedness,
        difficulty_score=seg.difficulty_score,
        predicted_vam=seg.predicted_vam,
        predicted_time_seconds=seg.predicted_time_seconds,
        predicted_power_watts=seg.predicted_power_watts,
        prediction_confidence=seg.prediction_confidence,
        intelligence_analyzed_at=seg.intelligence_analyzed_at,
    )


def _effort_read(effort) -> SegmentEffortRead:
    return SegmentEffortRead(
        id=effort.id,
        segment_id=effort.segment_id,
        activity_id=effort.activity_id,
        activity_name=effort.activity.name if effort.activity else None,
        started_at=effort.started_at,
        elapsed_seconds=effort.elapsed_seconds,
        avg_power_watts=effort.avg_power_watts,
        avg_hr=effort.avg_hr,
        avg_speed_mps=effort.avg_speed_mps,
        effort_vam=effort.effort_vam,
        is_pr=effort.is_pr,
    )


@router.get("", response_model=list[SegmentRead])
async def list_segments(
    route_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """All climb segments for the user (optionally for one route), PR-first."""
    segments = await segment_service.list_segments(db, current_user.id, route_id)
    # One grouped query for the whole user, not a count per segment: this is a
    # list endpoint and the page renders every row, so counting in the loop
    # would be an N+1. When `route_id` filters to one route, the counts are
    # still computed across all of the user's routes -- a hill seen on three
    # routes must report 3 here too, or the "also on N other routes" line would
    # be wrong exactly when it is being shown.
    sizes = await segment_service.geo_cluster_sizes(db, current_user.id)
    return [
        _segment_read(
            seg,
            geo_cluster_size=sizes.get(seg.geo_cluster_id, 1)
            if seg.geo_cluster_id
            else 1,
        )
        for seg in segments
    ]


# NOTE: registered before `/{segment_id}` below. Both are single-segment
# paths, so order decides which wins (pitfall 13): `/{segment_id}` would
# otherwise swallow `/status` as a segment id and 404. `/climbs/{geo_cluster_id}`
# is two segments and cannot collide, but status stays above both for readability.
@router.get("/status")
async def get_segments_intelligence_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lightweight fitted marker for the settings intelligence card.

    Returns 200 with ``analyzed_at=None`` when nothing has been analyzed
    (instead of 404), so the UI can render "Not yet fitted" without treating
    it as an error. ``analyzed_at`` is the newest
    ``intelligence_analyzed_at`` across the user's segments.
    """
    result = await db.execute(
        select(
            func.max(Segment.intelligence_analyzed_at),
            func.count(),
            func.count(Segment.intelligence_analyzed_at),
        ).where(Segment.user_id == current_user.id)
    )
    analyzed_at, segment_count, analyzed_count = result.one()
    return {
        "analyzed_at": analyzed_at.isoformat() if analyzed_at else None,
        "segment_count": segment_count,
        "analyzed_count": analyzed_count,
    }


@router.get("/climbs/{geo_cluster_id}", response_model=ClimbDetail)
async def get_climb_detail(
    geo_cluster_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """One physical hill merged across every route it appears on.

    Registered above ``/{segment_id}``, though **ordering is not what makes this
    safe** and the spec's warning to the contrary was wrong.

    Pitfall 13's rule (static single-segment routes must sit above a dynamic
    one) is about *colliding path shapes*: ``/tags`` and ``/{param}`` are both
    one segment, so whichever is registered first wins. This route is two
    segments and the dynamic one is one::

        /{segment_id}            ->  ^/(?P<segment_id>[^/]+)$
        /climbs/{geo_cluster_id} ->  ^/climbs/(?P<geo_cluster_id>[^/]+)$

    ``[^/]+`` cannot span a slash, so ``/{segment_id}`` is never a candidate
    for ``/climbs/<uuid>``. The shape makes shadowing impossible whatever the
    order.

    It stays above for readability -- the specific route reading first is what a
    reader expects -- and ``test_segment_geo_clusters.py`` asserts the *shape*
    rather than the order, plus a test showing the single-segment variant
    (``GET /climbs``, no parameter) really is shadowed. That is the case the rule
    is actually for.
    """
    try:
        members, efforts = await segment_service.get_climb_leaderboard(
            db, current_user.id, geo_cluster_id
        )
    except LookupError as e:
        # A hill owned by another user raises the same LookupError as one that
        # does not exist, so this endpoint cannot be used to probe for ids.
        raise HTTPException(status_code=404, detail=str(e)) from e

    sizes = await segment_service.geo_cluster_sizes(db, current_user.id)
    size = sizes.get(geo_cluster_id, len(members))
    reads = [_segment_read(seg, geo_cluster_size=size) for seg in members]
    return ClimbDetail(
        geo_cluster_id=geo_cluster_id,
        name=segment_service.canonical_climb_name(members),
        route_count=len({seg.route_id for seg in members}),
        segments=reads,
        efforts=[_effort_read(e) for e in efforts],
    )


@router.get("/{segment_id}", response_model=SegmentDetail)
async def get_segment_detail(
    segment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Segment + leaderboard-of-self efforts sorted by elapsed time."""
    try:
        seg, efforts = await segment_service.get_segment_leaderboard(
            db, current_user.id, segment_id
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return SegmentDetail(
        segment=_segment_read(seg), efforts=[_effort_read(e) for e in efforts]
    )
