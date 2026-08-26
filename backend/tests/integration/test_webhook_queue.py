"""Integration tests for the Strava webhook event queue.

Covers:
- the POST receiver persisting events (not processing inline),
- ``process_pending_strava_events`` draining the queue oldest-first,
- retry-then-fail semantics for permanently-failing events.

Run with:  pytest tests/integration/test_webhook_queue.py -m integration
"""

from __future__ import annotations

import hashlib
import hmac
import json
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.webhook_event import StravaWebhookEvent
from app.services.strava.webhook_queue import MAX_ATTEMPTS

pytestmark = [pytest.mark.integration, pytest.mark.expensive]


async def _new_session(test_engine) -> AsyncSession:
    return AsyncSession(bind=test_engine, expire_on_commit=False)


@pytest_asyncio.fixture
async def test_session_factory(test_engine):
    """A session factory bound to the test database (like async_session_factory)."""
    return async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )


class TestWebhookReceiver:
    """POST /webhooks/strava persists the event and returns fast."""

    async def test_persists_event_without_processing(
        self, app, client, test_session_factory
    ):
        import app.api.webhooks as webhooks_api

        # Give the HMAC a real secret (dev .env may have it empty → the guard
        # would 503 instead of verifying).
        secret = "test-webhook-secret"
        body = json.dumps(
            {
                "object_type": "activity",
                "object_id": 12345,
                "aspect_type": "create",
                "owner_id": 67890,
                "updates": {},
            }
        ).encode()
        sig = hmac.HMAC(secret.encode(), body, hashlib.sha256).hexdigest()

        with patch.object(webhooks_api.settings, "strava_client_secret", secret), \
             patch("app.database.async_session_factory", test_session_factory), \
             patch(
                 "app.services.strava.webhooks.handle_strava_event",
                 new=AsyncMock(),
             ) as mock_handle:
            resp = await client.post(
                "/api/v1/webhooks/strava",
                content=body,
                headers={"X-Hub-Signature-256": f"sha256={sig}"},
            )

        assert resp.status_code == 200
        # Processing is async — the receiver must NOT call the handler inline.
        mock_handle.assert_not_called()

        async with test_session_factory() as s:
            rows = (
                await s.execute(select(StravaWebhookEvent))
            ).scalars().all()
        assert len(rows) == 1
        assert rows[0].status == "pending"
        assert rows[0].object_id == "12345"
        assert rows[0].aspect_type == "create"

        async with test_session_factory() as s:
            await s.execute(delete(StravaWebhookEvent))
            await s.commit()

    async def test_rejects_bad_signature(self, app, client):
        import app.api.webhooks as webhooks_api

        with patch.object(webhooks_api.settings, "strava_client_secret", "test-secret"):
            body = json.dumps(
                {
                    "object_type": "activity",
                    "object_id": 1,
                    "aspect_type": "create",
                    "owner_id": 2,
                }
            ).encode()
            resp = await client.post(
                "/api/v1/webhooks/strava",
                content=body,
                headers={"X-Hub-Signature-256": "sha256=invalid"},
            )
        assert resp.status_code == 401


class TestProcessPendingEvents:
    """process_pending_strava_events drains the queue oldest-first."""

    async def test_marks_all_processed(self, test_engine, test_session_factory):
        from app.services.strava.webhook_queue import process_pending_strava_events

        session = await _new_session(test_engine)
        session.add_all(
            [
                StravaWebhookEvent(
                    aspect_type="create",
                    object_type="activity",
                    object_id="1",
                    owner_id="100",
                    raw_data={},
                ),
                StravaWebhookEvent(
                    aspect_type="delete",
                    object_type="activity",
                    object_id="2",
                    owner_id="100",
                    raw_data={},
                ),
            ]
        )
        await session.commit()

        with patch(
            "app.services.strava.webhooks.handle_strava_event", new=AsyncMock()
        ) as mock_handle:
            result = await process_pending_strava_events(session)
        await session.close()

        assert result == {"processed": 2, "failed": 0}
        assert mock_handle.call_count == 2

        fresh = await _new_session(test_engine)
        rows = (
            await fresh.execute(select(StravaWebhookEvent))
        ).scalars().all()
        await fresh.close()
        assert all(r.status == "processed" for r in rows)

        async with test_session_factory() as s:
            await s.execute(delete(StravaWebhookEvent))
            await s.commit()

    async def test_retries_then_fails(self, test_engine, test_session_factory):
        from app.services.strava.webhook_queue import process_pending_strava_events

        session = await _new_session(test_engine)
        event = StravaWebhookEvent(
            aspect_type="create",
            object_type="activity",
            object_id="99",
            owner_id="100",
            raw_data={},
        )
        session.add(event)
        await session.commit()

        with patch(
            "app.services.strava.webhooks.handle_strava_event",
            new=AsyncMock(side_effect=Exception("provider boom")),
        ):
            # Attempts 1..MAX_ATTEMPTS — event stays pending until the cap.
            for expected_attempts in range(1, MAX_ATTEMPTS):
                await process_pending_strava_events(session)
                await session.refresh(event)
                assert event.attempts == expected_attempts
                assert event.status == "pending"
            await process_pending_strava_events(session)
            await session.refresh(event)
            assert event.attempts == MAX_ATTEMPTS
            assert event.status == "failed"
        await session.close()

        async with test_session_factory() as s:
            await s.execute(delete(StravaWebhookEvent))
            await s.commit()