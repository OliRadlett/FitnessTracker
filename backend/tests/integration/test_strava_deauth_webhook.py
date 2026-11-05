"""A Strava deauthorisation webhook must flip the connection, not wait for a 401.

End to end over the real handler and a real row, because the part that can break
silently is the *lookup*: the webhook carries a Strava athlete id, and it has to
match whatever the OAuth callback stored in ``provider_user_id``. A predicate test
cannot see that; only a row can.

``mark_connection_reauth`` commits (it notifies and increments a metric), so the
test re-queries rather than trusting an attribute on a committed, expired object.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.user import OAuthConnection
from app.services.connection_health import (
    CONNECTION_STATUS_ACTIVE,
    CONNECTION_STATUS_NEEDS_REAUTH,
)
from app.services.strava.webhooks import handle_strava_event

pytestmark = pytest.mark.integration

ATHLETE_ID = 987654


async def _strava_connection(db_session, user_id, athlete_id: str = str(ATHLETE_ID)):
    connection = OAuthConnection(
        user_id=user_id,
        provider="strava",
        access_token="access-token",
        refresh_token="refresh-token",
        provider_user_id=athlete_id,
    )
    db_session.add(connection)
    await db_session.flush()
    return connection


async def _status(db_session, connection_id) -> str:
    result = await db_session.execute(
        select(OAuthConnection.status).where(OAuthConnection.id == connection_id)
    )
    return result.scalar_one()


class TestDeauthorizationWebhook:
    async def test_marks_the_connection_needs_reauth(self, db_session, test_user):
        connection = await _strava_connection(db_session, test_user.id)
        assert connection.status == CONNECTION_STATUS_ACTIVE

        await handle_strava_event(
            db_session,
            object_type="athlete",
            object_id=ATHLETE_ID,
            aspect_type="update",
            owner_id=ATHLETE_ID,
            updates={"authorized": "false"},
        )

        assert await _status(db_session, connection.id) == CONNECTION_STATUS_NEEDS_REAUTH

    async def test_records_why(self, db_session, test_user):
        connection = await _strava_connection(db_session, test_user.id)

        await handle_strava_event(
            db_session,
            object_type="athlete",
            object_id=ATHLETE_ID,
            aspect_type="update",
            owner_id=ATHLETE_ID,
            updates={"authorized": "false"},
        )

        result = await db_session.execute(
            select(OAuthConnection.last_error).where(OAuthConnection.id == connection.id)
        )
        error = result.scalar_one()
        assert "revoked" in error.lower()
        assert "reconnect" in error.lower()

    async def test_a_profile_update_leaves_the_connection_alone(self, db_session, test_user):
        connection = await _strava_connection(db_session, test_user.id)

        await handle_strava_event(
            db_session,
            object_type="athlete",
            object_id=ATHLETE_ID,
            aspect_type="update",
            owner_id=ATHLETE_ID,
            updates={"authorized": "true"},
        )

        assert await _status(db_session, connection.id) == CONNECTION_STATUS_ACTIVE

    async def test_unknown_athlete_is_a_no_op_not_an_error(self, db_session, test_user):
        """A deauth for an athlete we never stored must not raise.

        This is the reconnect-then-revoke-in-another-tab case: the row is gone, so
        there is nothing to mark, and the webhook must still be marked processed.
        """
        await handle_strava_event(
            db_session,
            object_type="athlete",
            object_id=uuid.uuid4().int % 100000,
            aspect_type="update",
            owner_id=uuid.uuid4().int % 100000,
            updates={"authorized": "false"},
        )

    async def test_does_not_touch_another_athletes_connection(self, db_session, test_user):
        """The lookup is keyed on the athlete id, not on "the only connection"."""
        connection = await _strava_connection(
            db_session, test_user.id, athlete_id="111111"
        )

        await handle_strava_event(
            db_session,
            object_type="athlete",
            object_id=222222,
            aspect_type="update",
            owner_id=222222,
            updates={"authorized": "false"},
        )

        assert await _status(db_session, connection.id) == CONNECTION_STATUS_ACTIVE
