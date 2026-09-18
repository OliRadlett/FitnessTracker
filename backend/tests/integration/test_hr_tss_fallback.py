"""hrTSS fallback: power-meter-less rides must still accrue training load.

``auto_compute_tss_for_activity`` computes power TSS when FTP+power exist and
falls back to ``calculate_hr_tss`` (needs profile LTHR + resting HR from the
last 30 days). Run with:
pytest tests/integration/test_hr_tss_fallback.py -m integration
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest

from app.models.activity import Activity
from app.models.cycling import CyclingProfile
from app.models.daily_metric import DailyMetric
from app.services.cycling.tss import auto_compute_tss_for_activity

pytestmark = pytest.mark.integration


async def _hr_only_ride(db_session, user_id) -> Activity:
    activity = Activity(
        user_id=user_id,
        source="strava",
        sport_type="cycling",
        name="HR-only Ride",
        start_date=datetime.now(UTC) - timedelta(days=1),
        duration_seconds=3600,
        average_heartrate=150.0,
        provider_activity_id=f"strava_hr_{uuid.uuid4().hex[:8]}",
    )
    db_session.add(activity)
    await db_session.flush()
    return activity


async def _profile_with_lthr(db_session, user_id) -> CyclingProfile:
    profile = CyclingProfile(
        user_id=user_id, ftp_watts=None, lactate_threshold_hr=170.0
    )
    db_session.add(profile)
    await db_session.flush()
    return profile


async def _recent_resting_hr(db_session, user_id, days_ago=1) -> DailyMetric:
    metric = DailyMetric(
        user_id=user_id,
        metric_date=date.today() - timedelta(days=days_ago),
        source="whoop",
        resting_hr=58.0,
    )
    db_session.add(metric)
    await db_session.flush()
    return metric


class TestHrTssFallback:
    async def test_hr_only_ride_gets_tss(self, db_session, test_user):
        """1 h @150 avg / LTHR 170 / rest 58 → ((92/112)²)×100 ≈ 67.5."""
        await _profile_with_lthr(db_session, test_user.id)
        await _recent_resting_hr(db_session, test_user.id)
        activity = await _hr_only_ride(db_session, test_user.id)

        tss = await auto_compute_tss_for_activity(db_session, activity, ftp=None)

        assert tss == pytest.approx(67.5, abs=0.5)
        assert activity.tss == pytest.approx(67.5, abs=0.5)

    async def test_missing_lthr_yields_none(self, db_session, test_user):
        """No LTHR → no fabricated load."""
        await _recent_resting_hr(db_session, test_user.id)
        activity = await _hr_only_ride(db_session, test_user.id)

        assert await auto_compute_tss_for_activity(db_session, activity, None) is None
        assert activity.tss is None

    async def test_stale_resting_hr_yields_none(self, db_session, test_user):
        """A 60-day-old resting HR must not feed hrTSS."""
        await _profile_with_lthr(db_session, test_user.id)
        await _recent_resting_hr(db_session, test_user.id, days_ago=60)
        activity = await _hr_only_ride(db_session, test_user.id)

        assert await auto_compute_tss_for_activity(db_session, activity, None) is None
        assert activity.tss is None

    async def test_power_path_still_preferred(self, db_session, test_user):
        """FTP + normalized power → power TSS (hrTSS must not override)."""
        profile = await _profile_with_lthr(db_session, test_user.id)
        profile.ftp_watts = 250.0
        await _recent_resting_hr(db_session, test_user.id)
        activity = await _hr_only_ride(db_session, test_user.id)
        activity.normalized_power = 200.0

        tss = await auto_compute_tss_for_activity(db_session, activity, 250.0)

        # 1 h @200/250 → IF 0.8 → 64.0
        assert tss == pytest.approx(64.0, abs=0.5)
