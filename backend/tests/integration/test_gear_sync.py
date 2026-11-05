"""Resolving `activities.raw_data["gear_id"]` into rows, without hammering Strava.

Strava's ``gear_id`` has always been in the stored payload; this is the half that
turns it into a query and keeps the read bucket intact. The properties worth
pinning are the ones a future refactor would break silently:

* the second run of the same sync makes **no** API call and links nothing new;
* a distance older than the TTL is refreshed, a fresh one is not;
* a provider failure leaves the rides untouched (`gear_id` stays NULL) instead of
  failing the sync;
* an activity whose gear was cleared (empty string) is not linked.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models.activity import Activity
from app.models.gear import Gear
from app.services import gear as gear_service

pytestmark = pytest.mark.integration

PAYLOAD = {
    "id": "b123",
    "name": "Canyon Endurace",
    "brand_name": "Canyon",
    "model_name": "Endurace",
    "frame_type": 3,
    "distance": 1_234_567.8,
}


def _connection() -> SimpleNamespace:
    return SimpleNamespace(provider="strava", access_token="token")


async def _ride(db_session, user_id, gear_id: str | None, name: str) -> Activity:
    activity = Activity(
        user_id=user_id,
        source="strava",
        sport_type="cycling",
        name=name,
        start_date=datetime.now(UTC) - timedelta(days=2),
        duration_seconds=3600,
        raw_data={"gear_id": gear_id} if gear_id is not None else {},
        provider_activity_id=f"ride_{uuid.uuid4().hex[:8]}",
    )
    db_session.add(activity)
    await db_session.flush()
    return activity


class TestSyncStravaGear:
    async def test_creates_gear_and_links_every_ride(
        self, db_session, test_user, monkeypatch
    ):
        calls: list[str] = []

        async def fake_get_gear(token, gear_id):
            calls.append(gear_id)
            return PAYLOAD

        monkeypatch.setattr(gear_service.strava_client, "get_gear", fake_get_gear)

        r1 = await _ride(db_session, test_user.id, "b123", "Morning ride")
        r2 = await _ride(db_session, test_user.id, "b123", "Evening ride")

        stats = await gear_service.sync_strava_gear(
            db_session, test_user.id, _connection()
        )

        assert stats == {"gears": 1, "linked": 2, "refreshed": 0, "errors": 0}
        assert calls == ["b123"]

        gear = (
            await db_session.execute(
                select(Gear).where(Gear.user_id == test_user.id)
            )
        ).scalar_one()
        assert gear.name == "Canyon Endurace"
        assert gear.kind == "bike"
        assert gear.distance_meters == pytest.approx(1_234_567.8)

        await db_session.refresh(r1)
        await db_session.refresh(r2)
        assert r1.gear_id == gear.id
        assert r2.gear_id == gear.id

    async def test_second_run_makes_no_call_and_links_nothing(
        self, db_session, test_user, monkeypatch
    ):
        calls: list[str] = []

        async def fake_get_gear(token, gear_id):
            calls.append(gear_id)
            return PAYLOAD

        monkeypatch.setattr(gear_service.strava_client, "get_gear", fake_get_gear)
        await _ride(db_session, test_user.id, "b123", "Ride")
        await gear_service.sync_strava_gear(db_session, test_user.id, _connection())

        stats = await gear_service.sync_strava_gear(
            db_session, test_user.id, _connection()
        )

        assert calls == ["b123"]  # not refetched — the distance is fresh
        assert stats["gears"] == 0
        assert stats["linked"] == 0
        assert stats["refreshed"] == 0

    async def test_stale_distance_is_refreshed(
        self, db_session, test_user, monkeypatch
    ):
        gear = Gear(
            user_id=test_user.id,
            provider="strava",
            provider_gear_id="b123",
            name="Old name",
            kind="bike",
            distance_meters=1_000.0,
            distance_synced_at=datetime.now(UTC) - timedelta(days=3),
        )
        db_session.add(gear)
        await db_session.flush()
        await _ride(db_session, test_user.id, "b123", "Ride")

        async def fake_get_gear(token, gear_id):
            return {**PAYLOAD, "distance": 2_000_000.0}

        monkeypatch.setattr(gear_service.strava_client, "get_gear", fake_get_gear)

        stats = await gear_service.sync_strava_gear(
            db_session, test_user.id, _connection()
        )

        assert stats["refreshed"] == 1
        await db_session.refresh(gear)
        assert gear.distance_meters == pytest.approx(2_000_000.0)

    async def test_provider_failure_leaves_rides_alone(
        self, db_session, test_user, monkeypatch
    ):
        async def failing_get_gear(token, gear_id):
            raise RuntimeError("429 Too Many Requests")

        monkeypatch.setattr(gear_service.strava_client, "get_gear", failing_get_gear)
        ride = await _ride(db_session, test_user.id, "b123", "Ride")

        stats = await gear_service.sync_strava_gear(
            db_session, test_user.id, _connection()
        )

        assert stats["errors"] == 1
        assert stats["linked"] == 0
        await db_session.refresh(ride)
        assert ride.gear_id is None  # retried on a later sync

    async def test_cleared_gear_is_not_linked(self, db_session, test_user, monkeypatch):
        """Strava sends an empty string when the athlete removes the gear."""
        calls: list[str] = []

        async def fake_get_gear(token, gear_id):
            calls.append(gear_id)
            return PAYLOAD

        monkeypatch.setattr(gear_service.strava_client, "get_gear", fake_get_gear)
        ride = await _ride(db_session, test_user.id, "", "No gear")

        stats = await gear_service.sync_strava_gear(
            db_session, test_user.id, _connection()
        )

        assert calls == []
        assert stats["gears"] == 0
        await db_session.refresh(ride)
        assert ride.gear_id is None

    async def test_an_activity_without_a_gear_key_is_ignored(
        self, db_session, test_user, monkeypatch
    ):
        async def fake_get_gear(token, gear_id):  # pragma: no cover
            raise AssertionError("no gear id, no call")

        monkeypatch.setattr(gear_service.strava_client, "get_gear", fake_get_gear)
        await _ride(db_session, test_user.id, None, "Trainer ride")

        stats = await gear_service.sync_strava_gear(
            db_session, test_user.id, _connection()
        )

        assert stats == {"gears": 0, "linked": 0, "refreshed": 0, "errors": 0}
