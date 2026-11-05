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
    SegmentGroupBest,
    SegmentGroupDetail,
    SegmentGroupList,
    SegmentGroupPrediction,
    SegmentGroupRead,
    SegmentGroupUpdate,
    SegmentRead,
)
from app.services import segment_groups as group_service
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
        moving_seconds=effort.moving_seconds,
        avg_power_watts=effort.avg_power_watts,
        avg_hr=effort.avg_hr,
        avg_speed_mps=effort.avg_speed_mps,
        effort_vam=effort.effort_vam,
        assisted=effort.assisted,
        is_pr=effort.is_pr,
        line_id=effort.segment_id,
    )


def _ranked_group_attempts(group):
    """One attempt per ride, best climb rate per line, assisted excluded.

    Ranking requires ``assisted is False``: ``True`` (assisted) and ``None``
    (unclassified) are visible in the detail but cannot become a PR.
    """
    rows = []
    for seg in group.segments:
        for e in seg.efforts or []:
            if e.assisted is not False or not e.elapsed_seconds:
                continue
            rate = (
                e.effort_vam
                if e.effort_vam is not None
                else (seg.distance_m / e.elapsed_seconds) * 3600
            )
            rows.append((e, seg, rate))
    by_activity = {}
    for row in rows:
        prev = by_activity.get(row[0].activity_id)
        if prev is None or row[2] > prev[2]:
            by_activity[row[0].activity_id] = row
    return list(by_activity.values())


def _group_read(group) -> SegmentGroupRead:
    attempts = _ranked_group_attempts(group)
    best = None
    if attempts:
        distances = [seg.distance_m for _, seg, _ in attempts]
        comparable = (
            max(distances) - min(distances) <= max(distances) * 0.02
            if distances
            else True
        )
        # The lab's D7 rule: a faster ride is faster when the lines are the same
        # length; otherwise climb rate is the only fair comparison.
        if comparable:
            chosen = min(
                attempts,
                key=lambda r: r[0].moving_seconds
                if r[0].moving_seconds is not None
                else r[0].elapsed_seconds,
            )
        else:
            chosen = max(attempts, key=lambda r: r[2])
        effort, _seg, _rate = chosen
        best = SegmentGroupBest(
            seconds=(
                effort.moving_seconds
                if effort.moving_seconds is not None
                else effort.elapsed_seconds
            ),
            moving_seconds=effort.moving_seconds,
            power_watts=effort.avg_power_watts,
            vam=effort.effort_vam,
            date=effort.started_at,
        )

    canonical = (
        max(group.segments, key=lambda s: (len(s.efforts or []), s.distance_m))
        if group.segments
        else None
    )
    prediction = None
    if not attempts and canonical is not None and canonical.predicted_time_seconds:
        if (canonical.prediction_confidence or 0.0) >= 0.4:
            prediction = SegmentGroupPrediction(
                seconds=canonical.predicted_time_seconds,
                vam=canonical.predicted_vam,
                power_watts=canonical.predicted_power_watts,
                confidence=canonical.prediction_confidence,
            )

    last_ridden = max(
        (e.started_at for e, _, _ in attempts if e.started_at is not None),
        default=None,
    )
    return SegmentGroupRead(
        id=group.id,
        kind=group.kind,
        name=group.display_name or group.canonical_name,
        canonical_name=group.canonical_name,
        display_name=group.display_name,
        name_source=group.name_source,
        area=group.area,
        region=group.region,
        country=group.country,
        route_name=canonical.route.name if canonical and canonical.route else None,
        distance_m=group.distance_m,
        gain_m=group.gain_m,
        avg_gradient_pct=group.avg_gradient_pct,
        max_gradient_pct=group.max_gradient_pct,
        steepest_200m_pct=group.steepest_200m_pct,
        sustained_share=group.sustained_share,
        profile=[list(p) for p in (group.profile or [])],
        category=group.category,
        difficulty=group.difficulty,
        attempts=len(attempts),
        best=best,
        last_ridden=last_ridden,
        route_count=len({s.route_id for s in group.segments}),
        prediction=prediction,
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
# NOTE: `/groups` is a single-segment static path and MUST stay above
# `/{segment_id}` (pitfall 13). `/groups/{group_id}` is two segments and cannot
# collide with the one-segment dynamic route.
@router.get("/groups", response_model=SegmentGroupList)
async def list_segment_groups(
    kind: str = "climb",
    tab: str = "all",
    q: str | None = None,
    area: str | None = None,
    region: str | None = None,
    sort: str = "attempts",
    limit: int = 100,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Every physical/defined segment for the user, merged across route lines.

    ``tab`` / ``sort`` are deliberately forgiving: an unknown value falls back
    to the default rather than 422ing the whole page.
    """
    groups = await group_service.list_groups(db, current_user.id, kind=kind)
    reads = [_group_read(g) for g in groups]

    counts = {
        "ridden": sum(1 for r in reads if r.attempts > 0),
        "to_ride": sum(1 for r in reads if r.attempts == 0),
        "all": len(reads),
    }

    if tab not in ("ridden", "to_ride", "all"):
        tab = "all"
    if tab == "ridden":
        reads = [r for r in reads if r.attempts > 0]
    elif tab == "to_ride":
        reads = [r for r in reads if r.attempts == 0]

    if q:
        needle = q.strip().lower()
        reads = [
            r
            for r in reads
            if needle
            in " ".join(
                filter(None, [r.name, r.canonical_name, r.area, r.region, r.country])
            ).lower()
        ]
    if area:
        reads = [r for r in reads if (r.area or "").lower() == area.lower()]
    if region:
        reads = [r for r in reads if (r.region or "").lower() == region.lower()]

    if sort == "recent":
        reads.sort(key=lambda r: r.last_ridden.timestamp() if r.last_ridden else 0, reverse=True)
    elif sort == "hardest":
        reads.sort(key=lambda r: r.difficulty or 0, reverse=True)
    elif sort == "longest":
        reads.sort(key=lambda r: r.distance_m, reverse=True)
    elif sort == "steepest":
        reads.sort(key=lambda r: r.avg_gradient_pct, reverse=True)
    elif sort == "name":
        reads.sort(key=lambda r: r.name.lower())
    else:  # attempts
        reads.sort(key=lambda r: (r.attempts, r.difficulty or 0), reverse=True)

    total = len(reads)
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    return SegmentGroupList(items=reads[offset : offset + limit], total=total, counts=counts)


@router.get("/groups/{group_id}", response_model=SegmentGroupDetail)
async def get_segment_group(
    group_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """One merged segment: canonical stats, its lines, and every attempt."""
    group = await group_service.get_group(db, current_user.id, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Segment group not found")

    size = len(group.segments)
    efforts = []
    for seg in group.segments:
        for effort in seg.efforts or []:
            read = _effort_read(effort)
            read.line_km = [
                round(seg.start_dist_m / 1000, 1),
                round(seg.end_dist_m / 1000, 1),
            ]
            efforts.append(read)
    efforts.sort(
        key=lambda e: e.started_at.timestamp() if e.started_at else 0, reverse=True
    )

    return SegmentGroupDetail(
        group=_group_read(group),
        segments=[_segment_read(s, geo_cluster_size=size) for s in group.segments],
        efforts=efforts,
        route_names=sorted({s.route.name for s in group.segments if s.route}),
    )


@router.patch("/groups/{group_id}", response_model=SegmentGroupRead)
async def rename_segment_group(
    group_id: uuid.UUID,
    payload: SegmentGroupUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Set or clear the user-owned name. Empty/null restores the generated one."""
    group = await group_service.rename_group(
        db, current_user.id, group_id, payload.display_name
    )
    if group is None:
        raise HTTPException(status_code=404, detail="Segment group not found")
    return _group_read(group)


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
