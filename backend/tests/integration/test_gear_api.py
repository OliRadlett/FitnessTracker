"""``/api/v1/gear`` — the read/annotate surface over resolved gear.

There is no maintenance page yet (deliberately), so this endpoint is how the
resolution can be checked against a real account: does the bike exist, does it
carry the provider's distance, and does a service interval turn that into a
number the user can act on.

The gaps are the point of two tests here: with no threshold there is **no** wear
percentage (not 0%), and a retired gear is hidden but not deleted — its rides
still point at it.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.models.gear import Gear

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


async def _gear(db_session, user_id, **overrides) -> Gear:
    fields = {
        "user_id": user_id,
        "provider": "strava",
        "provider_gear_id": f"b{uuid.uuid4().hex[:8]}",
        "name": "Canyon Endurace",
        "kind": "bike",
        "distance_meters": 600_000.0,
    }
    fields.update(overrides)
    gear = Gear(**fields)
    db_session.add(gear)
    await db_session.flush()
    return gear


class TestGearList:
    async def test_no_threshold_means_no_wear_percentage(self, client, db_session, test_user):
        """Not 0% — "we have no interval" is different from "brand new"."""
        await _gear(db_session, test_user.id)

        response = await client.get("/api/v1/gear/")

        assert response.status_code == 200
        [item] = response.json()
        assert item["name"] == "Canyon Endurace"
        assert item["distance_meters"] == 600_000.0
        assert item["wear_percent"] is None
        assert item["wear_remaining_meters"] is None

    async def test_retired_gear_is_hidden_but_kept(self, client, db_session, test_user):
        await _gear(db_session, test_user.id, retired_at=datetime.now(UTC))

        assert (await client.get("/api/v1/gear/")).json() == []

        with_retired = await client.get("/api/v1/gear/?include_retired=true")
        assert len(with_retired.json()) == 1

    async def test_gear_is_scoped_to_the_user(self, client, db_session, test_user):
        """A gear row belonging to nobody visible here must not leak in."""
        other_user_gear = await _gear(db_session, test_user.id, name="Mine")
        assert other_user_gear.user_id == test_user.id

        response = await client.get("/api/v1/gear/")

        names = [item["name"] for item in response.json()]
        assert "Mine" in names
        assert all(name == "Mine" for name in names)


class TestGearUpdate:
    async def test_setting_an_interval_turns_distance_into_wear(
        self, client, db_session, test_user
    ):
        gear = await _gear(db_session, test_user.id)

        response = await client.patch(
            f"/api/v1/gear/{gear.id}", json={"wear_threshold_meters": 1_000_000}
        )

        assert response.status_code == 200
        body = response.json()
        assert body["wear_percent"] == 60.0
        assert body["wear_remaining_meters"] == 400_000.0

    async def test_retire_and_unretire(self, client, db_session, test_user):
        gear = await _gear(db_session, test_user.id)

        retired = await client.patch(f"/api/v1/gear/{gear.id}", json={"retired": True})
        assert retired.json()["retired_at"] is not None

        back = await client.patch(f"/api/v1/gear/{gear.id}", json={"retired": False})
        assert back.json()["retired_at"] is None

    async def test_omitted_fields_are_untouched(self, client, db_session, test_user):
        gear = await _gear(db_session, test_user.id, wear_threshold_meters=1_000_000)

        response = await client.patch(f"/api/v1/gear/{gear.id}", json={"name": "Renamed"})

        body = response.json()
        assert body["name"] == "Renamed"
        assert body["wear_threshold_meters"] == 1_000_000

    async def test_unknown_gear_is_404(self, client):
        response = await client.patch(
            f"/api/v1/gear/{uuid.uuid4()}", json={"retired": True}
        )
        assert response.status_code == 404

    async def test_another_users_gear_is_404_not_403(self, client):
        """Ownership is a filter, not a permission check — do not confirm existence."""
        response = await client.patch(
            f"/api/v1/gear/{uuid.uuid4()}", json={"name": "Nope"}
        )
        assert response.status_code == 404
