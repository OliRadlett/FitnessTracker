"""Integration tests for the Events API (CRUD + AI analysis).

These tests exercise the full pipeline: HTTP → FastAPI router → service → model → database.
No internal functions are mocked.

Run with:  pytest tests/integration/test_events_api.py -m integration
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


# ── Create ────────────────────────────────────────────────────────────────


class TestCreateEvent:
    """POST /api/v1/events — creates an event."""

    async def test_create_event_returns_201(self, client):
        """A valid POST returns 201 and the serialised event."""
        resp = await client.post(
            "/api/v1/events",
            json={
                "name": "Spring Century",
                "event_date": (date.today() + timedelta(days=60)).isoformat(),
                "event_type": "race",
                "target_tss": 300.0,
                "taper_days": 14,
                "notes": "Target sub-5 hours",
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Spring Century"
        assert data["event_type"] == "race"
        assert data["target_tss"] == 300.0
        assert data["taper_days"] == 14
        assert "id" in data
        assert "days_until" in data
        assert "is_in_taper" in data

    async def test_create_rejects_invalid_event_type(self, client):
        """An unknown event_type returns 400."""
        resp = await client.post(
            "/api/v1/events",
            json={
                "name": "Bad Event",
                "event_date": (date.today() + timedelta(days=30)).isoformat(),
                "event_type": "invalid_type",
            },
        )
        assert resp.status_code == 400
        assert "Invalid event_type" in resp.json()["detail"]


# ── List ──────────────────────────────────────────────────────────────────


class TestListEvents:
    """GET /api/v1/events — lists events."""

    async def test_list_events(self, client, test_event):
        """List returns all events for the user."""
        resp = await client.get("/api/v1/events")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        assert data[0]["name"] == "Summer Century Ride"

    async def test_list_upcoming_only(self, client, test_event):
        """List with upcoming_only=true filters past events."""
        resp = await client.get("/api/v1/events?upcoming_only=true")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        # test_event is 30 days in the future, so should be included
        assert len(data) >= 1


# ── Get Single ────────────────────────────────────────────────────────────


class TestGetEvent:
    """GET /api/v1/events/{id} — gets single event."""

    async def test_get_event(self, client, test_event):
        """Get returns the event with countdown info."""
        resp = await client.get(f"/api/v1/events/{test_event.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == str(test_event.id)
        assert data["name"] == "Summer Century Ride"
        assert data["days_until"] >= 0
        assert "taper_start_date" in data

    async def test_get_nonexistent_event(self, client):
        """Get returns 404 for nonexistent event."""
        import uuid

        resp = await client.get(f"/api/v1/events/{uuid.uuid4()}")
        assert resp.status_code == 404


# ── Update ────────────────────────────────────────────────────────────────


class TestUpdateEvent:
    """PUT /api/v1/events/{id} — updates event."""

    async def test_update_event(self, client, test_event):
        """PATCH updates the event fields."""
        resp = await client.patch(
            f"/api/v1/events/{test_event.id}",
            json={"name": "Updated Century", "taper_days": 21},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Updated Century"
        assert data["taper_days"] == 21


# ── Delete ────────────────────────────────────────────────────────────────


class TestDeleteEvent:
    """DELETE /api/v1/events/{id} — deletes event."""

    async def test_delete_event(self, client, test_event):
        """DELETE removes the event."""
        resp = await client.delete(f"/api/v1/events/{test_event.id}")
        assert resp.status_code == 204

        # Verify it's gone
        resp = await client.get(f"/api/v1/events/{test_event.id}")
        assert resp.status_code == 404


# ── Event AI Analysis ─────────────────────────────────────────────────────


class TestEventAiAnalysis:
    """GET/POST /api/v1/events/{id}/ai-analysis — event AI analysis."""

    async def test_returns_null_when_none_exists(self, client, test_event):
        """GET returns null when no analysis exists."""
        resp = await client.get(f"/api/v1/events/{test_event.id}/ai-analysis")
        assert resp.status_code == 200
        assert resp.json() is None

    async def test_triggers_event_ai_analysis(
        self, client, test_event, test_user, monkeypatch
    ):
        """POST triggers event AI analysis (mocked Gemini)."""
        import uuid
        from datetime import UTC, date, datetime
        from unittest.mock import AsyncMock, patch

        from app.models.llm_analysis import LlmAnalysis

        mock_analysis = LlmAnalysis(
            id=uuid.uuid4(),
            user_id=test_user.id,
            analysis_type="event",
            event_id=test_event.id,
            analysis_date=date.today(),
            stats_json={},
            analysis_text="Test event analysis",
            model_used="gemini-2.0-flash",
            created_at=datetime.now(UTC),
        )

        with patch(
            "app.services.llm_analysis.run_event_ai_analysis",
            new_callable=AsyncMock,
            return_value=mock_analysis,
        ):
            resp = await client.post(f"/api/v1/events/{test_event.id}/ai-analysis")
            assert resp.status_code == 200
            data = resp.json()
            assert data["analysis_type"] == "event"
