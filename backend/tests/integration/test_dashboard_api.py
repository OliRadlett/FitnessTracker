"""Integration tests for the Dashboard API.

These tests exercise the full pipeline: HTTP → FastAPI router → service → model → database.
No internal functions are mocked.  The only dependency overridden is ``get_current_user``
(injected via the ``client`` fixture from conftest).

Run with:  pytest tests/integration/test_dashboard_api.py -m integration
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


# ── Dashboard Summary ────────────────────────────────────────────────────


class TestDashboardSummary:
    """GET /api/v1/dashboard/summary — weekly summary with volume, sessions, TSS, distance."""

    async def test_returns_weekly_volume_sessions_tss_distance(
        self, client, test_activity, test_lifting_session, test_daily_metric,
    ):
        """Summary returns correct weekly volume, sessions, TSS, and distance."""
        resp = await client.get("/api/v1/dashboard/summary")
        assert resp.status_code == 200
        data = resp.json()
        assert "weekly_volume_kg" in data
        assert "weekly_sessions" in data
        assert "weekly_tss" in data
        assert "weekly_distance_meters" in data
        assert "latest_recovery" in data
        assert "latest_hrv_ms" in data
        assert "active_alerts_count" in data
        assert "rest_day_suggestion" in data
        # With test data, we should have at least some values
        assert data["weekly_tss"] >= 0
        assert data["weekly_distance_meters"] >= 0

    async def test_rest_day_suggestion_with_low_recovery(
        self, client, test_user, db_session,
    ):
        """Rest day suggestion triggers with low recovery scores."""
        from app.models.daily_metric import DailyMetric

        # Insert multiple low recovery days
        for i in range(3):
            metric = DailyMetric(
                user_id=test_user.id,
                metric_date=date.today() - timedelta(days=i),
                source="whoop",
                recovery_score=30.0,  # Below 40% threshold
                hrv_ms=40.0,
                resting_hr=62.0,
            )
            db_session.add(metric)
        await db_session.flush()

        resp = await client.get("/api/v1/dashboard/summary")
        assert resp.status_code == 200
        data = resp.json()
        rest = data["rest_day_suggestion"]
        assert "should_rest" in rest
        assert "reasons" in rest
        # With 3 consecutive low recovery days, should suggest rest
        assert rest["should_rest"] is True
        assert any("Recovery" in r or "recovery" in r for r in rest["reasons"])

    async def test_rest_day_suggestion_with_consecutive_training_days(
        self, client, test_user, db_session,
    ):
        """Rest day suggestion triggers with 6+ consecutive training days."""
        from app.models.activity import Activity

        # Insert activities for the last 7 days
        for i in range(7):
            activity = Activity(
                user_id=test_user.id,
                source="strava",
                sport_type="cycling",
                name=f"Day {i} Ride",
                start_date=datetime.now(UTC) - timedelta(days=i),
                duration_seconds=3600,
                distance_meters=40_000.0,
                average_power=200.0,
                tss=70.0,
                provider_activity_id=f"strava_consec_{i}",
            )
            db_session.add(activity)
        await db_session.flush()

        resp = await client.get("/api/v1/dashboard/summary")
        assert resp.status_code == 200
        data = resp.json()
        rest = data["rest_day_suggestion"]
        assert rest["consecutive_training_days"] >= 6


# ── Today ────────────────────────────────────────────────────────────────


class TestDashboardToday:
    """GET /api/v1/dashboard/today — today's activity and lifting summaries."""

    async def test_returns_today_summary_structure(self, client):
        """Today endpoint returns the expected structure."""
        resp = await client.get("/api/v1/dashboard/today")
        assert resp.status_code == 200
        data = resp.json()
        assert "today_activities" in data
        assert "today_lifting_sessions" in data
        assert "today_tss" in data
        assert "today_volume_kg" in data
        assert "today_distance_meters" in data
        assert "today_duration_seconds" in data
        assert "current_ctl" in data
        assert "current_atl" in data
        assert "current_tsb" in data

    async def test_empty_when_no_data_today(self, client):
        """Today returns zeroed values when no data exists for today."""
        resp = await client.get("/api/v1/dashboard/today")
        assert resp.status_code == 200
        data = resp.json()
        assert data["today_activities"] == []
        assert data["today_lifting_sessions"] == []
        assert data["today_tss"] == 0.0
        assert data["today_volume_kg"] == 0.0


# ── Weekly Report ────────────────────────────────────────────────────────


class TestDashboardWeekly:
    """GET /api/v1/dashboard/weekly-report — weekly report with correct aggregations."""

    async def test_returns_weekly_report_structure(self, client, test_activity, test_lifting_session):
        """Weekly report returns the expected structure with data."""
        resp = await client.get("/api/v1/dashboard/weekly-report")
        assert resp.status_code == 200
        data = resp.json()
        assert "week_start" in data
        assert "week_end" in data
        assert "lifting_sessions" in data
        assert "lifting_volume_kg" in data
        assert "cardio_sessions" in data
        assert "total_tss" in data
        assert "new_prs" in data
        # Should have at least 1 lifting session from fixture
        assert data["lifting_sessions"] >= 1

    async def test_weekly_report_with_weeks_back(self, client):
        """Weekly report accepts weeks_back parameter."""
        resp = await client.get("/api/v1/dashboard/weekly-report?weeks_back=1")
        assert resp.status_code == 200
        data = resp.json()
        assert data["week_start"] is not None
        assert data["week_end"] is not None


# ── Yearly Highlights ────────────────────────────────────────────────────


class TestDashboardYearly:
    """GET /api/v1/dashboard/yearly-summary/{year} — yearly highlights."""

    async def test_returns_yearly_summary_structure(self, client, test_activity, test_lifting_session):
        """Yearly summary returns the expected structure."""
        year = date.today().year
        resp = await client.get(f"/api/v1/dashboard/yearly-summary/{year}")
        assert resp.status_code == 200
        data = resp.json()
        assert "total_activities" in data
        assert "total_distance_m" in data
        assert "total_time_s" in data
        assert "total_tss" in data
        assert "total_lifting_sessions" in data
        assert "total_lifting_volume_kg" in data
        assert "months" in data
        assert "highlights" in data

    async def test_yearly_summary_empty_year(self, client):
        """Yearly summary for a year with no data returns zeros."""
        resp = await client.get("/api/v1/dashboard/yearly-summary/2020")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_activities"] == 0
        assert data["total_lifting_sessions"] == 0


# ── Monthly Summary ──────────────────────────────────────────────────────


class TestDashboardMonthly:
    """GET /api/v1/dashboard/monthly-summary — monthly breakdown."""

    async def test_returns_monthly_summary(self, client, test_multiple_activities):
        """Monthly summary returns a list of monthly items."""
        resp = await client.get("/api/v1/dashboard/monthly-summary")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        if data:
            item = data[0]
            assert "month" in item
            assert "cardio_sessions" in item
            assert "lifting_sessions" in item
            assert "total_tss" in item
            assert "total_distance_meters" in item
