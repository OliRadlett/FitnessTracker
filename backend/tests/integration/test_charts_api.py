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


# ── Param Validation ─────────────────────────────────────────────────────


class TestChartParamValidation:
    """Required registry params must return 422, not 500."""

    async def test_missing_exercise_name_returns_422(self, client):
        resp = await client.get("/api/v1/charts/estimated_1rm_history")
        assert resp.status_code == 422

    async def test_missing_exercise_name_progress_returns_422(self, client):
        resp = await client.get("/api/v1/charts/exercise_progress")
        assert resp.status_code == 422

    async def test_unknown_chart_returns_404(self, client):
        resp = await client.get("/api/v1/charts/nonexistent_chart")
        assert resp.status_code == 404


# ── New Intelligence Charts ──────────────────────────────────────────────


class TestNewCharts:
    """Ramp rate, W/kg curve, percentile profile, heatmap, sleep, strength."""

    async def test_ramp_rate(self, client, test_multiple_activities):
        resp = await client.get("/api/v1/charts/ramp_rate?weeks=16")
        assert resp.status_code == 200
        data = resp.json()
        assert data["chart_type"] == "bar"
        assert isinstance(data["reference_areas"], list)

    async def test_wkg_power_curve(self, client, test_multiple_activities):
        resp = await client.get("/api/v1/charts/wkg_power_curve?days=90")
        assert resp.status_code == 200
        data = resp.json()
        assert data["chart_type"] == "line"

    async def test_power_duration_percentile(self, client, test_multiple_activities):
        resp = await client.get("/api/v1/charts/power_duration_percentile?days=90")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["series"]) >= 3  # percentile curves

    async def test_consistency_heatmap(self, client, test_multiple_activities):
        resp = await client.get("/api/v1/charts/consistency_heatmap?days=60")
        assert resp.status_code == 200
        data = resp.json()
        assert data["chart_type"] == "heatmap"

    async def test_sleep_consistency(self, client):
        resp = await client.get("/api/v1/charts/sleep_consistency?days=30")
        assert resp.status_code == 200

    async def test_strength_balance(self, client):
        resp = await client.get("/api/v1/charts/strength_balance")
        assert resp.status_code == 200

    async def test_training_load_balance(self, client, test_multiple_activities):
        resp = await client.get("/api/v1/charts/training_load_balance?weeks=16")
        assert resp.status_code == 200
