"""Ride segments API (§3.13) — climb segments + leaderboard-of-self."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.segment import (
    SegmentDetail,
    SegmentEffortRead,
    SegmentRead,
)
from app.services import segments as segment_service
from app.services.auth import get_current_user

router = APIRouter()


def _segment_read(seg) -> SegmentRead:
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
    return [_segment_read(seg) for seg in segments]


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
