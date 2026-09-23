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

# Refresh proactively before the access token actually dies. Without a buffer
# a token that expires between the refresh check and the last API call of a
# long sync raises a mid-sync 401, which the scheduler marks needs_reauth —
# forcing a manual re-auth for what a refresh would have fixed. 5 minutes
# covers normal sync durations without causing extra rotations (Strava lives
# 6h, Whoop ~1h, Withings ~3h).
REFRESH_LEEWAY_SECONDS = 300


def _db_expired(connection: OAuthConnection) -> bool:
    if connection.token_expires_at is None:
        return False
    expires_at = connection.token_expires_at
    if expires_at.tzinfo is None:
        # Naive datetimes from legacy rows compare against aware now() —
        # assume UTC rather than crashing the sync.
        expires_at = expires_at.replace(tzinfo=UTC)
    return expires_at < datetime.now(UTC) + timedelta(seconds=REFRESH_LEEWAY_SECONDS)


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
    force: bool = False,
) -> OAuthConnection:
    """Refresh a provider access token if it is expired (hardened path).

    Args:
        force: skip the expiry check and refresh unconditionally. Used for
            retry-once after a mid-sync 401 — the token may have died between
            the pre-sync check and the API call.

    Raises:
        PermanentAuthError — credentials revoked/expired without a usable
            refresh token; the connection is marked ``needs_reauth``.
        TransientSyncError — a temporary failure that a later run may beat.
    """
    if not force and not is_expired(connection):
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
    if not force and not is_expired(connection):
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

    access_token = token_data.get("access_token")
    if not access_token:
        # Some providers return HTTP 200 with an error body (Withings uses
        # ``{"status": <non-zero>, "error": ...}`` at 200). Record a typed
        # transient failure instead of surfacing an opaque KeyError that skips
        # all connection-health bookkeeping.
        message = (
            f"{connection.provider} refresh returned no access_token "
            f"(keys={sorted(token_data)})"
        )
        await _record_transient(db, connection, message)
        raise TransientSyncError(message)

    connection.access_token = access_token
    connection.refresh_token = token_data.get("refresh_token", connection.refresh_token)
    set_expiry(connection, token_data)
    connection.last_refreshed_at = datetime.now(UTC)
    connection.status = CONNECTION_STATUS_ACTIVE
    connection.consecutive_failures = 0
    connection.last_error = None
    connection.last_error_at = None
    # Commit immediately: the freshly rotated token must survive a later
    # rollback of this user's sync work.
    await db.commit()
    logger.info(f"Refreshed {connection.provider} token for user {connection.user_id}")
    return connection


async def reset_connection_health(
    db: AsyncSession, connection: OAuthConnection
) -> None:
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
    try:
        from app.services.notifications import notify

        # Keyed per "episode": the last successful refresh timestamp. A fresh
        # episode after reconnecting gets a fresh notification.
        episode = (
            connection.last_refreshed_at.isoformat()
            if connection.last_refreshed_at
            else "never"
        )
        await notify(
            db,
            connection.user_id,
            type="connection_reauth",
            title=f"{connection.provider} needs re-authentication",
            body="Your connection stopped syncing. Reconnect from Settings to keep data fresh.",
            severity="error",
            link="/settings",
            dedup_key=f"reauth:{connection.id}:{episode}",
            metadata={"provider": connection.provider},
        )
    except Exception as e:  # a notification must never break reauth handling
        logger.warning(
            f"Failed to queue connection_reauth notification for "
            f"{connection.provider} user {connection.user_id}: {e}"
        )
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


def http_status_code(exc: BaseException) -> int | None:
    """Extract the HTTP status from an httpx error, else None."""
    if isinstance(exc, httpx.HTTPStatusError) and exc.response is not None:
        return exc.response.status_code
    return None


async def handle_sync_http_error(
    db: AsyncSession,
    connection: OAuthConnection,
    exc: BaseException,
    refresh_client: Any | None = None,
) -> bool:
    """Classify a raw HTTP error escaping a provider sync loop (SYNC-03).

    A mid-sync 401/403 usually means the token died between the pre-sync
    refresh check and the API call (clock skew / long pagination). When
    *refresh_client* is supplied, attempt one forced refresh first: if it
    succeeds the caller should retry the sync (returns True). Only when
    there is no client, no refresh token, or the forced refresh itself fails
    is the connection marked ``needs_reauth`` (returns False).

    Anything else is recorded as a transient failure (returns False).

    Both paths commit immediately so a later per-user rollback can't discard
    them.
    """
    status = http_status_code(exc)
    if status in (401, 403):
        if refresh_client is not None and connection.refresh_token:
            try:
                await refresh_connection(
                    db, connection, refresh_client, force=True
                )
                logger.info(
                    f"Recovered {connection.provider} mid-sync HTTP {status} "
                    f"via forced refresh for user {connection.user_id}"
                )
                return True
            except (PermanentAuthError, TransientSyncError):
                # Forced refresh failed — fall through to needs_reauth
                # (already recorded by refresh_connection).
                pass
            except Exception as e:
                logger.warning(
                    f"Forced refresh after mid-sync HTTP {status} failed "
                    f"for {connection.provider} user {connection.user_id}: {e}"
                )
        await _mark_reauth(
            db,
            connection,
            f"{connection.provider} rejected credentials mid-sync "
            f"(HTTP {status}); token revoked or expired.",
        )
        return False
    else:
        await _record_transient(
            db, connection, f"{connection.provider} HTTP {status or '?'}: {exc}"
        )
        return False
