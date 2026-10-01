"""TSS for imported activities.

Every provider sync computes TSS on write (``strava/sync.py``,
``services/wahoo.py``, ``strava/webhooks.py``) and ``backfill_lifting_tss``
covers strength work — but nothing covered file imports. ``import_fit`` parsed
the file correctly, stored the power streams, and then left ``tss=NULL``; since
every load consumer skips null-tss rows (``services/analytics.py``), an imported
ride contributed nothing to weekly TSS, CTL/ATL, or the recommendation engines.

The parse is mocked rather than fed a real FIT binary (``fitparse`` is
read-only, so there is no in-repo encoder), which keeps the test focused on the
seam that was broken: the write path must end with a TSS.
"""

from __future__ import annotations

import sys
import types
from datetime import UTC, date, datetime, timedelta
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.models.activity import Activity
from app.services.cycling import backfill_manual_activity_tss

# A realistic ``parse_fit_file`` return: one hour at a steady 200 W with NP 220.
PARSED_FIT: dict = {
    "session": {
        "name": "Imported Test Ride",
        "sport_type": "cycling",
        "start_time": datetime.now(UTC) - timedelta(days=3),
        "duration_seconds": 3600,
        "distance_meters": 30000.0,
        "elevation_gain_meters": 250.0,
        "average_heartrate": 140.0,
        "max_heartrate": 165.0,
        "average_power": 200.0,
        "normalized_power": 220.0,
        "average_speed": 8.33,
        "average_cadence": 85.0,
        "calories": 800.0,
        "record_count": 3600,
    },
    "streams": {
        "heartrate": [140.0] * 3600,
        "power": [200.0] * 3600,
        "cadence": [85.0] * 3600,
        "altitude": [100.0] * 3600,
        "enhanced_speed": [8.33] * 3600,
        "position_lat": [51.5] * 3600,
        "position_long": [-0.12] * 3600,
    },
}


async def _import_fit(client) -> dict:
    """POST a FIT upload with the parser stubbed. Returns the response JSON.

    ``import_fit`` imports the parser lazily inside the handler, and the real
    module needs ``fitparse`` — a Cython package whose wheel does not build on
    Windows, so it is absent from a Windows dev checkout (CI is Linux and has
    it). Substituting a stub module keeps this test runnable on every platform
    and keeps the focus on the seam that was actually broken: the write path must
    end with a TSS.
    """
    stub = types.ModuleType("app.services.fit_parser")
    stub.parse_fit_file = lambda raw: PARSED_FIT
    with patch.dict(sys.modules, {"app.services.fit_parser": stub}):
        resp = await client.post(
            "/api/v1/activities/import-fit",
            files={
                "file": (
                    "ride.fit",
                    b"not-a-real-fit-binary",
                    "application/octet-stream",
                )
            },
        )
    assert resp.status_code == 200, resp.text
    return resp.json()


# ── The import path computes TSS ─────────────────────────────────────────────


class TestImportComputesTss:
    async def test_imported_activity_has_tss(self, client, db_session, test_cycling_profile):
        """The regression: this used to persist tss=NULL."""
        body = await _import_fit(client)

        assert body["tss"] is not None, "imported activity must carry a TSS"
        assert body["tss"] > 0
        assert body["tss_source"] == "power"

    async def test_tss_computed_from_fit_normalized_power(
        self, client, db_session, test_cycling_profile
    ):
        """FIT's own NP is preferred over recomputing from the samples."""
        from app.services.cycling.tss import calculate_power_tss

        body = await _import_fit(client)

        # 1h at NP 220 with FTP 250 -> IF 0.88, TSS = 3600 * 0.88 / (250 * 0.88) * 100
        expected = calculate_power_tss(3600, 220.0, test_cycling_profile.ftp_watts)
        assert body["tss"] == pytest.approx(expected, rel=1e-6)

    async def test_imported_activity_visible_to_daily_tss(
        self, client, db_session, test_user, test_cycling_profile
    ):
        """The property that motivated the fix: it must count for load.

        ``get_daily_tss`` is what feeds CTL/ATL and the recommendation engines,
        so a TSS that is set but invisible would not be a fix.
        """
        from app.services.cycling.tss import get_daily_tss

        body = await _import_fit(client)
        day = date.fromisoformat(body["start_date"][:10])

        daily = await get_daily_tss(
            db_session, test_user.id, day - timedelta(days=1), day + timedelta(days=1)
        )

        assert daily.get(day, 0) > 0, f"imported ride absent from daily TSS for {day}"

    async def test_streams_still_persisted(
        self, client, db_session, test_cycling_profile
    ):
        """TSS computation must not disturb stream persistence."""
        from app.models.activity import ActivityStream

        await _import_fit(client)

        result = await db_session.execute(select(ActivityStream))
        types_present = {s.stream_type for s in result.scalars().all()}
        assert "power" in types_present
        assert "heartrate" in types_present


# ── Backfill for activities stranded before the fix ─────────────────────────


def _stranded_import(user, **overrides) -> Activity:
    base = {
        "user_id": user.id,
        "source": "manual",
        "sport_type": "cycling",
        "name": "Old Import",
        "start_date": datetime.now(UTC) - timedelta(days=30),
        "duration_seconds": 3600,
        "distance_meters": 30000.0,
        "average_power": 200.0,
        "normalized_power": 220.0,
        "average_heartrate": 140.0,
        "tss": None,
    }
    base.update(overrides)
    return Activity(**base)


class TestBackfillManualActivityTss:
    async def test_fills_stranded_import(
        self, db_session, test_user, test_cycling_profile
    ):
        activity = _stranded_import(test_user)
        db_session.add(activity)
        await db_session.flush()

        count = await backfill_manual_activity_tss(db_session, test_user.id)

        assert count == 1
        await db_session.refresh(activity)
        assert activity.tss is not None and activity.tss > 0
        assert activity.tss_source == "power"

    async def test_is_idempotent(
        self, db_session, test_user, test_cycling_profile
    ):
        """A repeat run must find nothing, not recompute and churn."""
        activity = _stranded_import(test_user)
        db_session.add(activity)
        await db_session.flush()

        first = await backfill_manual_activity_tss(db_session, test_user.id)
        second = await backfill_manual_activity_tss(db_session, test_user.id)

        assert first == 1
        assert second == 0

    async def test_leaves_existing_tss_alone(
        self, db_session, test_user, test_cycling_profile
    ):
        """A row that already has a TSS must not be overwritten."""
        activity = _stranded_import(test_user, tss=42.0, tss_source="provider")
        db_session.add(activity)
        await db_session.flush()

        count = await backfill_manual_activity_tss(db_session, test_user.id)

        assert count == 0
        await db_session.refresh(activity)
        assert activity.tss == 42.0
        assert activity.tss_source == "provider"

    async def test_skips_provider_synced_activities(
        self, db_session, test_user, test_cycling_profile
    ):
        """Scope is source='manual' — a provider row is never this task's business."""
        activity = _stranded_import(test_user, source="strava")
        db_session.add(activity)
        await db_session.flush()

        count = await backfill_manual_activity_tss(db_session, test_user.id)

        assert count == 0
        await db_session.refresh(activity)
        assert activity.tss is None

    async def test_no_stranded_rows_returns_zero(
        self, db_session, test_user, test_cycling_profile
    ):
        assert await backfill_manual_activity_tss(db_session, test_user.id) == 0

    async def test_import_while_ftp_unset_defers_to_backfill(
        self, client, db_session, test_user, test_cycling_profile
    ):
        """No FTP and no usable HR inputs -> no TSS at import, filled in later.

        This is why the backfill is scheduled rather than run once: a user who
        imports history before configuring FTP gets nothing on the write path,
        and setting FTP later does not retroactively fix the import.
        """
        from app.models.cycling import CyclingProfile

        profile = await db_session.get(CyclingProfile, test_cycling_profile.id)
        profile.ftp_watts = None
        profile.lactate_threshold_hr = None
        await db_session.flush()

        body = await _import_fit(client)
        assert body["tss"] is None

        # FTP arrives later.
        profile.ftp_watts = 250.0
        await db_session.flush()

        assert await backfill_manual_activity_tss(db_session, test_user.id) == 1
