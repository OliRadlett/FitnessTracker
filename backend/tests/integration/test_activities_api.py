"""Integration tests for the Activities API.

Tests the full HTTP → router → service → model pipeline.
Run with:  pytest tests/integration/test_activities_api.py -m integration
"""

from __future__ import annotations

import uuid as _uuid

import pytest

pytestmark = pytest.mark.integration


# ── List ──────────────────────────────────────────────────────────────────


class TestListActivities:
    """GET /api/v1/activities — paginated activity list."""

    async def test_empty_list(self, client):
        """Returns an empty list with X-Total-Count header when no activities exist."""
        resp = await client.get("/api/v1/activities")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 0
        assert resp.headers.get("x-total-count") == "0"

    async def test_returns_created_activity(self, client, test_activity):
        """An activity inserted via fixture shows up in the list."""
        resp = await client.get("/api/v1/activities")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "Morning Ride"
        assert data[0]["sport_type"] == "cycling"
        assert resp.headers.get("x-total-count") == "1"

    async def test_filter_by_sport_type(self, client, test_activity):
        """Filtering by sport_type returns matching activities."""
        resp = await client.get("/api/v1/activities", params={"sport_type": "cycling"})
        assert resp.status_code == 200
        assert len(resp.json()) == 1

        resp = await client.get("/api/v1/activities", params={"sport_type": "running"})
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    async def test_filter_by_source(self, client, test_activity):
        """Filtering by source works correctly."""
        resp = await client.get("/api/v1/activities", params={"source": "strava"})
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    async def test_pagination_limit_and_offset(self, client, test_activity):
        """Limit and offset query params control the response."""
        resp = await client.get("/api/v1/activities", params={"limit": 1, "offset": 0})
        assert resp.status_code == 200
        assert len(resp.json()) == 1

        resp = await client.get("/api/v1/activities", params={"limit": 1, "offset": 1})
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    async def test_filter_by_q_name_search(self, client, test_activity):
        """Filtering by q searches activity name case-insensitively."""
        resp = await client.get("/api/v1/activities", params={"q": "morning"})
        assert resp.status_code == 200
        assert len(resp.json()) == 1
        assert resp.json()[0]["name"] == "Morning Ride"

        resp = await client.get("/api/v1/activities", params={"q": "nonexistent"})
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    async def test_filter_by_distance_range(self, client, test_activity):
        """Filtering by min_distance/max_distance returns matching activities."""
        # Activity has distance_meters=50_000
        resp = await client.get(
            "/api/v1/activities", params={"min_distance": 40000, "max_distance": 60000}
        )
        assert resp.status_code == 200
        assert len(resp.json()) == 1

        resp = await client.get("/api/v1/activities", params={"min_distance": 60000})
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    async def test_filter_by_duration_range(self, client, test_activity):
        """Filtering by min_duration/max_duration returns matching activities."""
        # Activity has duration_seconds=3600
        resp = await client.get(
            "/api/v1/activities", params={"min_duration": 3000, "max_duration": 4000}
        )
        assert resp.status_code == 200
        assert len(resp.json()) == 1

        resp = await client.get("/api/v1/activities", params={"min_duration": 5000})
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    async def test_filter_by_tss_range(self, client, test_activity):
        """Filtering by min_tss/max_tss returns matching activities."""
        # Activity has tss=80
        resp = await client.get(
            "/api/v1/activities", params={"min_tss": 70, "max_tss": 90}
        )
        assert resp.status_code == 200
        assert len(resp.json()) == 1

        resp = await client.get("/api/v1/activities", params={"min_tss": 100})
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    async def test_sort_by_distance_desc(self, client, test_multiple_activities):
        """Sorting by distance descending returns activities in correct order."""
        resp = await client.get(
            "/api/v1/activities", params={"sort_by": "distance", "sort_order": "desc"}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 5
        distances = [a["distance_meters"] for a in data]
        assert distances == sorted(distances, reverse=True)

    async def test_sort_by_tss_asc(self, client, test_multiple_activities):
        """Sorting by tss ascending returns activities in correct order."""
        resp = await client.get(
            "/api/v1/activities", params={"sort_by": "tss", "sort_order": "asc"}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 5
        tss_values = [a["tss"] for a in data]
        assert tss_values == sorted(tss_values)

    async def test_sort_by_invalid_returns_422(self, client):
        """Invalid sort_by value returns 422."""
        resp = await client.get(
            "/api/v1/activities", params={"sort_by": "invalid_field"}
        )
        assert resp.status_code == 422
        assert "Invalid sort_by" in resp.json()["detail"]

    async def test_min_distance_greater_than_max_returns_422(self, client):
        """min_distance > max_distance returns 422."""
        resp = await client.get(
            "/api/v1/activities",
            params={"min_distance": 100, "max_distance": 50},
        )
        assert resp.status_code == 422
        assert "min_distance" in resp.json()["detail"]

    async def test_min_duration_greater_than_max_returns_422(self, client):
        """min_duration > max_duration returns 422."""
        resp = await client.get(
            "/api/v1/activities",
            params={"min_duration": 100, "max_duration": 50},
        )
        assert resp.status_code == 422
        assert "min_duration" in resp.json()["detail"]

    async def test_min_tss_greater_than_max_returns_422(self, client):
        """min_tss > max_tss returns 422."""
        resp = await client.get(
            "/api/v1/activities",
            params={"min_tss": 100, "max_tss": 50},
        )
        assert resp.status_code == 422
        assert "min_tss" in resp.json()["detail"]


# ── Detail ────────────────────────────────────────────────────────────────


class TestGetActivity:
    """GET /api/v1/activities/{id} — single activity detail."""

    async def test_get_existing_activity(self, client, test_activity):
        """Returns the full activity record with enriched fields."""
        resp = await client.get(f"/api/v1/activities/{test_activity.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == str(test_activity.id)
        assert data["name"] == "Morning Ride"
        assert data["average_power"] == 200.0
        assert data["sources"] == []

    async def test_get_nonexistent_returns_404(self, client):
        resp = await client.get(f"/api/v1/activities/{_uuid.uuid4()}")
        assert resp.status_code == 404


# ── Streams ───────────────────────────────────────────────────────────────


class TestActivityStreams:
    """GET /api/v1/activities/{id}/streams — stream data for an activity."""

    async def test_returns_streams(self, client, test_activity):
        resp = await client.get(f"/api/v1/activities/{test_activity.id}/streams")
        assert resp.status_code == 200
        streams = resp.json()
        assert len(streams) == 1
        assert streams[0]["stream_type"] == "watts"
        assert len(streams[0]["data"]["data"]) == 360

    async def test_streams_for_nonexistent_activity(self, client):
        resp = await client.get(f"/api/v1/activities/{_uuid.uuid4()}/streams")
        assert resp.status_code == 404


# ── Analysis (static) ─────────────────────────────────────────────────────


class TestActivityAnalysis:
    """GET /api/v1/activities/{id}/analysis — static ride analysis."""

    async def test_analysis_for_activity_with_power_stream(
        self, client, test_activity, test_cycling_profile
    ):
        """Analysis should return power zones, pacing, and TSS breakdown."""
        resp = await client.get(f"/api/v1/activities/{test_activity.id}/analysis")
        assert resp.status_code == 200
        data = resp.json()
        # The response should include at least these keys
        assert "power_zones" in data
        assert "pacing_analysis" in data
        assert "tss_breakdown" in data
        assert "fatigue_index" in data or "variability_index" in data

    async def test_analysis_nonexistent_activity(self, client):
        resp = await client.get(f"/api/v1/activities/{_uuid.uuid4()}/analysis")
        assert resp.status_code == 404


# ── AI analysis ───────────────────────────────────────────────────────────


class TestActivityAiAnalysis:
    """GET/POST /api/v1/activities/{id}/ai-analysis — per-activity Gemini analysis."""

    async def test_get_ai_analysis_returns_null_when_none_exists(
        self, client, test_activity
    ):
        """Returns null/None when no AI analysis has been generated yet."""
        resp = await client.get(f"/api/v1/activities/{test_activity.id}/ai-analysis")
        assert resp.status_code == 200
        assert resp.json() is None

    async def test_trigger_ai_analysis_with_mocked_gemini(
        self, client, test_activity, test_cycling_profile
    ):
        """Triggering AI analysis creates and returns an LlmAnalysis record.

        Only the external Gemini HTTP call is mocked — the full internal
        pipeline (compile_activity_context → store → retrieve) runs for real.
        """
        from unittest.mock import AsyncMock, patch

        from app.config import get_settings

        mock_response = AsyncMock()
        mock_response.text = (
            "### Pacing Analysis\n"
            "Good pacing strategy with consistent power output.\n\n"
            "### Effort Classification\n"
            "Endurance ride at moderate intensity."
        )

        settings = get_settings()
        with (
            patch.object(settings, "gemini_api_key", "fake-test-key"),
            patch("google.genai.Client") as mock_client_cls,
        ):
            mock_client = AsyncMock()
            mock_client.aio.models.generate_content.return_value = mock_response
            mock_client_cls.return_value = mock_client

            resp = await client.post(
                f"/api/v1/activities/{test_activity.id}/ai-analysis"
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["analysis_type"] == "activity"
        assert data["activity_id"] == str(test_activity.id)
        assert "Pacing Analysis" in data["analysis_text"]
        assert "stats_json" in data
        # The stats_json should contain the real compiled context
        assert "activity_summary" in data["stats_json"]

    async def test_get_ai_analysis_after_trigger(
        self, client, test_activity, test_cycling_profile
    ):
        """After triggering analysis, GET returns the stored result."""
        from unittest.mock import AsyncMock, patch

        from app.config import get_settings

        mock_response = AsyncMock()
        mock_response.text = "Test analysis response."

        settings = get_settings()
        with (
            patch.object(settings, "gemini_api_key", "fake-test-key"),
            patch("google.genai.Client") as mock_client_cls,
        ):
            mock_client = AsyncMock()
            mock_client.aio.models.generate_content.return_value = mock_response
            mock_client_cls.return_value = mock_client

            await client.post(f"/api/v1/activities/{test_activity.id}/ai-analysis")

        # Now GET should return the stored analysis
        resp = await client.get(f"/api/v1/activities/{test_activity.id}/ai-analysis")
        assert resp.status_code == 200
        data = resp.json()
        assert data is not None
        assert data["analysis_text"] == "Test analysis response."

    async def test_trigger_for_nonexistent_activity(self, client):
        resp = await client.post(f"/api/v1/activities/{_uuid.uuid4()}/ai-analysis")
        assert resp.status_code == 404
