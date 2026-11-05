"""Mirroring a weigh-in onto the Wahoo profile.

Wahoo estimates calories and W/kg from the weight stored on *its* profile, and
nothing here has ever written it — so the head unit has been using whatever was
typed when the account was created. Same failure shape as the zone sync: the
device holds its own copy of a number we own.

Every branch below is a decision that could silently become wrong:

* **No connection** is a no-op, not an error — most users have no Wahoo account.
* **No weigh-in** means there is nothing to mirror; pushing the profile's own
  value back would be a write with no information in it.
* **Within tolerance** skips the write. Scale readings drift by tenths; Wahoo's
  field is a profile, not a log.
* **Failures never raise.** The trigger is a weigh-in sync, and losing a genuine
  measurement because a third-party profile write failed would be the wrong
  trade in both directions.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest

from app.models.user import OAuthConnection
from app.models.weight import WeightLog
from app.services.wahoo import (
    WAHOO_WEIGHT_TOLERANCE_KG,
    push_weight_to_wahoo,
)

pytestmark = pytest.mark.integration


async def _connection(db_session, user_id) -> OAuthConnection:
    connection = OAuthConnection(
        user_id=user_id,
        provider="wahoo",
        access_token="access-token",
        refresh_token="refresh-token",
        provider_user_id="wahoo-1",
    )
    db_session.add(connection)
    await db_session.flush()
    return connection


async def _weigh_in(db_session, user_id, kg: float) -> WeightLog:
    row = WeightLog(
        user_id=user_id,
        date=date.today(),
        weight_kilogram=kg,
        source="withings",
    )
    db_session.add(row)
    await db_session.flush()
    return row


class _Client:
    """Records calls and returns canned Wahoo responses."""

    def __init__(self, profile_weight: str | None = "78.5000") -> None:
        self.profile_weight = profile_weight
        self.get_calls = 0
        self.updates: list[float] = []
        self.get_error: Exception | None = None
        self.update_error: Exception | None = None

    async def get_user(self, token):
        self.get_calls += 1
        if self.get_error:
            raise self.get_error
        return {"id": 1, "weight": self.profile_weight}

    async def update_user(self, token, *, weight_kg=None, height_m=None):
        if self.update_error:
            raise self.update_error
        self.updates.append(weight_kg)
        return {"id": 1, "weight": f"{weight_kg:.2f}"}


@pytest.fixture
def client(monkeypatch):
    fake = _Client()
    monkeypatch.setattr("app.services.wahoo.wahoo_client.get_user", fake.get_user)
    monkeypatch.setattr("app.services.wahoo.wahoo_client.update_user", fake.update_user)
    return fake


class TestPushWeight:
    async def test_no_wahoo_connection_is_a_no_op(self, db_session, test_user, client):
        await _weigh_in(db_session, test_user.id, 80.0)

        result = await push_weight_to_wahoo(db_session, test_user.id)

        assert result == {"pushed": False, "reason": "no_connection"}
        assert client.get_calls == 0

    async def test_no_weigh_in_pushes_nothing(self, db_session, test_user, client):
        await _connection(db_session, test_user.id)

        result = await push_weight_to_wahoo(db_session, test_user.id)

        assert result["reason"] == "no_weight"
        assert client.updates == []

    async def test_within_tolerance_does_not_write(self, db_session, test_user, client):
        """78.5 kg on the profile, 78.6 kg on the scale is not a change."""
        await _connection(db_session, test_user.id)
        await _weigh_in(db_session, test_user.id, 78.5 + WAHOO_WEIGHT_TOLERANCE_KG / 2)

        result = await push_weight_to_wahoo(db_session, test_user.id)

        assert result["reason"] == "unchanged"
        assert client.updates == []

    async def test_a_real_change_is_written(self, db_session, test_user, client):
        await _connection(db_session, test_user.id)
        await _weigh_in(db_session, test_user.id, 76.2)

        result = await push_weight_to_wahoo(db_session, test_user.id)

        assert result["pushed"] is True
        assert result["weight_kg"] == pytest.approx(76.2)
        assert result["wahoo_weight_kg"] == pytest.approx(78.5)
        assert client.updates == [pytest.approx(76.2)]

    async def test_unset_profile_weight_is_written(self, db_session, test_user, client):
        """A profile with no weight is the case the feature exists for."""
        client.profile_weight = None
        await _connection(db_session, test_user.id)
        await _weigh_in(db_session, test_user.id, 81.0)

        result = await push_weight_to_wahoo(db_session, test_user.id)

        assert result["pushed"] is True
        assert result["wahoo_weight_kg"] is None

    async def test_profile_read_failure_does_not_raise(self, db_session, test_user, client):
        client.get_error = RuntimeError("429 Too Many Requests")
        await _connection(db_session, test_user.id)
        await _weigh_in(db_session, test_user.id, 76.2)

        result = await push_weight_to_wahoo(db_session, test_user.id)

        assert result == {"pushed": False, "reason": "profile_unavailable"}
        assert client.updates == []

    async def test_write_failure_does_not_raise(self, db_session, test_user, client):
        """A failed profile write must never fail the weigh-in sync."""
        client.update_error = RuntimeError("403 token lacks user_write")
        await _connection(db_session, test_user.id)
        await _weigh_in(db_session, test_user.id, 76.2)

        result = await push_weight_to_wahoo(db_session, test_user.id)

        assert result == {"pushed": False, "reason": "write_failed"}

    async def test_latest_weigh_in_wins(self, db_session, test_user, client):
        """Two weigh-ins: the most recent date is the profile value."""
        await _connection(db_session, test_user.id)
        older = WeightLog(
            user_id=test_user.id,
            date=date.today() - timedelta(days=3),
            weight_kilogram=80.0,
            source="withings",
        )
        newer = WeightLog(
            user_id=test_user.id,
            date=date.today(),
            weight_kilogram=79.0,
            source="manual",
        )
        db_session.add_all([older, newer])
        await db_session.flush()

        await push_weight_to_wahoo(db_session, test_user.id)

        assert client.updates == [pytest.approx(79.0)]
