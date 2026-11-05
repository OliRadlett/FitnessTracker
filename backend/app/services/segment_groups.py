"""Stable segment groups (the entity the /segments page ranks).

A ``Segment`` is a per-route detection (a *line*). This service folds those
lines into ``SegmentGroup`` rows: one physical/defined segment per user, with a
stable id, a canonical name the rider can override, the canonical line's
profile/metrics, and links from ``segments``/``segment_efforts``.

The grouping seed is the existing ``geo_cluster_id`` (a weekly batch label).
That is a migration seed, **not** the identity: it is the smallest member's
UUID and moves when membership changes. ``identity_key`` is the persisted,
direction-aware geometry hash.

Pure geometry helpers are module-level so they can be unit-tested without a DB.
"""

from __future__ import annotations

import bisect
import hashlib
import re
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.activity import Activity
from app.models.route import Route
from app.models.segment import Segment, SegmentEffort, SegmentGroup
from app.services.polyline_utils import decode_polyline, haversine_distance
from app.services.segments import climb_category

KIND_CLIMB = "climb"
PROFILE_SAMPLES = 48  # 0..48 inclusive → 49 points
GEOMETRY_SAMPLES = 20
GRADIENT_HALF_M = 40.0
STEEPEST_WINDOW_M = 200.0

_GENERIC_ROUTE = re.compile(
    r"^(cycling|option \d+|road ride|ride|morning ride|lunch ride|evening ride|"
    r"afternoon ride|night ride|easy ride)$",
    re.IGNORECASE,
)


# ── pure geometry ──────────────────────────────────────────────────────────


def clean_route_name(name: str) -> str:
    """Turn an import title into a usable base name.

    Mirrors the lab's rule: strip the Strava/Komoot suffix, then keep the first
    clause of an en-dash title when it is substantial enough to stand alone
    (``Gladhouse Reservoir (North) – Gladhouse Reservoir loop``).
    """
    s = re.sub(r"\s+loop from\s+.*$", "", name, flags=re.IGNORECASE)
    s = re.sub(r"\s+-\s+.*$", "", s)
    s = re.sub(r"\s+via\s+.*$", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s+", " ", s).strip()
    left = s.split(" – ")[0]
    if left and len(left) >= 18 and left != s:
        s = left
    return s or name


def identity_key(
    *,
    kind: str,
    start_lat: float,
    start_lng: float,
    end_lat: float,
    end_lng: float,
    distance_m: float,
) -> str:
    """Direction-aware, quantised geometry hash.

    Four decimal places is ~11 m at UK latitudes; a one-metre GPS jitter between
    two detections of the same hill must not mint a second group, while two
    genuinely different climbs are far more than 11 m apart. Distance is rounded
    to 10 m for the same reason. Direction matters: the same road climbed from
    the other side is a different effort.
    """
    raw = (
        f"{kind}|{start_lat:.4f}|{start_lng:.4f}|"
        f"{end_lat:.4f}|{end_lng:.4f}|{round(distance_m / 10)}"
    )
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _route_axis(route: Route) -> tuple[list[float], list[float], list[tuple[float, float]]]:
    """Cumulative metres, elevations, and points along a route polyline.

    Elevations are index-aligned on every route in the real snapshot. If they are
    not, they are interpolated by proportional distance rather than dropped: a
    flattened profile is worse than an approximate one.
    """
    points = decode_polyline(route.encoded_polyline or "")
    if len(points) < 2:
        return [], [], []

    dists: list[float] = []
    cum = 0.0
    for i, (lat, lng) in enumerate(points):
        if i:
            prev = points[i - 1]
            cum += haversine_distance(prev[0], prev[1], lat, lng)
        dists.append(cum)

    profile = route.elevation_profile or {}
    raw: list = []
    if isinstance(profile.get("elevations"), list):
        raw = profile["elevations"]
    elif isinstance(profile.get("elevation"), list):
        raw = profile["elevation"]

    if len(raw) == len(points):
        elevs = [float(v) if v is not None else None for v in raw]
    elif raw and len(raw) >= 2:
        # Evenly spaced samples over the route; map by cumulative distance.
        span = dists[-1] or 1.0
        valid = [(i / (len(raw) - 1) * span, v) for i, v in enumerate(raw) if v is not None]
        xs = [p[0] for p in valid]
        ys = [float(p[1]) for p in valid]
        elevs = []
        for d in dists:
            if not xs:
                elevs.append(None)
                continue
            idx = bisect.bisect_left(xs, d)
            if idx <= 0:
                elevs.append(ys[0])
            elif idx >= len(xs):
                elevs.append(ys[-1])
            else:
                x0, x1 = xs[idx - 1], xs[idx]
                f = 0 if x1 == x0 else (d - x0) / (x1 - x0)
                elevs.append(ys[idx - 1] + (ys[idx] - ys[idx - 1]) * f)
    else:
        elevs = [None] * len(points)

    return dists, elevs, points


def _elev_at(dists: list[float], elevs: list[float | None], d: float) -> float | None:
    if not dists:
        return None
    if d <= dists[0]:
        return elevs[0]
    if d >= dists[-1]:
        return elevs[-1]
    i = bisect.bisect_left(dists, d)
    lo, hi = i - 1, i
    while lo > 0 and elevs[lo] is None:
        lo -= 1
    while hi < len(elevs) - 1 and elevs[hi] is None:
        hi += 1
    a, b = elevs[lo], elevs[hi]
    if a is None or b is None:
        return a if a is not None else b
    span = dists[hi] - dists[lo]
    return a if span <= 0 else a + (b - a) * ((d - dists[lo]) / span)


def _point_at(
    dists: list[float], points: list[tuple[float, float]], d: float
) -> tuple[float, float]:
    if not points:
        return (0.0, 0.0)
    j = min(bisect.bisect_left(dists, d), len(points) - 1)
    return points[j]


def build_profile(
    route: Route, start_dist: float, end_dist: float
) -> dict:
    """Sample the real climb window into profile, geometry and metrics.

    Returns ``{profile, geometry, distance_m, gain_m, avg_gradient_pct,
    max_gradient_pct, steepest_200m_pct, sustained_share, start_lat, start_lng,
    end_lat, end_lng}``. Empty-safe: a route with no geometry returns zeros and
    an empty profile rather than raising.
    """
    dists, elevs, points = _route_axis(route)
    distance = max(0.0, end_dist - start_dist)
    if not points or distance <= 0:
        return {
            "profile": [],
            "geometry": [],
            "distance_m": 0.0,
            "gain_m": 0.0,
            "avg_gradient_pct": 0.0,
            "max_gradient_pct": 0.0,
            "steepest_200m_pct": 0.0,
            "sustained_share": 0.0,
            "start_lat": 0.0,
            "start_lng": 0.0,
            "end_lat": 0.0,
            "end_lng": 0.0,
        }

    profile: list[list[float]] = []
    geometry: list[list[float]] = []
    for i in range(PROFILE_SAMPLES + 1):
        d = start_dist + (distance * i) / PROFILE_SAMPLES
        e = _elev_at(dists, elevs, d)
        if e is None:
            e = 0.0
        lo = max(start_dist, d - GRADIENT_HALF_M)
        hi = min(end_dist, d + GRADIENT_HALF_M)
        e_lo = _elev_at(dists, elevs, lo)
        e_hi = _elev_at(dists, elevs, hi)
        g = 0.0
        if e_lo is not None and e_hi is not None and hi > lo:
            g = max(-25.0, min(25.0, (e_hi - e_lo) / (hi - lo) * 100.0))
        profile.append([round(d - start_dist, 1), round(e, 1), round(g, 1)])

    for i in range(GEOMETRY_SAMPLES + 1):
        d = start_dist + (distance * i) / GEOMETRY_SAMPLES
        j = min(bisect.bisect_left(dists, d), len(points) - 1)
        lat, lng = points[j]
        geometry.append([round(lat, 6), round(lng, 6)])

    start_lat, start_lng = _point_at(dists, points, start_dist)
    end_lat, end_lng = _point_at(dists, points, end_dist)

    elevs_valid = [p[1] for p in profile]
    gain = max(0.0, elevs_valid[-1] - elevs_valid[0])
    avg = (gain / distance) * 100.0 if distance else 0.0
    max_grad = max((p[2] for p in profile), default=0.0)

    window = min(STEEPEST_WINDOW_M, max(60.0, distance * 0.5))
    steepest = 0.0
    d = start_dist
    while d + window <= end_dist + 0.01:
        a = _elev_at(dists, elevs, d)
        b = _elev_at(dists, elevs, d + window)
        if a is not None and b is not None:
            steepest = max(steepest, (b - a) / window * 100.0)
        d += 10.0

    climbing = sum(1 for p in profile if p[2] >= avg * 0.75)
    return {
        "profile": profile,
        "geometry": geometry,
        "distance_m": round(distance, 1),
        "gain_m": round(gain, 1),
        "avg_gradient_pct": round(avg, 2),
        "max_gradient_pct": round(max_grad, 1),
        "steepest_200m_pct": round(max(0.0, steepest), 1),
        "sustained_share": round(climbing / len(profile), 2) if profile else 0.0,
        "start_lat": float(start_lat),
        "start_lng": float(start_lng),
        "end_lat": float(end_lat),
        "end_lng": float(end_lng),
    }


def canonical_name(base: str, ordinal: int, total: int) -> str:
    """``Route`` or ``Route · climb N``, never a raw import title alone."""
    if _GENERIC_ROUTE.match(base):
        return f"Climb {ordinal}" if total > 1 else "Climb"
    if total > 1:
        return f"{base} · climb {ordinal}"
    return base


# ── DB glue ────────────────────────────────────────────────────────────────


def _assisted_from(sport_type: str | None, raw_data: dict | None) -> bool:
    """Classify an activity as assisted from provider metadata.

    Strava stores the provider value in ``raw_data.sport_type`` (``EBikeRide``,
    ``EMountainBikeRide``); the internal ``sport_type`` is normalised to
    ``cycling`` and loses that. Anything we cannot read is treated as human
    (``False``) for legacy rows — the provider says how it was recorded, and
    the matcher will set ``True``/``NULL`` where it has better evidence.
    """
    values = [sport_type or ""]
    if isinstance(raw_data, dict):
        values.extend(
            str(raw_data.get(k) or "")
            for k in ("sport_type", "type", "activity_type")
        )
    text = " ".join(values).lower()
    return any(token in text for token in ("ebike", "e-bike", "emtb", "assisted"))


def _unique_activities(segments: list[Segment]) -> int:
    return len({e.activity_id for s in segments for e in (s.efforts or [])})


async def rebuild_user_groups(
    db: AsyncSession, user_id: uuid.UUID
) -> dict[str, int]:
    """Create/update every group for one user from the current segments.

    Idempotent: an existing ``group_id`` on any member wins (so a user's
    ``display_name`` survives a route edit that changes the geometry hash),
    then ``identity_key``, then a new row. Segments and efforts are re-pointed;
    nothing is deleted.

    This is a backfill/rebuild, not a per-sync path. It loads the user's whole
    segment set because grouping one route in isolation would split a hill that
    crosses routes.
    """
    result = await db.execute(
        select(Segment)
        .where(Segment.user_id == user_id)
        .options(
            selectinload(Segment.route),
            selectinload(Segment.efforts),
        )
    )
    segments = list(result.scalars().all())
    if not segments:
        return {"groups": 0, "segments": 0, "efforts": 0}

    # Classify the legacy efforts once. Provider sport types are in raw_data;
    # the internal sport_type has already been normalised to "cycling".
    activity_ids = {
        e.activity_id for s in segments for e in (s.efforts or [])
    }
    assist_by_activity: dict[uuid.UUID, bool] = {}
    if activity_ids:
        act_rows = await db.execute(
            select(Activity.id, Activity.sport_type, Activity.raw_data).where(
                Activity.id.in_(activity_ids)
            )
        )
        assist_by_activity = {
            row[0]: _assisted_from(row[1], row[2]) for row in act_rows.all()
        }

    groups_result = await db.execute(
        select(SegmentGroup).where(
            SegmentGroup.user_id == user_id, SegmentGroup.kind == KIND_CLIMB
        )
    )
    groups = list(groups_result.scalars().all())
    by_segment_group: dict[uuid.UUID, SegmentGroup] = {}
    by_identity = {g.identity_key: g for g in groups}
    by_id = {g.id: g for g in groups}
    for seg in segments:
        if seg.group_id and seg.group_id in by_id:
            by_segment_group[seg.id] = by_id[seg.group_id]

    # Build the per-route climb ordinal once. A route's segments are ordered by
    # start distance so "climb 2" is the second climb you meet, not a UUID order.
    per_route: dict[uuid.UUID, list[Segment]] = {}
    for seg in segments:
        per_route.setdefault(seg.route_id, []).append(seg)
    ordinal: dict[uuid.UUID, tuple[int, int]] = {}
    for route_segments in per_route.values():
        ordered = sorted(route_segments, key=lambda s: s.start_dist_m)
        for i, seg in enumerate(ordered, start=1):
            ordinal[seg.id] = (i, len(ordered))

    # Group by the current display label. A missing label is its own group: it
    # has not been clustered yet, and inventing a merge would be wrong.
    clusters: dict[str, list[Segment]] = {}
    for seg in segments:
        key = str(seg.geo_cluster_id or seg.id)
        clusters.setdefault(key, []).append(seg)

    touched_group_ids: set[uuid.UUID] = set()
    segments_touched = 0
    efforts_touched = 0

    for key, members in clusters.items():
        canonical = max(
            members,
            key=lambda s: (_unique_activities([s]), s.distance_m),
        )
        route = canonical.route
        if route is None or not route.encoded_polyline:
            # A segment without geometry cannot produce a profile. Leave its
            # group unset rather than writing zeros that look measured.
            continue

        geom = build_profile(route, canonical.start_dist_m, canonical.end_dist_m)
        idk = identity_key(
            kind=KIND_CLIMB,
            start_lat=geom["start_lat"],
            start_lng=geom["start_lng"],
            end_lat=geom["end_lat"],
            end_lng=geom["end_lng"],
            distance_m=geom["distance_m"],
        )

        existing: SegmentGroup | None = None
        for m in members:
            existing = by_segment_group.get(m.id)
            if existing is not None:
                break
        if existing is None:
            existing = by_identity.get(idk)

        base = clean_route_name(route.name or "Climb")
        idx, total = ordinal.get(canonical.id, (1, 1))
        name = canonical_name(base, idx, total)
        category = climb_category(geom["gain_m"], geom["avg_gradient_pct"])

        if existing is None:
            existing = SegmentGroup(
                id=uuid.uuid4(),
                user_id=user_id,
                kind=KIND_CLIMB,
                canonical_name=name,
                name_source="route",
                identity_key=idk,
                distance_m=geom["distance_m"],
                gain_m=geom["gain_m"],
                avg_gradient_pct=geom["avg_gradient_pct"],
                max_gradient_pct=geom["max_gradient_pct"],
                steepest_200m_pct=geom["steepest_200m_pct"],
                sustained_share=geom["sustained_share"],
            )
            db.add(existing)
            by_id[existing.id] = existing
            by_identity[idk] = existing
            touched_group_ids.add(existing.id)
        else:
            # canonical_name is generated; display_name is the user's and is
            # never touched. A recompute that overwrote a rename would undo the
            # only durable answer to the naming problem.
            existing.canonical_name = name
            existing.distance_m = geom["distance_m"]
            existing.gain_m = geom["gain_m"]
            existing.avg_gradient_pct = geom["avg_gradient_pct"]
            existing.max_gradient_pct = geom["max_gradient_pct"]
            existing.steepest_200m_pct = geom["steepest_200m_pct"]
            existing.sustained_share = geom["sustained_share"]
            touched_group_ids.add(existing.id)

        existing.profile = geom["profile"]
        existing.geometry = geom["geometry"]
        existing.centroid_lat = round((geom["start_lat"] + geom["end_lat"]) / 2, 6)
        existing.centroid_lng = round((geom["start_lng"] + geom["end_lng"]) / 2, 6)
        existing.category = category
        existing.difficulty = canonical.difficulty_score
        existing.area = route.locality or existing.area
        existing.region = existing.region or route.country
        existing.country = route.country or existing.country
        existing.updated_at = datetime.now(UTC)

        for m in members:
            if m.route is not None and m.route.encoded_polyline:
                m.geometry = build_profile(
                    m.route, m.start_dist_m, m.end_dist_m
                )["geometry"]
            if m.group_id != existing.id:
                m.group_id = existing.id
            segments_touched += 1
            by_segment_group[m.id] = existing
            for effort in m.efforts or []:
                effort.group_id = existing.id
                if effort.assisted is None:
                    effort.assisted = assist_by_activity.get(effort.activity_id, False)
                efforts_touched += 1

    await db.flush()
    return {
        "groups": len(touched_group_ids),
        "segments": segments_touched,
        "efforts": efforts_touched,
    }


async def list_groups(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    kind: str = KIND_CLIMB,
) -> list[SegmentGroup]:
    """Every group for a user, with the lines and efforts needed by the page."""
    result = await db.execute(
        select(SegmentGroup)
        .where(SegmentGroup.user_id == user_id, SegmentGroup.kind == kind)
        .order_by(SegmentGroup.canonical_name.asc())
        .options(
            selectinload(SegmentGroup.segments).selectinload(Segment.efforts),
            selectinload(SegmentGroup.segments).selectinload(Segment.route),
        )
    )
    return list(result.scalars().all())


async def get_group(
    db: AsyncSession, user_id: uuid.UUID, group_id: uuid.UUID
) -> SegmentGroup | None:
    result = await db.execute(
        select(SegmentGroup)
        .where(SegmentGroup.id == group_id, SegmentGroup.user_id == user_id)
        .options(
            selectinload(SegmentGroup.segments)
            .selectinload(Segment.efforts)
            .selectinload(SegmentEffort.activity),
            selectinload(SegmentGroup.segments).selectinload(Segment.route),
        )
    )
    return result.scalar_one_or_none()


async def rename_group(
    db: AsyncSession, user_id: uuid.UUID, group_id: uuid.UUID, name: str | None
) -> SegmentGroup | None:
    group = await get_group(db, user_id, group_id)
    if group is None:
        return None
    cleaned = (name or "").strip()
    if not cleaned:
        group.display_name = None
        group.name_source = "route"
    else:
        group.display_name = cleaned[:200]
        group.name_source = "user"
    await db.flush()
    return group
