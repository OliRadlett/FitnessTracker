"""Integration tests for geometry coherence across a route merge.

Regression: `merge_routes` adopted the duplicate's polyline when it had more
points, but left the primary's `is_loop`, start/end coords and `distance_meters`
alone. Merging a closed-loop duplicate into an open-trace primary therefore
produced a route whose polyline was a loop while its metadata said open, with
start/end hundreds of metres apart — and nothing recomputes those fields.

Also: the merge snapshot did not capture the duplicate's OSM `road_match`, so
undo recreated the route without it.
"""

from __future__ import annotations

import math

import pytest
from sqlalchemy import select

from app.models.route import Route, RouteMergeLog
from app.services.polyline_utils import encode_polyline
from app.services.route_service import create_route, merge_routes, undo_route_merge

pytestmark = [pytest.mark.integration, pytest.mark.expensive]


def _line(km: float, n: int = 101):
    lat0 = 55.0
    cos = math.cos(math.radians(lat0))
    dist = km * 1000.0
    return [(lat0, i / (n - 1) * (dist / (111_320.0 * cos))) for i in range(n)]


async def test_merge_adopting_geometry_adopts_its_metadata(db_session, test_user):
    """A closed-loop duplicate with more points must bring its loop metadata."""
    # Primary: SHORT polyline, marked open (the "odd one out" shape).
    small = await create_route(
        db_session, test_user.id, "Open trace", "cycling", 10_000.0,
        encode_polyline(_line(10.0, n=20)),
    )
    small.is_loop = False
    small.start_lat, small.start_lng = 55.0, 0.0
    small.end_lat, small.end_lng = 55.05, 0.0  # ~5.5 km apart

    # Duplicate: LONGER polyline, a closed loop.
    loop_pts = _line(18.0, n=200)
    loop_pts[-1] = loop_pts[0]  # exact closure
    big = await create_route(
        db_session, test_user.id, "Closed loop", "cycling", 18_000.0,
        encode_polyline(loop_pts),
    )
    big.is_loop = True
    big.start_lat = big.end_lat = 55.0
    big.start_lng = big.end_lng = 0.0
    big.road_match = {"version": 1, "coverage": 1.0, "edge_set": ["a", "b"]}
    await db_session.flush()

    merged = await merge_routes(db_session, small.id, big.id, test_user.id, score=0.9)
    assert merged is not None and merged.id == small.id

    # Geometry AND its metadata came across together.
    assert merged.is_loop is True
    assert merged.start_lat == 55.0 and merged.end_lat == 55.0
    assert merged.start_lng == 0.0 and merged.end_lng == 0.0
    assert merged.distance_meters == 18_000.0
    # The adopted polyline invalidates the old match rather than keeping stale.
    assert merged.road_match is None
    assert merged.road_match_version is None


async def test_merge_keeps_primary_geometry_when_it_is_better(db_session, test_user):
    """The inverse: a richer primary keeps its own geometry and match."""
    big_pts = _line(18.0, n=200)
    big = await create_route(
        db_session, test_user.id, "Rich", "cycling", 18_000.0, encode_polyline(big_pts)
    )
    big.road_match = {"version": 1, "coverage": 1.0, "edge_set": ["x"]}
    small = await create_route(
        db_session, test_user.id, "Poor", "cycling", 10_000.0,
        encode_polyline(_line(10.0, n=20)),
    )
    await db_session.flush()

    merged = await merge_routes(db_session, big.id, small.id, test_user.id, score=0.9)
    assert merged is not None
    # Untouched: primary geometry and match survive.
    assert merged.road_match == {"version": 1, "coverage": 1.0, "edge_set": ["x"]}
    assert merged.distance_meters == 18_000.0


async def test_undo_restores_the_road_match(db_session, test_user):
    """The merge snapshot must carry road_match so undo restores it."""
    a = await create_route(
        db_session, test_user.id, "A", "cycling", 10_000.0, encode_polyline(_line(10.0))
    )
    b = await create_route(
        db_session, test_user.id, "B", "cycling", 10_000.0, encode_polyline(_line(10.0))
    )
    b.road_match = {"version": 1, "coverage": 0.9, "edge_set": ["z"]}
    b.road_match_version = 1
    await db_session.flush()

    await merge_routes(db_session, a.id, b.id, test_user.id, score=0.9)
    log = (
        await db_session.execute(
            select(RouteMergeLog).where(RouteMergeLog.primary_route_id == a.id)
        )
    ).scalar_one()

    restored = await undo_route_merge(db_session, log.id, test_user.id)
    assert restored is not None and restored.id == b.id
    assert restored.road_match == {"version": 1, "coverage": 0.9, "edge_set": ["z"]}
    assert restored.road_match_version == 1
