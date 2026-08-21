"""Integration tests for the Goals API (CRUD).

These tests exercise the full pipeline: HTTP → FastAPI router → service → model → database.
No internal functions are mocked.  The only dependency overridden is ``get_current_user``
(injected via the ``client`` fixture from conftest).

Run with:  pytest tests/integration/test_goals_api.py -m integration
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.integration


# ── Create ────────────────────────────────────────────────────────────────


class TestCreateGoal:
    """POST /api/v1/goals — create a new training goal."""

    async def test_create_returns_201_with_full_payload(self, client):
        """A valid POST returns 201 and the serialised goal including server defaults."""
        resp = await client.post(
            "/api/v1/goals",
            json={
                "goal_type": "weight_target",
                "target_value": 80.0,
                "target_date": "2026-12-31",
                "notes": "Lose 5 kg",
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["goal_type"] == "weight_target"
        assert data["target_value"] == 80.0
        assert data["notes"] == "Lose 5 kg"
        assert data["status"] == "active"
        assert "id" in data
        assert "created_at" in data
        assert "updated_at" in data

    async def test_create_ftp_target(self, client):
        """Creating an ftp_target goal works correctly."""
        resp = await client.post(
            "/api/v1/goals",
            json={"goal_type": "ftp_target", "target_value": 300.0},
        )
        assert resp.status_code == 201
        assert resp.json()["goal_type"] == "ftp_target"

    async def test_create_weekly_sessions_goal(self, client):
        """Creating a weekly_sessions goal works correctly."""
        resp = await client.post(
            "/api/v1/goals",
            json={"goal_type": "weekly_sessions", "target_value": 4.0},
        )
        assert resp.status_code == 201
        assert resp.json()["goal_type"] == "weekly_sessions"

    async def test_create_rejects_invalid_goal_type(self, client):
        """An unknown goal_type returns 400."""
        resp = await client.post(
            "/api/v1/goals",
            json={"goal_type": "invalid_type", "target_value": 100.0},
        )
        assert resp.status_code == 400
        assert "Invalid goal_type" in resp.json()["detail"]

    async def test_missing_greenlet_fix(self, client):
        """Verify that server-default columns (created_at, status) are eagerly loaded.

        Before the MissingGreenlet fix, accessing these after ``db.flush()``
        without ``db.refresh()`` raised ``MissingGreenlet``.
        """
        resp = await client.post(
            "/api/v1/goals",
            json={"goal_type": "ftp_target", "target_value": 300.0},
        )
        assert resp.status_code == 201
        data = resp.json()
        # These come from server defaults — the fix ensures they're loaded
        assert data["status"] == "active"
        assert data["created_at"] is not None
        assert data["updated_at"] is not None


# ── List / Read ───────────────────────────────────────────────────────────


class TestListGoals:
    """GET /api/v1/goals — list all goals for the current user."""

    async def test_empty_list(self, client):
        """Returns an empty list when no goals exist."""
        resp = await client.get("/api/v1/goals")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_returns_created_goals(self, client):
        """Goals created via POST appear in the list."""
        await client.post(
            "/api/v1/goals",
            json={"goal_type": "ftp_target", "target_value": 300.0},
        )
        await client.post(
            "/api/v1/goals",
            json={"goal_type": "weight_target", "target_value": 75.0},
        )
        resp = await client.get("/api/v1/goals")
        assert resp.status_code == 200
        goals = resp.json()
        assert len(goals) == 2
        types = {g["goal_type"] for g in goals}
        assert types == {"ftp_target", "weight_target"}


class TestGetGoal:
    """GET /api/v1/goals/{id} — retrieve a single goal."""

    async def test_get_existing_goal(self, client):
        create_resp = await client.post(
            "/api/v1/goals",
            json={"goal_type": "ftp_target", "target_value": 300.0},
        )
        goal_id = create_resp.json()["id"]

        resp = await client.get(f"/api/v1/goals/{goal_id}")
        assert resp.status_code == 200
        assert resp.json()["id"] == goal_id

    async def test_get_nonexistent_goal_returns_404(self, client):
        import uuid
        resp = await client.get(f"/api/v1/goals/{uuid.uuid4()}")
        assert resp.status_code == 404


# ── Update ────────────────────────────────────────────────────────────────


class TestUpdateGoal:
    """PATCH /api/v1/goals/{id} — partial update."""

    async def test_update_target_value(self, client):
        create_resp = await client.post(
            "/api/v1/goals",
            json={"goal_type": "weight_target", "target_value": 80.0},
        )
        goal_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/goals/{goal_id}",
            json={"target_value": 75.0, "notes": "Adjusted target"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["target_value"] == 75.0
        assert data["notes"] == "Adjusted target"

    async def test_update_status(self, client):
        create_resp = await client.post(
            "/api/v1/goals",
            json={"goal_type": "ftp_target", "target_value": 300.0},
        )
        goal_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/goals/{goal_id}",
            json={"status": "achieved"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "achieved"

    async def test_update_nonexistent_returns_404(self, client):
        import uuid
        resp = await client.patch(
            f"/api/v1/goals/{uuid.uuid4()}",
            json={"target_value": 100.0},
        )
        assert resp.status_code == 404


# ── Delete ────────────────────────────────────────────────────────────────


class TestDeleteGoal:
    """DELETE /api/v1/goals/{id} — remove a goal."""

    async def test_delete_returns_204(self, client):
        create_resp = await client.post(
            "/api/v1/goals",
            json={"goal_type": "weight_target", "target_value": 80.0},
        )
        goal_id = create_resp.json()["id"]

        resp = await client.delete(f"/api/v1/goals/{goal_id}")
        assert resp.status_code == 204

    async def test_deleted_goal_is_gone(self, client):
        create_resp = await client.post(
            "/api/v1/goals",
            json={"goal_type": "weight_target", "target_value": 80.0},
        )
        goal_id = create_resp.json()["id"]

        await client.delete(f"/api/v1/goals/{goal_id}")

        resp = await client.get(f"/api/v1/goals/{goal_id}")
        assert resp.status_code == 404

    async def test_delete_nonexistent_returns_404(self, client):
        import uuid
        resp = await client.delete(f"/api/v1/goals/{uuid.uuid4()}")
        assert resp.status_code == 404


# ── Full round-trip ───────────────────────────────────────────────────────


class TestGoalRoundTrip:
    """Full CRUD lifecycle: create → read → update → delete → verify gone."""

    async def test_create_read_update_delete(self, client):
        # 1. Create
        create_resp = await client.post(
            "/api/v1/goals",
            json={"goal_type": "ftp_target", "target_value": 300.0, "notes": "Big goal"},
        )
        assert create_resp.status_code == 201
        goal_id = create_resp.json()["id"]
        assert create_resp.json()["target_value"] == 300.0

        # 2. Read
        read_resp = await client.get(f"/api/v1/goals/{goal_id}")
        assert read_resp.status_code == 200
        assert read_resp.json()["notes"] == "Big goal"

        # 3. Update
        update_resp = await client.patch(
            f"/api/v1/goals/{goal_id}",
            json={"target_value": 280.0, "status": "active"},
        )
        assert update_resp.status_code == 200
        assert update_resp.json()["target_value"] == 280.0

        # 4. Delete
        del_resp = await client.delete(f"/api/v1/goals/{goal_id}")
        assert del_resp.status_code == 204

        # 5. Verify gone
        gone_resp = await client.get(f"/api/v1/goals/{goal_id}")
        assert gone_resp.status_code == 404
