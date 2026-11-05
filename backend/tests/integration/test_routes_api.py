"""Integration tests for the Routes API (CRUD, filtering).

These tests exercise the full pipeline: HTTP → FastAPI router → service → model → database.
No internal functions are mocked.

Run with:  pytest tests/integration/test_routes_api.py -m integration
"""

from __future__ import annotations

import uuid

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


# ── List Routes ──────────────────────────────────────────────────────────


class TestListRoutes:
    """GET /api/v1/routes — lists routes."""

    async def test_list_routes(self, client, test_route):
        """List returns all routes for the user."""
        resp = await client.get("/api/v1/routes/")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        # Check X-Total-Count header
        assert "x-total-count" in resp.headers
        assert int(resp.headers["x-total-count"]) >= 1

    async def test_list_routes_includes_preview_polyline(self, client, test_route):
        """List carries a display polyline so cards can draw the route shape."""
        resp = await client.get("/api/v1/routes/")
        assert resp.status_code == 200
        route = next(r for r in resp.json() if r["id"] == str(test_route.id))

        assert route["preview_polyline"]
        from app.services.polyline_utils import decode_polyline

        assert len(decode_polyline(route["preview_polyline"])) == len(
            decode_polyline(test_route.encoded_polyline)
        )

    async def test_detail_keeps_full_polyline(self, client, test_route):
        """The preview is additive; detail still returns the full polyline."""
        resp = await client.get(f"/api/v1/routes/{test_route.id}")
        assert resp.status_code == 200
        assert resp.json()["encoded_polyline"] == test_route.encoded_polyline

    async def test_list_routes_empty(self, client):
        """List returns empty when no routes exist."""
        resp = await client.get("/api/v1/routes/")
        assert resp.status_code == 200
        data = resp.json()
        assert data == []

    async def test_list_routes_with_sport_type_filter(self, client, test_route):
        """List with sport_type filter returns matching routes."""
        resp = await client.get("/api/v1/routes/?sport_type=cycling")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert all(r["sport_type"] == "cycling" for r in data)

    async def test_list_routes_with_distance_filter(self, client, test_route):
        """List with distance filters returns matching routes."""
        resp = await client.get("/api/v1/routes/?min_distance=10000&max_distance=20000")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1


# ── Get Single Route ─────────────────────────────────────────────────────


class TestGetRoute:
    """GET /api/v1/routes/{id} — gets single route."""

    async def test_get_route(self, client, test_route):
        """Get returns the route with sources."""
        resp = await client.get(f"/api/v1/routes/{test_route.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == str(test_route.id)
        assert data["name"] == "Richmond Park Loop"
        assert data["distance_meters"] == 15000.0
        assert data["is_loop"] is True
        assert "sources" in data

    async def test_get_nonexistent_route(self, client):
        """Get returns 404 for nonexistent route."""
        resp = await client.get(f"/api/v1/routes/{uuid.uuid4()}")
        assert resp.status_code == 404


# ── Surface Type Filter ──────────────────────────────────────────────────


class TestSurfaceTypeFilter:
    """GET /api/v1/routes/?surface_type=... — filter by surface profile key."""

    async def test_filter_by_surface_type(self, client, test_route_with_surface):
        """Filtering by surface_type returns routes containing that surface key."""
        resp = await client.get("/api/v1/routes/?surface_type=paved")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert any(r["id"] == str(test_route_with_surface.id) for r in data)

    async def test_filter_by_nonexistent_surface_type(
        self, client, test_route_with_surface
    ):
        """Filtering by a surface type not in any route returns empty."""
        resp = await client.get("/api/v1/routes/?surface_type=sand")
        assert resp.status_code == 200
        data = resp.json()
        # Should not include the test route
        assert not any(r["id"] == str(test_route_with_surface.id) for r in data)


# ── Route History ────────────────────────────────────────────────────────


class TestRouteHistory:
    """GET /api/v1/routes/{route_id}/history — ride history with personal best."""

    async def test_history_returns_rides_and_pb(
        self, client, test_route, test_route_activities
    ):
        """History endpoint returns all rides and the personal best."""
        resp = await client.get(f"/api/v1/routes/{test_route.id}/history")
        assert resp.status_code == 200
        data = resp.json()
        assert data["route_id"] == str(test_route.id)
        assert data["route_name"] == "Richmond Park Loop"
        assert data["total_rides"] == 3
        assert len(data["rides"]) == 3
        # Rides should be ordered by date desc
        dates = [r["date"] for r in data["rides"]]
        assert dates == sorted(dates, reverse=True)
        # Personal best should be the ride with shortest duration
        assert data["personal_best"] is not None
        assert data["personal_best"]["duration_seconds"] == 3000  # shortest

    async def test_history_empty_route(self, client, test_route):
        """History for a route with no rides returns empty list and no PB."""
        resp = await client.get(f"/api/v1/routes/{test_route.id}/history")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_rides"] == 0
        assert data["rides"] == []
        assert data["personal_best"] is None

    async def test_history_nonexistent_route(self, client):
        """History for nonexistent route returns 404."""
        resp = await client.get(f"/api/v1/routes/{uuid.uuid4()}/history")
        assert resp.status_code == 404


class TestDuplicatesQueue:
    """GET /api/v1/routes/duplicates — the review queue.

    Regression: the cached-duplicates path loaded routes with only
    `selectinload(Route.sources)`, but `RouteRead` also reads `.tags` (a lazy
    viewonly relationship) → MissingGreenlet → HTTP 500 once the
    `route_similarity` cache was populated.
    """

    async def test_duplicates_returns_200_when_cache_populated(
        self, client, db_session, test_user, test_route
    ):
        from app.models.route import RouteSimilarity
        from app.services.route_service import create_route

        other = await create_route(
            db_session,
            test_user.id,
            "Second",
            "cycling",
            40_000.0,
            test_route.encoded_polyline,
        )
        db_session.add(
            RouteSimilarity(
                user_id=test_user.id,
                route_a_id=test_route.id,
                route_b_id=other.id,
                score=0.7,
                tier="review",
                breakdown={"total": 0.7, "tier": "review"},
            )
        )
        await db_session.flush()

        resp = await client.get("/api/v1/routes/duplicates")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        # RouteRead must serialise cleanly, including tags.
        assert "tags" in data[0]["route_a"]

    async def test_duplicates_without_cache_returns_empty_and_reports_never(
        self, client, test_route
    ):
        """An empty cache must not trigger the 15-minute synchronous scan."""
        resp = await client.get("/api/v1/routes/duplicates")
        assert resp.status_code == 200, resp.text
        assert resp.json() == []
        assert resp.headers["x-scan-status"] == "never"

    async def test_duplicates_never_scans_on_read(self, client, test_route, monkeypatch):
        from app.services import route_service

        async def _boom(*args, **kwargs):
            raise AssertionError("the review queue must not scan on read")

        monkeypatch.setattr(route_service, "find_potential_duplicates", _boom)

        resp = await client.get("/api/v1/routes/duplicates")
        assert resp.status_code == 200, resp.text

    async def test_scan_status_is_never_before_the_first_scan(self, client):
        resp = await client.get("/api/v1/routes/duplicates/status")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["state"] == "never"
        assert body["pairs"] is None

    async def test_refresh_queues_a_background_scan(self, client, monkeypatch):
        from app.services import route_similarity

        queued: list[str] = []

        async def _fake_enqueue(user_id):
            queued.append(str(user_id))
            return "queued"

        monkeypatch.setattr(route_similarity, "enqueue_user_similarity", _fake_enqueue)

        resp = await client.post("/api/v1/routes/duplicates/refresh")
        assert resp.status_code == 202, resp.text
        assert resp.json() == {"status": "queued"}
        assert len(queued) == 1


class TestRouteIntelligenceRefresh:
    """POST /api/v1/routes/intelligence/refresh — terrain + quality, now.

    Both are weekly-only jobs, so a route synced/imported today used to wait up
    to a week for terrain and a score. The refresh is also what sync and GPX
    import call.
    """

    async def _hill_route(self, db_session, test_user):
        from app.services.route_service import create_route

        return await create_route(
            db_session,
            test_user.id,
            "Hill Rep",
            "cycling",
            3_000.0,
            "o}~mH~}xMz@z@z@z@z@z@",
            elevation_profile={
                "distance": [0, 500, 1000, 1500, 2000, 2500, 3000],
                "elevation": [100, 130, 170, 220, 270, 320, 360],
            },
        )

    async def test_refresh_classifies_terrain_and_scores_quality(
        self, client, db_session, test_user
    ):
        from sqlalchemy import select

        from app.models.route import Route
        from app.models.route_organize import RouteQuality

        route = await self._hill_route(db_session, test_user)
        await db_session.flush()

        resp = await client.post("/api/v1/routes/intelligence/refresh")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["terrain_classified"] >= 1
        assert body["quality_scored"] >= 1

        refreshed = (
            await db_session.execute(select(Route).where(Route.id == route.id))
        ).scalar_one()
        assert refreshed.terrain_classification
        assert refreshed.terrain_classification["terrain_type"] != "unknown"
        assert refreshed.quality_score is not None

        quality = (
            await db_session.execute(
                select(RouteQuality).where(RouteQuality.route_id == route.id)
            )
        ).scalar_one_or_none()
        assert quality is not None
        assert quality.overall_score is not None

    async def test_refresh_is_idempotent(self, client, db_session, test_user):
        await self._hill_route(db_session, test_user)
        await db_session.flush()

        await client.post("/api/v1/routes/intelligence/refresh")
        second = await client.post("/api/v1/routes/intelligence/refresh")
        assert second.status_code == 200, second.text
        assert second.json()["terrain_classified"] == 0

