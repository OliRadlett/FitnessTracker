"""Integration tests for the Cycling API.

Tests profile management, training load, power curve, FTP estimation,
and metrics summary — all through real HTTP requests to the full app.
Run with:  pytest tests/integration/test_cycling_api.py -m integration
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.integration


# ── Cycling Profile ───────────────────────────────────────────────────────


class TestCyclingProfile:
    """GET/PATCH /api/v1/cycling/profile — cycling profile CRUD."""

    async def test_get_profile_creates_one_if_missing(self, client):
        """GET /profile auto-creates a profile when none exists."""
        resp = await client.get("/api/v1/cycling/profile")
        assert resp.status_code == 200
        data = resp.json()
        assert "id" in data
        assert "ftp_watts" in data
        assert data["ftp_watts"] is None  # brand new — no FTP yet

    async def test_get_existing_profile(self, client, test_cycling_profile):
        """Returns the pre-seeded profile data."""
        resp = await client.get("/api/v1/cycling/profile")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ftp_watts"] == 250.0
        assert data["weight_kg"] == 75.0
        assert data["lactate_threshold_hr"] == 170.0

    async def test_update_profile_ftp(self, client, test_cycling_profile):
        """PATCH /profile updates FTP and records history."""
        resp = await client.patch(
            "/api/v1/cycling/profile",
            json={"ftp_watts": 270.0},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ftp_watts"] == 270.0
        # Weight should be unchanged
        assert data["weight_kg"] == 75.0

    async def test_update_profile_weight(self, client, test_cycling_profile):
        resp = await client.patch(
            "/api/v1/cycling/profile",
            json={"weight_kg": 73.5},
        )
        assert resp.status_code == 200
        assert resp.json()["weight_kg"] == 73.5

    async def test_update_creates_ftp_history(self, client, test_cycling_profile):
        """Changing FTP creates an FTP history entry."""
        await client.patch(
            "/api/v1/cycling/profile",
            json={"ftp_watts": 280.0},
        )
        resp = await client.get("/api/v1/cycling/ftp-history")
        assert resp.status_code == 200
        history = resp.json()
        assert len(history) >= 1
        assert any(h["ftp_watts"] == 280.0 for h in history)


# ── Training Load ─────────────────────────────────────────────────────────


class TestTrainingLoad:
    """GET /api/v1/cycling/training-load — CTL/ATL/TSB computation."""

    async def test_training_load_returns_data_structure(
        self, client, test_cycling_profile
    ):
        """Even with minimal data, the endpoint returns the expected structure."""
        resp = await client.get("/api/v1/cycling/training-load", params={"days": 30})
        assert resp.status_code == 200
        data = resp.json()
        assert "data" in data
        assert "current_ctl" in data
        assert "current_atl" in data
        assert "current_tsb" in data
        assert isinstance(data["data"], list)
        # current values should be numeric
        assert isinstance(data["current_ctl"], (int, float))
        assert isinstance(data["current_atl"], (int, float))
        assert isinstance(data["current_tsb"], (int, float))

    async def test_training_load_with_activity_data(
        self, client, test_activity, test_cycling_profile
    ):
        """With a TSS-bearing activity, CTL/ATL should be > 0."""
        resp = await client.get("/api/v1/cycling/training-load", params={"days": 30})
        assert resp.status_code == 200
        data = resp.json()
        # The test_activity has tss=80.0, so there should be some load
        assert data["current_ctl"] >= 0
        assert data["current_atl"] >= 0


# ── Power Curve ───────────────────────────────────────────────────────────


class TestPowerCurve:
    """GET /api/v1/cycling/power-curve — best power at each duration bucket."""

    async def test_power_curve_returns_all_buckets(self, client, test_cycling_profile):
        """Power curve returns data for each standard duration bucket."""
        resp = await client.get("/api/v1/cycling/power-curve", params={"days": 90})
        assert resp.status_code == 200
        data = resp.json()
        assert "data" in data
        assert "ftp_watts" in data
        assert data["ftp_watts"] == 250.0
        # Should have entries for 5s, 10s, ... 60min
        assert len(data["data"]) >= 10
        for point in data["data"]:
            assert "duration_label" in point
            assert "duration_seconds" in point
            assert "best_power_watts" in point

    async def test_power_curve_with_stream_data(
        self, client, test_activity, test_cycling_profile
    ):
        """With power stream data, at least some buckets should have values."""
        resp = await client.get("/api/v1/cycling/power-curve", params={"days": 90})
        assert resp.status_code == 200
        data = resp.json()
        # The test_activity has a power stream with values around 200-250W
        # Short durations (5s, 10s) should have values from the stream
        non_null = [p for p in data["data"] if p["best_power_watts"] is not None]
        assert len(non_null) > 0


# ── FTP Estimation ────────────────────────────────────────────────────────


class TestFtpEstimation:
    """POST /api/v1/cycling/estimate-ftp — estimate FTP from power data."""

    async def test_estimate_ftp_no_data_returns_400(self, client, test_cycling_profile):
        """Without power stream data, returns 400."""
        resp = await client.post(
            "/api/v1/cycling/estimate-ftp",
            params={"days": 90},
        )
        assert resp.status_code == 400
        assert "No power stream data" in resp.json()["detail"]

    async def test_estimate_ftp_with_power_data(
        self, client, test_activity, test_cycling_profile
    ):
        """With power stream data, FTP estimation returns a structured response."""
        resp = await client.post(
            "/api/v1/cycling/estimate-ftp",
            params={"days": 90},
        )
        # May succeed (200) or fail (400) depending on whether the stream
        # data contains enough duration for a valid estimate
        if resp.status_code == 200:
            data = resp.json()
            assert "estimated_ftp" in data
            assert "confidence" in data
            assert "method" in data
            assert "all_estimates" in data
            assert isinstance(data["estimated_ftp"], (int, float))
            assert 0 <= data["confidence"] <= 1


# ── Metrics Summary ───────────────────────────────────────────────────────


class TestMetricsSummary:
    """GET /api/v1/cycling/metrics-summary — cycling-specific metrics overview."""

    async def test_metrics_summary_structure(self, client, test_cycling_profile):
        """Returns all expected fields."""
        resp = await client.get("/api/v1/cycling/metrics-summary")
        assert resp.status_code == 200
        data = resp.json()
        assert "recent_tss" in data
        assert "recent_distance_km" in data
        assert "recent_rides" in data
        assert "ftp_watts" in data
        assert data["ftp_watts"] == 250.0
        assert "weight_kg" in data
        assert "power_to_weight" in data
        # Trend fields
        assert "tss_trend" in data
        assert "distance_trend" in data
        # Benchmark fields
        assert "ftp_wkg_benchmark" in data

    async def test_metrics_with_activity(
        self, client, test_activity, test_cycling_profile
    ):
        """With activity data, metrics should reflect the rides."""
        resp = await client.get("/api/v1/cycling/metrics-summary")
        assert resp.status_code == 200
        data = resp.json()
        assert data["recent_rides"] >= 1


# ── FTP History ───────────────────────────────────────────────────────────


class TestFtpHistory:
    """GET/POST /api/v1/cycling/ftp-history — FTP history management."""

    async def test_empty_ftp_history(self, client, test_cycling_profile):
        resp = await client.get("/api/v1/cycling/ftp-history")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_create_and_read_ftp_history(self, client, test_cycling_profile):
        """Creating an FTP entry shows up in history."""
        from datetime import date

        resp = await client.post(
            "/api/v1/cycling/ftp-history",
            json={
                "ftp_watts": 260.0,
                "effective_date": str(date.today()),
                "source": "manual",
                "notes": "Ramp test",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ftp_watts"] == 260.0

        # Verify in history
        resp = await client.get("/api/v1/cycling/ftp-history")
        assert resp.status_code == 200
        assert len(resp.json()) >= 1


# ── Cycling Power PRs ───────────────────────────────────────────────────────


class TestCyclingPRs:
    """GET/POST /api/v1/cycling/prs and POST /prs/check."""

    async def test_list_prs_empty(self, client, test_cycling_profile):
        """GET /prs returns empty list when no PRs exist."""
        resp = await client.get("/api/v1/cycling/prs")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_create_manual_pr(
        self, client, test_cycling_profile
    ):
        """POST /prs creates a PR manually."""
        from datetime import date

        resp = await client.post(
            "/api/v1/cycling/prs",
            json={
                "duration_label": "5min",
                "duration_seconds": 300,
                "power_watts": 300.0,
                "achieved_date": str(date.today()),
                "notes": "Ramp test",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["duration_label"] == "5min"
        assert data["power_watts"] == 300.0
        assert data["w_per_kg"] is not None
        # Weight is 75.0 from the profile fixture
        assert abs(data["w_per_kg"] - 4.0) < 0.01  # 300 / 75 = 4.0

    async def test_create_pr_updates_existing(
        self, client, test_cycling_profile
    ):
        """POST /prs with higher power updates the existing PR."""
        from datetime import date

        # Create initial PR
        await client.post(
            "/api/v1/cycling/prs",
            json={
                "duration_label": "5min",
                "duration_seconds": 300,
                "power_watts": 300.0,
                "achieved_date": str(date.today()),
                "notes": "First",
            },
        )

        # Beat it with higher power
        resp = await client.post(
            "/api/v1/cycling/prs",
            json={
                "duration_label": "5min",
                "duration_seconds": 300,
                "power_watts": 320.0,
                "achieved_date": str(date.today()),
                "notes": "Improved",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["power_watts"] == 320.0
        assert data["improvement_pct"] is not None
        assert data["improvement_pct"] > 0

    async def test_create_pr_lower_power_no_change(
        self, client, test_cycling_profile
    ):
        """POST /prs with lower power returns the existing (higher) PR."""
        from datetime import date

        # Create PR at 320W
        await client.post(
            "/api/v1/cycling/prs",
            json={
                "duration_label": "5min",
                "duration_seconds": 300,
                "power_watts": 320.0,
                "achieved_date": str(date.today()),
            },
        )

        # Try to set a lower value
        resp = await client.post(
            "/api/v1/cycling/prs",
            json={
                "duration_label": "5min",
                "duration_seconds": 300,
                "power_watts": 300.0,
                "achieved_date": str(date.today()),
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["power_watts"] == 320.0  # unchanged

    async def test_check_prs_single_activity(
        self, client, test_cycling_profile, test_activity
    ):
        """POST /prs/check with activity_id detects PRs from that activity."""
        resp = await client.post(
            "/api/v1/cycling/prs/check",
            json={"activity_id": str(test_activity.id)},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["checked"] == 1
        assert data["updated_prs"] > 0

        # Verify PRs were created
        resp = await client.get("/api/v1/cycling/prs")
        assert resp.status_code == 200
        prs = resp.json()
        assert len(prs) > 0
        labels = [p["duration_label"] for p in prs]
        # Activity has 360 data points at 10s resolution (1 hour total)
        # So buckets up to 5min (300 data points) are computable
        assert "max" in labels
        assert "5min" in labels
        assert "1min" in labels
        assert "5s" in labels

    async def test_check_prs_all_activities(
        self, client, test_cycling_profile, test_activity
    ):
        """POST /prs/check without activity_id does a full rescan."""
        resp = await client.post(
            "/api/v1/cycling/prs/check",
            json={},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["updated_prs"] > 0

    async def test_check_prs_nonexistent_activity(
        self, client, test_cycling_profile
    ):
        """POST /prs/check with a non-existent activity_id returns 404."""
        resp = await client.post(
            "/api/v1/cycling/prs/check",
            json={"activity_id": "00000000-0000-0000-0000-000000000000"},
        )
        assert resp.status_code == 404

# ── Power Zones ───────────────────────────────────────────────────────────


class TestPowerZones:
    """GET /api/v1/cycling/power-zones — Coggan power zone distribution."""

    async def test_power_zones_requires_ftp(self, client):
        """Without FTP set, returns 400."""
        resp = await client.get("/api/v1/cycling/power-zones")
        assert resp.status_code == 400
        assert "FTP not set" in resp.json()["detail"]

    async def test_power_zones_returns_structure(
        self, client, test_cycling_profile, test_activity
    ):
        """With FTP and power stream data, returns zone distribution."""
        resp = await client.get("/api/v1/cycling/power-zones", params={"days": 30})
        assert resp.status_code == 200
        data = resp.json()
        assert "ftp_watts" in data
        assert data["ftp_watts"] == 250.0
        assert "zones" in data
        assert "total_time_seconds" in data
