"""Integration tests for the Export API (CSV, GPX, PDF).

These tests exercise the full pipeline: HTTP → FastAPI router → service → model → database.
No internal functions are mocked.

Run with:  pytest tests/integration/test_export_api.py -m integration
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


# ── CSV Exports ──────────────────────────────────────────────────────────


class TestLiftingCsvExport:
    """GET /api/v1/export/lifting/csv — exports lifting data as CSV."""

    async def test_export_lifting_csv(self, client, test_lifting_session):
        """Lifting CSV export returns valid CSV content."""
        resp = await client.get("/api/v1/export/lifting/csv")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "text/csv; charset=utf-8"
        assert "fittrack_lifting.csv" in resp.headers.get("content-disposition", "")
        content = resp.text
        assert "session_date" in content
        assert "Back Squat" in content


class TestActivitiesCsvExport:
    """GET /api/v1/export/activities/csv — exports activities as CSV."""

    async def test_export_activities_csv(self, client, test_activity):
        """Activities CSV export returns valid CSV content."""
        resp = await client.get("/api/v1/export/activities/csv")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "text/csv; charset=utf-8"
        assert "fittrack_activities.csv" in resp.headers.get("content-disposition", "")
        content = resp.text
        assert "date" in content
        assert "Morning Ride" in content


class TestPrsCsvExport:
    """GET /api/v1/export/prs/csv — exports PRs as CSV."""

    async def test_export_prs_csv(self, client, test_personal_record):
        """PRs CSV export returns valid CSV content."""
        resp = await client.get("/api/v1/export/prs/csv")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "text/csv; charset=utf-8"
        content = resp.text
        assert "exercise_name" in content
        assert "Back Squat" in content


# ── PDF Reports ──────────────────────────────────────────────────────────


class TestWeeklyReportPdf:
    """GET /api/v1/export/weekly-report/{week_start} — generates PDF."""

    async def test_generates_weekly_pdf(
        self, client, test_activity, test_lifting_session
    ):
        """Weekly report generates a PDF."""
        week_start = date.today() - timedelta(days=date.today().weekday())
        resp = await client.get(
            f"/api/v1/export/weekly-report/{week_start.isoformat()}"
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/pdf"
        # PDF should start with %PDF
        assert resp.content[:4] == b"%PDF"


class TestMonthlyReportPdf:
    """GET /api/v1/export/monthly-report/{month} — generates PDF."""

    async def test_generates_monthly_pdf(
        self, client, test_activity, test_lifting_session
    ):
        """Monthly report generates a PDF."""
        month = date.today().strftime("%Y-%m")
        resp = await client.get(f"/api/v1/export/monthly-report/{month}")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/pdf"
        assert resp.content[:4] == b"%PDF"

    async def test_rejects_invalid_month_format(self, client):
        """Invalid month format returns 400."""
        resp = await client.get("/api/v1/export/monthly-report/invalid")
        assert resp.status_code == 400
        assert "YYYY-MM" in resp.json()["detail"]
