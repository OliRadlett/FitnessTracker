"""8-min bucket liveness + Uth resting-HR staleness bound.

The 8-min FTP tier (``power_curve.py``) and the 8-min VO2max signal
(``vo2max.py``) key on bucket ``480`` — which was missing from
``POWER_DURATION_BUCKETS``, so no caller ever produced it. The Uth
HR estimate must ignore resting-HR readings older than 30 days.
Run with: pytest tests/integration/test_power_curve_buckets.py -m integration
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest

from app.models.activity import Activity, ActivityStream
from app.models.daily_metric import DailyMetric
from app.services.cycling.power_curve import compute_power_curve_from_streams
from app.services.cycling.prs import check_and_record_cycling_prs
from app.services.cycling.vo2max import estimate_vo2max

pytestmark = pytest.mark.integration


async def _steady_ride(db_session, user_id, seconds: int, watts: float) -> Activity:
    activity = Activity(
        user_id=user_id,
        source="strava",
        sport_type="cycling",
        name="Steady Ride",
        start_date=datetime.now(UTC) - timedelta(days=1),
        duration_seconds=seconds,
        average_power=watts,
        max_heartrate=185.0,
        provider_activity_id=f"strava_steady_{uuid.uuid4().hex[:8]}",
    )
    db_session.add(activity)
    await db_session.flush()
    db_session.add(
        ActivityStream(
            activity_id=activity.id,
            stream_type="watts",
            data={"data": [watts] * seconds},
            resolution=1,
        )
    )
    await db_session.flush()
    return activity


class TestEightMinuteBucket:
    async def test_480_bucket_present_in_curve(self, db_session, test_user):
        """A 20-min steady ride must populate the 480 s bucket."""
        await _steady_ride(db_session, test_user.id, 1200, 250.0)
        curve = await compute_power_curve_from_streams(db_session, test_user.id)
        assert curve[480] == pytest.approx(250.0)

    async def test_480_pr_label(self, db_session, test_user):
        """Per-activity PR scan records the 8-min best under label '8min'."""
        activity = await _steady_ride(db_session, test_user.id, 1200, 250.0)
        prs = await check_and_record_cycling_prs(db_session, test_user.id, activity)
        by_label = {p.duration_label: p for p in prs}
        assert by_label["8min"].power_watts == pytest.approx(250.0)


class TestUthStalenessBound:
    async def _resting_hr(self, db_session, user_id, days_ago: int):
        db_session.add(
            DailyMetric(
                user_id=user_id,
                metric_date=date.today() - timedelta(days=days_ago),
                source="whoop",
                resting_hr=60.0,
            )
        )
        await db_session.flush()

    async def test_stale_resting_hr_skips_uth(self, db_session, test_user):
        """Only a 60-day-old resting HR + HRmax but no power → no estimate."""
        await self._resting_hr(db_session, test_user.id, days_ago=60)
        db_session.add(
            Activity(
                user_id=test_user.id,
                source="strava",
                sport_type="cycling",
                name="HR Ride",
                start_date=datetime.now(UTC) - timedelta(days=1),
                duration_seconds=3600,
                average_heartrate=150.0,
                max_heartrate=185.0,
                provider_activity_id=f"strava_hr_{uuid.uuid4().hex[:8]}",
            )
        )
        await db_session.flush()
        assert await estimate_vo2max(db_session, test_user.id) is None

    async def test_recent_resting_hr_allows_uth(self, db_session, test_user):
        """HRmax 185 / rest 60 → 15.3×185/60 ≈ 47.2 via Uth."""
        await self._resting_hr(db_session, test_user.id, days_ago=1)
        db_session.add(
            Activity(
                user_id=test_user.id,
                source="strava",
                sport_type="cycling",
                name="HR Ride",
                start_date=datetime.now(UTC) - timedelta(days=1),
                duration_seconds=3600,
                average_heartrate=150.0,
                max_heartrate=185.0,
                provider_activity_id=f"strava_hr2_{uuid.uuid4().hex[:8]}",
            )
        )
        await db_session.flush()
        est = await estimate_vo2max(db_session, test_user.id)
        assert est is not None
        assert est.vo2max == pytest.approx(47.2, abs=0.5)
        assert "Uth" in est.method
