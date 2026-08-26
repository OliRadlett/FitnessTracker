"""Connection health helpers — BUG-072.

Centralises token refresh so all providers share one hardened path:

* **Row-locking** (``SELECT ... FOR UPDATE``) prevents two overlapping sync
  runs from racing on the same refresh token (which would rotate it twice and
  invalidate the loser's copy on strict-rotation providers like Wahoo/Whoop).
* **Error classification** distinguishes permanent auth failures (revoked /
  deauthorised / ``invalid_grant``) from transient ones (timeout / 5xx / 429).
  Permanent failures mark the connection ``needs_reauth`` so the scheduler
  stops hammering the provider and the UI can prompt re-authorisation.
* **Immediate commit** of the token + health-state writes, so a later rollback
  in the caller's per-user transaction can't discard a freshly rotated
  refresh token.

Providers keep a thin ``refresh_if_needed`` wrapper (same name/signature as
before) that supplies the client and its expiry semantics.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.errors import PermanentAuthError, TransientSyncError
from app.models.user import OAuthConnection

logger = logging.getLogger(__name__)

CONNECTION_STATUS_ACTIVE = "active"
CONNECTION_STATUS_NEEDS_REAUTH = "needs_reauth"


def _db_expired(connection: OAuthConnection) -> bool:
    return (
        connection.token_expires_at is not None
        and connection.token_expires_at < datetime.now(UTC)
    )


def _default_set_expiry(connection: OAuthConnection, token_data: dict) -> None:
    """Set ``token_expires_at`` from the refresh response.

    Falls back to a conservative default so a provider that omits expiry info
    doesn't trigger a refresh (and token rotation) on every single run.
    """
    if "expires_in" in token_data:
        connection.token_expires_at = datetime.now(UTC) + timedelta(
            seconds=int(token_data["expires_in"])
        )
    elif "expires_at" in token_data:
        connection.token_expires_at = datetime.fromtimestamp(
            float(token_data["expires_at"]), tz=UTC
        )
    else:
        connection.token_expires_at = datetime.now(UTC) + timedelta(hours=6)


async def refresh_connection(
    db: AsyncSession,
    connection: OAuthConnection,
    client: Any,
    *,
    is_expired: Callable[[OAuthConnection], bool] = _db_expired,
    set_expiry: Callable[[OAuthConnection, dict], None] = _default_set_expiry,
) -> OAuthConnection:
    """Refresh a provider access token if it is expired (hardened path).

    Raises:
        PermanentAuthError — credentials revoked/expired without a usable
            refresh token; the connection is marked ``needs_reauth``.
        TransientSyncError — a temporary failure that a later run may beat.
    """
    if not is_expired(connection):
        return connection

    if not connection.refresh_token:
        await _mark_reauth(
            db, connection, "No refresh token available — re-authorise this provider"
        )
        raise PermanentAuthError(
            f"{connection.provider} connection has no refresh token — "
            "re-authorise from Settings"
        )

    # Serialize concurrent refreshes for the same connection so two overlapping
    # runs can't rotate the refresh token twice (strict-rotation providers
    # invalidate the first token on second use).
    locked = await db.execute(
        select(OAuthConnection)
        .where(OAuthConnection.id == connection.id)
        .with_for_update()
    )
    connection = locked.scalar_one()

    # Another worker may have refreshed while we waited for the lock.
    if not is_expired(connection):
        return connection

    try:
        token_data = await client.refresh_access_token(connection.refresh_token)
    except PermanentAuthError as e:
        await _mark_reauth(db, connection, str(e))
        raise
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (400, 401, 403):
            await _mark_reauth(
                db,
                connection,
                f"token refresh rejected (HTTP {e.response.status_code})",
            )
            raise PermanentAuthError(
                f"{connection.provider} token refresh rejected "
                f"(HTTP {e.response.status_code}) — re-authorise from Settings"
            ) from e
        await _record_transient(db, connection, str(e))
        raise TransientSyncError(
            f"{connection.provider} token refresh failed "
            f"(HTTP {e.response.status_code})"
        ) from e
    except Exception as e:
        await _record_transient(db, connection, str(e))
        raise TransientSyncError(
            f"{connection.provider} token refresh failed: {e}"
        ) from e

    connection.access_token = token_data["access_token"]
    connection.refresh_token = token_data.get(
        "refresh_token", connection.refresh_token
    )
    set_expiry(connection, token_data)
    connection.last_refreshed_at = datetime.now(UTC)
    connection.consecutive_failures = 0
    connection.last_error = None
    connection.last_error_at = None
    # Commit immediately: the freshly rotated token must survive a later
    # rollback of this user's sync work.
    await db.commit()
    logger.info(
        f"Refreshed {connection.provider} token for user {connection.user_id}"
    )
    return connection


async def reset_connection_health(db: AsyncSession, connection: OAuthConnection) -> None:
    """Clear failure state after a successful connect/reconnect OAuth flow."""
    connection.status = CONNECTION_STATUS_ACTIVE
    connection.consecutive_failures = 0
    connection.last_error = None
    connection.last_error_at = None


async def mark_connection_reauth(
    db: AsyncSession, connection: OAuthConnection, message: str
) -> None:
    """Explicitly mark a connection as needing re-authorisation (e.g. after a
    mid-sync 401) and persist the health state."""
    await _mark_reauth(db, connection, message)


async def _mark_reauth(
    db: AsyncSession, connection: OAuthConnection, message: str
) -> None:
    connection.status = CONNECTION_STATUS_NEEDS_REAUTH
    connection.last_error = message[:500]
    connection.last_error_at = datetime.now(UTC)
    connection.consecutive_failures = (connection.consecutive_failures or 0) + 1
    await db.commit()
    try:
        from app.metrics import CONNECTION_REAUTH

        CONNECTION_REAUTH.labels(provider=connection.provider).inc()
    except Exception:  # metrics must never break syncing
        pass
    logger.warning(
        f"Marked {connection.provider} connection for user {connection.user_id} "
        f"as needs_reauth: {message}"
    )


async def _record_transient(
    db: AsyncSession, connection: OAuthConnection, message: str
) -> None:
    connection.consecutive_failures = (connection.consecutive_failures or 0) + 1
    connection.last_error = message[:500]
    connection.last_error_at = datetime.now(UTC)
    await db.commit()
    logger.warning(
        f"{connection.provider} transient refresh failure "
        f"({connection.consecutive_failures}x) for user {connection.user_id}: {message}"
    )