"""Integration tests for the global search endpoint (command palette).

Run with:  pytest tests/integration/test_search_api.py -m integration
"""

from __future__ import annotations

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


class TestGlobalSearch:
    """GET /api/v1/search — cross-domain name lookup."""

    async def test_finds_activity_by_name(self, client, test_activity):
        resp = await client.get("/api/v1/search?q=morning")
        assert resp.status_code == 200
        data = resp.json()
        names = [a["name"] for a in data["activities"]]
        assert "Morning Ride" in names

    async def test_finds_event_by_name(self, client, test_event):
        resp = await client.get("/api/v1/search?q=summer")
        assert resp.status_code == 200
        data = resp.json()
        names = [e["name"] for e in data["events"]]
        assert "Summer Century Ride" in names

    async def test_finds_route_by_name(self, client, test_route):
        resp = await client.get("/api/v1/search?q=test")
        assert resp.status_code == 200
        data = resp.json()
        names = [r["name"] for r in data["routes"]]
        assert any("test" in r_name.lower() for r_name in names)

    async def test_no_match_returns_empty_groups(self, client):
        resp = await client.get("/api/v1/search?q=zzzz_not_a_real_query")
        assert resp.status_code == 200
        data = resp.json()
        assert data["activities"] == []
        assert data["routes"] == []
        assert data["lifting_sessions"] == []
        assert data["exercises"] == []
        assert data["goals"] == []
        assert data["events"] == []

    async def test_empty_query_returns_no_error(self, client):
        resp = await client.get("/api/v1/search?q=")
        assert resp.status_code == 200
        assert resp.json()["query"] == ""
