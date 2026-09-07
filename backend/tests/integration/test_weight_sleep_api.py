"""Integration tests for Weight and Sleep API endpoints.

These tests exercise the full pipeline: HTTP → FastAPI router → service → model → database.
No internal functions are mocked.

Run with:  pytest tests/integration/test_weight_sleep_api.py -m integration
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


# ── Weight ───────────────────────────────────────────────────────────────


class TestWeightEndpoints:
    """Weight logging and history endpoints."""

    async def test_get_weight_history(self, client, test_weight_log):
        """GET /api/v1/metrics/weight returns weight history."""
        resp = await client.get("/api/v1/metrics/weight?days=90")
        assert resp.status_code == 200
        data = resp.json()
        assert "entries" in data
        assert "rolling_avg" in data
        assert len(data["entries"]) >= 1
        entry = data["entries"][0]
        assert entry["weight_kg"] == 75.5
        assert entry["source"] == "manual"

    async def test_get_weight_empty(self, client):
        """GET /api/v1/metrics/weight returns empty when no logs."""
        resp = await client.get("/api/v1/metrics/weight?days=90")
        assert resp.status_code == 200
        data = resp.json()
        assert data["entries"] == []
        assert data["rolling_avg"] == []

    async def test_create_weight_entry(self, client):
        """POST /api/v1/metrics/weight creates a manual entry for today."""
        resp = await client.post("/api/v1/metrics/weight", json={"weight_kg": 74.2})
        assert resp.status_code == 200
        data = resp.json()
        assert data["weight_kg"] == 74.2
        assert data["source"] == "manual"
        assert data["id"]
        assert data["date"] == date.today().isoformat()

    async def test_create_weight_entry_upserts_same_day(self, client):
        """POST twice for the same date updates rather than duplicating."""
        await client.post(
            "/api/v1/metrics/weight",
            json={"date": date.today().isoformat(), "weight_kg": 74.0},
        )
        resp = await client.post(
            "/api/v1/metrics/weight",
            json={"date": date.today().isoformat(), "weight_kg": 73.5},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["weight_kg"] == 73.5

        history = await client.get("/api/v1/metrics/weight?days=90")
        entries = history.json()["entries"]
        today_entries = [e for e in entries if e["date"] == date.today().isoformat()]
        assert len(today_entries) == 1
        assert today_entries[0]["weight_kg"] == 73.5

    async def test_create_weight_entry_syncs_profile(self, client):
        """Creating a manual weight updates the cycling profile reference weight."""
        resp = await client.post("/api/v1/metrics/weight", json={"weight_kg": 76.0})
        assert resp.status_code == 200

        profile = await client.get("/api/v1/cycling/profile")
        assert profile.status_code == 200
        assert profile.json()["weight_kg"] == 76.0

    async def test_create_weight_entry_rejects_out_of_bounds(self, client):
        """POST weight outside 20-300 kg returns 422."""
        resp = await client.post("/api/v1/metrics/weight", json={"weight_kg": 400})
        assert resp.status_code == 422

    async def test_patch_weight_entry(self, client, test_weight_log):
        """PATCH /api/v1/metrics/weight/{id} updates a manual entry."""
        resp = await client.patch(
            f"/api/v1/metrics/weight/{test_weight_log.id}",
            json={"weight_kg": 71.0},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["weight_kg"] == 71.0

    async def test_delete_weight_entry(self, client, test_weight_log):
        """DELETE /api/v1/metrics/weight/{id} removes a manual entry."""
        resp = await client.delete(f"/api/v1/metrics/weight/{test_weight_log.id}")
        assert resp.status_code == 200
        assert resp.json() == {"deleted": True}

        history = await client.get("/api/v1/metrics/weight?days=90")
        assert history.json()["entries"] == []

    async def test_patch_delete_404_for_unknown_or_whoop_entry(self, client):
        """PATCH/DELETE on unknown id returns 404; Whoop-sourced entries are off-limits."""
        resp = await client.patch(
            "/api/v1/metrics/weight/11111111-1111-1111-1111-111111111111",
            json={"weight_kg": 70.0},
        )
        assert resp.status_code == 404

        resp = await client.delete(
            "/api/v1/metrics/weight/11111111-1111-1111-1111-111111111111"
        )
        assert resp.status_code == 404


# ── Sleep ────────────────────────────────────────────────────────────────


class TestSleepEndpoints:
    """Sleep logging and history endpoints."""

    async def test_get_sleep_consistency(self, client, test_sleep_log):
        """GET /api/v1/metrics/sleep-consistency returns consistency data."""
        resp = await client.get("/api/v1/metrics/sleep-consistency?days=7")
        assert resp.status_code == 200
        data = resp.json()
        assert "consistency_score" in data
        assert "days_analyzed" in data

    async def test_get_sleep_debt(self, client, test_sleep_log):
        """GET /api/v1/metrics/sleep-debt returns debt data."""
        resp = await client.get("/api/v1/metrics/sleep-debt?days=7")
        assert resp.status_code == 200
        data = resp.json()
        assert "debt_hours" in data
        assert "avg_sleep_hours" in data
        assert "days_below_target" in data

    async def test_get_sleep_debt_custom_target(self, client, test_sleep_log):
        """GET /api/v1/metrics/sleep-debt accepts custom target_hours."""
        resp = await client.get("/api/v1/metrics/sleep-debt?target_hours=9.0&days=7")
        assert resp.status_code == 200
        data = resp.json()
        assert data["target_hours"] == 9.0
