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
