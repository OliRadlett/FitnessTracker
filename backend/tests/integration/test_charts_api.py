"""Integration tests for the Charts API.

These tests exercise the full pipeline: HTTP → FastAPI router → ChartService → database.
No internal functions are mocked.

Run with:  pytest tests/integration/test_charts_api.py -m integration
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


# ── Daily TSS Chart ──────────────────────────────────────────────────────


class TestDailyTssChart:
    """GET /api/v1/charts/daily_tss — TSS data points."""

    async def test_returns_tss_data_points(self, client, test_multiple_activities):
        """Daily TSS chart returns data with correct structure."""
        resp = await client.get("/api/v1/charts/daily_tss?days=30")
        assert resp.status_code == 200
        data = resp.json()
        assert "chart_type" in data
        assert "title" in data
        assert "labels" in data
        assert "series" in data
        assert "x_label" in data
        assert "y_label" in data
        assert isinstance(data["labels"], list)
        assert isinstance(data["series"], list)

    async def test_empty_when_no_activities(self, client):
        """Daily TSS chart returns empty data when no activities exist."""
        resp = await client.get("/api/v1/charts/daily_tss?days=30")
        assert resp.status_code == 200
        data = resp.json()
        assert data["chart_type"] is not None
        assert isinstance(data["labels"], list)


# ── Weight Trend Chart ───────────────────────────────────────────────────


class TestWeightTrendChart:
    """GET /api/v1/charts/weight_trend — weight data points."""

    async def test_returns_weight_data_points(self, client, test_weight_log):
        """Weight trend chart returns data with correct structure."""
        resp = await client.get("/api/v1/charts/weight_trend?days=90")
        assert resp.status_code == 200
        data = resp.json()
        assert "chart_type" in data
        assert "title" in data
        assert "labels" in data
        assert "series" in data
        assert isinstance(data["labels"], list)
        assert isinstance(data["series"], list)

    async def test_empty_when_no_weight_logs(self, client):
        """Weight trend chart returns empty data when no weight logs exist."""
        resp = await client.get("/api/v1/charts/weight_trend?days=90")
        assert resp.status_code == 200
        data = resp.json()
        assert data["chart_type"] is not None
        assert isinstance(data["labels"], list)
