"""The weather-correlation sample must not include estimated power.

Strava infers watts from heart rate when a ride has no meter. Heart rate also
rises with heat. Put those two facts in a regression of power against
temperature and heart rate sits on both sides of it, so the fit can produce a
"temperature costs you power" coefficient that is really "temperature raised
your HR, and your HR is what the watts were made of".

This is the one place provenance is *filtered* rather than merely labelled. It
is a sample, not stored history: nothing is rewritten, no ride loses its data,
and the task logs how many rides it excluded so a shrinking sample is visible
rather than silent.

TSS is deliberately not filtered. Excluding an estimate's load would delete
CTL/ATL history for anyone without a meter, and the score is already labelled by
``tss_source`` + ``power_provenance``.

The NULL case matters most: every activity synced before migration 107 has
``power_provenance IS NULL``. A filter that dropped NULLs would silently discard
the entire history of anyone who has not re-synced — which is why the predicate
is ``IS DISTINCT FROM`` and why this test seeds an unclassified row.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.models.activity import Activity
from app.services.power_provenance import (
    POWER_ESTIMATED,
    POWER_MEASURED,
    measured_power_clause,
)

pytestmark = pytest.mark.integration


async def _ride(db_session, user_id, *, name: str, provenance: str | None) -> Activity:
    """A qualifying weather-sample ride with the given provenance."""
    activity = Activity(
        user_id=user_id,
        source="strava",
        sport_type="cycling",
        name=name,
        start_date=datetime.now(UTC) - timedelta(days=3),
        duration_seconds=3600,
        average_power=200.0,
        weather_temperature=15.0,
        power_provenance=provenance,
        provider_activity_id=f"prov_{uuid.uuid4().hex[:8]}",
    )
    db_session.add(activity)
    await db_session.flush()
    return activity


def _sample_query(user_id):
    """The same predicate the weather task applies (minus the 200-row cap)."""
    return select(Activity.name).where(
        Activity.user_id == user_id,
        Activity.sport_type == "cycling",
        Activity.weather_temperature.isnot(None),
        Activity.average_power.isnot(None),
        measured_power_clause(),
        Activity.duration_seconds >= 600,
    )


class TestWeatherSample:
    async def test_excludes_estimated_power(self, db_session, test_user):
        await _ride(db_session, test_user.id, name="estimated", provenance=POWER_ESTIMATED)
        await _ride(db_session, test_user.id, name="measured", provenance=POWER_MEASURED)

        rows = (await db_session.execute(_sample_query(test_user.id))).scalars().all()

        assert rows == ["measured"]

    async def test_keeps_unclassified_rows(self, db_session, test_user):
        """Rows synced before migration 107 are unclassified, not estimated.

        Dropping them would silently discard the whole pre-provenance history —
        the failure mode a plain ``!= 'estimated'`` would produce.
        """
        await _ride(db_session, test_user.id, name="unknown", provenance=None)
        await _ride(db_session, test_user.id, name="estimated", provenance=POWER_ESTIMATED)

        rows = (await db_session.execute(_sample_query(test_user.id))).scalars().all()

        assert rows == ["unknown"]

    async def test_exclusion_count_matches_what_was_removed(self, db_session, test_user):
        """The task logs this number; it must describe the same population.

        Two measured, one estimated, one unclassified — so the filter removes one
        and the sample keeps three.
        """
        await _ride(db_session, test_user.id, name="m1", provenance=POWER_MEASURED)
        await _ride(db_session, test_user.id, name="m2", provenance=POWER_MEASURED)
        await _ride(db_session, test_user.id, name="est", provenance=POWER_ESTIMATED)
        await _ride(db_session, test_user.id, name="unk", provenance=None)

        kept = (await db_session.execute(_sample_query(test_user.id))).scalars().all()
        excluded = await db_session.scalar(
            select(func.count(Activity.id)).where(
                Activity.user_id == test_user.id,
                Activity.sport_type == "cycling",
                Activity.weather_temperature.isnot(None),
                Activity.average_power.isnot(None),
                Activity.power_provenance == POWER_ESTIMATED,
                Activity.duration_seconds >= 600,
            )
        )

        assert sorted(kept) == ["m1", "m2", "unk"]
        assert excluded == 1
