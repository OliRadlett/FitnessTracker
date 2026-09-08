"""Integration tests for §3.12 — health-alert tuning + new regeneration signals.

Exercises the three new signals (performance decline, sleep consistency,
resting-HR elevation), the per-user health preferences (disabled / snoozed /
threshold overrides), and the disabling of composite + legacy alert types.

Run with:  pytest tests/integration/test_health_preferences.py -m integration
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cycling import FtpHistory
from app.models.daily_metric import DailyMetric
from app.models.sleep import SleepLog

pytestmark = [pytest.mark.integration, pytest.mark.expensive]


def _ftp(db: AsyncSession, user_id, watts: float, days_ago: int) -> None:
    db.add(
        FtpHistory(
            user_id=user_id,
            ftp_watts=watts,
            effective_date=date.today() - timedelta(days=days_ago),
            source="manual",
        )
    )


def _sleep(db: AsyncSession, user_id, minutes: int, days_ago: int) -> None:
    db.add(
        SleepLog(
            user_id=user_id,
            sleep_date=date.today() - timedelta(days=days_ago),
            source="whoop",
            total_sleep_seconds=minutes * 60,
            sleep_efficiency=90.0,
            sleep_start=datetime.now(UTC) - timedelta(hours=10),
            sleep_end=datetime.now(UTC) - timedelta(hours=2),
        )
    )


def _rhr(db: AsyncSession, user_id, bpm: float, days_ago: int) -> None:
    db.add(
        DailyMetric(
            user_id=user_id,
            metric_date=date.today() - timedelta(days=days_ago),
            source="whoop",
            resting_hr=bpm,
            recovery_score=60.0,
        )
    )


# ── New signals ───────────────────────────────────────────────────────────


class TestPerformanceDeclineSignal:
    async def test_detects_ftp_drop(self, db_session, test_user):
        from app.services.health_analysis import (
            DEFAULT_HEALTH_THRESHOLDS,
            _analyze_performance_decline,
        )

        _ftp(db_session, test_user.id, 250.0, days_ago=60)
        _ftp(db_session, test_user.id, 255.0, days_ago=45)
        _ftp(db_session, test_user.id, 220.0, days_ago=10)
        _ftp(db_session, test_user.id, 225.0, days_ago=3)
        await db_session.flush()

        result = await _analyze_performance_decline(
            db_session, test_user.id, DEFAULT_HEALTH_THRESHOLDS["performance_decline"]
        )

        assert result["alert_type"] == "performance_decline"
        # baseline 252.5 → recent 222.5 ≈ 11.9% drop ≥ 8% → warning (not critical).
        assert result["severity"] == "warning"
        assert result["score"] > 8

    async def test_none_when_insufficient_history(self, db_session, test_user):
        from app.services.health_analysis import (
            DEFAULT_HEALTH_THRESHOLDS,
            _analyze_performance_decline,
        )

        _ftp(db_session, test_user.id, 250.0, days_ago=30)
        _ftp(db_session, test_user.id, 245.0, days_ago=3)
        await db_session.flush()

        result = await _analyze_performance_decline(
            db_session, test_user.id, DEFAULT_HEALTH_THRESHOLDS["performance_decline"]
        )

        assert result["severity"] == "none"
        assert result["evidence"]["found"] == 2

    async def test_none_when_drop_below_threshold(self, db_session, test_user):
        from app.services.health_analysis import (
            DEFAULT_HEALTH_THRESHOLDS,
            _analyze_performance_decline,
        )

        _ftp(db_session, test_user.id, 250.0, days_ago=60)
        _ftp(db_session, test_user.id, 250.0, days_ago=45)
        _ftp(db_session, test_user.id, 247.0, days_ago=10)
        _ftp(db_session, test_user.id, 248.0, days_ago=3)
        await db_session.flush()

        result = await _analyze_performance_decline(
            db_session, test_user.id, DEFAULT_HEALTH_THRESHOLDS["performance_decline"]
        )

        assert result["severity"] == "none"


class TestSleepConsistencySignal:
    async def test_detects_variable_sleep(self, db_session, test_user):
        from app.services.health_analysis import (
            DEFAULT_HEALTH_THRESHOLDS,
            _analyze_sleep_consistency,
        )

        _sleep(db_session, test_user.id, 420, days_ago=0)
        _sleep(db_session, test_user.id, 360, days_ago=1)
        _sleep(db_session, test_user.id, 540, days_ago=2)
        await db_session.flush()

        result = await _analyze_sleep_consistency(
            db_session, test_user.id, DEFAULT_HEALTH_THRESHOLDS["sleep_consistency"]
        )

        assert result["alert_type"] == "sleep_consistency"
        # pstdev of [420, 360, 540] ≈ 74.8 min ≥ 60 → warning.
        assert result["severity"] == "warning"
        assert result["score"] >= 60

    async def test_none_when_consistent(self, db_session, test_user):
        from app.services.health_analysis import (
            DEFAULT_HEALTH_THRESHOLDS,
            _analyze_sleep_consistency,
        )

        _sleep(db_session, test_user.id, 480, days_ago=0)
        _sleep(db_session, test_user.id, 490, days_ago=1)
        _sleep(db_session, test_user.id, 470, days_ago=2)
        await db_session.flush()

        result = await _analyze_sleep_consistency(
            db_session, test_user.id, DEFAULT_HEALTH_THRESHOLDS["sleep_consistency"]
        )

        assert result["severity"] == "none"

    async def test_none_when_few_nights(self, db_session, test_user):
        from app.services.health_analysis import (
            DEFAULT_HEALTH_THRESHOLDS,
            _analyze_sleep_consistency,
        )

        _sleep(db_session, test_user.id, 420, days_ago=0)
        _sleep(db_session, test_user.id, 360, days_ago=1)
        await db_session.flush()

        result = await _analyze_sleep_consistency(
            db_session, test_user.id, DEFAULT_HEALTH_THRESHOLDS["sleep_consistency"]
        )

        assert result["severity"] == "none"
        assert result["evidence"]["nights"] == 2


class TestRestingHrElevationSignal:
    async def test_detects_elevation(self, db_session, test_user):
        from app.services.health_analysis import (
            DEFAULT_HEALTH_THRESHOLDS,
            _analyze_resting_hr_elevation,
        )

        # 5 baseline readings at 52 bpm.
        for i in range(1, 6):
            _rhr(db_session, test_user.id, 52.0, days_ago=20 - i)
        # 3 recent readings at 60 bpm → elevation 8 ≥ critical 8.
        for i in range(3):
            _rhr(db_session, test_user.id, 60.0, days_ago=i)
        await db_session.flush()

        result = await _analyze_resting_hr_elevation(
            db_session, test_user.id, DEFAULT_HEALTH_THRESHOLDS["resting_hr_elevation"]
        )

        assert result["alert_type"] == "resting_hr_elevation"
        assert result["severity"] == "critical"
        assert result["evidence"]["elevation_bpm"] == 8.0

    async def test_none_when_few_readings(self, db_session, test_user):
        from app.services.health_analysis import (
            DEFAULT_HEALTH_THRESHOLDS,
            _analyze_resting_hr_elevation,
        )

        _rhr(db_session, test_user.id, 52.0, days_ago=3)
        _rhr(db_session, test_user.id, 60.0, days_ago=0)
        await db_session.flush()

        result = await _analyze_resting_hr_elevation(
            db_session, test_user.id, DEFAULT_HEALTH_THRESHOLDS["resting_hr_elevation"]
        )

        assert result["severity"] == "none"


# ── Orchestration + preferences ───────────────────────────────────────────


class TestRegenerationOrchestration:
    async def _make_triggering_data(self, db_session, test_user):
        """Creates data that triggers all three signals on default thresholds."""
        _ftp(db_session, test_user.id, 250.0, days_ago=60)
        _ftp(db_session, test_user.id, 255.0, days_ago=45)
        _ftp(db_session, test_user.id, 220.0, days_ago=10)
        _ftp(db_session, test_user.id, 225.0, days_ago=3)
        _sleep(db_session, test_user.id, 420, days_ago=0)
        _sleep(db_session, test_user.id, 360, days_ago=1)
        _sleep(db_session, test_user.id, 540, days_ago=2)
        for i in range(1, 6):
            _rhr(db_session, test_user.id, 52.0, days_ago=20 - i)
        for i in range(3):
            _rhr(db_session, test_user.id, 60.0, days_ago=i)
        await db_session.flush()

    async def test_all_signals_fire_on_defaults(self, db_session, test_user):
        from app.services.health_analysis import analyze_regeneration_signals

        await self._make_triggering_data(db_session, test_user)

        results = await analyze_regeneration_signals(db_session, test_user.id)

        by_type = {r["alert_type"]: r for r in results}
        assert by_type["performance_decline"]["severity"] == "warning"
        assert by_type["sleep_consistency"]["severity"] == "warning"
        assert by_type["resting_hr_elevation"]["severity"] == "critical"

    async def test_disabled_types_are_silent(self, db_session, test_user):
        from app.services.health_analysis import (
            analyze_regeneration_signals,
            set_health_preferences,
        )

        await self._make_triggering_data(db_session, test_user)
        await set_health_preferences(
            db_session,
            test_user,
            {"disabled": ["performance_decline", "resting_hr_elevation"]},
        )

        results = await analyze_regeneration_signals(db_session, test_user.id)

        by_type = {r["alert_type"]: r for r in results}
        assert by_type["performance_decline"]["severity"] == "none"
        assert by_type["resting_hr_elevation"]["severity"] == "none"
        assert by_type["performance_decline"]["evidence"].get("disabled") is True
        assert by_type["sleep_consistency"]["severity"] == "warning"

    async def test_snoozed_types_are_silent(self, db_session, test_user):
        from app.services.health_analysis import (
            analyze_regeneration_signals,
            set_health_preferences,
        )

        await self._make_triggering_data(db_session, test_user)
        snooze_until = (date.today() + timedelta(days=1)).isoformat()
        await set_health_preferences(
            db_session,
            test_user,
            {"snoozed": {"sleep_consistency": snooze_until}},
        )

        results = await analyze_regeneration_signals(db_session, test_user.id)

        by_type = {r["alert_type"]: r for r in results}
        assert by_type["sleep_consistency"]["severity"] == "none"
        assert (
            by_type["sleep_consistency"]["evidence"].get("snoozed_until")
            == snooze_until
        )

    async def test_snooze_expired_does_not_block(self, db_session, test_user):
        from app.services.health_analysis import (
            analyze_regeneration_signals,
            set_health_preferences,
        )

        await self._make_triggering_data(db_session, test_user)
        await set_health_preferences(
            db_session,
            test_user,
            {
                "snoozed": {
                    "performance_decline": (
                        date.today() - timedelta(days=1)
                    ).isoformat()
                }
            },
        )

        results = await analyze_regeneration_signals(db_session, test_user.id)

        by_type = {r["alert_type"]: r for r in results}
        assert by_type["performance_decline"]["severity"] == "warning"

    async def test_threshold_override_alters_severity(self, db_session, test_user):
        from app.services.health_analysis import (
            analyze_regeneration_signals,
            set_health_preferences,
        )

        await self._make_triggering_data(db_session, test_user)
        # Raise the decline threshold so the ~12% drop no longer qualifies.
        await set_health_preferences(
            db_session,
            test_user,
            {
                "thresholds": {
                    "performance_decline": {"drop_pct": 30.0, "critical_pct": 40.0}
                }
            },
        )

        results = await analyze_regeneration_signals(db_session, test_user.id)

        by_type = {r["alert_type"]: r for r in results}
        assert by_type["performance_decline"]["severity"] == "none"

    async def test_lowering_threshold_intensifies(self, db_session, test_user):
        from app.services.health_analysis import (
            analyze_regeneration_signals,
            set_health_preferences,
        )

        await self._make_triggering_data(db_session, test_user)
        # 8% resting-HR elevation becomes warning (default critical is 8).
        await set_health_preferences(
            db_session,
            test_user,
            {"thresholds": {"resting_hr_elevation": {"bpm": 2.0, "critical_bpm": 9.0}}},
        )

        results = await analyze_regeneration_signals(db_session, test_user.id)

        by_type = {r["alert_type"]: r for r in results}
        assert by_type["resting_hr_elevation"]["severity"] == "warning"


class TestHealthPreferencesHelpers:
    async def test_defaults_and_roundtrip(self, db_session, test_user):
        from app.services.health_analysis import (
            DEFAULT_HEALTH_THRESHOLDS,
            get_health_preferences,
            set_health_preferences,
        )

        prefs = get_health_preferences(test_user)
        assert prefs["disabled"] == []
        assert prefs["snoozed"] == {}
        for t, spec in DEFAULT_HEALTH_THRESHOLDS.items():
            assert prefs["thresholds"][t] == spec

        await set_health_preferences(
            db_session,
            test_user,
            {
                "disabled": ["overtraining", "bogus_type"],
                "snoozed": {"hrv_drop": "not-a-date", "sleep_decline": "2030-01-01"},
                "thresholds": {
                    "sleep_consistency": {"stddev_min": 30, "junk": 1},
                },
            },
        )

        prefs = get_health_preferences(test_user)
        # Invalid types / dates / fields are dropped.
        assert prefs["disabled"] == ["overtraining"]
        assert prefs["snoozed"] == {"sleep_decline": "2030-01-01"}
        assert prefs["thresholds"]["sleep_consistency"] == {
            "stddev_min": 30.0,
            "critical_stddev_min": 120.0,
        }
