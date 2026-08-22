"""Integration tests for the Workout Planner API.

These tests exercise the full pipeline: HTTP → FastAPI router → service → model → database.
No internal functions are mocked.

Run with:  pytest tests/integration/test_workout_planner_api.py -m integration
"""

from __future__ import annotations

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


# ── Workout Zones ────────────────────────────────────────────────────────


class TestWorkoutZones:
    """GET /api/v1/workout-planner/zones — intensity zones."""

    async def test_returns_zones_with_cycling_profile(
        self, client, test_cycling_profile
    ):
        """Zones endpoint returns zones when cycling profile exists."""
        resp = await client.get("/api/v1/workout-planner/zones")
        assert resp.status_code == 200
        data = resp.json()
        assert "zones" in data
        assert "readiness" in data
        assert "ftp_watts" in data
        assert "lthr" in data
        assert data["ftp_watts"] == 250.0
        assert isinstance(data["zones"], list)
        assert len(data["zones"]) > 0
        zone = data["zones"][0]
        assert "zone" in zone
        assert "name" in zone
        assert "power_low" in zone
        assert "power_high" in zone


# ── Plan Workout ─────────────────────────────────────────────────────────


class TestPlanWorkout:
    """POST /api/v1/workout-planner/plan — generates a workout plan."""

    async def test_generates_workout_plan(self, client, test_cycling_profile):
        """Plan endpoint returns workout targets."""
        resp = await client.post(
            "/api/v1/workout-planner/plan",
            json={"difficulty": "z3", "duration_minutes": 60},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data is not None
        assert "difficulty" in data
        assert "zone_id" in data
        assert "zone_name" in data
        assert "duration_minutes" in data
        assert "target_power_low" in data
        assert "target_power_high" in data
        assert "target_tss_low" in data
        assert "target_tss_high" in data
        assert data["duration_minutes"] == 60

    async def test_returns_null_when_no_ftp(self, client, test_user, db_session):
        """Plan returns null when FTP is not set."""
        from app.models.cycling import CyclingProfile

        # Create a profile with no FTP
        profile = CyclingProfile(
            user_id=test_user.id,
            ftp_watts=0.0,
            weight_kg=75.0,
        )
        db_session.add(profile)
        await db_session.flush()

        resp = await client.post(
            "/api/v1/workout-planner/plan",
            json={"difficulty": "z2", "duration_minutes": 45},
        )
        assert resp.status_code == 200
        assert resp.json() is None
