"""End-to-end §3.13 segment recompute against the database.

``sync_route_segments`` had no test at all, which is how a systematic
timebase error survived: Strava reports a stream's ``resolution`` as the
string ``"high"``/``"low"``, so ``ActivityStream.resolution`` is ``NULL`` and
the service assumed one second per sample for *every* stream — including the
low-resolution ones Strava returns at the device's native GPS rate. Both the
integrated distance and every duration derived from it were wrong by the
ratio of the real sample spacing.

What these tests pin down: the cumulative-distance series and the timebase
share one index axis, the real ``distance`` stream wins over velocity
integration, and the pre-B4 fallback still works for rides without one.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity, ActivityStream
from app.models.route import Route
from app.models.segment import Segment, SegmentEffort
from app.models.user import User
from app.services.polyline_utils import encode_polyline
from app.services.segments import sync_route_segments

_ACTIVITY_START = datetime(2026, 9, 20, 8, 0, tzinfo=UTC)
_BASE_EPOCH = 1_700_000_000.0
_ROUTE_LENGTH_M = 2000.0
# The climb runs 500 m → 1500 m at 10% (100 m of gain).
_CLIMB_START_M = 500.0
_CLIMB_END_M = 1500.0
_CLIMB_GAIN_M = 100.0

# A ride that covers the whole climb: 301 samples, one every 10 s, covering
# 5 m each — 1505 m over 3010 s, i.e. a true 0.5 m/s. The climb therefore takes
# 1000 m / 0.5 m/s = 2000 s. Any timebase that isn't the real one changes that
# number, which is what these tests are for.
_RIDE_SAMPLES = 301
_RIDE_SECONDS = 10.0
_RIDE_METRES = 5.0
_RIDE_SPEED_MPS = _RIDE_METRES / _RIDE_SECONDS
_CLIMB_SECONDS = (_CLIMB_END_M - _CLIMB_START_M) / _RIDE_SPEED_MPS


def _climb_route(user: User) -> Route:
    """A 2 km north-south route with a 1 km, 10% climb in the middle.

    The polyline gives the distance axis (200 points, ~10 m apart); the
    elevation profile is interpolated onto it.
    """
    points = [
        (51.4430 + i * (_ROUTE_LENGTH_M / (200 * 111_320.0)), -0.2710)
        for i in range(201)
    ]
    return Route(
        id=uuid.uuid4(),
        user_id=user.id,
        name="Test Climb",
        sport_type="cycling",
        distance_meters=_ROUTE_LENGTH_M,
        elevation_gain_meters=_CLIMB_GAIN_M,
        encoded_polyline=encode_polyline(points),
        elevation_profile={
            "distance": [0.0, _CLIMB_START_M, _CLIMB_END_M, _ROUTE_LENGTH_M],
            "elevation": [50.0, 50.0, 50.0 + _CLIMB_GAIN_M, 50.0 + _CLIMB_GAIN_M],
        },
        start_lat=points[0][0],
        start_lng=points[0][1],
        end_lat=points[-1][0],
        end_lng=points[-1][1],
    )


async def _add_ride(
    db: AsyncSession,
    user: User,
    route: Route,
    *,
    n_samples: int,
    sample_seconds: float,
    metres_per_sample: float,
    source: str = "distance",
) -> Activity:
    """A linked cycling activity with a realistic, GPS-rate stream set.

    ``metres_per_sample`` is the ground actually covered between consecutive
    samples, so the honest speed is ``metres_per_sample / sample_seconds``.
    ``resolution`` is left ``NULL`` on every stream, which is exactly what the
    Strava importer produces for a ``"high"``/``"low"`` resolution string.
    """
    activity = Activity(
        user_id=user.id,
        route_id=route.id,
        source="strava",
        sport_type="cycling",
        name="Climb Repeat",
        start_date=_ACTIVITY_START,
        duration_seconds=int(n_samples * sample_seconds),
        distance_meters=n_samples * metres_per_sample,
    )
    db.add(activity)
    await db.flush()

    rows = [
        ActivityStream(
            activity_id=activity.id,
            stream_type="time",
            data={
                "data": [_BASE_EPOCH + i * sample_seconds for i in range(n_samples)]
            },
        ),
        ActivityStream(
            activity_id=activity.id,
            stream_type="watts",
            data={"data": [250.0] * n_samples},
        ),
    ]
    if source == "distance":
        # Native rate: ~10x coarser than the 1s time axis, as Strava returns it.
        # The last sample must land exactly on the ride's total distance, or the
        # climb end falls outside the alignment tolerance.
        coarse = max(2, n_samples // 10)
        total = n_samples * metres_per_sample
        step = total / (coarse - 1)
        rows.append(
            ActivityStream(
                activity_id=activity.id,
                stream_type="distance",
                data={"data": [i * step for i in range(coarse)]},
            )
        )
    else:
        rows.append(
            ActivityStream(
                activity_id=activity.id,
                stream_type="velocity_smooth",
                data={"data": [metres_per_sample / sample_seconds] * n_samples},
            )
        )
    for row in rows:
        db.add(row)
    await db.flush()
    return activity


async def _efforts_for(db: AsyncSession, segment: Segment) -> list[SegmentEffort]:
    result = await db.execute(
        select(SegmentEffort).where(SegmentEffort.segment_id == segment.id)
    )
    return list(result.scalars().all())


async def _climb_and_effort(
    db: AsyncSession, user: User, **ride_kwargs
) -> tuple[list[Segment], list[SegmentEffort]]:
    route = _climb_route(user)
    db.add(route)
    await db.flush()
    kwargs = {
        "n_samples": _RIDE_SAMPLES,
        "sample_seconds": _RIDE_SECONDS,
        "metres_per_sample": _RIDE_METRES,
    }
    kwargs.update(ride_kwargs)
    await _add_ride(db, user, route, **kwargs)
    segments = await sync_route_segments(db, user.id, route.id)
    efforts = []
    for seg in segments:
        efforts.extend(await _efforts_for(db, seg))
    return segments, efforts


def _assert_climb_effort(effort: SegmentEffort) -> None:
    """The climb's duration and speed, at the ride's true 0.5 m/s."""
    assert abs(effort.elapsed_seconds - _CLIMB_SECONDS) < _CLIMB_SECONDS * 0.05, (
        f"elapsed_seconds={effort.elapsed_seconds}, expected ~{_CLIMB_SECONDS} — "
        "a different value means the 1s-per-sample assumption is back"
    )
    assert effort.avg_speed_mps == pytest.approx(_RIDE_SPEED_MPS, abs=0.05)


@pytest.mark.asyncio
async def test_climb_is_detected_and_ride_aligned(
    db_session: AsyncSession, test_user: User
):
    segments, efforts = await _climb_and_effort(db_session, test_user)
    assert len(segments) == 1
    assert segments[0].climb_category is not None
    assert len(efforts) == 1


@pytest.mark.asyncio
async def test_timebase_comes_from_the_time_stream_not_assumed_1s(
    db_session: AsyncSession, test_user: User
):
    """5 m every 10 s is 0.5 m/s — not the 5 m/s a 1s-per-sample read gives.

    The 1000 m climb takes ~2000 s. A hardcoded 1 s timebase would report
    ~200 s, 10x too fast, with the window on the wrong stretch of road.
    """
    _, efforts = await _climb_and_effort(db_session, test_user)
    assert len(efforts) == 1
    _assert_climb_effort(efforts[0])
    effort = efforts[0]
    # Power and HR are sliced with the same indices, so a 250 W ride reports
    # 250 W — not a 10x-shorter window over a different part of the ride.
    assert effort.avg_power_watts == pytest.approx(250.0, abs=1.0)
    # `started_at` uses the same timebase, so it lands inside the ride.
    assert effort.started_at is not None
    assert _ACTIVITY_START <= effort.started_at <= _ACTIVITY_START + timedelta(
        seconds=_RIDE_SAMPLES * _RIDE_SECONDS
    )


@pytest.mark.asyncio
async def test_distance_stream_wins_over_velocity_integration(
    db_session: AsyncSession, test_user: User
):
    """A distance stream that disagrees with velocity must be believed.

    Strava's cumulative distance is derived from position; velocity is
    derived from distance. When they disagree, position wins — otherwise the
    alignment inherits every smoothing error in the velocity series.
    """
    route = _climb_route(test_user)
    db_session.add(route)
    await db_session.flush()

    activity = Activity(
        user_id=test_user.id,
        route_id=route.id,
        source="strava",
        sport_type="cycling",
        name="Disagreeing Streams",
        start_date=_ACTIVITY_START,
        duration_seconds=2010,
        distance_meters=1005.0,
    )
    db_session.add(activity)
    await db_session.flush()

    n = _RIDE_SAMPLES
    for stream in [
        ActivityStream(
            activity_id=activity.id,
            stream_type="time",
            data={"data": [_BASE_EPOCH + i * _RIDE_SECONDS for i in range(n)]},
        ),
        # 5 m per 10 s sample → the true 0.5 m/s.
        ActivityStream(
            activity_id=activity.id,
            stream_type="distance",
            data={"data": [float(i * _RIDE_METRES) for i in range(n)]},
        ),
        # A smoothed velocity claiming 10x the speed. If this won, the window
        # would be 10x shorter and the reported speed 10x higher.
        ActivityStream(
            activity_id=activity.id,
            stream_type="velocity_smooth",
            data={"data": [_RIDE_METRES] * n},
        ),
    ]:
        db_session.add(stream)
    await db_session.flush()

    segments = await sync_route_segments(db_session, test_user.id, route.id)
    efforts = await _efforts_for(db_session, segments[0])
    assert len(efforts) == 1
    _assert_climb_effort(efforts[0])


@pytest.mark.asyncio
async def test_velocity_fallback_agrees_with_the_distance_stream(
    db_session: AsyncSession, test_user: User
):
    """A ride with no ``distance`` stream (synced before it was requested)."""
    _, efforts = await _climb_and_effort(db_session, test_user, source="velocity")
    assert len(efforts) == 1
    _assert_climb_effort(efforts[0])


@pytest.mark.asyncio
async def test_unusable_distance_stream_falls_back_to_velocity(
    db_session: AsyncSession, test_user: User
):
    """An all-null distance stream must not wipe out the ride."""
    route = _climb_route(test_user)
    db_session.add(route)
    await db_session.flush()

    activity = Activity(
        user_id=test_user.id,
        route_id=route.id,
        source="strava",
        sport_type="cycling",
        name="Null Distance",
        start_date=_ACTIVITY_START,
        duration_seconds=int(_RIDE_SAMPLES * _RIDE_SECONDS),
        distance_meters=_RIDE_SAMPLES * _RIDE_METRES,
    )
    db_session.add(activity)
    await db_session.flush()
    n = _RIDE_SAMPLES
    for stream in [
        ActivityStream(
            activity_id=activity.id,
            stream_type="time",
            data={"data": [_BASE_EPOCH + i * _RIDE_SECONDS for i in range(n)]},
        ),
        ActivityStream(
            activity_id=activity.id,
            stream_type="distance",
            data={"data": [None] * n},
        ),
        ActivityStream(
            activity_id=activity.id,
            stream_type="velocity_smooth",
            data={"data": [_RIDE_SPEED_MPS] * n},
        ),
    ]:
        db_session.add(stream)
    await db_session.flush()

    segments = await sync_route_segments(db_session, test_user.id, route.id)
    efforts = await _efforts_for(db_session, segments[0])
    assert len(efforts) == 1
    _assert_climb_effort(efforts[0])


@pytest.mark.asyncio
async def test_no_usable_stream_means_no_effort(
    db_session: AsyncSession, test_user: User
):
    """Segments are still created when no linked ride can be aligned."""
    route = _climb_route(test_user)
    db_session.add(route)
    await db_session.flush()
    activity = Activity(
        user_id=test_user.id,
        route_id=route.id,
        source="strava",
        sport_type="cycling",
        name="No Streams",
        start_date=_ACTIVITY_START,
        duration_seconds=2010,
        distance_meters=1005.0,
    )
    db_session.add(activity)
    await db_session.flush()

    segments = await sync_route_segments(db_session, test_user.id, route.id)
    assert len(segments) == 1
    assert await _efforts_for(db_session, segments[0]) == []


@pytest.mark.asyncio
async def test_unlinked_activity_never_gets_an_effort(
    db_session: AsyncSession, test_user: User
):
    route = _climb_route(test_user)
    db_session.add(route)
    await db_session.flush()
    activity = Activity(
        user_id=test_user.id,
        route_id=None,  # never linked
        source="strava",
        sport_type="cycling",
        name="Different Ride",
        start_date=_ACTIVITY_START,
        duration_seconds=2010,
        distance_meters=1005.0,
    )
    db_session.add(activity)
    await db_session.flush()
    for stream in [
        ActivityStream(
            activity_id=activity.id,
            stream_type="time",
            data={"data": [_BASE_EPOCH + i * 10.0 for i in range(201)]},
        ),
        ActivityStream(
            activity_id=activity.id,
            stream_type="distance",
            data={"data": [float(i * 5) for i in range(201)]},
        ),
    ]:
        db_session.add(stream)
    await db_session.flush()

    segments = await sync_route_segments(db_session, test_user.id, route.id)
    assert segments
    assert (await db_session.execute(select(SegmentEffort))).scalars().all() == []


@pytest.mark.asyncio
async def test_recompute_is_idempotent(
    db_session: AsyncSession, test_user: User
):
    """Delete-and-recreate must not accumulate duplicate efforts."""
    route = _climb_route(test_user)
    db_session.add(route)
    await db_session.flush()
    await _add_ride(
        db_session,
        test_user,
        route,
        n_samples=_RIDE_SAMPLES,
        sample_seconds=_RIDE_SECONDS,
        metres_per_sample=_RIDE_METRES,
    )

    segments = await sync_route_segments(db_session, test_user.id, route.id)
    first_ids = {s.id for s in segments}

    segments = await sync_route_segments(db_session, test_user.id, route.id)
    all_efforts = (await db_session.execute(select(SegmentEffort))).scalars().all()

    assert len(segments) == 1
    assert segments[0].id not in first_ids  # recreated, not updated in place
    assert len(all_efforts) == 1

@pytest.mark.asyncio
async def test_numeric_resolution_without_time_stream_still_works(
    db_session: AsyncSession, test_user: User
):
    """The pre-existing non-Strava path (Wahoo/GPX) must keep working.

    Those sources record a numeric seconds-per-sample and have no ``time``
    stream, so the timebase comes from ``ActivityStream.resolution``.
    """
    route = _climb_route(test_user)
    db_session.add(route)
    await db_session.flush()

    activity = Activity(
        user_id=test_user.id,
        route_id=route.id,
        source="wahoo",
        sport_type="cycling",
        name="Non-Strava Ride",
        start_date=_ACTIVITY_START,
        duration_seconds=2010,
        distance_meters=1005.0,
    )
    db_session.add(activity)
    await db_session.flush()
    # 1 m every 10 s at resolution=10 → 0.1 m/s, so 1505 samples to clear the
    # climb. 10x the duration of the Strava-shaped ride, as expected.
    n = 1505
    db_session.add(
        ActivityStream(
            activity_id=activity.id,
            stream_type="velocity_smooth",
            data={"data": [0.1] * n},
            resolution=10,
        )
    )
    await db_session.flush()

    segments = await sync_route_segments(db_session, test_user.id, route.id)
    efforts = await _efforts_for(db_session, segments[0])
    assert len(efforts) == 1
    assert efforts[0].avg_speed_mps == pytest.approx(0.1, abs=0.01)
    assert efforts[0].elapsed_seconds == pytest.approx(10_000.0, rel=0.05)


@pytest.mark.asyncio
async def test_ride_too_short_to_reach_the_climb_is_skipped(
    db_session: AsyncSession, test_user: User
):
    """Coverage below the 90% floor drops the effort, it doesn't fudge it."""
    route = _climb_route(test_user)
    db_session.add(route)
    await db_session.flush()
    # 400 m of riding — stops well short of the 500 m climb start.
    await _add_ride(
        db_session,
        test_user,
        route,
        n_samples=41,
        sample_seconds=10.0,
        metres_per_sample=10.0,
    )

    segments = await sync_route_segments(db_session, test_user.id, route.id)
    assert len(segments) == 1
    assert await _efforts_for(db_session, segments[0]) == []


@pytest.mark.asyncio
async def test_best_avg_power_includes_coasting(
    db_session: AsyncSession, test_user: User
):
    """`best_avg_power_watts` is the max over efforts, so an average that dropped
    zeros inflated the headline number on every segment.

    This ride pedals 300 W partway up, then coasts the rest of the climb. The
    honest window average is well under 300 W — reporting 300 W described only
    the part where the rider was pedalling.
    """
    route = _climb_route(test_user)
    db_session.add(route)
    await db_session.flush()

    n = _RIDE_SAMPLES
    activity = Activity(
        user_id=test_user.id,
        route_id=route.id,
        source="strava",
        sport_type="cycling",
        name="Coasting Climb",
        start_date=_ACTIVITY_START,
        duration_seconds=int(n * _RIDE_SECONDS),
        distance_meters=n * _RIDE_METRES,
    )
    db_session.add(activity)
    await db_session.flush()

    # Pedal for the first 55% of the ride, coast after that. The climb window
    # is samples 100..300, so it straddles the transition.
    pedalling = int(n * 0.55)
    power = [300.0] * pedalling + [0.0] * (n - pedalling)
    for stream in [
        ActivityStream(
            activity_id=activity.id,
            stream_type="time",
            data={"data": [_BASE_EPOCH + i * _RIDE_SECONDS for i in range(n)]},
        ),
        ActivityStream(
            activity_id=activity.id,
            stream_type="distance",
            data={"data": [i * _RIDE_METRES for i in range(n)]},
        ),
        ActivityStream(
            activity_id=activity.id,
            stream_type="watts",
            data={"data": power},
        ),
    ]:
        db_session.add(stream)
    await db_session.flush()

    segments = await sync_route_segments(db_session, test_user.id, route.id)
    assert len(segments) == 1
    seg = segments[0]
    efforts = await _efforts_for(db_session, seg)
    assert len(efforts) == 1

    # Recompute the expectation from the window the service should have aligned:
    # the climb runs 500 m → 1500 m at 5 m per sample.
    start_idx = int(_CLIMB_START_M / _RIDE_METRES)
    end_idx = int(_CLIMB_END_M / _RIDE_METRES)
    window = power[start_idx : end_idx + 1]
    assert window[-1] == 0.0, "the window must actually include the coasting"

    expected = sum(window) / len(window)
    assert efforts[0].avg_power_watts == pytest.approx(expected, abs=0.05)
    # And the number shown on the segment card is not the pedalling power.
    assert efforts[0].avg_power_watts < 300.0
    assert seg.best_avg_power_watts == efforts[0].avg_power_watts

# ── §3: derived-field carry-over and the PR flag ──────────────────────────


@pytest.mark.asyncio
async def test_is_pr_marks_exactly_the_fastest_effort(
    db_session: AsyncSession, test_user: User
):
    """``SegmentEffort.is_pr`` was never assigned anywhere in the backend.

    It appeared only in the model, the schema and the read path, so every effort
    carried the column default and the PR badge in ``SegmentRow.tsx`` could
    never render. ``min()`` on ``elapsed_seconds`` is already the segment's PR
    by the same definition the segment-level totals use, so the winner is
    marked in place rather than in a second pass.
    """
    from tests.integration.test_segment_recompute import _climb_and_effort

    segments, efforts = await _climb_and_effort(db_session, test_user)
    assert efforts, "expected the seeded ride to produce efforts"

    fastest = min(efforts, key=lambda e: e.elapsed_seconds)
    prs = [e for e in efforts if e.is_pr]
    assert len(prs) == 1, "exactly one effort per segment is the PR"
    assert prs[0].id == fastest.id


@pytest.mark.asyncio
async def test_derived_fields_survive_a_recompute(
    db_session: AsyncSession, test_user: User
):
    """The precondition for persisting ``geo_cluster_id`` at all.

    ``sync_route_segments`` is delete-and-recreate per route, so without a
    carry-over every recompute wiped a week of intelligence and reset the hill
    to NULL. A persisted column that dies on every recompute is not meaningfully
    persisted: the hill would fragment each time a route was re-imported and the
    merged leaderboard would go back to one row per route.
    """
    from tests.integration.test_segment_recompute import _climb_and_effort

    segments, _ = await _climb_and_effort(db_session, test_user)
    assert segments
    original = segments[0]
    cluster = uuid.uuid4()

    original.geo_cluster_id = cluster
    original.cluster_id = 7
    original.climb_type = "steady"
    original.sustainedness = 0.62
    original.difficulty_score = 71.5
    original.predicted_vam = 903.0
    original.predicted_time_seconds = 399.0
    original.predicted_power_watts = 254.0
    original.prediction_confidence = 0.44
    original.intelligence_analyzed_at = datetime(2026, 9, 27, 6, 15, tzinfo=UTC)
    await db_session.flush()

    from app.services.segments import _CARRIED_FIELDS

    route_id = original.route_id
    await db_session.flush()
    recomputed = await sync_route_segments(db_session, test_user.id, route_id)

    assert recomputed, "the recompute must still produce the segment"
    after = recomputed[0]
    assert after.id != original.id, "delete-and-recreate means a new row"

    for field in _CARRIED_FIELDS:
        assert getattr(after, field) == getattr(original, field), (
            f"{field} was not carried across the recompute"
        )
    assert after.geo_cluster_id == cluster


@pytest.mark.asyncio
async def test_geometry_totals_are_recomputed_not_carried(
    db_session: AsyncSession, test_user: User
):
    """The complement: the fields that must NOT be copied.

    ``times_ridden`` / ``pr_seconds`` / ``has_pr`` / ``best_avg_power_watts`` are
    recomputed from the efforts later in ``sync_route_segments``. Carrying them
    would serve a stale leaderboard, which is why ``_CARRIED_FIELDS`` is an
    explicit allowlist rather than "every non-geometry column".
    """
    from tests.integration.test_segment_recompute import _climb_and_effort

    segments, efforts = await _climb_and_effort(db_session, test_user)
    assert segments and efforts
    assert segments[0].times_ridden == 1

    recomputed = await sync_route_segments(db_session, test_user.id, segments[0].route_id)
    after = recomputed[0]
    assert after.times_ridden == 1, "recomputed from the efforts, not copied blindly"
    assert after.pr_seconds == pytest.approx(
        segments[0].pr_seconds, abs=0.01
    ), "recomputed to the same value, because the same ride is on the same route"
