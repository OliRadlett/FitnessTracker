"""Integration tests for stable segment groups (migration 106 + API).

The load-bearing behaviours: one group per physical hill, one attempt per ride,
assisted efforts never become a PR, rename survives a rebuild, and another
user's group is a 404 rather than a leak.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.models.activity import Activity
from app.models.route import Route
from app.models.segment import Segment, SegmentEffort, SegmentGroup
from app.models.user import User
from app.services.segment_groups import rebuild_user_groups

pytestmark = pytest.mark.integration


async def _route(db_session, user_id, name: str) -> Route:
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


async def _segment(db_session, user_id, route_id, cluster, *, name="Hill") -> Segment:
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
        start_lng=-2.59,
        end_lat=53.809,
        end_lng=-2.59,
        times_ridden=1,
        has_pr=False,
    )
    seg.geo_cluster_id = cluster
    db_session.add(seg)
    await db_session.flush()
    return seg


async def _effort(db_session, segment, activity, *, elapsed=300.0, assisted=None):
    effort = SegmentEffort(
        segment_id=segment.id,
        activity_id=activity.id,
        started_at=datetime(2026, 9, 20, 9, 0, tzinfo=UTC),
        elapsed_seconds=elapsed,
        avg_power_watts=200.0,
        avg_speed_mps=3.3,
        effort_vam=720.0,
        assisted=assisted,
    )
    db_session.add(effort)
    await db_session.flush()
    return effort


async def _activity(db_session, user_id, name="Ride") -> Activity:
    activity = Activity(
        user_id=user_id,
        source="strava",
        sport_type="cycling",
        name=name,
        start_date=datetime(2026, 9, 20, 9, 0, tzinfo=UTC),
        duration_seconds=3600,
        distance_meters=10_000.0,
        raw_data={"sport_type": "Ride"},
    )
    db_session.add(activity)
    await db_session.flush()
    return activity


async def _seed_hill(db_session, user_id):
    cluster = uuid.uuid4()
    r1 = await _route(db_session, user_id, "Queensferry loop")
    r2 = await _route(db_session, user_id, "Cycling")
    s1 = await _segment(db_session, user_id, r1.id, cluster)
    s2 = await _segment(db_session, user_id, r2.id, cluster)
    activity = await _activity(db_session, user_id)
    await _effort(db_session, s1, activity)
    await rebuild_user_groups(db_session, user_id)
    await db_session.commit()
    return {"cluster": cluster, "segments": [s1, s2], "activity": activity}


class TestGroups:
    async def test_one_group_per_hill_and_one_attempt_per_ride(
        self, client, db_session, test_user
    ):
        await _seed_hill(db_session, test_user.id)

        resp = await client.get("/api/v1/segments/groups")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["counts"] == {"ridden": 1, "to_ride": 0, "all": 1}
        item = body["items"][0]
        assert item["kind"] == "climb"
        assert item["route_count"] == 2
        assert item["attempts"] == 1
        assert item["best"]["seconds"] == 300.0
        assert len(item["profile"]) == 49

    async def test_assisted_effort_is_visible_but_never_a_pr(
        self, client, db_session, test_user
    ):
        cluster = uuid.uuid4()
        route = await _route(db_session, test_user.id, "Cycling")
        seg = await _segment(db_session, test_user.id, route.id, cluster)
        activity = await _activity(db_session, test_user.id)
        await _effort(db_session, seg, activity, assisted=True)
        await rebuild_user_groups(db_session, test_user.id)
        await db_session.commit()

        body = (await client.get("/api/v1/segments/groups")).json()
        item = body["items"][0]
        assert item["attempts"] == 0
        assert item["best"] is None
        assert body["counts"]["ridden"] == 0

        detail = (
            await client.get(f"/api/v1/segments/groups/{item['id']}")
        ).json()
        assert len(detail["efforts"]) == 1
        assert detail["efforts"][0]["assisted"] is True

    async def test_rename_persists_and_resets(self, client, db_session, test_user):
        await _seed_hill(db_session, test_user.id)
        item = (await client.get("/api/v1/segments/groups")).json()["items"][0]
        url = f"/api/v1/segments/groups/{item['id']}"

        resp = await client.patch(url, json={"display_name": "The Ferry Climb"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["name"] == "The Ferry Climb"
        assert resp.json()["name_source"] == "user"

        # A rebuild must not overwrite the user's name.
        await rebuild_user_groups(db_session, test_user.id)
        await db_session.commit()
        assert (await client.get(url)).json()["group"]["name"] == "The Ferry Climb"

        resp = await client.patch(url, json={"display_name": None})
        assert resp.status_code == 200
        assert resp.json()["name"] == item["canonical_name"]
        assert resp.json()["name_source"] == "route"

    async def test_another_users_group_is_404(self, client, db_session, test_user):
        stranger = User(
            id=uuid.uuid4(), email=f"stranger-{uuid.uuid4().hex[:8]}@example.com", name="S"
        )
        db_session.add(stranger)
        await db_session.flush()
        other = SegmentGroup(
            user_id=stranger.id,
            kind="climb",
            canonical_name="Theirs",
            name_source="route",
            identity_key=uuid.uuid4().hex,
            distance_m=1000.0,
            gain_m=60.0,
            avg_gradient_pct=6.0,
            max_gradient_pct=9.0,
            steepest_200m_pct=8.0,
            sustained_share=0.5,
        )
        db_session.add(other)
        await db_session.flush()
        await db_session.commit()

        resp = await client.get(f"/api/v1/segments/groups/{other.id}")
        assert resp.status_code == 404
        resp = await client.patch(
            f"/api/v1/segments/groups/{other.id}",
            json={"display_name": "Stolen"},
        )
        assert resp.status_code == 404

    async def test_route_ordering_shape(self):
        """`/groups` is single-segment static and must precede `/{segment_id}`."""
        from app.api.segments import router

        paths = [r.path for r in router.routes]
        assert paths.index("/groups") < paths.index("/{segment_id}")
        # /groups/{id} is two segments and cannot collide with /{id}.
        assert "/groups/{group_id}" in paths
