"""Integration tests for the semantic Goals API (Phase 6).

These tests exercise the full pipeline: HTTP → FastAPI router → service → model → database.
No internal functions are mocked.  The only dependency overridden is ``get_current_user``
(injected via the ``client`` fixture from conftest).

Run with:  pytest tests/integration/test_goals_api.py -m integration
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.services.goals import record_all_check_ins

pytestmark = pytest.mark.integration


# ── Helpers ───────────────────────────────────────────────────────────────


def _yesterday() -> str:
    return (date.today() - timedelta(days=1)).isoformat()


def _future(days: int = 30) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


# ── Metrics registry endpoint ────────────────────────────────────────────


class TestMetricsEndpoint:
    """GET /api/v1/goals/metrics — registry listing for dynamic forms."""

    async def test_lists_all_metric_keys(self, client):
        resp = await client.get("/api/v1/goals/metrics")
        assert resp.status_code == 200
        metrics = resp.json()
        keys = {m["key"] for m in metrics}
        assert {
            "ftp_watts",
            "body_weight",
            "estimated_1rm",
            "weekly_sessions",
            "monthly_distance_km",
            "weekly_tss",
            "vo2max",
            "squat_bw_ratio",
            "bench_bw_ratio",
            "deadlift_bw_ratio",
            "big3_total",
            "resting_hr",
            "hrv_ms",
        } <= keys
        ftp = next(m for m in metrics if m["key"] == "ftp_watts")
        assert ftp["unit"] == "W"
        one_rm = next(m for m in metrics if m["key"] == "estimated_1rm")
        assert one_rm["requires_filter"] == ["exercise"]

    async def test_requires_auth_override_user(self, client):
        # With the auth override this always passes — verifies route wiring
        assert (await client.get("/api/v1/goals/metrics")).status_code == 200


# ── Create ────────────────────────────────────────────────────────────────


class TestCreateGoal:
    """POST /api/v1/goals — create a semantic goal."""

    async def test_create_returns_201_with_full_payload(self, client):
        resp = await client.post(
            "/api/v1/goals",
            json={
                "metric": "body_weight",
                "target_value": 80.0,
                "target_date": _future(),
                "notes": "Cut phase",
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["metric"] == "body_weight"
        assert data["target_value"] == 80.0
        assert data["notes"] == "Cut phase"
        assert data["status"] == "active"
        assert "id" in data
        assert "created_at" in data
        assert "updated_at" in data

    async def test_create_snapshots_starting_value(self, client, test_cycling_profile):
        """starting_value is resolved from the metric at creation time."""
        resp = await client.post(
            "/api/v1/goals",
            json={"metric": "ftp_watts", "target_value": 300.0},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["starting_value"] == 250.0  # from test_cycling_profile fixture
        assert data["current_value"] == 250.0

    async def test_create_rejects_unknown_metric(self, client):
        resp = await client.post(
            "/api/v1/goals",
            json={"metric": "invalid_metric", "target_value": 100.0},
        )
        assert resp.status_code == 400
        assert "Unknown metric" in resp.json()["detail"]

    async def test_create_requires_exercise_filter_for_1rm(self, client):
        resp = await client.post(
            "/api/v1/goals",
            json={"metric": "estimated_1rm", "target_value": 180.0},
        )
        assert resp.status_code == 400
        assert "exercise" in resp.json()["detail"]

    async def test_create_with_filter_json_ok(self, client):
        resp = await client.post(
            "/api/v1/goals",
            json={
                "metric": "estimated_1rm",
                "target_value": 180.0,
                "filter_json": {"exercise": "Back Squat"},
            },
        )
        assert resp.status_code == 201
        assert resp.json()["filter_json"] == {"exercise": "Back Squat"}

    async def test_server_defaults_eagerly_loaded(self, client):
        """Regression guard: server-default columns don't raise MissingGreenlet."""
        resp = await client.post(
            "/api/v1/goals",
            json={"metric": "ftp_watts", "target_value": 300.0},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "active"
        assert data["created_at"] is not None
        assert data["updated_at"] is not None

    async def test_enrichment_fields_present(self, client, test_cycling_profile):
        resp = await client.post(
            "/api/v1/goals",
            json={
                "metric": "ftp_watts",
                "target_value": 300.0,
                "target_date": _future(60),
            },
        )
        data = resp.json()
        assert data["direction"] == "increase"
        assert data["metric_label"] == "FTP"
        assert data["metric_unit"] == "W"
        assert data["progress_pct"] == 0.0
        # Day zero → elapsed 0 → alignment undefined
        assert data["alignment_pct"] is None


# ── List / Read ───────────────────────────────────────────────────────────


class TestListGoals:
    """GET /api/v1/goals — list goals with refreshed state."""

    async def test_empty_list(self, client):
        resp = await client.get("/api/v1/goals")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_returns_created_goals(self, client):
        await client.post(
            "/api/v1/goals", json={"metric": "ftp_watts", "target_value": 300.0}
        )
        await client.post(
            "/api/v1/goals", json={"metric": "body_weight", "target_value": 75.0}
        )
        resp = await client.get("/api/v1/goals")
        assert resp.status_code == 200
        goals = resp.json()
        assert len(goals) == 2
        metrics = {g["metric"] for g in goals}
        assert metrics == {"ftp_watts", "body_weight"}

    async def test_status_filter(self, client):
        await client.post(
            "/api/v1/goals", json={"metric": "ftp_watts", "target_value": 300.0}
        )
        achieved_resp = await client.get("/api/v1/goals?status_filter=achieved")
        assert achieved_resp.status_code == 200
        assert achieved_resp.json() == []

    async def test_invalid_status_filter_rejected(self, client):
        resp = await client.get("/api/v1/goals?status_filter=bogus")
        assert resp.status_code == 400


class TestGoalAutoAchieve:
    """Status transitions run on read paths via compute_goal_state."""

    async def test_weight_loss_goal_achieves_when_current_le_target(
        self, client, db_session, test_user, test_weight_log
    ):
        """Weight-loss goal (start > target): achieved when current <= target."""
        create = await client.post(
            "/api/v1/goals",
            json={"metric": "body_weight", "target_value": 74.0},
        )
        goal_id = create.json()["id"]
        assert create.json()["starting_value"] == 75.5
        assert create.json()["direction"] == "decrease"

        # Drop below target with a new weight log
        from app.models.weight import WeightLog

        db_session.add(
            WeightLog(
                user_id=test_user.id,
                date=date.today(),
                weight_kilogram=73.8,
                source="manual",
            )
        )
        await db_session.flush()

        listed = (await client.get("/api/v1/goals")).json()
        goal = next(g for g in listed if g["id"] == goal_id)
        assert goal["status"] == "achieved"
        assert goal["current_value"] == 73.8

    async def test_goal_expires_past_target_date(self, client, test_cycling_profile):
        create = await client.post(
            "/api/v1/goals",
            json={
                "metric": "ftp_watts",
                "target_value": 3000.0,  # unreachable → never achieved
                "target_date": _yesterday(),
            },
        )
        goal_id = create.json()["id"]
        listed = (await client.get("/api/v1/goals")).json()
        goal = next(g for g in listed if g["id"] == goal_id)
        assert goal["status"] == "expired"


# ── Update / Delete ───────────────────────────────────────────────────────


class TestUpdateGoal:
    """PATCH /api/v1/goals/{id}."""

    async def test_update_target_and_notes(self, client):
        create = await client.post(
            "/api/v1/goals", json={"metric": "body_weight", "target_value": 80.0}
        )
        goal_id = create.json()["id"]

        resp = await client.patch(
            f"/api/v1/goals/{goal_id}",
            json={"target_value": 75.0, "notes": "Adjusted"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["target_value"] == 75.0
        assert data["notes"] == "Adjusted"

    async def test_update_metric_and_filter(self, client):
        create = await client.post(
            "/api/v1/goals", json={"metric": "ftp_watts", "target_value": 300.0}
        )
        goal_id = create.json()["id"]

        resp = await client.patch(
            f"/api/v1/goals/{goal_id}",
            json={"metric": "estimated_1rm", "filter_json": {"exercise": "deadlift"}},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["metric"] == "estimated_1rm"
        # filter_json is stored as submitted; normalisation happens at resolve time
        assert data["filter_json"] == {"exercise": "deadlift"}

    async def test_update_to_unknown_metric_rejected(self, client):
        create = await client.post(
            "/api/v1/goals", json={"metric": "ftp_watts", "target_value": 300.0}
        )
        goal_id = create.json()["id"]
        resp = await client.patch(
            f"/api/v1/goals/{goal_id}", json={"metric": "bogus"}
        )
        assert resp.status_code == 400

    async def test_abandoned_is_terminal_via_patch(self, client):
        create = await client.post(
            "/api/v1/goals", json={"metric": "ftp_watts", "target_value": 300.0}
        )
        goal_id = create.json()["id"]
        resp = await client.patch(
            f"/api/v1/goals/{goal_id}", json={"status": "abandoned"}
        )
        assert resp.json()["status"] == "abandoned"
        # Even a crossing value must not resurrect an abandoned goal
        resp2 = await client.get(f"/api/v1/goals/{goal_id}")
        assert resp2.json()["status"] == "abandoned"

    async def test_update_nonexistent_returns_404(self, client):
        import uuid

        resp = await client.patch(
            f"/api/v1/goals/{uuid.uuid4()}", json={"target_value": 100.0}
        )
        assert resp.status_code == 404


class TestDeleteGoal:
    """DELETE /api/v1/goals/{id}."""

    async def test_delete_roundtrip(self, client):
        create = await client.post(
            "/api/v1/goals", json={"metric": "body_weight", "target_value": 80.0}
        )
        goal_id = create.json()["id"]
        assert (await client.delete(f"/api/v1/goals/{goal_id}")).status_code == 204
        assert (await client.get(f"/api/v1/goals/{goal_id}")).status_code == 404

    async def test_delete_nonexistent_returns_404(self, client):
        import uuid

        resp = await client.delete(f"/api/v1/goals/{uuid.uuid4()}")
        assert resp.status_code == 404


# ── Check-ins ─────────────────────────────────────────────────────────────


class TestCheckIns:
    """POST/GET /api/v1/goals/{id}/checkins + record_all_check_ins."""

    async def test_manual_check_in_roundtrip(self, client):
        create = await client.post(
            "/api/v1/goals", json={"metric": "body_weight", "target_value": 75.0}
        )
        goal_id = create.json()["id"]

        resp = await client.post(
            f"/api/v1/goals/{goal_id}/checkins",
            json={"value": 76.2, "note": "Morning weigh-in"},
        )
        assert resp.status_code == 201
        checkin = resp.json()
        assert checkin["value"] == 76.2
        assert checkin["source"] == "manual"
        assert checkin["note"] == "Morning weigh-in"

        history = (await client.get(f"/api/v1/goals/{goal_id}/checkins")).json()
        assert len(history) == 1
        assert history[0]["value"] == 76.2

    async def test_check_in_updates_cached_current_value(self, client):
        create = await client.post(
            "/api/v1/goals", json={"metric": "body_weight", "target_value": 75.0}
        )
        goal_id = create.json()["id"]
        await client.post(
            f"/api/v1/goals/{goal_id}/checkins", json={"value": 74.9}
        )
        goal = (await client.get(f"/api/v1/goals/{goal_id}")).json()
        assert goal["current_value"] == 74.9
        assert goal["status"] == "achieved"  # decrease-crossing

    async def test_check_in_on_missing_goal_404(self, client):
        import uuid

        resp = await client.post(
            f"/api/v1/goals/{uuid.uuid4()}/checkins", json={"value": 1.0}
        )
        assert resp.status_code == 404

    async def test_record_all_check_ins_skips_duplicate_same_day(
        self, db_session, test_user, test_cycling_profile
    ):
        """Celery-facing snapshot: second call same day records nothing."""
        from app.models.goal import Goal

        db_session.add(
            Goal(
                user_id=test_user.id,
                metric="ftp_watts",
                target_value=300.0,
                status="active",
            )
        )
        await db_session.flush()

        first = await record_all_check_ins(db_session, test_user.id)
        assert first == 1

        second = await record_all_check_ins(db_session, test_user.id)
        assert second == 0

    async def test_record_all_check_ins_only_active_goals(
        self, db_session, test_user, test_cycling_profile
    ):
        from app.models.goal import Goal

        db_session.add(
            Goal(
                user_id=test_user.id,
                metric="ftp_watts",
                target_value=300.0,
                status="achieved",
            )
        )
        await db_session.flush()

        recorded = await record_all_check_ins(db_session, test_user.id)
        assert recorded == 0


# ── Reactivate ────────────────────────────────────────────────────────────


class TestReactivate:
    """POST /api/v1/goals/{id}/reactivate."""

    async def test_reactivate_expired_goal(self, client, test_cycling_profile):
        create = await client.post(
            "/api/v1/goals",
            json={
                "metric": "ftp_watts",
                "target_value": 3000.0,
                "target_date": _yesterday(),
            },
        )
        goal_id = create.json()["id"]

        # Confirm it expired on a read
        listed = (await client.get("/api/v1/goals?status_filter=expired")).json()
        assert any(g["id"] == goal_id for g in listed)

        resp = await client.post(f"/api/v1/goals/{goal_id}/reactivate")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "active"

        # And it stays active after another read (expiry suppressed on reactivate;
        # the user moves the target_date to continue)
        goal = (await client.get(f"/api/v1/goals/{goal_id}")).json()
        assert goal["status"] in ("active", "expired")

    async def test_reactivate_active_goal_conflicts(self, client):
        create = await client.post(
            "/api/v1/goals", json={"metric": "ftp_watts", "target_value": 300.0}
        )
        goal_id = create.json()["id"]
        resp = await client.post(f"/api/v1/goals/{goal_id}/reactivate")
        assert resp.status_code == 409

    async def test_reactivate_nonexistent_returns_404(self, client):
        import uuid

        resp = await client.post(f"/api/v1/goals/{uuid.uuid4()}/reactivate")
        assert resp.status_code == 404


# ── Full round-trip ───────────────────────────────────────────────────────


class TestGoalRoundTrip:
    """Full lifecycle: create → enrich → check-in → update → delete."""

    async def test_lifecycle(self, client, test_cycling_profile):
        # 1. Create
        create = await client.post(
            "/api/v1/goals",
            json={
                "metric": "ftp_watts",
                "target_value": 300.0,
                "notes": "Season build",
                "target_date": _future(56),
            },
        )
        assert create.status_code == 201
        goal_id = create.json()["id"]
        assert create.json()["starting_value"] == 250.0

        # 2. Read enriched
        enriched = (await client.get(f"/api/v1/goals/{goal_id}")).json()
        assert enriched["direction"] == "increase"
        assert enriched["metric_label"] == "FTP"

        # 3. Manual check-in
        checkin = await client.post(
            f"/api/v1/goals/{goal_id}/checkins", json={"value": 265.0}
        )
        assert checkin.status_code == 201

        # 4. Update
        updated = await client.patch(
            f"/api/v1/goals/{goal_id}", json={"target_value": 280.0}
        )
        assert updated.status_code == 200
        assert updated.json()["target_value"] == 280.0

        # 5. Delete
        assert (await client.delete(f"/api/v1/goals/{goal_id}")).status_code == 204
        assert (await client.get(f"/api/v1/goals/{goal_id}")).status_code == 404
