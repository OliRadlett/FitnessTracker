"""App-auth (google/github) OAuth callback must validate ``state`` (SEC-04).

The fitness-integration branch of ``/oauth/{provider}/callback`` already
consumes a single-use opaque state token (SEC-02). The app-auth branch did
not: it ignored ``state`` entirely and called ``exchange_code_for_user``
directly, so an attacker could drive a victim's browser through a callback
with an attacker-supplied code and have the resulting session minted for the
attacker's account (login CSRF / account-confusion).

These tests drive the real endpoint through FastAPI. Only the Redis boundary
(``_get_redis``) and the provider token exchange are stubbed — the routing,
state validation, and error mapping under test are the real code.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import AsyncClient
from httpx._transports.asgi import ASGITransport

from app.models.user import User
from app.services.auth import mint_oauth_state_token

pytestmark = [pytest.mark.integration, pytest.mark.expensive]

FAKE_USER_ID = uuid.UUID("12345678-1234-5678-1234-567812345678")


class _FakeRedis:
    """Minimal in-memory stand-in for the single-use state store."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.store[key] = value

    async def getdel(self, key: str) -> str | None:
        return self.store.pop(key, None)


@pytest_asyncio.fixture
async def client(test_user: User) -> AsyncGenerator[AsyncClient, None]:
    app = FastAPI()
    from app.api import auth as auth_api

    app.include_router(auth_api.router, prefix="/api/v1/auth")

    fake_redis = _FakeRedis()
    with patch("app.services.cache._get_redis", MagicMock(return_value=fake_redis)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            yield c


def _stub_exchange() -> AsyncMock:
    """Pretend the provider returned a usable identity for FAKE_USER_ID."""
    return AsyncMock(
        return_value=(
            User(
                id=FAKE_USER_ID,
                email="attacker@example.com",
                name="Attacker",
                created_at=datetime(2026, 1, 1, tzinfo=UTC),
            ),
            False,
        )
    )


class TestAppAuthCallbackRequiresState:
    """``state`` is mandatory on the google/github callback."""

    async def test_rejects_callback_with_no_state(self, client):
        """No state at all → 400. Today this mints a session (the bug)."""
        with patch(
            "app.api.auth.exchange_code_for_user", _stub_exchange()
        ) as exchange:
            resp = await client.get("/api/v1/auth/oauth/google/callback?code=abc")

        assert resp.status_code == 400
        # The code must never be exchanged without a verified state.
        exchange.assert_not_called()

    async def test_rejects_callback_with_unknown_state(self, client):
        """A state that was never minted (or was consumed) → 400."""
        with patch(
            "app.api.auth.exchange_code_for_user", _stub_exchange()
        ) as exchange:
            resp = await client.get(
                "/api/v1/auth/oauth/google/callback?code=abc&state=forged-token"
            )

        assert resp.status_code == 400
        exchange.assert_not_called()

    async def test_rejects_state_minted_for_a_different_provider(self, client):
        """State bound to ``github`` must not satisfy a ``google`` callback."""
        state = await mint_oauth_state_token(FAKE_USER_ID, "github")

        with patch(
            "app.api.auth.exchange_code_for_user", _stub_exchange()
        ) as exchange:
            resp = await client.get(
                f"/api/v1/auth/oauth/google/callback?code=abc&state={state}"
            )

        assert resp.status_code == 400
        exchange.assert_not_called()

    async def test_accepts_minted_state_and_is_single_use(self, client):
        """A valid state passes; replaying the same state is rejected."""
        state = await mint_oauth_state_token(FAKE_USER_ID, "google")

        with patch("app.api.auth.exchange_code_for_user", _stub_exchange()):
            first = await client.get(
                f"/api/v1/auth/oauth/google/callback?code=abc&state={state}"
            )
        assert first.status_code == 200
        assert first.json()["token"]["access_token"]

        # Same state, second time — the token was consumed by GETDEL.
        with patch(
            "app.api.auth.exchange_code_for_user", _stub_exchange()
        ) as exchange:
            replay = await client.get(
                f"/api/v1/auth/oauth/google/callback?code=abc&state={state}"
            )

        assert replay.status_code == 400
        exchange.assert_not_called()
