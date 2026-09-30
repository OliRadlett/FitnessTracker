"""Strava webhook verify token must not have a guessable default (SEC-05).

``config.py`` shipped ``strava_verify_token = "fittrack_strava_webhook"``. The
GET challenge endpoint echoes ``hub.challenge`` back to anyone presenting a
matching ``hub.verify_token``, so the hardcoded default let anyone who had read
the repository claim the app's webhook subscription. A default that is
guessable is the same class of bug as an empty HMAC key.

The fix: the default becomes empty, and an unset token fails closed (403)
rather than matching a well-known string. Deployments that need the challenge
must set ``STRAVA_VERIFY_TOKEN`` explicitly.

Run with:  pytest tests/integration/test_strava_webhook_verify_token.py -m integration
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from unittest.mock import patch

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import AsyncClient

from app.config import get_settings

pytestmark = [pytest.mark.integration, pytest.mark.expensive]

# The old hardcoded default that must no longer be accepted out of the box.
LEGACY_HARDCODED_DEFAULT = "fittrack_strava_webhook"


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    app = FastAPI()
    from app.api import webhooks as webhooks_api

    app.include_router(webhooks_api.router, prefix="/api/v1/webhooks")
    transport = httpx.ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


def _challenge(token: str) -> dict[str, str]:
    return {
        "hub.mode": "subscribe",
        "hub.verify_token": token,
        "hub.challenge": "15f7d1a91c1f40f8a748fd134752feb3",
    }


class TestStravaChallengeVerifyToken:
    def test_settings_default_is_not_a_guessable_string(self):
        """SEC-05: the shipped default must be empty, not a public constant."""
        settings = get_settings()
        assert settings.strava_verify_token != LEGACY_HARDCODED_DEFAULT, (
            "strava_verify_token still defaults to a value published in the "
            "repository — anyone can impersonate the webhook subscription"
        )

    async def test_legacy_hardcoded_token_is_rejected(self, client):
        """The old default must not authenticate once it is not configured."""
        with patch("app.api.webhooks.settings.strava_verify_token", ""):
            resp = await client.get(
                "/api/v1/webhooks/strava", params=_challenge(LEGACY_HARDCODED_DEFAULT)
            )
        assert resp.status_code == 503

    async def test_unconfigured_token_fails_closed(self, client):
        """An unset verify token rejects every challenge, including empty.

        503 (not configured), never 200 — an empty presented token matching an
        unset config would let anyone claim the subscription.
        """
        with patch("app.api.webhooks.settings.strava_verify_token", ""):
            for presented in ("", "anything", LEGACY_HARDCODED_DEFAULT):
                resp = await client.get(
                    "/api/v1/webhooks/strava", params=_challenge(presented)
                )
                assert resp.status_code == 503, f"token {presented!r} was accepted"

    async def test_configured_token_still_works(self, client):
        """An explicitly configured token keeps the real Strava flow working."""
        with patch(
            "app.api.webhooks.settings.strava_verify_token", "a-real-secret"
        ):
            resp = await client.get(
                "/api/v1/webhooks/strava", params=_challenge("a-real-secret")
            )
        assert resp.status_code == 200
        assert resp.json() == {"hub.challenge": "15f7d1a91c1f40f8a748fd134752feb3"}
