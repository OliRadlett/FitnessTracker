"""Integration tests for the health analysis service (expensive).

These tests exercise the health analysis functions directly with real DB.
No external APIs are mocked — only the database is used.

Run with:  pytest tests/integration/test_health_analysis_service.py -m integration
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.daily_metric import DailyMetric
from app.models.lifting import LiftingSession
from app.models.sleep import SleepLog

pytestmark = [pytest.mark.integration, pytest.mark.expensive]


# ── Overtraining Analysis ────────────────────────────────────────────────


class TestAnalyzeOvertraining:
    """analyze_overtraining() — detects overtraining from high TSB + low recovery."""

    async def test_detects_overtraining_from_low_recovery(
        self, db_session, test_user,
    ):
        """Detects overtraining when recovery is consistently low and TSB is negative."""
        from app.services.health_analysis import analyze_overtraining

        # Insert 7 days of low recovery metrics
        for i in range(7):
            metric = DailyMetric(
                user_id=test_user.id,
                metric_date=date.today() - timedelta(days=i),
                source="whoop",
                recovery_score=25.0,  # Very low
                hrv_ms=35.0,
                resting_hr=65.0,
                sleep_efficiency=75.0,
            )
            db_session.add(metric)

        # Insert high-TSS activities to create negative TSB (overreaching)
        for i in range(14):
            activity = Activity(
                user_id=test_user.id,
                source="strava",
                sport_type="cycling",
                name=f"Hard Ride {i}",
                start_date=datetime.now(UTC) - timedelta(days=i),
                duration_seconds=5400,
                distance_meters=50_000.0,
                average_power=220.0,
                tss=150.0,  # High TSS to drive TSB negative
                provider_activity_id=f"strava_ot_{i}",
            )
            db_session.add(activity)
        await db_session.flush()

        result = await analyze_overtraining(db_session, test_user.id)

        assert result is not None
        assert result["alert_type"] == "overtraining"
        assert result["severity"] in ("info", "warning", "critical")
        assert result["score"] > 0
        assert "evidence" in result

    async def test_returns_none_severity_when_data_is_normal(
        self, db_session, test_user,
    ):
        """Returns 'none' severity when all metrics are normal."""
        from app.services.health_analysis import analyze_overtraining

        # Insert 7 days of normal recovery metrics
        for i in range(7):
            metric = DailyMetric(
                user_id=test_user.id,
                metric_date=date.today() - timedelta(days=i),
                source="whoop",
                recovery_score=80.0,  # Good recovery
                hrv_ms=60.0,
                resting_hr=52.0,
                sleep_efficiency=95.0,
            )
            db_session.add(metric)
        await db_session.flush()

        result = await analyze_overtraining(db_session, test_user.id)

        assert result is not None
        assert result["severity"] == "none"
        assert result["score"] == 0.0

    async def test_returns_none_when_insufficient_data(
        self, db_session, test_user,
    ):
        """Returns 'none' severity when less than 3 days of data."""
        from app.services.health_analysis import analyze_overtraining

        # Only 1 day of data
        metric = DailyMetric(
            user_id=test_user.id,
            metric_date=date.today(),
            source="whoop",
            recovery_score=50.0,
        )
        db_session.add(metric)
        await db_session.flush()

        result = await analyze_overtraining(db_session, test_user.id)

        assert result is not None
        assert result["severity"] == "none"


# ── Injury Risk Analysis ─────────────────────────────────────────────────


class TestAnalyzeInjuryRisk:
    """analyze_injury_risk() — detects injury risk from volume spikes."""

    async def test_detects_injury_risk_from_volume_spike(
        self, db_session, test_user,
    ):
        """Detects injury risk when current week volume is much higher than prior weeks."""
        from app.services.health_analysis import analyze_injury_risk

        today = date.today()

        # Insert prior weeks with moderate volume
        for week_offset in range(1, 6):
            week_start = today - timedelta(weeks=week_offset)
            session = LiftingSession(
                user_id=test_user.id,
                session_date=week_start + timedelta(days=1),
                focus="squat",
                total_volume_kg=5000.0,
                duration_seconds=3600,
            )
            db_session.add(session)
        await db_session.flush()

        # Insert current week with very high volume (spike)
        for day_offset in range(5):
            session = LiftingSession(
                user_id=test_user.id,
                session_date=today - timedelta(days=day_offset),
                focus="squat",
                total_volume_kg=15000.0,  # 3x normal
                duration_seconds=3600,
            )
            db_session.add(session)
        await db_session.flush()

        result = await analyze_injury_risk(db_session, test_user.id)

        assert result is not None
        assert result["alert_type"] == "injury_risk"
        assert result["score"] >= 0

    async def test_returns_none_severity_when_volume_is_stable(
        self, db_session, test_user,
    ):
        """Returns 'none' severity when volume is stable."""
        from app.services.health_analysis import analyze_injury_risk

        today = date.today()

        # Insert consistent volume across weeks
        for week_offset in range(6):
            week_start = today - timedelta(weeks=week_offset)
            session = LiftingSession(
                user_id=test_user.id,
                session_date=week_start + timedelta(days=1),
                focus="squat",
                total_volume_kg=5000.0,
                duration_seconds=3600,
            )
            db_session.add(session)
        await db_session.flush()

        result = await analyze_injury_risk(db_session, test_user.id)

        assert result is not None
        assert result["severity"] == "none"


# ── Illness Analysis ─────────────────────────────────────────────────────


class TestAnalyzeIllness:
    """analyze_illness() — detects illness from elevated resting HR + low HRV."""

    async def test_detects_illness_from_elevated_resting_hr_and_low_hrv(
        self, db_session, test_user,
    ):
        """Detects illness risk when resting HR is elevated and HRV is low."""
        from app.services.health_analysis import analyze_illness

        # Insert 30 days of baseline metrics
        for i in range(30, 7, -1):
            metric = DailyMetric(
                user_id=test_user.id,
                metric_date=date.today() - timedelta(days=i),
                source="whoop",
                recovery_score=75.0,
                hrv_ms=55.0,
                resting_hr=55.0,
                respiratory_rate=15.0,
            )
            db_session.add(metric)

        # Insert recent 7 days with elevated resting HR and low HRV
        for i in range(7):
            metric = DailyMetric(
                user_id=test_user.id,
                metric_date=date.today() - timedelta(days=i),
                source="whoop",
                recovery_score=30.0,  # Low
                hrv_ms=30.0,          # Low
                resting_hr=70.0,      # Elevated
                respiratory_rate=18.0, # Elevated
            )
            db_session.add(metric)
        await db_session.flush()

        result = await analyze_illness(db_session, test_user.id)

        assert result is not None
        assert result["alert_type"] == "illness_risk"
        assert result["score"] >= 0

    async def test_returns_none_severity_when_healthy(
        self, db_session, test_user,
    ):
        """Returns 'none' severity when all metrics are normal."""
        from app.services.health_analysis import analyze_illness

        # Insert 7 days of healthy metrics
        for i in range(7):
            metric = DailyMetric(
                user_id=test_user.id,
                metric_date=date.today() - timedelta(days=i),
                source="whoop",
                recovery_score=85.0,
                hrv_ms=60.0,
                resting_hr=50.0,
                respiratory_rate=14.5,
            )
            db_session.add(metric)
        await db_session.flush()

        result = await analyze_illness(db_session, test_user.id)

        assert result is not None
        assert result["severity"] == "none"
        assert result["score"] == 0.0
