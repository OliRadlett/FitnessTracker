"""Unit tests for the hardened token-refresh path (BUG-072).

Covers: no-op when not expired, permanent-auth classification (marks the
connection ``needs_reauth``), transient classification (counts failures),
successful refresh (token + health reset + immediate commit), and the
missing-refresh-token case.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from app.integrations.errors import PermanentAuthError, TransientSyncError
from app.models.user import OAuthConnection
from app.services.connection_health import (
    CONNECTION_STATUS_NEEDS_REAUTH,
    refresh_connection,
)


def _make_connection(*, expired: bool = True, refresh_token: str | None = "refresh-123"):
    conn = OAuthConnection(
        provider="strava",
        provider_user_id="strava_user",
        access_token="old-access",
        refresh_token=refresh_token,
        status="active",
        token_expires_at=(
            datetime.now(UTC) - timedelta(minutes=1)
            if expired
            else datetime.now(UTC) + timedelta(hours=1)
        ),
    )
    return conn


def _mock_db(conn: OAuthConnection) -> MagicMock:
    """AsyncSession whose locked re-select returns the given connection."""
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one.return_value = conn
    db.execute.return_value = result
    return db


def _status_error(status_code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://example.com/token")
    response = httpx.Response(status_code, request=request)
    return httpx.HTTPStatusError("token error", request=request, response=response)


class TestRefreshConnection:
    async def test_noop_when_not_expired(self):
        conn = _make_connection(expired=False)
        db = _mock_db(conn)
        client = MagicMock()

        result = await refresh_connection(db, conn, client)

        assert result is conn
        client.refresh_access_token.assert_not_called()
        db.commit.assert_not_called()

    async def test_missing_refresh_token_marks_reauth(self):
        conn = _make_connection(refresh_token=None)
        db = _mock_db(conn)
        client = MagicMock()

        with pytest.raises(PermanentAuthError):
            await refresh_connection(db, conn, client)

        assert conn.status == CONNECTION_STATUS_NEEDS_REAUTH
        assert conn.consecutive_failures == 1
        assert conn.last_error is not None
        db.commit.assert_called()

    async def test_permanent_http_failure_marks_reauth(self):
        conn = _make_connection()
        db = _mock_db(conn)
        client = MagicMock()
        client.refresh_access_token = AsyncMock(side_effect=_status_error(400))

        with pytest.raises(PermanentAuthError):
            await refresh_connection(db, conn, client)

        assert conn.status == CONNECTION_STATUS_NEEDS_REAUTH
        assert conn.consecutive_failures == 1
        assert "400" in (conn.last_error or "")

    async def test_transient_http_failure_counts_and_keeps_active(self):
        conn = _make_connection()
        db = _mock_db(conn)
        client = MagicMock()
        client.refresh_access_token = AsyncMock(side_effect=_status_error(500))

        with pytest.raises(TransientSyncError):
            await refresh_connection(db, conn, client)

        assert conn.status == "active"
        assert conn.consecutive_failures == 1

    async def test_success_updates_tokens_and_resets_health(self):
        conn = _make_connection()
        conn.consecutive_failures = 3
        conn.last_error = "previous failure"
        db = _mock_db(conn)
        client = MagicMock()
        client.refresh_access_token = AsyncMock(
            return_value={
                "access_token": "new-access",
                "refresh_token": "new-refresh",
                "expires_in": 21600,
            }
        )

        result = await refresh_connection(db, conn, client)

        assert result.access_token == "new-access"
        assert result.refresh_token == "new-refresh"
        assert result.token_expires_at is not None
        assert result.last_refreshed_at is not None
        assert result.consecutive_failures == 0
        assert result.last_error is None
        assert result.status == "active"
        db.commit.assert_called()

    async def test_typed_permanent_error_propagates_and_marks_reauth(self):
        conn = _make_connection()
        db = _mock_db(conn)
        client = MagicMock()
        client.refresh_access_token = AsyncMock(
            side_effect=PermanentAuthError("revoked")
        )

        with pytest.raises(PermanentAuthError):
            await refresh_connection(db, conn, client)

        assert conn.status == CONNECTION_STATUS_NEEDS_REAUTH