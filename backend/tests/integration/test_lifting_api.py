"""Integration tests for the Lifting API.

Tests sessions CRUD, set management, analysis, and AI analysis.
Run with:  pytest tests/integration/test_lifting_api.py -m integration
"""

from __future__ import annotations

import uuid as _uuid

import pytest

pytestmark = pytest.mark.integration


# ── Create session ────────────────────────────────────────────────────────


class TestCreateLiftingSession:
    """POST /api/v1/lifting/sessions — create a new lifting session."""

    async def test_create_session_with_sets(self, client):
        """Creating a session with inline sets returns the full session."""
        resp = await client.post(
            "/api/v1/lifting/sessions",
            json={
                "session_date": "2026-08-20",
                "focus": "bench",
                "duration_seconds": 3000,
                "rpe_session": 8.0,
                "notes": "Heavy day",
                "sets": [
                    {
                        "exercise_name": "Bench Press",
                        "set_number": 1,
                        "weight_kg": 80.0,
                        "reps": 5,
                        "rpe": 7.0,
                    },
                    {
                        "exercise_name": "Bench Press",
                        "set_number": 2,
                        "weight_kg": 85.0,
                        "reps": 5,
                        "rpe": 8.0,
                    },
                ],
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["focus"] == "bench"
        assert data["rpe_session"] == 8.0
        assert len(data["sets"]) == 2
        assert data["sets"][0]["exercise_name"] == "Bench Press"
        assert "id" in data
        assert "created_at" in data

    async def test_create_empty_session(self, client):
        """A session without sets still returns 201."""
        resp = await client.post(
            "/api/v1/lifting/sessions",
            json={"session_date": "2026-08-20", "focus": "squat"},
        )
        assert resp.status_code == 201
        assert resp.json()["sets"] == []


# ── List sessions ─────────────────────────────────────────────────────────


class TestListLiftingSessions:
    """GET /api/v1/lifting/sessions — paginated list."""

    async def test_empty_list(self, client):
        resp = await client.get("/api/v1/lifting/sessions")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 0
        assert resp.headers.get("x-total-count") == "0"

    async def test_returns_created_session(self, client, test_lifting_session):
        """Session created via fixture appears in the list."""
        resp = await client.get("/api/v1/lifting/sessions")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["focus"] == "squat"
        assert len(data[0]["sets"]) == 3


# ── Get session ───────────────────────────────────────────────────────────


class TestGetLiftingSession:
    """GET /api/v1/lifting/sessions/{id} — single session detail."""

    async def test_get_existing_session(self, client, test_lifting_session):
        resp = await client.get(f"/api/v1/lifting/sessions/{test_lifting_session.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == str(test_lifting_session.id)
        assert data["focus"] == "squat"
        assert len(data["sets"]) == 3

    async def test_get_nonexistent_returns_404(self, client):
        resp = await client.get(f"/api/v1/lifting/sessions/{_uuid.uuid4()}")
        assert resp.status_code == 404


# ── Update / Delete ───────────────────────────────────────────────────────


class TestUpdateDeleteSession:
    """PATCH/DELETE /api/v1/lifting/sessions/{id}."""

    async def test_update_session(self, client, test_lifting_session):
        resp = await client.patch(
            f"/api/v1/lifting/sessions/{test_lifting_session.id}",
            json={"notes": "Updated notes", "rpe_session": 9.0},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["notes"] == "Updated notes"
        assert data["rpe_session"] == 9.0

    async def test_delete_session(self, client, test_lifting_session):
        resp = await client.delete(
            f"/api/v1/lifting/sessions/{test_lifting_session.id}"
        )
        assert resp.status_code == 204

        # Verify gone
        resp = await client.get(f"/api/v1/lifting/sessions/{test_lifting_session.id}")
        assert resp.status_code == 404


# ── Sets CRUD ─────────────────────────────────────────────────────────────


class TestSetManagement:
    """POST /api/v1/lifting/sessions/{id}/sets and PATCH/DELETE on sets."""

    async def test_add_set_to_existing_session(self, client, test_lifting_session):
        """Adding a set to an existing session works end-to-end."""
        resp = await client.post(
            f"/api/v1/lifting/sessions/{test_lifting_session.id}/sets",
            json={
                "exercise_name": "Back Squat",
                "set_number": 4,
                "weight_kg": 120.0,
                "reps": 3,
                "rpe": 9.0,
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["exercise_name"] == "Back Squat"
        assert data["set_number"] == 4

    async def test_add_set_to_nonexistent_session(self, client):
        resp = await client.post(
            f"/api/v1/lifting/sessions/{_uuid.uuid4()}/sets",
            json={
                "exercise_name": "Bench Press",
                "set_number": 1,
                "weight_kg": 80.0,
                "reps": 5,
            },
        )
        assert resp.status_code == 404


# ── Session analysis ──────────────────────────────────────────────────────


class TestLiftingAnalysis:
    """GET /api/v1/lifting/sessions/{id}/analysis — static lifting analysis."""

    async def test_analysis_for_session_with_sets(self, client, test_lifting_session):
        """Analysis should return volume breakdown, set progression, etc."""
        resp = await client.get(
            f"/api/v1/lifting/sessions/{test_lifting_session.id}/analysis"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "volume_breakdown" in data
        assert "set_progression" in data
        assert "fatigue_index" in data
        assert "exercise_count" in data
        assert "working_sets_count" in data
        assert data["exercise_count"] >= 1

    async def test_analysis_nonexistent_session(self, client):
        resp = await client.get(f"/api/v1/lifting/sessions/{_uuid.uuid4()}/analysis")
        assert resp.status_code == 404


# ── AI analysis ───────────────────────────────────────────────────────────


class TestLiftingSessionAiAnalysis:
    """GET/POST /api/v1/lifting/sessions/{id}/ai-analysis."""

    async def test_get_ai_analysis_returns_null_when_none(
        self, client, test_lifting_session
    ):
        resp = await client.get(
            f"/api/v1/lifting/sessions/{test_lifting_session.id}/ai-analysis"
        )
        assert resp.status_code == 200
        assert resp.json() is None

    async def test_trigger_ai_analysis_with_mocked_gemini(
        self, client, test_lifting_session
    ):
        """Full AI pipeline runs — only the Gemini HTTP call is mocked."""
        from unittest.mock import AsyncMock, patch

        from app.config import get_settings

        mock_response = AsyncMock()
        mock_response.text = (
            "### Volume & Intensity Assessment\n"
            "Good session with progressive loading.\n\n"
            "### Fatigue Analysis\n"
            "Rep dropoff was minimal across sets."
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
                f"/api/v1/lifting/sessions/{test_lifting_session.id}/ai-analysis"
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["analysis_type"] == "lifting_session"
        assert data["lifting_session_id"] == str(test_lifting_session.id)
        assert "Volume" in data["analysis_text"]
        assert "session_summary" in data["stats_json"]

    async def test_trigger_for_nonexistent_session(self, client):
        resp = await client.post(
            f"/api/v1/lifting/sessions/{_uuid.uuid4()}/ai-analysis"
        )
        assert resp.status_code == 404
