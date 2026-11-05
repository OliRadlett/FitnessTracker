"""Match activities to segment groups using the stored **latlng sample stream**.

The first matcher attempt used `raw_data.map.summary_polyline`; on the real
account it recovered only 9 of 38 known efforts because a 1.3 km climb on a
111 km ride has ~3 polyline vertices. This version requires the sample-level
`latlng` stream (requested for new rides; backfilled for old ones) and refuses
to guess when it is absent.

`dry_run=True` returns the evidence and writes nothing. The production path is
still gated on a dry-run review; nothing here is wired into a task or endpoint.
"""

from __future__ import annotations

import math
import uuid
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.activity import Activity
from app.models.segment import Segment, SegmentEffort, SegmentGroup
from app.services.polyline_utils import haversine_distance
from app.services.segment_groups import KIND_CLIMB, _assisted_from
from app.services.segments import (
    _resolve_cumulative_distance,
    _stream_map,
    compute_effort_for_window,
)

# Sample-level GPS is accurate to a few metres; these are tighter than the
# summary-polyline experiment ever could be.
MAX_POINT_OFFSET_M = 50.0
MAX_MEDIAN_OFFSET_M = 25.0
MAX_P90_OFFSET_M = 55.0
# A group's canonical line can differ from the line the rider actually took
# (896 m vs 1,024 m on one real hill), so the span tolerance has to cover the
# line spread. The offset limits are what keep this from matching a different
# road; a 1.5 m median on a 1 km climb is the signal, not the ratio.
MIN_SPAN_FRACTION = 0.80
MAX_SPAN_FRACTION = 1.20


def _project(
    lat: float,
    lng: float,
    a: tuple[float, float],
    b: tuple[float, float],
    *,
    lat0: float,
    lng0: float,
) -> tuple[float, float]:
    """Distance (m) from a point to segment AB, and the fraction along AB."""
    kx = 111_320.0 * math.cos(math.radians(lat0))
    ky = 110_540.0
    ax, ay = (a[1] - lng0) * kx, (a[0] - lat0) * ky
    bx, by = (b[1] - lng0) * kx, (b[0] - lat0) * ky
    px, py = (lng - lng0) * kx, (lat - lat0) * ky
    dx, dy = bx - ax, by - ay
    denom = dx * dx + dy * dy
    t = 0.0 if denom == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / denom))
    qx, qy = ax + t * dx, ay + t * dy
    return math.hypot(px - qx, py - qy), t


def _cumulative(points: list[list[float]]) -> list[float]:
    out = [0.0]
    for i in range(1, len(points)):
        out.append(out[-1] + haversine_distance(*points[i - 1], *points[i]))
    return out


def match_geometry(
    climb: list[list[float]], ride: list[list[float]]
) -> dict | None:
    """Project a climb geometry onto a ride trace as a monotonic path.

    Each climb point keeps every candidate within ``MAX_POINT_OFFSET_M`` and a
    small dynamic program chooses the lowest-offset path whose cumulative
    distance increases by a plausible step. This is what stops a loop or an
    out-and-back from snapping one point to the return pass.
    """
    if len(climb) < 2 or len(ride) < 2:
        return None

    ride_cum = _cumulative(ride)
    total = ride_cum[-1]
    if total <= 0:
        return None

    lat0, lng0 = ride[0][0], ride[0][1]
    point_candidates: list[list[tuple[float, float]]] = []
    for clat, clng in climb:
        cands: list[tuple[float, float]] = []
        for i in range(1, len(ride)):
            d, t = _project(clat, clng, ride[i - 1], ride[i], lat0=lat0, lng0=lng0)
            if d <= MAX_POINT_OFFSET_M:
                cands.append(
                    (ride_cum[i - 1] + t * (ride_cum[i] - ride_cum[i - 1]), d)
                )
        if not cands:
            return None
        cands.sort(key=lambda c: c[1])
        point_candidates.append(cands[:12])

    climb_len = sum(
        haversine_distance(*climb[i - 1], *climb[i]) for i in range(1, len(climb))
    )
    if climb_len <= 0:
        return None
    expected_step = climb_len / (len(climb) - 1)
    max_step = max(80.0, expected_step * 4.0)

    paths: list[tuple[float, float, list[tuple[float, float]]]] = [
        (cum, off, [(cum, off)]) for cum, off in point_candidates[0]
    ]
    for i in range(1, len(climb)):
        nxt: list[tuple[float, float, list[tuple[float, float]]]] = []
        for last_cum, cost, seq in paths:
            for cum, off in point_candidates[i]:
                delta = cum - last_cum
                if 0.2 <= delta <= max_step:
                    nxt.append((cum, cost + off, seq + [(cum, off)]))
        if not nxt:
            return None
        nxt.sort(key=lambda p: p[1])
        paths = nxt[:40]

    valid = [
        p
        for p in paths
        if climb_len * 0.9 <= (p[2][-1][0] - p[2][0][0]) <= climb_len * 1.1
    ]
    chosen = min(valid or paths, key=lambda p: p[1])
    cums = [c for c, _ in chosen[2]]
    offsets = sorted(o for _, o in chosen[2])
    span = cums[-1] - cums[0]
    if span <= 0:
        return None
    median = offsets[len(offsets) // 2]
    p90 = offsets[min(len(offsets) - 1, int(len(offsets) * 0.9))]
    if median > MAX_MEDIAN_OFFSET_M or p90 > MAX_P90_OFFSET_M:
        return None
    return {
        "start_frac": cums[0] / total,
        "end_frac": cums[-1] / total,
        "median_offset": round(median, 1),
        "p90_offset": round(p90, 1),
        "span_m": round(span, 1),
    }


async def _candidates(db: AsyncSession, user_id: uuid.UUID) -> list[SegmentGroup]:
    result = await db.execute(
        select(SegmentGroup)
        .where(SegmentGroup.user_id == user_id, SegmentGroup.kind == KIND_CLIMB)
        .options(selectinload(SegmentGroup.segments).selectinload(Segment.efforts))
    )
    return [g for g in result.scalars().all() if g.geometry]


def _best_line(
    group: SegmentGroup, ride: list[list[float]]
) -> tuple[Segment, dict] | None:
    """Match the ride against every stored line, not just the canonical one.

    A hill's lines can differ by >20 % in length (896 m vs 1,024 m in the real
    set). The canonical line is the map shape; the ridden line is whichever
    member's geometry actually matches.
    """
    best: tuple[float, Segment, dict] | None = None
    for seg in group.segments:
        geometry = seg.geometry
        if not geometry:
            continue
        match = match_geometry(geometry, ride)
        if match is None:
            continue
        ratio = match["span_m"] / seg.distance_m if seg.distance_m else 0.0
        if not MIN_SPAN_FRACTION <= ratio <= MAX_SPAN_FRACTION:
            continue
        score = match["median_offset"] + abs(ratio - 1.0) * 50.0
        if best is None or score < best[0]:
            best = (score, seg, match)
    if best is None:
        return None
    return best[1], best[2]


async def match_activity(
    db: AsyncSession,
    group: SegmentGroup,
    activity: Activity,
    *,
    dry_run: bool,
) -> dict | None:
    """Match one loaded activity against one group. No latlng → no match."""
    if activity.sport_type != "cycling":
        return None
    streams = _stream_map(activity.streams or [])
    latlng = streams.get("latlng")
    if not latlng or len(latlng) < 2:
        return None

    chosen = _best_line(group, latlng)
    if chosen is None:
        return None
    canonical, geom = chosen

    resolved = _resolve_cumulative_distance(streams)
    if resolved is None:
        return None
    cum, elapsed_axis = resolved
    if len(cum) < 2 or cum[-1] <= 0:
        return None
    dt = elapsed_axis[1] - elapsed_axis[0] if len(elapsed_axis) > 1 else 1.0
    start_d = geom["start_frac"] * cum[-1]
    end_d = geom["end_frac"] * cum[-1]

    effort = compute_effort_for_window(
        cum_dist=cum,
        dt=dt,
        segment={
            "start_dist": start_d,
            "end_dist": end_d,
            "distance_m": end_d - start_d,
        },
        power=streams.get("watts") or streams.get("power"),
        hr=streams.get("heartrate"),
        altitude=streams.get("altitude"),
        elapsed_axis=elapsed_axis,
    )
    if effort is None:
        return None

    started_at = (
        activity.start_date
        + timedelta(
            seconds=int(
                elapsed_axis[effort["start_idx"]]
                if effort["start_idx"] < len(elapsed_axis)
                else effort["start_idx"] * dt
            )
        )
        if activity.start_date
        else None
    )
    report = {
        "group": group.canonical_name,
        "group_id": str(group.id),
        "activity": activity.name,
        "activity_id": str(activity.id),
        "line_id": str(canonical.id),
        "line_km": [
            round(canonical.start_dist_m / 1000, 1),
            round(canonical.end_dist_m / 1000, 1),
        ],
        "span_m": geom["span_m"],
        "climb_m": canonical.distance_m,
        "median_offset_m": geom["median_offset"],
        "p90_offset_m": geom["p90_offset"],
        "elapsed_seconds": effort["elapsed_seconds"],
        "power_w": effort["avg_power_watts"],
        "vam": effort["effort_vam"],
        "assisted": _assisted_from(activity.sport_type, activity.raw_data),
    }
    if dry_run:
        return report

    existing = await db.execute(
        select(SegmentEffort.id).where(
            SegmentEffort.activity_id == activity.id,
            (SegmentEffort.group_id == group.id)
            | (SegmentEffort.segment_id == canonical.id),
        )
    )
    if existing.scalar_one_or_none() is not None:
        return {**report, "skipped": "existing"}

    db.add(
        SegmentEffort(
            segment_id=canonical.id,
            group_id=group.id,
            activity_id=activity.id,
            started_at=started_at,
            elapsed_seconds=effort["elapsed_seconds"],
            avg_power_watts=effort["avg_power_watts"],
            avg_hr=effort["avg_hr"],
            avg_speed_mps=effort["avg_speed_mps"],
            effort_vam=effort["effort_vam"],
            assisted=report["assisted"],
        )
    )
    return report


async def dry_run_user(db: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    """Every plausible match, written to nothing."""
    groups = await _candidates(db, user_id)
    activities = (
        await db.execute(
            select(Activity)
            .where(Activity.user_id == user_id, Activity.sport_type == "cycling")
            .options(selectinload(Activity.streams))
        )
    ).scalars().all()

    reports: list[dict] = []
    for activity in activities:
        streams = _stream_map(activity.streams or [])
        if not streams.get("latlng"):
            continue
        for group in groups:
            report = await match_activity(db, group, activity, dry_run=True)
            if report:
                reports.append(report)
    return reports
