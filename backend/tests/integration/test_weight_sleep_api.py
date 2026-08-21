"""Integration tests for Weight and Sleep API endpoints.

These tests exercise the full pipeline: HTTP → FastAPI router → service → model → database.
No internal functions are mocked.

Run with:  pytest tests/integration/test_weight_sleep_api.py -m integration
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


# ── Weight ───────────────────────────────────────────────────────────────


class TestWeightEndpoints:
    """Weight logging and history endpoints."""

    async def test_get_weight_history(self, client, test_weight_log):
        """GET /api/v1/metrics/weight returns weight history."""
        resp = await client.get("/api/v1/metrics/weight?days=90")
        assert resp.status_code == 200
        data = resp.json()
        assert "entries" in data
        assert "rolling_avg" in data
        assert len(data["entries"]) >= 1
        entry = data["entries"][0]
        assert entry["weight_kg"] == 75.5
        assert entry["source"] == "manual"

    async def test_get_weight_empty(self, client):
        """GET /api/v1/metrics/weight returns empty when no logs."""
        resp = await client.get("/api/v1/metrics/weight?days=90")
        assert resp.status_code == 200
        data = resp.json()
        assert data["entries"] == []
        assert data["rolling_avg"] == []


# ── Sleep ────────────────────────────────────────────────────────────────


class TestSleepEndpoints:
    """Sleep logging and history endpoints."""

    async def test_get_sleep_consistency(self, client, test_sleep_log):
        """GET /api/v1/metrics/sleep-consistency returns consistency data."""
        resp = await client.get("/api/v1/metrics/sleep-consistency?days=7")
        assert resp.status_code == 200
        data = resp.json()
        assert "consistency_score" in data
        assert "days_analyzed" in data

    async def test_get_sleep_debt(self, client, test_sleep_log):
        """GET /api/v1/metrics/sleep-debt returns debt data."""
        resp = await client.get("/api/v1/metrics/sleep-debt?days=7")
        assert resp.status_code == 200
        data = resp.json()
        assert "debt_hours" in data
        assert "avg_sleep_hours" in data
        assert "days_below_target" in data

    async def test_get_sleep_debt_custom_target(self, client, test_sleep_log):
        """GET /api/v1/metrics/sleep-debt accepts custom target_hours."""
        resp = await client.get("/api/v1/metrics/sleep-debt?target_hours=9.0&days=7")
        assert resp.status_code == 200
        data = resp.json()
        assert data["target_hours"] == 9.0
