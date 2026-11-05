"""Integration tests for the Course API.

Course grouping is an UPDATE, not a merge: the route must survive group/ungroup.
Ride links are suggested until confirmed; course history counts confirmed only.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.integration


class TestCourseCrud:
    async def test_empty_list(self, client):
        resp = await client.get("/api/v1/courses")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_create_course_groups_route_and_sets_canonical(
        self, client, test_route
    ):
        resp = await client.post(
            "/api/v1/courses",
            json={
                "name": "Richmond Park",
                "sport_type": "cycling",
                "route_ids": [str(test_route.id)],
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Richmond Park"
        assert data["route_count"] == 1
        assert data["canonical_route_id"] == str(test_route.id)
        assert data["routes"][0]["is_canonical"] is True

    async def test_list_and_detail_after_create(self, client, test_route):
        created = await client.post(
            "/api/v1/courses",
            json={"name": "Richmond Park", "route_ids": [str(test_route.id)]},
        )
        course_id = created.json()["id"]

        listed = await client.get("/api/v1/courses")
        assert listed.status_code == 200
        assert [c["id"] for c in listed.json()] == [course_id]

        detail = await client.get(f"/api/v1/courses/{course_id}")
        assert detail.status_code == 200
        assert detail.json()["routes"][0]["id"] == str(test_route.id)

    async def test_uncoursed_is_static_not_a_course_id(self, client, test_route):
        # `uncoursed` must be registered before `/{course_id}` (pitfall 13).
        resp = await client.get("/api/v1/courses/uncoursed")
        assert resp.status_code == 200
        assert [r["id"] for r in resp.json()] == [str(test_route.id)]

    async def test_blank_name_is_rejected(self, client):
        resp = await client.post("/api/v1/courses", json={"name": "   "})
        assert resp.status_code == 400

    async def test_rename_course(self, client, test_route):
        created = await client.post(
            "/api/v1/courses",
            json={"name": "Old name", "route_ids": [str(test_route.id)]},
        )
        course_id = created.json()["id"]
        renamed = await client.patch(
            f"/api/v1/courses/{course_id}", json={"name": "New name"}
        )
        assert renamed.status_code == 200
        assert renamed.json()["name"] == "New name"

        blank = await client.patch(f"/api/v1/courses/{course_id}", json={"name": "   "})
        assert blank.status_code == 400

    async def test_unknown_course_is_404(self, client):
        resp = await client.get("/api/v1/courses/00000000-0000-0000-0000-000000000000")
        assert resp.status_code == 404


class TestCourseGrouping:
    async def test_group_and_ungroup_keep_the_route(
        self, client, db_session, test_route, test_route_with_surface
    ):
        created = await client.post(
            "/api/v1/courses",
            json={"name": "Two variants", "route_ids": [str(test_route.id)]},
        )
        course_id = created.json()["id"]

        grouped = await client.post(
            f"/api/v1/courses/{course_id}/routes/{test_route_with_surface.id}"
        )
        assert grouped.status_code == 200
        assert grouped.json()["route_count"] == 2

        ungrouped = await client.delete(
            f"/api/v1/courses/{course_id}/routes/{test_route_with_surface.id}"
        )
        assert ungrouped.status_code == 200
        assert ungrouped.json()["route_count"] == 1

        # The route still exists and is uncoursed, not deleted.
        from app.models.route import Route

        route = await db_session.get(Route, test_route_with_surface.id)
        assert route is not None
        assert route.course_id is None

    async def test_group_route_not_in_course_is_404(
        self, client, test_route, test_route_with_surface
    ):
        created = await client.post(
            "/api/v1/courses",
            json={"name": "Only one", "route_ids": [str(test_route.id)]},
        )
        course_id = created.json()["id"]
        resp = await client.delete(
            f"/api/v1/courses/{course_id}/routes/{test_route_with_surface.id}"
        )
        assert resp.status_code == 404


class TestCourseSuggestions:
    async def test_suggestion_pair_and_disappears_after_merge(
        self, client, db_session, test_user, test_route, test_route_with_surface
    ):
        from app.models.route import RouteSimilarity

        a = await client.post(
            "/api/v1/courses",
            json={"name": "A", "route_ids": [str(test_route.id)]},
        )
        b = await client.post(
            "/api/v1/courses",
            json={"name": "B", "route_ids": [str(test_route_with_surface.id)]},
        )
        db_session.add(
            RouteSimilarity(
                user_id=test_user.id,
                route_a_id=test_route.id,
                route_b_id=test_route_with_surface.id,
                score=0.7,
                tier="review",
                breakdown={"min_coverage": 0.9},
            )
        )
        await db_session.flush()

        resp = await client.get("/api/v1/courses/suggestions")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["route_a_course_id"] == a.json()["id"]
        assert data[0]["route_b_course_id"] == b.json()["id"]

        # Merging the two courses makes the pair a non-suggestion.
        await client.post(f"/api/v1/courses/{a.json()['id']}/merge/{b.json()['id']}")
        after = await client.get("/api/v1/courses/suggestions")
        assert after.status_code == 200
        assert after.json() == []

    async def test_same_course_pair_is_not_a_suggestion(
        self, client, db_session, test_user, test_route, test_route_with_surface
    ):
        from app.models.route import RouteSimilarity

        created = await client.post(
            "/api/v1/courses",
            json={
                "name": "Same",
                "route_ids": [str(test_route.id), str(test_route_with_surface.id)],
            },
        )
        assert created.status_code == 201
        db_session.add(
            RouteSimilarity(
                user_id=test_user.id,
                route_a_id=test_route.id,
                route_b_id=test_route_with_surface.id,
                score=0.7,
                tier="review",
                breakdown={},
            )
        )
        await db_session.flush()

        resp = await client.get("/api/v1/courses/suggestions")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_suggestions_static_path_is_not_a_course_id(self, client):
        # `suggestions` must be registered before `/{course_id}` (pitfall 13).
        resp = await client.get("/api/v1/courses/suggestions")
        assert resp.status_code == 200
        assert resp.json() == []


class TestCourseSuggestionDismissal:
    async def test_dismiss_hides_pair_until_restored(
        self, client, db_session, test_user, test_route, test_route_with_surface
    ):
        from app.models.route import RouteSimilarity

        await client.post(
            "/api/v1/courses",
            json={"name": "A", "route_ids": [str(test_route.id)]},
        )
        await client.post(
            "/api/v1/courses",
            json={"name": "B", "route_ids": [str(test_route_with_surface.id)]},
        )
        db_session.add(
            RouteSimilarity(
                user_id=test_user.id,
                route_a_id=test_route.id,
                route_b_id=test_route_with_surface.id,
                score=0.7,
                tier="review",
                breakdown={},
            )
        )
        await db_session.flush()

        dismissed = await client.post(
            f"/api/v1/courses/suggestions/{test_route.id}/{test_route_with_surface.id}/dismiss"
        )
        assert dismissed.status_code == 200
        assert dismissed.json() == {"dismissed": True}
        assert (await client.get("/api/v1/courses/suggestions")).json() == []

        dismissed_list = await client.get("/api/v1/courses/suggestions/dismissed")
        assert dismissed_list.status_code == 200
        assert len(dismissed_list.json()) == 1
        assert dismissed_list.json()[0]["route_a_id"] == str(test_route.id)

        # Orientation-insensitive: the reverse dismissal also restores it.
        restored = await client.delete(
            f"/api/v1/courses/suggestions/{test_route_with_surface.id}/{test_route.id}/dismiss"
        )
        assert restored.status_code == 200
        assert restored.json() == {"restored": True}
        assert len((await client.get("/api/v1/courses/suggestions")).json()) == 1
        assert (await client.get("/api/v1/courses/suggestions/dismissed")).json() == []

    async def test_dismiss_unknown_pair_is_404(self, client, test_route, test_user):
        resp = await client.post(
            f"/api/v1/courses/suggestions/{test_route.id}/00000000-0000-0000-0000-000000000000/dismiss"
        )
        assert resp.status_code == 404


class TestCourseMerge:
    async def test_merge_moves_routes_and_deletes_empty_source(
        self, client, db_session, test_route, test_route_with_surface
    ):
        target = await client.post(
            "/api/v1/courses",
            json={"name": "Target", "route_ids": [str(test_route.id)]},
        )
        source = await client.post(
            "/api/v1/courses",
            json={"name": "Source", "route_ids": [str(test_route_with_surface.id)]},
        )
        target_id = target.json()["id"]
        source_id = source.json()["id"]

        merged = await client.post(f"/api/v1/courses/{target_id}/merge/{source_id}")
        assert merged.status_code == 200
        assert merged.json()["route_count"] == 2
        assert {r["id"] for r in merged.json()["routes"]} == {
            str(test_route.id),
            str(test_route_with_surface.id),
        }

        # The source course is gone; the routes and rides are not.
        assert (await client.get(f"/api/v1/courses/{source_id}")).status_code == 404
        from app.models.route import Route

        for route_id in (test_route.id, test_route_with_surface.id):
            assert await db_session.get(Route, route_id) is not None

    async def test_merge_with_itself_is_404(self, client, test_route):
        course = await client.post(
            "/api/v1/courses",
            json={"name": "Self", "route_ids": [str(test_route.id)]},
        )
        course_id = course.json()["id"]
        resp = await client.post(f"/api/v1/courses/{course_id}/merge/{course_id}")
        assert resp.status_code == 404


class TestRideLinkTrust:
    async def test_confirm_and_reject_links(
        self, client, db_session, test_route, test_route_activities
    ):
        for activity in test_route_activities:
            activity.route_link_status = "suggested"
            activity.route_link_source = "legacy"
        await db_session.flush()

        created = await client.post(
            "/api/v1/courses",
            json={"name": "Ride history", "route_ids": [str(test_route.id)]},
        )
        course_id = created.json()["id"]

        detail = await client.get(f"/api/v1/courses/{course_id}")
        assert detail.json()["confirmed_ride_count"] == 0
        assert detail.json()["suggested_ride_count"] == 3

        confirmed = await client.post(
            f"/api/v1/courses/ride-links/{test_route_activities[0].id}/confirm"
        )
        assert confirmed.status_code == 200
        assert confirmed.json()["status"] == "confirmed"

        rejected = await client.post(
            f"/api/v1/courses/ride-links/{test_route_activities[1].id}/reject"
        )
        assert rejected.status_code == 200
        assert rejected.json()["status"] == "rejected"

        detail = await client.get(f"/api/v1/courses/{course_id}")
        data = detail.json()
        assert data["confirmed_ride_count"] == 1
        # 3 suggested - 1 confirmed - 1 rejected = 1 still suggested.
        assert data["suggested_ride_count"] == 1
        # Rejected links are not shown as course history.
        assert len(data["activities"]) == 2

    async def test_confirm_activity_without_route_is_404(
        self, client, db_session, test_user
    ):
        from datetime import UTC, datetime

        from app.models.activity import Activity

        activity = Activity(
            user_id=test_user.id,
            source="strava",
            sport_type="cycling",
            name="Unlinked ride",
            start_date=datetime.now(UTC),
        )
        db_session.add(activity)
        await db_session.flush()

        resp = await client.post(f"/api/v1/courses/ride-links/{activity.id}/confirm")
        assert resp.status_code == 404
