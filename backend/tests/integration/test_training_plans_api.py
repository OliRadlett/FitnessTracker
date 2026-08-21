"""Integration tests for the Training Plans API (CRUD + generation).

These tests exercise the full pipeline: HTTP → FastAPI router → service → model → database.
No internal functions are mocked.

Run with:  pytest tests/integration/test_training_plans_api.py -m integration
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


# ── Create ────────────────────────────────────────────────────────────────


class TestCreateTrainingPlan:
    """POST /api/v1/training-plans — creates a training plan."""

    async def test_create_plan_returns_201(self, client):
        """A valid POST returns 201 and the serialised plan with days."""
        resp = await client.post(
            "/api/v1/training-plans",
            json={
                "name": "Base Phase",
                "description": "Building aerobic base",
                "start_date": date.today().isoformat(),
                "end_date": (date.today() + timedelta(weeks=4)).isoformat(),
                "plan_type": "base",
                "status": "draft",
                "days": [
                    {
                        "day_date": date.today().isoformat(),
                        "planned_tss": 100.0,
                        "planned_duration_min": 60,
                        "planned_type": "moderate",
                    },
                    {
                        "day_date": (date.today() + timedelta(days=1)).isoformat(),
                        "planned_tss": 0,
                        "planned_duration_min": 0,
                        "planned_type": "rest",
                    },
                ],
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Base Phase"
        assert data["plan_type"] == "base"
        assert len(data["days"]) == 2
        assert "id" in data

    async def test_create_rejects_invalid_plan_type(self, client):
        """An unknown plan_type returns 400."""
        resp = await client.post(
            "/api/v1/training-plans",
            json={
                "name": "Bad Plan",
                "start_date": date.today().isoformat(),
                "end_date": (date.today() + timedelta(weeks=1)).isoformat(),
                "plan_type": "invalid_type",
            },
        )
        assert resp.status_code == 400
        assert "Invalid plan_type" in resp.json()["detail"]

    async def test_create_rejects_end_before_start(self, client):
        """end_date before start_date returns 400."""
        resp = await client.post(
            "/api/v1/training-plans",
            json={
                "name": "Bad Dates",
                "start_date": date.today().isoformat(),
                "end_date": (date.today() - timedelta(days=1)).isoformat(),
                "plan_type": "build",
            },
        )
        assert resp.status_code == 400


# ── List ──────────────────────────────────────────────────────────────────


class TestListTrainingPlans:
    """GET /api/v1/training-plans — lists plans."""

    async def test_list_plans(self, client, test_training_plan):
        """List returns all plans for the user."""
        resp = await client.get("/api/v1/training-plans")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        assert data[0]["name"] == "4-Week Build"
        assert data[0]["day_count"] >= 1

    async def test_list_plans_with_status_filter(self, client, test_training_plan):
        """List with status_filter returns only matching plans."""
        resp = await client.get("/api/v1/training-plans?status_filter=active")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert all(p["status"] == "active" for p in data)


# ── Get Single ────────────────────────────────────────────────────────────


class TestGetTrainingPlan:
    """GET /api/v1/training-plans/{id} — gets single plan."""

    async def test_get_plan(self, client, test_training_plan):
        """Get returns the plan with all days."""
        resp = await client.get(f"/api/v1/training-plans/{test_training_plan.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == str(test_training_plan.id)
        assert data["name"] == "4-Week Build"
        assert len(data["days"]) >= 1

    async def test_get_nonexistent_plan(self, client):
        """Get returns 404 for nonexistent plan."""
        import uuid
        resp = await client.get(f"/api/v1/training-plans/{uuid.uuid4()}")
        assert resp.status_code == 404


# ── Update ────────────────────────────────────────────────────────────────


class TestUpdateTrainingPlan:
    """PUT /api/v1/training-plans/{id} — updates plan."""

    async def test_update_plan(self, client, test_training_plan):
        """PATCH updates the plan fields."""
        resp = await client.patch(
            f"/api/v1/training-plans/{test_training_plan.id}",
            json={"name": "Updated Plan", "status": "active"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Updated Plan"
        assert data["status"] == "active"


# ── Delete ────────────────────────────────────────────────────────────────


class TestDeleteTrainingPlan:
    """DELETE /api/v1/training-plans/{id} — deletes plan."""

    async def test_delete_plan(self, client, test_training_plan):
        """DELETE removes the plan and its days."""
        resp = await client.delete(f"/api/v1/training-plans/{test_training_plan.id}")
        assert resp.status_code == 204

        # Verify it's gone
        resp = await client.get(f"/api/v1/training-plans/{test_training_plan.id}")
        assert resp.status_code == 404
