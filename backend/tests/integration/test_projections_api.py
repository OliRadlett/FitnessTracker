"""Integration tests for the Projections API (Phase 7).

These tests exercise the full pipeline: HTTP → FastAPI router → service → model → database.
No internal functions are mocked.  The only dependency overridden is ``get_current_user``
(injected via the ``client`` fixture from conftest).

Run with:  pytest tests/integration/test_projections_api.py -m integration
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest

pytestmark = pytest.mark.integration


# ── Goal projection endpoint ─────────────────────────────────────────────────


class TestGoalProjectionEndpoint:
    """GET /api/v1/projections/goal/{goal_id}."""

    async def test_returns_projection_for_goal_with_checkins(self, client):
        # Create a goal
        create = await client.post(
            "/api/v1/goals",
            json={
                "metric": "body_weight",
                "target_value": 75.0,
                "target_date": (date.today() + timedelta(days=60)).isoformat(),
            },
        )
        assert create.status_code == 201
        goal_id = create.json()["id"]

        # Add 5 check-ins (enough for regression)
        for i in range(5):
            resp = await client.post(
                f"/api/v1/goals/{goal_id}/checkins",
                json={"value": 80.0 - i * 0.5},
            )
            assert resp.status_code == 201

        # Get projection
        resp = await client.get(f"/api/v1/projections/goal/{goal_id}")
        assert resp.status_code == 200
        data = resp.json()

        assert data["goal_id"] == goal_id
        assert data["metric"] == "body_weight"
        assert data["target_value"] == 75.0
        assert data["direction"] == "decrease"
        assert data["badge"] in ("On Track", "At Risk", "Unlikely", "Not enough data")
        assert len(data["history"]) == 5
        assert isinstance(data["projection_line"], list)

    async def test_returns_404_for_unknown_goal(self, client):
        resp = await client.get(f"/api/v1/projections/goal/{uuid.uuid4()}")
        assert resp.status_code == 404

    async def test_returns_badge_not_enough_data_for_few_checkins(self, client):
        create = await client.post(
            "/api/v1/goals",
            json={"metric": "ftp_watts", "target_value": 300.0},
        )
        goal_id = create.json()["id"]

        # Only 1 check-in
        await client.post(f"/api/v1/goals/{goal_id}/checkins", json={"value": 255.0})

        resp = await client.get(f"/api/v1/projections/goal/{goal_id}")
        assert resp.status_code == 200
        assert resp.json()["badge"] == "Not enough data"


# ── Metric trend endpoint ────────────────────────────────────────────────────


class TestMetricTrendEndpoint:
    """GET /api/v1/projections/metric/{metric_key}."""

    async def test_returns_trend_for_ftp(self, client, test_ftp_history):
        resp = await client.get("/api/v1/projections/metric/ftp_watts?months=6")
        assert resp.status_code == 200
        data = resp.json()
        assert data["metric"] == "ftp_watts"
        assert "current_value" in data
        assert "trend" in data

    async def test_returns_400_for_unknown_metric(self, client):
        resp = await client.get("/api/v1/projections/metric/bogus_metric")
        assert resp.status_code == 400
        assert "Unknown metric" in resp.json()["detail"]

    async def test_returns_trend_for_body_weight(self, client, test_weight_log):
        resp = await client.get("/api/v1/projections/metric/body_weight?months=6")
        assert resp.status_code == 200
        data = resp.json()
        assert data["metric"] == "body_weight"


# ── TSB projection endpoint ──────────────────────────────────────────────────


class TestTsbProjectionEndpoint:
    """GET /api/v1/projections/tsb/{plan_id}."""

    async def test_returns_400_for_non_event_plan(self, client, test_training_plan):
        plan_id = test_training_plan.id
        resp = await client.get(f"/api/v1/projections/tsb/{plan_id}")
        assert resp.status_code == 400
        assert "not linked to an event" in resp.json()["detail"]

    async def test_returns_404_for_unknown_plan(self, client):
        resp = await client.get(f"/api/v1/projections/tsb/{uuid.uuid4()}")
        assert resp.status_code == 404

    async def test_returns_projection_for_event_linked_plan(
        self, client, db_session, test_user, test_training_plan, test_event
    ):
        """Link plan to event, then get TSB projection."""
        # Link plan to event
        test_training_plan.event_id = test_event.id
        await db_session.flush()

        resp = await client.get(
            f"/api/v1/projections/tsb/{test_training_plan.id}?days=7"
        )
        assert resp.status_code == 200
        data = resp.json()

        assert data["plan_id"] == str(test_training_plan.id)
        assert data["event_date"] is not None
        assert "current_tsb" in data
        assert "race_day_tsb" in data
        assert "freshness_assessment" in data
        assert isinstance(data["projection"], list)
        # Should have 8 entries (today + 7 days)
        assert len(data["projection"]) == 8
