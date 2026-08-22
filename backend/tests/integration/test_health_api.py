"""Integration tests for the Health/Metrics API.

These tests exercise the full pipeline: HTTP → FastAPI router → service → model → database.
No internal functions are mocked.

Run with:  pytest tests/integration/test_health_api.py -m integration
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


# ── Readiness ────────────────────────────────────────────────────────────


class TestReadiness:
    """GET /api/v1/metrics/readiness — readiness indicator."""

    async def test_returns_readiness_indicator(self, client, test_daily_metric):
        """Readiness endpoint returns a readiness level with data."""
        resp = await client.get("/api/v1/metrics/readiness")
        assert resp.status_code == 200
        data = resp.json()
        assert "readiness" in data
        assert "recovery_score" in data
        assert data["readiness"] in ("green", "yellow", "red", "unknown")
        assert data["recovery_score"] is not None

    async def test_returns_no_data_when_no_metrics(self, client):
        """Readiness returns 'unknown' when no metrics exist."""
        resp = await client.get("/api/v1/metrics/readiness")
        assert resp.status_code == 200
        data = resp.json()
        assert data["readiness"] == "unknown"
        assert data["recovery_score"] is None


# ── Sleep Consistency ────────────────────────────────────────────────────


class TestSleepConsistency:
    """GET /api/v1/metrics/sleep-consistency — consistency score."""

    async def test_returns_consistency_score(self, client, test_sleep_log):
        """Sleep consistency returns a score with data."""
        resp = await client.get("/api/v1/metrics/sleep-consistency?days=7")
        assert resp.status_code == 200
        data = resp.json()
        assert "consistency_score" in data
        assert "days_analyzed" in data
        assert "window_days" in data
        assert data["window_days"] == 7

    async def test_returns_zero_when_no_sleep_logs(self, client):
        """Sleep consistency returns 0 when no sleep logs exist."""
        resp = await client.get("/api/v1/metrics/sleep-consistency?days=7")
        assert resp.status_code == 200
        data = resp.json()
        assert data["consistency_score"] == 0


# ── Sleep Debt ───────────────────────────────────────────────────────────


class TestSleepDebt:
    """GET /api/v1/metrics/sleep-debt — sleep debt calculation."""

    async def test_returns_sleep_debt(self, client, test_sleep_log):
        """Sleep debt returns debt hours with data."""
        resp = await client.get("/api/v1/metrics/sleep-debt?days=7")
        assert resp.status_code == 200
        data = resp.json()
        assert "debt_hours" in data
        assert "avg_sleep_hours" in data
        assert "days_below_target" in data
        assert "target_hours" in data

    async def test_returns_zero_debt_when_no_logs(self, client):
        """Sleep debt returns 0 when no sleep logs exist."""
        resp = await client.get("/api/v1/metrics/sleep-debt?days=7")
        assert resp.status_code == 200
        data = resp.json()
        assert data["debt_hours"] == 0.0


# ── Optimal Bedtime ──────────────────────────────────────────────────────


class TestOptimalBedtime:
    """GET /api/v1/metrics/optimal-bedtime — optimal bedtime suggestion."""

    async def test_returns_optimal_bedtime(
        self, client, test_sleep_log, test_daily_metric
    ):
        """Optimal bedtime returns a suggestion."""
        resp = await client.get("/api/v1/metrics/optimal-bedtime")
        assert resp.status_code == 200
        data = resp.json()
        # The response structure depends on the suggest_optimal_bedtime function
        assert isinstance(data, dict)


# ── Respiratory Rate ─────────────────────────────────────────────────────


class TestRespiratoryRate:
    """GET /api/v1/metrics/respiratory-rate — respiratory rate trend."""

    async def test_returns_respiratory_rate_trend(self, client, test_daily_metric):
        """Respiratory rate returns trend data."""
        resp = await client.get("/api/v1/metrics/respiratory-rate")
        assert resp.status_code == 200
        data = resp.json()
        assert "current_rr" in data
        assert "recent_avg_rr" in data
        assert "baseline_avg_rr" in data
        assert "trend" in data
        assert data["trend"] in ("stable", "elevated", "low")

    async def test_returns_none_when_no_data(self, client):
        """Respiratory rate returns None values when no data exists."""
        resp = await client.get("/api/v1/metrics/respiratory-rate")
        assert resp.status_code == 200
        data = resp.json()
        assert data["current_rr"] is None


# ── Weight ───────────────────────────────────────────────────────────────


class TestWeightHistory:
    """GET /api/v1/metrics/weight — weight history."""

    async def test_returns_weight_history(self, client, test_weight_log):
        """Weight endpoint returns entries and rolling average."""
        resp = await client.get("/api/v1/metrics/weight?days=90")
        assert resp.status_code == 200
        data = resp.json()
        assert "entries" in data
        assert "rolling_avg" in data
        assert len(data["entries"]) >= 1
        assert data["entries"][0]["weight_kg"] == 75.5

    async def test_returns_empty_when_no_weight_logs(self, client):
        """Weight endpoint returns empty when no logs exist."""
        resp = await client.get("/api/v1/metrics/weight?days=90")
        assert resp.status_code == 200
        data = resp.json()
        assert data["entries"] == []
        assert data["rolling_avg"] == []


# ── Health Alerts ────────────────────────────────────────────────────────


class TestHealthAlerts:
    """GET /api/v1/metrics/health-alerts — active alerts."""

    async def test_returns_active_alerts(self, client, test_health_alert):
        """Health alerts endpoint returns active alerts."""
        resp = await client.get("/api/v1/metrics/health-alerts")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        assert data[0]["alert_type"] == "overtraining"
        assert data[0]["status"] == "active"

    async def test_returns_empty_when_no_alerts(self, client):
        """Health alerts returns empty list when no alerts exist."""
        resp = await client.get("/api/v1/metrics/health-alerts")
        assert resp.status_code == 200
        data = resp.json()
        assert data == []

    async def test_dismiss_alert(self, client, test_health_alert):
        """PATCH health-alerts/{id}/dismiss marks alert as dismissed."""
        resp = await client.patch(
            f"/api/v1/metrics/health-alerts/{test_health_alert.id}/dismiss",
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "dismissed"


# ── Health Analysis ──────────────────────────────────────────────────────


class TestHealthAnalysis:
    """POST /api/v1/metrics/health-alerts/analyze — runs health analysis pipeline."""

    async def test_runs_health_analysis_pipeline(self, client, test_daily_metric):
        """Health analysis runs and returns results."""
        resp = await client.post("/api/v1/metrics/health-alerts/analyze")
        assert resp.status_code == 200
        data = resp.json()
        assert "analysis_results" in data
        assert "alerts_generated" in data
        assert isinstance(data["analysis_results"], list)
        # Should have 3 analysis types
        types = {r["type"] for r in data["analysis_results"]}
        assert "overtraining" in types
        assert "injury_risk" in types
        assert "illness_risk" in types


# ── Health AI Analysis ───────────────────────────────────────────────────


class TestHealthAiAnalysis:
    """GET/POST /api/v1/metrics/health-ai-analysis — health AI analysis."""

    async def test_returns_null_when_none_exists(self, client):
        """GET health-ai-analysis returns null when no analysis exists."""
        resp = await client.get("/api/v1/metrics/health-ai-analysis")
        assert resp.status_code == 200
        assert resp.json() is None

    async def test_triggers_health_ai_analysis(
        self, client, test_daily_metric, monkeypatch
    ):
        """POST health-ai-analysis triggers analysis (mocked Gemini)."""
        import uuid
        from unittest.mock import AsyncMock, patch

        from app.models.llm_analysis import LlmAnalysis

        mock_analysis = LlmAnalysis(
            id=uuid.uuid4(),
            user_id=test_daily_metric.user_id,
            analysis_type="health",
            analysis_date=date.today(),
            stats_json={},
            analysis_text="Test health analysis",
            model_used="gemini-2.0-flash",
            created_at=datetime.now(UTC),
        )

        with patch(
            "app.services.llm_analysis.run_health_ai_analysis",
            new_callable=AsyncMock,
            return_value=mock_analysis,
        ):
            resp = await client.post("/api/v1/metrics/health-ai-analysis")
            assert resp.status_code == 200
            data = resp.json()
            assert data["analysis_type"] == "health"
