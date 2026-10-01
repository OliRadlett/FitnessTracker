"""Cross-route hill identity: ``geo_cluster_id`` (plan Â§3).

The same hill ridden on three routes is three rows, three PRs and three
``times_ridden`` counts, because ``Segment`` is unique on
``(route_id, start_dist_m, end_dist_m)`` and ``sync_route_segments`` is
delete-and-recreate per route. The rider's actual best on that hill is
invisible, and since the page groups by route there is nowhere to show it.

The load-bearing assertion in here is ``TestRouteOrdering``: ``/climbs/{uuid}``
and ``/{segment_id}`` are both single-segment UUID paths, so the specific route
must be registered *above* the dynamic one or it is swallowed and the request
422s. That is not hypothetical â€” see ``test_orphan_review_api.py``, where a route
existed, was documented as correctly ordered, and still 422'd because "before"
means above the *earliest* dynamic handler, not beside the other static routes.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.api.segments import router
from app.models.segment import Segment, SegmentEffort
from app.services.segments import canonical_climb_name, sync_route_segments

pytestmark = pytest.mark.integration


class TestRouteOrdering:
    """Why ``/climbs/{geo_cluster_id}`` is safe, and what would not be.

    The spec (§2.3) warned that this route "must be registered above
    ``/{segment_id}`` or the dynamic route swallows it and the request 422s",
    citing AGENTS pitfall 13. That warning is **wrong for this particular route**,
    and a test asserting the decorator order would have locked the over-caution
    in forever without ever checking the thing that matters.

    The two paths are different *shapes*:

        /{segment_id}              ->  ^/(?P<segment_id>[^/]+)$
        /climbs/{geo_cluster_id}   ->  ^/climbs/(?P<geo_cluster_id>[^/]+)$

    One segment versus two. ``[^/]+`` cannot span a slash, so the dynamic route
    is not a candidate for ``/climbs/<uuid>`` at all and registration order is
    irrelevant. Pitfall 13's real cases (``/tags`` vs ``/{param}``,
    ``/orphans`` vs ``/{route_id}``) are all **single-segment** static routes
    competing with a single-segment dynamic one, which is the shape that does
    collide.

    So the invariant worth protecting is the path *shape*, not the order.
    """

    def test_the_two_routes_have_different_path_shapes(self):
        """The assertion with teeth: they cannot match the same URL."""
        by_path = {r.path: r for r in router.routes}
        assert "/climbs/{geo_cluster_id}" in by_path
        assert "/{segment_id}" in by_path

        specific = by_path["/climbs/{geo_cluster_id}"].path_regex.pattern
        dynamic = by_path["/{segment_id}"].path_regex.pattern

        # Two segments vs one, and the dynamic segment class excludes "/".
        assert specific.startswith("^/climbs/")
        assert dynamic.count("/") == 2, dynamic
        assert "[^/]+" in dynamic
        assert specific != dynamic

    async def test_a_real_climbs_request_is_not_parsed_as_a_segment_id(
        self, client, three_route_hill
    ):
        """The observable consequence: 200, and the specific handler ran."""
        resp = await client.get(
            f"/api/v1/segments/climbs/{three_route_hill['cluster']}"
        )
        assert resp.status_code == 200, (
            f"got {resp.status_code} -- /climbs/{{geo_cluster_id}} was reached as "
            "/{segment_id} and 'climbs' failed UUID parsing"
        )
        assert "route_count" in resp.json()

    async def test_a_single_segment_variant_would_indeed_be_shadowed(self):
        """Demonstrates the hazard pitfall 13 describes, for a colliding shape.

        A ``GET /climbs`` (no parameter) *is* a single-segment static route and
        *is* shadowed by ``/{segment_id}`` when registered after it. This is the
        shape that actually needs the ordering rule, and it is why the rule
        exists at all -- shown here so the assertion above is understood as "this
        shape is safe", not "ordering stopped mattering".
        """
        from fastapi import APIRouter, FastAPI
        from fastapi.testclient import TestClient

        colliding = APIRouter()

        # `uuid.UUID` rather than a local alias: this module uses
        # `from __future__ import annotations`, so FastAPI resolves the
        # annotation from the module namespace.

        @colliding.get("/{segment_id}")
        async def _dynamic(segment_id: uuid.UUID):
            return {"handler": "dynamic"}

        @colliding.get("/climbs")
        async def _static():
            return {"handler": "static"}

        app = FastAPI()
        app.include_router(colliding, prefix="/t")
        resp = TestClient(app).get("/t/climbs")
        assert resp.status_code == 422, (
            "expected the single-segment static route to be shadowed; if "
            "Starlette's precedence changed, re-read AGENTS pitfall 13 before "
            "relaxing any ordering assertion"
        )


def paths_index(router, path: str) -> int:
    return [r.path for r in router.routes].index(path)


async def _seed_route(db_session, *, user_id: uuid.UUID, name: str):
    """A minimal cycling Route.

    The coordinates are required by the schema even though these tests never
    read them -- they are on Route, not Segment, which is the trap.
    """
    from app.models.route import Route

    route = Route(
        user_id=user_id,
        name=name,
        sport_type="cycling",
        distance_meters=10_000.0,
        elevation_gain_meters=100.0,
        encoded_polyline="o}~mH~}xMz@z@z@z@z@z@",
        start_lat=51.4430,
        start_lng=-0.2710,
        end_lat=51.4430,
        end_lng=-0.2710,
        is_loop=True,
    )
    db_session.add(route)
    await db_session.flush()
    return route


async def _seed_segment(
    db_session,
    *,
    user_id,
    route_id: uuid.UUID,
    cluster: uuid.UUID,
    name: str = "Hill",
    times_ridden: int = 1,
    start_lng: float = -2.59,
) -> Segment:
    seg = Segment(
        user_id=user_id,
        route_id=route_id,
        name=name,
        start_dist_m=1000.0,
        end_dist_m=2000.0,
        distance_m=1000.0,
        elevation_gain_m=60.0,
        avg_gradient_pct=6.0,
        max_gradient_pct=9.0,
        start_lat=53.80,
        start_lng=start_lng,
        end_lat=53.809,
        end_lng=start_lng,
        times_ridden=times_ridden,
        has_pr=False,
    )
    seg.geo_cluster_id = cluster
    db_session.add(seg)
    await db_session.flush()
    return seg


async def _seed_activity(db_session, *, user_id: uuid.UUID, name: str):
    """A real Activity.

    ``SegmentEffort.activity_id`` is a foreign key, so an invented UUID cannot
    stand in for a ride â€” the endpoint reads ``activity.name`` through a
    selectinload, so the row has to exist.
    """
    from app.models.activity import Activity

    activity = Activity(
        user_id=user_id,
        name=name,
        sport_type="cycling",
        source="strava",
        start_date=datetime(2026, 9, 20, 9, 0, tzinfo=UTC),
        distance_meters=10_000.0,
        duration_seconds=3600,
    )
    db_session.add(activity)
    await db_session.flush()
    return activity


async def _seed_effort(
    db_session,
    *,
    segment: Segment,
    activity_id: uuid.UUID,
    elapsed: float,
    vam: float | None,
) -> SegmentEffort:
    effort = SegmentEffort(
        segment_id=segment.id,
        activity_id=activity_id,
        elapsed_seconds=elapsed,
        avg_speed_mps=5.0,
        effort_vam=vam,
        is_pr=False,
    )
    db_session.add(effort)
    await db_session.flush()
    return effort


@pytest.fixture
async def three_route_hill(db_session, test_user, test_activity, test_route):
    """One hill detected on three routes: 3 segments, 1 cluster."""
    routes = [
        await _seed_route(db_session, user_id=test_user.id, name=f"Route {n}")
        for n in range(3)
    ]

    cluster = uuid.uuid4()
    segments = []
    for n, route in enumerate(routes):
        seg = await _seed_segment(
            db_session,
            user_id=test_user.id,
            route_id=route.id,
            cluster=cluster,
            name=f"Route {n} climb",
            times_ridden=3 - n,  # route 0 is the most-ridden
        )
        segments.append(seg)
    return {"routes": routes, "segments": segments, "cluster": cluster}


class TestClimbLeaderboardEndpoint:
    async def test_returns_members_across_every_route(self, client, three_route_hill):
        cluster = three_route_hill["cluster"]
        resp = await client.get(f"/api/v1/segments/climbs/{cluster}")
        assert resp.status_code == 200, resp.text
        body = resp.json()

        assert len(body["segments"]) == 3, "all three routes' segments are members"
        route_ids = {s["route_id"] for s in body["segments"]}
        assert len(route_ids) == 3, "one segment per distinct route"

    async def test_route_count_is_the_number_of_distinct_routes(
        self, client, three_route_hill
    ):
        resp = await client.get(
            f"/api/v1/segments/climbs/{three_route_hill['cluster']}"
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["route_count"] == 3

    async def test_name_is_the_most_ridden_member(self, client, three_route_hill):
        """Canonical naming: the most-ridden member's name.

        The per-segment name is generated from the route name, so the same hill
        wears a different name on every route. times_ridden is 3/2/1 across the
        three, so "Route 0 climb" is the deterministic choice.
        """
        resp = await client.get(
            f"/api/v1/segments/climbs/{three_route_hill['cluster']}"
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["name"] == "Route 0 climb"

    async def test_efforts_are_ranked_by_vam_not_elapsed(
        self, client, db_session, test_user, three_route_hill
    ):
        """VAM-first is the whole point of the merged leaderboard.

        Different routes detect the same hill with slightly different windows,
        so elapsed seconds are not comparable across members and ranking by them
        would report a "best" nobody rode. This crafts an effort that is *slowest
        by seconds* and *best by VAM*: ranking by seconds would put it last.
        """
        cluster = three_route_hill["cluster"]
        segments = three_route_hill["segments"]
        act_a = await _seed_activity(db_session, user_id=test_user.id, name="A")
        act_b = await _seed_activity(db_session, user_id=test_user.id, name="B")
        act_c = await _seed_activity(db_session, user_id=test_user.id, name="C")

        # Fast in seconds but low VAM (a long, shallow window).
        await _seed_effort(
            db_session,
            segment=segments[0],
            activity_id=act_a.id,
            elapsed=100.0,
            vam=300.0,
        )
        # Slowest in seconds, but the best VAM.
        await _seed_effort(
            db_session,
            segment=segments[1],
            activity_id=act_b.id,
            elapsed=250.0,
            vam=950.0,
        )
        # Middle on both.
        await _seed_effort(
            db_session,
            segment=segments[2],
            activity_id=act_c.id,
            elapsed=150.0,
            vam=600.0,
        )

        resp = await client.get(f"/api/v1/segments/climbs/{cluster}")
        assert resp.status_code == 200, resp.text
        efforts = resp.json()["efforts"]
        assert len(efforts) == 3
        assert [e["effort_vam"] for e in efforts] == [950.0, 600.0, 300.0]
        # The slowest-by-seconds effort is ranked first.
        assert efforts[0]["elapsed_seconds"] == 250.0

    async def test_efforts_without_vam_sort_last(
        self, client, db_session, test_user, three_route_hill
    ):
        """A NULL VAM must not be ranked as though it were the best.

        `ORDER BY effort_vam` alone does not guarantee NULLs sort last, so the
        sort is done in Python. This pins that.
        """
        cluster = three_route_hill["cluster"]
        seg = three_route_hill["segments"][0]
        fast = await _seed_activity(db_session, user_id=test_user.id, name="Fast")
        slow = await _seed_activity(db_session, user_id=test_user.id, name="Slow")
        await _seed_effort(
            db_session, segment=seg, activity_id=fast.id, elapsed=10.0, vam=None
        )
        await _seed_effort(
            db_session, segment=seg, activity_id=slow.id, elapsed=400.0, vam=120.0
        )

        resp = await client.get(f"/api/v1/segments/climbs/{cluster}")
        assert resp.status_code == 200, resp.text
        efforts = resp.json()["efforts"]
        assert efforts[0]["effort_vam"] == 120.0
        assert efforts[-1]["effort_vam"] is None

    async def test_falls_back_to_elapsed_when_no_effort_has_vam(
        self, client, db_session, test_user, three_route_hill
    ):
        """No VAM anywhere: elapsed seconds is the only signal available."""
        cluster = three_route_hill["cluster"]
        seg = three_route_hill["segments"][0]
        slow = await _seed_activity(db_session, user_id=test_user.id, name="Slow")
        quick = await _seed_activity(db_session, user_id=test_user.id, name="Quick")
        await _seed_effort(
            db_session, segment=seg, activity_id=slow.id, elapsed=300.0, vam=None
        )
        await _seed_effort(
            db_session, segment=seg, activity_id=quick.id, elapsed=100.0, vam=None
        )

        resp = await client.get(f"/api/v1/segments/climbs/{cluster}")
        assert resp.status_code == 200, resp.text
        assert [e["elapsed_seconds"] for e in resp.json()["efforts"]] == [100.0, 300.0]

    async def test_unknown_cluster_is_404(self, client):
        resp = await client.get(f"/api/v1/segments/climbs/{uuid.uuid4()}")
        assert resp.status_code == 404

    async def test_another_users_cluster_is_404(
        self, client, db_session, three_route_hill
    ):
        """Indistinguishable from nonexistent, so the endpoint cannot probe ids."""
        from app.models.user import User

        stranger = User(
            email=f"stranger-{uuid.uuid4().hex[:8]}@example.com", name="Stranger"
        )
        db_session.add(stranger)
        await db_session.flush()
        route = await _seed_route(db_session, user_id=stranger.id, name="Theirs")
        their_cluster = uuid.uuid4()
        await _seed_segment(
            db_session,
            user_id=stranger.id,
            route_id=route.id,
            cluster=their_cluster,
            name="Private Hill",
        )

        resp = await client.get(f"/api/v1/segments/climbs/{their_cluster}")
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()


class TestClusterSizeOnList:
    async def test_list_reports_the_member_count(self, client, three_route_hill):
        """`geo_cluster_size > 1` is what tells the UI to offer the hill view."""
        resp = await client.get("/api/v1/segments")
        assert resp.status_code == 200, resp.text
        rows = resp.json()
        assert len(rows) == 3
        assert all(r["geo_cluster_size"] == 3 for r in rows)
        assert {r["geo_cluster_id"] for r in rows} == {str(three_route_hill["cluster"])}

    async def test_unclustered_segments_report_size_one(
        self, client, db_session, test_user, test_route
    ):
        """NULL geo_cluster_id is "not clustered yet", which is a hill of one."""
        seg = await _seed_segment(
            db_session,
            user_id=test_user.id,
            route_id=test_route.id,
            cluster=uuid.uuid4(),
        )
        seg.geo_cluster_id = None

        resp = await client.get("/api/v1/segments")
        assert resp.status_code == 200, resp.text
        row = next(r for r in resp.json() if r["id"] == str(seg.id))
        assert row["geo_cluster_id"] is None
        assert row["geo_cluster_size"] == 1

    async def test_size_counts_across_routes_even_when_filtered_to_one(
        self, client, three_route_hill
    ):
        """A hill seen on three routes must report 3 even when listing one.

        Otherwise "also on N other routes" is wrong exactly when it is being
        shown, which is the only time it is shown.
        """
        one_route = three_route_hill["routes"][0]
        resp = await client.get(f"/api/v1/segments?route_id={one_route.id}")
        assert resp.status_code == 200, resp.text
        rows = resp.json()
        assert len(rows) == 1
        assert rows[0]["geo_cluster_size"] == 3


class TestCanonicalName:
    def test_most_ridden_wins(self):
        """Pure function, so this needs no database."""
        made = [
            _bare_segment(name="B", times_ridden=5),
            _bare_segment(name="A", times_ridden=9),
            _bare_segment(name="C", times_ridden=1),
        ]
        assert canonical_climb_name(made) == "A"

    def test_ties_break_on_name_deterministically(self):
        made = [
            _bare_segment(name="Zebra", times_ridden=4),
            _bare_segment(name="Alpha", times_ridden=4),
        ]
        assert canonical_climb_name(made) == "Alpha"
        assert canonical_climb_name(list(reversed(made))) == "Alpha"

    def test_empty_is_an_error_not_an_implicit_none(self):
        with pytest.raises(ValueError):
            canonical_climb_name([])


def _bare_segment(name: str, times_ridden: int) -> Segment:
    """A Segment that is never persisted -- only the two fields are read."""
    return Segment(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        route_id=uuid.uuid4(),
        name=name,
        start_dist_m=0.0,
        end_dist_m=1.0,
        distance_m=1.0,
        elevation_gain_m=1.0,
        avg_gradient_pct=1.0,
        max_gradient_pct=2.0,
        start_lat=0.0,
        start_lng=0.0,
        end_lat=0.0,
        end_lng=0.0,
        times_ridden=times_ridden,
        has_pr=False,
    )
