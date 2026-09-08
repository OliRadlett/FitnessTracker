"""Ride segment analysis (§3.13).

Geometry-defined climbing segments extracted from a route's polyline +
elevation profile, with per-ride efforts (elapsed time, power, HR, speed,
VAM) computed by distance-aligning activity streams to the segment window.
Each segment becomes a leaderboard-of-self: the rider's own PRs across
repeated rides of the route.

Pure geometry functions (:func:`detect_climb_segments`,
:func:`climb_category`) are unit-tested without a database.
"""

from __future__ import annotations

import math
import uuid
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.activity import Activity, ActivityStream
from app.models.route import Route
from app.models.segment import Segment, SegmentEffort
from app.services.polyline_utils import decode_polyline, haversine_distance

# Climb-detection thresholds.
MIN_SEGMENT_GAIN_M = 0.3  # elevation rise that counts as "climbing" locally
GAP_DROP_MAX_M = 8.0  # a bigger single-pair descent ends the climb candidate
MIN_CLIMB_GAIN_M = 30.0
MIN_CLIMB_AVG_GRADIENT = 0.03  # 3%
MIN_CLIMB_LENGTH_M = 150.0
# Distance-window tolerance for matching an activity pass to a segment.
MAX_ALIGNMENT_TOL_M = 25.0
ALIGNMENT_TOL_FRACTION = 0.05
MIN_COVERAGE_FRACTION = 0.9
# Climbing is deemed "on" above this local gradient (0.4%).
LOCAL_CLIMB_GRADIENT = 0.004
# Non-climbing tail (plateau / saddle) that still counts as part of a climb,
# measured in meters of travel after the last new-high point.
FLAT_TAIL_MAX_M = 200.0


# ── Pure geometry ─────────────────────────────────────────────────────────


def _distance_elevation_profile(
    encoded_polyline: str,
    elevation_profile: dict | None,
) -> list[dict]:
    """Distance-aligned (dist, ele, lat, lng) points along a route polyline.

    Narrows just the polyline points; elevations are aligned to each point
    for either stored shape (``{"elevations": [...]}`` per polyline point, or
    ``{"distance": [...], "elevation": [...]}``) with linear interpolation.
    Missing elevation → ``None`` (:func:`detect_climb_segments` treats it as
    flat, so only the gradient-relevant section starts a climb).
    """
    points = decode_polyline(encoded_polyline)
    if len(points) < 2:
        return []

    profile: list[dict] = []
    cumulative = 0.0
    for i, (lat, lng) in enumerate(points):
        if i > 0:
            prev_lat, prev_lng = points[i - 1]
            cumulative += haversine_distance(prev_lat, prev_lng, lat, lng)
        profile.append({"dist": cumulative, "ele": None, "lat": lat, "lng": lng})

    if elevation_profile is None:
        return profile

    if "elevations" in elevation_profile:
        raw = elevation_profile["elevations"]
        if len(raw) == len(profile):
            for p, ele in zip(profile, raw):
                p["ele"] = float(ele) if ele is not None else None
        elif len(raw) >= 2:
            # Mismatched sampling — interpolate per polyline point.
            ele_profile = _interp_elevations(raw)
            for p in profile:
                p["ele"] = ele_profile(p["dist"]) if p["ele"] is None else p["ele"]
        return profile

    if "distance" in elevation_profile and "elevation" in elevation_profile:
        dists = [float(d) for d in elevation_profile["distance"]]
        eles = elevation_profile["elevation"]
        if len(dists) >= 2:
            lookup = _interp_elevations_by_dist(dists, eles)
            for p in profile:
                p["ele"] = lookup(p["dist"])
        return profile

    return profile


def _interp_elevations(raw: list):
    """Return a distance → elevation interpolator for evenly-spaced samples."""
    n = len(raw)
    span = float(n - 1)

    def lookup(dist_m: float) -> float | None:
        if dist_m <= 0:
            return float(raw[0]) if raw[0] is not None else None
        idx = dist_m / span
        i = min(int(idx), n - 2)
        frac = idx - i
        a, b = raw[i], raw[i + 1]
        if a is None or b is None:
            valid = [v for v in (a, b) if v is not None]
            return float(valid[0]) if valid else None
        return float(a + frac * (b - a))

    return lookup


def _interp_elevations_by_dist(dists: list[float], eles: list):
    """Return a distance → elevation interpolator over an irregular profile."""
    n = len(dists)
    valid = [(d, e) for d, e in zip(dists, eles) if e is not None]
    if not valid:
        return lambda _dist_m: None

    def lookup(dist_m: float) -> float | None:
        if dist_m <= valid[0][0]:
            return valid[0][1]
        if dist_m >= valid[-1][0]:
            return valid[-1][1]
        for i in range(1, len(valid)):
            if dist_m <= valid[i][0]:
                pa, ea = valid[i - 1]
                pb, eb = valid[i]
                frac = (dist_m - pa) / max(pb - pa, 1e-9)
                return float(ea + frac * (eb - ea))
        return valid[-1][1]

    return lookup


def climb_category(gain_m: float, avg_gradient_pct: float) -> str | None:
    """Strava-style climb categorisation from gain + average gradient."""
    if avg_gradient_pct >= 7.5 and gain_m >= 900:
        return "HC"
    if avg_gradient_pct >= 5.0 and gain_m >= 450:
        return "1"
    if avg_gradient_pct >= 5.0 and gain_m >= 150:
        return "2"
    if avg_gradient_pct >= 4.0 and gain_m >= 100:
        return "3"
    if avg_gradient_pct >= 3.0 and gain_m >= 30:
        return "4"
    return None


def detect_climb_segments(
    profile: list[dict],
    *,
    min_gain_m: float = MIN_CLIMB_GAIN_M,
    min_avg_gradient: float = MIN_CLIMB_AVG_GRADIENT,
    min_length_m: float = MIN_CLIMB_LENGTH_M,
) -> list[dict]:
    """Detect sustained climbs in a distance-aligned elevation profile.

    Walks point-pairs; a run of climbing (average rise, no single descent
    beyond ``GAP_DROP_MAX_M``) becomes a candidate segment once it meets the
    gain/gradient/length thresholds. Returns list of dicts:
    ``{start_dist, end_dist, distance_m, elevation_gain_m, avg_gradient_pct,
    max_gradient_pct, peak_elevation_m, start_lat, start_lng, end_lat, end_lng}``.
    """
    segments: list[dict] = []
    i = 0
    n = len(profile)
    while i < n - 1:
        # Find the start of an upward run.
        while i < n - 1 and not _rises(profile[i], profile[i + 1]):
            i += 1
        if i >= n - 1:
            break

        start = i
        j = i
        max_gradient = 0.0
        peak = profile[i]["ele"]
        peak_idx = i
        tail_dist = 0.0
        while j < n - 1:
            a, b = profile[j], profile[j + 1]
            rise = _rise(a, b)
            if rise < -GAP_DROP_MAX_M:
                break
            max_gradient = max(max_gradient, _pair_gradient(a, b))
            if b["ele"] is not None and (peak is None or b["ele"] > peak):
                peak = b["ele"]
                peak_idx = j + 1
                tail_dist = 0.0
            else:
                tail_dist += b["dist"] - a["dist"]
                if tail_dist > FLAT_TAIL_MAX_M:
                    break
            j += 1

        # Trim to the summit — a flat/downhill tail isn't part of the climb.
        end = peak_idx
        seg = _finalise_climb(profile, start, end, max_gradient, peak)
        if seg is not None:
            ok = (
                seg["elevation_gain_m"] >= min_gain_m
                and seg["avg_gradient_pct"] >= min_avg_gradient * 100
                and seg["distance_m"] >= min_length_m
            )
            if ok:
                segments.append(seg)
        # Continue scanning from the summit so a fresh valley climb is found.
        i = max(end, start + 1)

    return segments


def _rise(a: dict, b: dict) -> float:
    if a["ele"] is None or b["ele"] is None:
        return 0.0
    return b["ele"] - a["ele"]


def _rises(a: dict, b: dict) -> bool:
    """True when the pair is climbing (or holding near-flat while ascending)."""
    if a["ele"] is None or b["ele"] is None:
        return False
    return b["ele"] - a["ele"] >= MIN_SEGMENT_GAIN_M or (
        _pair_gradient(a, b) >= LOCAL_CLIMB_GRADIENT
    )


def _pair_gradient(a: dict, b: dict) -> float:
    delta = b["dist"] - a["dist"]
    if a["ele"] is None or b["ele"] is None or delta <= 0:
        return 0.0
    return (b["ele"] - a["ele"]) / delta


def _finalise_climb(
    profile: list[dict],
    start: int,
    end: int,
    max_gradient: float,
    peak: float | None,
) -> dict | None:
    a, b = profile[start], profile[end]
    distance_m = b["dist"] - a["dist"]
    gain = max(0.0, _rise(a, b))
    if distance_m <= 0:
        return None
    return {
        "start_dist": a["dist"],
        "end_dist": b["dist"],
        "distance_m": round(distance_m, 1),
        "elevation_gain_m": round(gain, 1),
        "avg_gradient_pct": round(gain / distance_m * 100, 2),
        "max_gradient_pct": round(max_gradient * 100, 2),
        "peak_elevation_m": round(peak, 1) if peak is not None else None,
        "start_lat": a["lat"],
        "start_lng": a["lng"],
        "end_lat": b["lat"],
        "end_lng": b["lng"],
    }


def _segment_name(
    route_name: str, start_dist: float, end_dist: float, index: int
) -> str:
    return f"{route_name} · km {start_dist / 1000:.1f}–{end_dist / 1000:.1f}"


# ── Effort windowing ──────────────────────────────────────────────────────


def _activity_cumulative_distance(
    velocity_data: list, resolution: int | None
) -> list[float]:
    """Integrate a velocity stream into cumulative meters per sample.

    Missing/zero velocity samples keep distance flat; ``resolution`` is the
    seconds-per-point timebase.
    """
    dt = float(resolution or 1)
    if not velocity_data:
        return []
    cum = [0.0]
    for v in velocity_data[1:]:
        if isinstance(v, (int, float)) and math.isfinite(float(v)):
            cum.append(cum[-1] + float(v) * dt)
        else:
            cum.append(cum[-1])
    return cum


def _window_indices(
    cum_dist: list[float], start_dist: float, end_dist: float, tol: float
):
    """Nearest index to each boundary within tolerance, else ``None``."""
    if not cum_dist:
        return None, None

    start_idx = min(
        range(len(cum_dist)),
        key=lambda i: abs(cum_dist[i] - start_dist),
    )
    end_idx = min(
        range(len(cum_dist)),
        key=lambda i: abs(cum_dist[i] - end_dist),
    )
    if abs(cum_dist[start_idx] - start_dist) > tol:
        return None, None
    if abs(cum_dist[end_idx] - end_dist) > tol:
        return None, None
    if end_idx <= start_idx:
        return None, None
    return start_idx, end_idx


def _mean(values: list, *, min_keep=0) -> float | None:
    vals = [
        float(v)
        for v in values
        if isinstance(v, (int, float))
        and math.isfinite(float(v))
        and v not in (0, None)
    ]
    if len(vals) < min_keep or not vals:
        return None
    return sum(vals) / len(vals)


def compute_effort_for_window(
    *,
    cum_dist: list[float],
    dt: float,
    segment: dict,
    power: list | None = None,
    hr: list | None = None,
    altitude: list | None = None,
) -> dict | None:
    """Time/power/HR/speed/VAM for one ride pass over a segment window.

    ``segment`` is a detection dict from :func:`detect_climb_segments`.
    Falls back to ``None`` when the ride doesn't cover the segment window
    (alignment tolerance or ≥90% coverage).
    """
    tol = max(MAX_ALIGNMENT_TOL_M, ALIGNMENT_TOL_FRACTION * segment["distance_m"])
    start_idx, end_idx = _window_indices(
        cum_dist, segment["start_dist"], segment["end_dist"], tol
    )
    if start_idx is None or end_idx is None:
        return None

    covered = cum_dist[end_idx] - cum_dist[start_idx]
    if covered < MIN_COVERAGE_FRACTION * segment["distance_m"]:
        return None

    elapsed = (end_idx - start_idx) * dt
    # Power bucket-per-second, mimicking the power-curve logic: average the
    # per-sample values (watts are 1s samples at high resolution).
    avg_power = _mean(power[start_idx : end_idx + 1]) if power else None
    avg_hr = _mean(hr[start_idx : end_idx + 1]) if hr else None
    avg_speed = covered / elapsed if elapsed > 0 else 0.0
    effort_vam = None
    if altitude is not None and elapsed > 0:
        alt_slice = [
            float(v)
            for v in altitude[start_idx : end_idx + 1]
            if isinstance(v, (int, float)) and math.isfinite(float(v)) and v is not None
        ]
        if len(alt_slice) >= 2:
            gain = max(0.0, alt_slice[-1] - alt_slice[0])
            if gain > 0:
                effort_vam = round(gain / elapsed * 3600, 1)

    return {
        "start_idx": start_idx,
        "end_idx": end_idx,
        "elapsed_seconds": round(elapsed, 1),
        "avg_power_watts": round(avg_power, 1) if avg_power else None,
        "avg_hr": round(avg_hr, 1) if avg_hr else None,
        "avg_speed_mps": round(avg_speed, 2),
        "effort_vam": effort_vam,
    }


# ── DB glue ───────────────────────────────────────────────────────────────


def _stream_map(streams: list[ActivityStream]) -> dict[str, list]:
    out: dict[str, list] = {}
    for s in streams:
        data = s.data.get("data") if isinstance(s.data, dict) else s.data
        out[s.stream_type] = list(data or [])
        out.setdefault("resolution", s.resolution)
    return out


async def _linked_activities(db: AsyncSession, route_id: uuid.UUID) -> list[Activity]:
    result = await db.execute(
        select(Activity)
        .where(
            Activity.route_id == route_id,
            Activity.sport_type == "cycling",
        )
        .order_by(Activity.start_date.asc())
        .options(selectinload(Activity.streams))
    )
    return list(result.scalars().all())


async def sync_route_segments(
    db: AsyncSession,
    user_id: uuid.UUID,
    route_id: uuid.UUID,
) -> list[Segment]:
    """Recompute segments + efforts for one route (delete-and-recreate)."""
    route = await db.get(Route, route_id)
    if route is None or route.user_id != user_id:
        raise LookupError("Route not found")

    profile = _distance_elevation_profile(
        route.encoded_polyline, route.elevation_profile
    )
    climbs = detect_climb_segments(profile)

    # Delete-and-recreate keeps geometry authoritative (unique route-range).
    existing = await db.execute(
        delete(Segment).where(Segment.route_id == route_id, Segment.user_id == user_id)
    )
    await db.flush()  # ensure deletes are visible for cascade-safety in tests

    created: list[Segment] = []
    for i, climb in enumerate(climbs):
        seg = Segment(
            user_id=user_id,
            route_id=route_id,
            name=_segment_name(route.name, climb["start_dist"], climb["end_dist"], i),
            start_dist_m=climb["start_dist"],
            end_dist_m=climb["end_dist"],
            distance_m=climb["distance_m"],
            elevation_gain_m=climb["elevation_gain_m"],
            avg_gradient_pct=climb["avg_gradient_pct"],
            max_gradient_pct=climb["max_gradient_pct"],
            peak_elevation_m=climb["peak_elevation_m"],
            start_lat=climb["start_lat"],
            start_lng=climb["start_lng"],
            end_lat=climb["end_lat"],
            end_lng=climb["end_lng"],
            climb_category=climb_category(
                climb["elevation_gain_m"], climb["avg_gradient_pct"]
            ),
        )
        db.add(seg)
        created.append(seg)

    await db.flush()

    ridden_activities = 0
    for activity in await _linked_activities(db, route_id):
        streams = _stream_map(activity.streams)
        velocity = (
            streams.get("velocity_smooth")
            or streams.get("velocity")
            or streams.get("speed")
        )
        res = streams.get("resolution") or 1
        if not velocity:
            continue
        dt = float(res or 1)
        cum = _activity_cumulative_distance(velocity, res)
        if not cum:
            continue

        power = streams.get("watts") or streams.get("power")
        hr = streams.get("heartrate")
        altitude = streams.get("altitude")
        gained_effort = False

        for seg in created:
            effort = compute_effort_for_window(
                cum_dist=cum,
                dt=dt,
                segment={
                    "start_dist": seg.start_dist_m,
                    "end_dist": seg.end_dist_m,
                    "distance_m": seg.distance_m,
                },
                power=power,
                hr=hr,
                altitude=altitude,
            )
            if effort is None:
                continue
            base = activity.start_date
            started_at = (
                base + timedelta(seconds=int(effort["start_idx"] * dt))
                if base
                else None
            )
            db.add(
                SegmentEffort(
                    segment_id=seg.id,
                    activity_id=activity.id,
                    started_at=started_at,
                    elapsed_seconds=effort["elapsed_seconds"],
                    avg_power_watts=effort["avg_power_watts"],
                    avg_hr=effort["avg_hr"],
                    avg_speed_mps=effort["avg_speed_mps"],
                    effort_vam=effort["effort_vam"],
                )
            )
            gained_effort = True

        if gained_effort:
            ridden_activities += 1

    # Denormalized leaderboard totals.
    for seg in created:
        result = await db.execute(
            select(SegmentEffort).where(SegmentEffort.segment_id == seg.id)
        )
        efforts = list(result.scalars().all())
        seg.times_ridden = len({e.activity_id for e in efforts})
        if efforts:
            pr = min(efforts, key=lambda e: e.elapsed_seconds)
            seg.pr_seconds = pr.elapsed_seconds
            seg.has_pr = True
            powered = [e.avg_power_watts for e in efforts if e.avg_power_watts]
            seg.best_avg_power_watts = max(powered) if powered else None
        else:
            seg.pr_seconds = None
            seg.has_pr = False
            seg.best_avg_power_watts = None

    await db.flush()
    return created


async def recompute_all_user_segments(db: AsyncSession, user_id: uuid.UUID) -> int:
    """Recompute segments for every cycling route owned by the user."""
    result = await db.execute(
        select(Route.id).where(
            Route.user_id == user_id,
            Route.sport_type == "cycling",
        )
    )
    total = 0
    for (route_id,) in result.all():
        total += len(await sync_route_segments(db, user_id, route_id))
    return total


async def list_segments(
    db: AsyncSession,
    user_id: uuid.UUID,
    route_id: uuid.UUID | None = None,
) -> list[Segment]:
    query = (
        select(Segment)
        .where(Segment.user_id == user_id)
        .order_by(Segment.pr_seconds.asc().nullslast(), Segment.updated_at.desc())
        .options(
            selectinload(Segment.route),
            selectinload(Segment.efforts).load_only(SegmentEffort.id),
        )
    )
    if route_id is not None:
        query = query.where(Segment.route_id == route_id)
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_segment(
    db: AsyncSession, user_id: uuid.UUID, segment_id: uuid.UUID
) -> Segment:
    result = await db.execute(
        select(Segment)
        .where(Segment.id == segment_id, Segment.user_id == user_id)
        .options(
            selectinload(Segment.route),
            selectinload(Segment.efforts).load_only(SegmentEffort.id),
        )
    )
    seg = result.scalar_one_or_none()
    if seg is None:
        raise LookupError("Segment not found")
    return seg


async def get_segment_leaderboard(
    db: AsyncSession, user_id: uuid.UUID, segment_id: uuid.UUID
) -> tuple[Segment, list[SegmentEffort]]:
    """Segment + its efforts sorted by elapsed time (PR first)."""
    seg = await get_segment(db, user_id, segment_id)
    result = await db.execute(
        select(SegmentEffort)
        .where(SegmentEffort.segment_id == seg.id)
        .order_by(SegmentEffort.elapsed_seconds.asc())
        .options(selectinload(SegmentEffort.activity))
    )
    efforts = list(result.scalars().all())
    return seg, efforts
