"""Cycling PR paths must preserve zero-watt samples and honor resolution.

Regression tests for the run-2 finding: ``prs.py`` dropped zero watts and
ignored ``ActivityStream.resolution``, inflating best-power PRs relative to
``compute_power_curve_from_streams``. Run with:
pytest tests/integration/test_cycling_pr_zeros.py -m integration
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.models.activity import Activity, ActivityStream
from app.services.cycling.power_curve import compute_power_curve_from_streams
from app.services.cycling.prs import (
    check_and_record_cycling_prs,
    compute_activity_power_curve,
)

pytestmark = pytest.mark.integration


async def _add_ride(db_session, user_id, samples, resolution=1) -> Activity:
    activity = Activity(
        user_id=user_id,
        source="strava",
        sport_type="cycling",
        name="Coasty Ride",
        start_date=datetime.now(UTC) - timedelta(days=1),
        duration_seconds=len(samples) * (resolution or 1),
        average_power=150.0,
        provider_activity_id="strava_coast_1",
    )
    db_session.add(activity)
    await db_session.flush()
    db_session.add(
        ActivityStream(
            activity_id=activity.id,
            stream_type="watts",
            data={"data": samples},
            resolution=resolution,
        )
    )
    await db_session.flush()
    return activity


class TestZeroPreservingPrCurve:
    async def test_coasting_does_not_inflate_best_power(self, db_session, test_user):
        """120 s alternating 10 s @300 W / 10 s coast → true best 60 s = 150,
        not 300 (zeros stripped would make the 60 nonzero samples contiguous)."""
        samples = ([300.0] * 10 + [0.0] * 10) * 6
        activity = await _add_ride(db_session, test_user.id, samples)

        curve = await compute_activity_power_curve(db_session, activity.id)
        assert curve[60] == pytest.approx(150.0, abs=1.0)

        main = await compute_power_curve_from_streams(db_session, test_user.id)
        assert main[60] == pytest.approx(curve[60], abs=1.0)

        prs = await check_and_record_cycling_prs(db_session, test_user.id, activity)
        by_label = {p.duration_label: p for p in prs}
        assert by_label["1min"].power_watts == pytest.approx(150.0, abs=1.0)

    async def test_resolution_scales_windows(self, db_session, test_user):
        """6 samples @300 W with resolution=10 (60 s of data) → best 60 s =
        300 using a 6-sample window; the 120 s bucket must be absent."""
        activity = await _add_ride(db_session, test_user.id, [300.0] * 6, resolution=10)
        curve = await compute_activity_power_curve(db_session, activity.id)
        assert curve[60] == pytest.approx(300.0)
        assert 120 not in curve
