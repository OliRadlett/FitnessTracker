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
