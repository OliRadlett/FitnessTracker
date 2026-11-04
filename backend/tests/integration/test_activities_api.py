"""Integration tests for the Activities API.

Tests the full HTTP → router → service → model pipeline.
Run with:  pytest tests/integration/test_activities_api.py -m integration
"""

from __future__ import annotations

import uuid as _uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.models.activity import Activity, ActivityStream
from app.models.route import Route
from app.models.user import User
from app.services.polyline_utils import encode_polyline

pytestmark = pytest.mark.integration


# ── List ──────────────────────────────────────────────────────────────────


class TestListActivities:
    """GET /api/v1/activities — paginated activity list."""

    async def test_empty_list(self, client):
        """Returns an empty list with X-Total-Count header when no activities exist."""
        resp = await client.get("/api/v1/activities")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 0
        assert resp.headers.get("x-total-count") == "0"

    async def test_returns_created_activity(self, client, test_activity):
        """An activity inserted via fixture shows up in the list."""
        resp = await client.get("/api/v1/activities")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "Morning Ride"
        assert data[0]["sport_type"] == "cycling"
        assert resp.headers.get("x-total-count") == "1"

    async def test_filter_by_sport_type(self, client, test_activity):
        """Filtering by sport_type returns matching activities."""
        resp = await client.get("/api/v1/activities", params={"sport_type": "cycling"})
        assert resp.status_code == 200
        assert len(resp.json()) == 1

        resp = await client.get("/api/v1/activities", params={"sport_type": "running"})
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    async def test_filter_by_source(self, client, test_activity):
        """Filtering by source works correctly."""
        resp = await client.get("/api/v1/activities", params={"source": "strava"})
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    async def test_pagination_limit_and_offset(self, client, test_activity):
        """Limit and offset query params control the response."""
        resp = await client.get("/api/v1/activities", params={"limit": 1, "offset": 0})
        assert resp.status_code == 200
        assert len(resp.json()) == 1

        resp = await client.get("/api/v1/activities", params={"limit": 1, "offset": 1})
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    async def test_filter_by_q_name_search(self, client, test_activity):
        """Filtering by q searches activity name case-insensitively."""
        resp = await client.get("/api/v1/activities", params={"q": "morning"})
        assert resp.status_code == 200
        assert len(resp.json()) == 1
        assert resp.json()[0]["name"] == "Morning Ride"

        resp = await client.get("/api/v1/activities", params={"q": "nonexistent"})
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    async def test_filter_by_distance_range(self, client, test_activity):
        """Filtering by min_distance/max_distance returns matching activities."""
        # Activity has distance_meters=50_000
        resp = await client.get(
            "/api/v1/activities", params={"min_distance": 40000, "max_distance": 60000}
        )
        assert resp.status_code == 200
        assert len(resp.json()) == 1

        resp = await client.get("/api/v1/activities", params={"min_distance": 60000})
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    async def test_filter_by_duration_range(self, client, test_activity):
        """Filtering by min_duration/max_duration returns matching activities."""
        # Activity has duration_seconds=3600
        resp = await client.get(
            "/api/v1/activities", params={"min_duration": 3000, "max_duration": 4000}
        )
        assert resp.status_code == 200
        assert len(resp.json()) == 1

        resp = await client.get("/api/v1/activities", params={"min_duration": 5000})
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    async def test_filter_by_tss_range(self, client, test_activity):
        """Filtering by min_tss/max_tss returns matching activities."""
        # Activity has tss=80
        resp = await client.get(
            "/api/v1/activities", params={"min_tss": 70, "max_tss": 90}
        )
        assert resp.status_code == 200
        assert len(resp.json()) == 1

        resp = await client.get("/api/v1/activities", params={"min_tss": 100})
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    async def test_sort_by_distance_desc(self, client, test_multiple_activities):
        """Sorting by distance descending returns activities in correct order."""
        resp = await client.get(
            "/api/v1/activities", params={"sort_by": "distance", "sort_order": "desc"}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 5
        distances = [a["distance_meters"] for a in data]
        assert distances == sorted(distances, reverse=True)

    async def test_sort_by_tss_asc(self, client, test_multiple_activities):
        """Sorting by tss ascending returns activities in correct order."""
        resp = await client.get(
            "/api/v1/activities", params={"sort_by": "tss", "sort_order": "asc"}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 5
        tss_values = [a["tss"] for a in data]
        assert tss_values == sorted(tss_values)

    async def test_sort_by_invalid_returns_422(self, client):
        """Invalid sort_by value returns 422."""
        resp = await client.get(
            "/api/v1/activities", params={"sort_by": "invalid_field"}
        )
        assert resp.status_code == 422
        assert "Invalid sort_by" in resp.json()["detail"]

    async def test_min_distance_greater_than_max_returns_422(self, client):
        """min_distance > max_distance returns 422."""
        resp = await client.get(
            "/api/v1/activities",
            params={"min_distance": 100, "max_distance": 50},
        )
        assert resp.status_code == 422
        assert "min_distance" in resp.json()["detail"]

    async def test_min_duration_greater_than_max_returns_422(self, client):
        """min_duration > max_duration returns 422."""
        resp = await client.get(
            "/api/v1/activities",
            params={"min_duration": 100, "max_duration": 50},
        )
        assert resp.status_code == 422
        assert "min_duration" in resp.json()["detail"]

    async def test_min_tss_greater_than_max_returns_422(self, client):
        """min_tss > max_tss returns 422."""
        resp = await client.get(
            "/api/v1/activities",
            params={"min_tss": 100, "max_tss": 50},
        )
        assert resp.status_code == 422
        assert "min_tss" in resp.json()["detail"]


# ── Detail ────────────────────────────────────────────────────────────────


class TestGetActivity:
    """GET /api/v1/activities/{id} — single activity detail."""

    async def test_get_existing_activity(self, client, test_activity):
        """Returns the full activity record with enriched fields."""
        resp = await client.get(f"/api/v1/activities/{test_activity.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == str(test_activity.id)
        assert data["name"] == "Morning Ride"
        assert data["average_power"] == 200.0
        assert data["sources"] == []

    async def test_get_nonexistent_returns_404(self, client):
        resp = await client.get(f"/api/v1/activities/{_uuid.uuid4()}")
        assert resp.status_code == 404


# ── Streams ───────────────────────────────────────────────────────────────


class TestActivityStreams:
    """GET /api/v1/activities/{id}/streams — stream data for an activity."""

    async def test_returns_streams(self, client, test_activity):
        resp = await client.get(f"/api/v1/activities/{test_activity.id}/streams")
        assert resp.status_code == 200
        streams = resp.json()
        assert len(streams) == 1
        assert streams[0]["stream_type"] == "watts"
        assert len(streams[0]["data"]["data"]) == 360

    async def test_streams_for_nonexistent_activity(self, client):
        resp = await client.get(f"/api/v1/activities/{_uuid.uuid4()}/streams")
        assert resp.status_code == 404


# ── Replay ────────────────────────────────────────────────────────────────


class TestActivityReplay:
    """GET /api/v1/activities/{id}/replay — normalized 3D replay payload."""

    async def test_replay_returns_aligned_ride(
        self, client, db_session, test_activity
    ):
        coords = [
            (46.0, 6.0),
            (46.001, 6.001),
            (46.002, 6.001),
            (46.003, 6.002),
            (46.004, 6.002),
            (46.005, 6.003),
        ]
        test_activity.raw_data = {
            "timezone": "UTC",
            "map": {"summary_polyline": encode_polyline(coords)},
        }
        db_session.add_all(
            [
                ActivityStream(
                    activity_id=test_activity.id,
                    stream_type="time",
                    data={"data": [0, 1, 2, 3, 4, 5]},
                    resolution=1,
                ),
                ActivityStream(
                    activity_id=test_activity.id,
                    stream_type="distance",
                    data={"data": [0, 5, 10, 15, 20, 25]},
                    resolution=1,
                ),
                ActivityStream(
                    activity_id=test_activity.id,
                    stream_type="velocity_smooth",
                    data={"data": [0, 5, 5, 5, 5, 5]},
                    resolution=1,
                ),
                ActivityStream(
                    activity_id=test_activity.id,
                    stream_type="altitude",
                    data={"data": [400, 405, 410, 415, 420, 425]},
                    resolution=1,
                ),
                ActivityStream(
                    activity_id=test_activity.id,
                    stream_type="heartrate",
                    data={"data": [100, 110, 120, 130, 140, 150]},
                    resolution=1,
                ),
                ActivityStream(
                    activity_id=test_activity.id,
                    stream_type="latlng",
                    data={"data": coords},
                    resolution=1,
                ),
            ]
        )
        await db_session.flush()

        resp = await client.get(
            f"/api/v1/activities/{test_activity.id}/replay"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ride"]["streams"]["t"][0] == 0
        assert data["ride"]["streams"]["d"][-1] == 25
        assert data["ride"]["key_points"]["end"] == 5
        assert data["ride"]["highlights"]["highest"]["idx"] == 5
        assert data["activity"]["timezone"] == "UTC"
        assert data["route"] is None

    async def test_replay_without_speed_returns_422(self, client, test_activity):
        resp = await client.get(
            f"/api/v1/activities/{test_activity.id}/replay"
        )
        assert resp.status_code == 422

    async def test_replay_for_nonexistent_activity(self, client):
        resp = await client.get(f"/api/v1/activities/{_uuid.uuid4()}/replay")
        assert resp.status_code == 404

    async def test_claim_map_false_leaves_budget_untouched(
        self, client, db_session, test_activity, monkeypatch
    ):
        """A ghost payload is fetched into an open map, so it must not claim one.

        Charging it would burn the monthly cap on a page that already counted.
        """
        from app.api import activities as activities_api

        calls = 0

        async def _count_claim(user_id):
            nonlocal calls
            calls += 1
            return {"allowed": True, "used": calls, "limit": 500}

        monkeypatch.setattr(activities_api, "claim_map_open", _count_claim)

        await _add_replay_streams(db_session, test_activity)

        plain = await client.get(f"/api/v1/activities/{test_activity.id}/replay")
        assert plain.status_code == 200
        assert calls == 1
        assert plain.json()["map_used"] == 1

        ghost = await client.get(
            f"/api/v1/activities/{test_activity.id}/replay?claim_map=0"
        )
        assert ghost.status_code == 200
        assert calls == 1, "claim_map=0 must not touch the budget"
        assert ghost.json()["map_used"] == 0


    async def test_second_open_serves_the_cached_payload(
        self, client, db_session, test_activity, monkeypatch
    ):
        """Repeat opens must not rebuild the payload (or reload its streams).

        The cache is swapped for an in-memory dict so the assertion does not
        depend on a Redis instance being reachable.
        """
        from app.api import activities as activities_api

        store: dict[str, object] = {}

        async def _get(key):
            return store.get(key)

        async def _set(key, value, ttl):
            store[key] = value

        monkeypatch.setattr(activities_api, "get_json", _get)
        monkeypatch.setattr(activities_api, "set_json", _set)

        builds = 0
        real_build = activities_api.build_replay

        def _count_build(activity):
            nonlocal builds
            builds += 1
            return real_build(activity)

        monkeypatch.setattr(activities_api, "build_replay", _count_build)
        await _add_replay_streams(db_session, test_activity)

        first = await client.get(f"/api/v1/activities/{test_activity.id}/replay")
        second = await client.get(f"/api/v1/activities/{test_activity.id}/replay")

        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()["ride"] == second.json()["ride"]
        assert builds == 1, "the second open should be served from cache"
        assert len(store) == 1


# ── Ghosts (route history) ────────────────────────────────────────────────


class TestActivityGhosts:
    """GET /api/v1/activities/{id}/ghosts — past rides on the same route."""

    async def test_lists_other_rides_on_the_route_newest_first(
        self, client, db_session, test_user, test_activity
    ):
        route = await _add_route(db_session, test_user)
        test_activity.route_id = route.id
        older = await _add_route_activity(
            db_session, test_user, route, days_ago=30, name="Older lap"
        )
        newer = await _add_route_activity(
            db_session, test_user, route, days_ago=2, name="Newer lap"
        )
        await db_session.flush()

        resp = await client.get(f"/api/v1/activities/{test_activity.id}/ghosts")
        assert resp.status_code == 200
        data = resp.json()
        assert data["route_id"] == str(route.id)
        assert data["route_name"] == "Test loop"
        assert [row["activity_id"] for row in data["candidates"]] == [
            str(newer.id),
            str(older.id),
        ]
        assert data["candidates"][0]["name"] == "Newer lap"
        assert data["candidates"][0]["moving_s"] == 3600
        assert data["reason"] is None

    async def test_excludes_the_activity_itself(
        self, client, db_session, test_user, test_activity
    ):
        route = await _add_route(db_session, test_user)
        test_activity.route_id = route.id
        await db_session.flush()

        resp = await client.get(f"/api/v1/activities/{test_activity.id}/ghosts")
        assert resp.status_code == 200
        data = resp.json()
        assert data["candidates"] == []
        assert data["reason"] == "No other rides on this route yet."

    async def test_unrouted_activity_reports_a_reason(self, client, test_activity):
        resp = await client.get(f"/api/v1/activities/{test_activity.id}/ghosts")
        assert resp.status_code == 200
        data = resp.json()
        assert data["candidates"] == []
        assert data["route_id"] is None
        assert "not matched to a route" in data["reason"]

    async def test_other_users_rides_are_not_offered(
        self, client, db_session, test_user, test_activity
    ):
        route = await _add_route(db_session, test_user)
        test_activity.route_id = route.id
        stranger = User(
            id=_uuid.uuid4(), email="stranger@example.com", name="Stranger"
        )
        db_session.add(stranger)
        await db_session.flush()
        await _add_route_activity(
            db_session, stranger, route, days_ago=3, name="Not mine"
        )
        await db_session.flush()

        resp = await client.get(f"/api/v1/activities/{test_activity.id}/ghosts")
        assert resp.status_code == 200
        assert resp.json()["candidates"] == []

    async def test_pb_is_the_quickest_ride_including_this_one(
        self, client, db_session, test_user, test_activity
    ):
        """The PB marker must include the current ride, not just the ghosts.

        Otherwise beating your own best makes the badge vanish — the one case
        where it matters most.
        """
        route = await _add_route(db_session, test_user)
        test_activity.route_id = route.id
        test_activity.duration_seconds = 1800  # this ride is the PB
        slower = await _add_route_activity(
            db_session, test_user, route, days_ago=5, name="Slower lap"
        )
        slower.duration_seconds = 2400
        await db_session.flush()

        resp = await client.get(f"/api/v1/activities/{test_activity.id}/ghosts")
        assert resp.status_code == 200
        assert resp.json()["pb_activity_id"] == str(test_activity.id)

    async def test_nonexistent_activity_returns_404(self, client):
        resp = await client.get(f"/api/v1/activities/{_uuid.uuid4()}/ghosts")
        assert resp.status_code == 404


async def _add_route(db_session, user) -> Route:
    route = Route(
        user_id=user.id,
        name="Test loop",
        sport_type="cycling",
        distance_meters=20_000.0,
        encoded_polyline="abc",
        start_lat=55.94,
        start_lng=-3.17,
        end_lat=55.94,
        end_lng=-3.17,
    )
    db_session.add(route)
    await db_session.flush()
    return route


async def _add_route_activity(db_session, user, route, *, days_ago, name):
    activity = Activity(
        user_id=user.id,
        source="strava",
        sport_type="cycling",
        name=name,
        start_date=datetime.now(UTC) - timedelta(days=days_ago),
        duration_seconds=3600,
        distance_meters=20_000.0,
        average_speed=5.5,
        route_id=route.id,
        raw_data={"timezone": "Europe/London"},
    )
    db_session.add(activity)
    await db_session.flush()
    return activity


async def _add_replay_streams(db_session, activity) -> None:
    """Give ``activity`` the minimum streams ``build_replay`` needs."""
    coords = [
        (46.0, 6.0),
        (46.001, 6.001),
        (46.002, 6.001),
        (46.003, 6.002),
        (46.004, 6.002),
        (46.005, 6.003),
    ]
    activity.raw_data = {
        "timezone": "UTC",
        "map": {"summary_polyline": encode_polyline(coords)},
    }
    for stream_type, data in (
        ("time", [0, 1, 2, 3, 4, 5]),
        ("distance", [0, 5, 10, 15, 20, 25]),
        ("velocity_smooth", [0, 5, 5, 5, 5, 5]),
        ("altitude", [400, 405, 410, 415, 420, 425]),
        ("heartrate", [100, 110, 120, 130, 140, 150]),
        ("latlng", coords),
    ):
        db_session.add(
            ActivityStream(
                activity_id=activity.id,
                stream_type=stream_type,
                data={"data": data},
                resolution=1,
            )
        )
    await db_session.flush()


# ── Analysis (static) ─────────────────────────────────────────────────────


class TestActivityAnalysis:
    """GET /api/v1/activities/{id}/analysis — static ride analysis."""

    async def test_analysis_for_activity_with_power_stream(
        self, client, test_activity, test_cycling_profile
    ):
        """Analysis should return power zones, pacing, and TSS breakdown."""
        resp = await client.get(f"/api/v1/activities/{test_activity.id}/analysis")
        assert resp.status_code == 200
        data = resp.json()
        # The response should include at least these keys
        assert "power_zones" in data
        assert "pacing_analysis" in data
        assert "tss_breakdown" in data
        assert "fatigue_index" in data or "variability_index" in data

    async def test_analysis_nonexistent_activity(self, client):
        resp = await client.get(f"/api/v1/activities/{_uuid.uuid4()}/analysis")
        assert resp.status_code == 404


# ── AI analysis ───────────────────────────────────────────────────────────


class TestActivityAiAnalysis:
    """GET/POST /api/v1/activities/{id}/ai-analysis — per-activity Gemini analysis."""

    async def test_get_ai_analysis_returns_null_when_none_exists(
        self, client, test_activity
    ):
        """Returns null/None when no AI analysis has been generated yet."""
        resp = await client.get(f"/api/v1/activities/{test_activity.id}/ai-analysis")
        assert resp.status_code == 200
        assert resp.json() is None

    async def test_trigger_ai_analysis_with_mocked_gemini(
        self, client, test_activity, test_cycling_profile
    ):
        """Triggering AI analysis creates and returns an LlmAnalysis record.

        Only the external Gemini HTTP call is mocked — the full internal
        pipeline (compile_activity_context → store → retrieve) runs for real.
        """
        from unittest.mock import AsyncMock, patch

        from app.config import get_settings

        mock_response = AsyncMock()
        mock_response.text = (
            "### Pacing Analysis\n"
            "Good pacing strategy with consistent power output.\n\n"
            "### Effort Classification\n"
            "Endurance ride at moderate intensity."
        )

        settings = get_settings()
        with (
            patch.object(settings, "gemini_api_key", "fake-test-key"),
            patch("google.genai.Client") as mock_client_cls,
        ):
            mock_client = AsyncMock()
            mock_client.aio.models.generate_content.return_value = mock_response
            mock_client_cls.return_value = mock_client

            resp = await client.post(
                f"/api/v1/activities/{test_activity.id}/ai-analysis"
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["analysis_type"] == "activity"
        assert data["activity_id"] == str(test_activity.id)
        assert "Pacing Analysis" in data["analysis_text"]
        assert "stats_json" in data
        # The stats_json should contain the real compiled context
        assert "activity_summary" in data["stats_json"]

    async def test_get_ai_analysis_after_trigger(
        self, client, test_activity, test_cycling_profile
    ):
        """After triggering analysis, GET returns the stored result."""
        from unittest.mock import AsyncMock, patch

        from app.config import get_settings

        mock_response = AsyncMock()
        mock_response.text = "Test analysis response."

        settings = get_settings()
        with (
            patch.object(settings, "gemini_api_key", "fake-test-key"),
            patch("google.genai.Client") as mock_client_cls,
        ):
            mock_client = AsyncMock()
            mock_client.aio.models.generate_content.return_value = mock_response
            mock_client_cls.return_value = mock_client

            await client.post(f"/api/v1/activities/{test_activity.id}/ai-analysis")

        # Now GET should return the stored analysis
        resp = await client.get(f"/api/v1/activities/{test_activity.id}/ai-analysis")
        assert resp.status_code == 200
        data = resp.json()
        assert data is not None
        assert data["analysis_text"] == "Test analysis response."

    async def test_trigger_for_nonexistent_activity(self, client):
        resp = await client.post(f"/api/v1/activities/{_uuid.uuid4()}/ai-analysis")
        assert resp.status_code == 404

# ── Journal contract ─────────────────────────────────────────────────────────
#
# The journal names a lift after the exercise it trained and filters by sport
# family, because provider strings disagree ("strength" vs "weighttraining") and
# every activity name is constant. These tests pin that contract end to end.


class TestJournalContract:
    """What the activity journal needs from the list and summary endpoints."""

    @staticmethod
    async def _strength_activity_with_sets(db_session, test_user):
        """An activity linked to a session with three sets of Bench Press."""
        from app.models.lifting import LiftingSession, LiftingSet

        activity = Activity(
            user_id=test_user.id,
            source="strava",
            sport_type="strength",
            name="Evening Weight Training",
            start_date=datetime.now(UTC) - timedelta(days=2),
            duration_seconds=4200,
        )
        db_session.add(activity)
        await db_session.flush()

        session = LiftingSession(
            user_id=test_user.id,
            activity_id=activity.id,
            session_date=activity.start_date.date(),
            focus="Push",
            duration_seconds=4200,
            total_volume_kg=5326.0,
            estimated_tss=58.7,
        )
        db_session.add(session)
        await db_session.flush()

        for index, (name, weight, reps) in enumerate(
            [("Bench Press", 90.0, 4), ("Bench Press", 90.0, 4), ("Tricep Extension", 36.0, 12)]
        ):
            db_session.add(
                LiftingSet(
                    session_id=session.id,
                    exercise_name=name,
                    weight_kg=weight,
                    reps=reps,
                    set_number=index + 1,
                    order_index=index,
                )
            )
        await db_session.flush()
        return activity

    async def test_linked_session_carries_the_exercise_the_row_shows(
        self, client, db_session, test_user
    ):
        """top_exercise / top_weights / estimated_tss come back on the list."""
        await self._strength_activity_with_sets(db_session, test_user)

        resp = await client.get("/api/v1/activities")

        assert resp.status_code == 200
        rows = resp.json()
        assert len(rows) == 1
        linked = rows[0]["linked_lifting_session"]
        assert linked["top_exercise"] == "Bench Press"
        assert linked["set_count"] == 3
        assert linked["top_weights"][0] == 90.0
        assert linked["estimated_tss"] == 58.7

    async def test_summary_includes_lifting_volume(self, client, db_session, test_user):
        """A period total without volume hides every lift."""
        await self._strength_activity_with_sets(db_session, test_user)

        resp = await client.get("/api/v1/activities/summary")

        assert resp.status_code == 200
        assert resp.json()["total_volume_kg"] == 5326.0

    async def test_sport_group_ride_excludes_lifts(self, client, db_session, test_user):
        await self._strength_activity_with_sets(db_session, test_user)
        db_session.add(
            Activity(
                user_id=test_user.id,
                source="strava",
                sport_type="cycling",
                name="Cycling",
                start_date=datetime.now(UTC) - timedelta(days=1),
                duration_seconds=3600,
                distance_meters=50_000.0,
            )
        )
        await db_session.flush()

        rides = await client.get("/api/v1/activities", params={"sport_group": "ride"})
        lifts = await client.get("/api/v1/activities", params={"sport_group": "lift"})

        assert [row["sport_type"] for row in rides.json()] == ["cycling"]
        # The real account stores "strength", not "weighttraining" — the old
        # dropdown's exact-match filter silently returned nothing.
        assert [row["sport_type"] for row in lifts.json()] == ["strength"]

    async def test_search_reaches_route_and_exercise_names(
        self, client, db_session, test_user, test_route_activities
    ):
        """`q` used to match Activity.name only — constant for every row."""
        by_route = await client.get("/api/v1/activities", params={"q": "Richmond"})
        assert by_route.status_code == 200
        assert len(by_route.json()) == len(test_route_activities)

        await self._strength_activity_with_sets(db_session, test_user)
        by_exercise = await client.get("/api/v1/activities", params={"q": "Tricep"})
        assert by_exercise.status_code == 200
        assert [row["sport_type"] for row in by_exercise.json()] == ["strength"]
