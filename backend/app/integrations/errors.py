"""Typed exceptions for the sync pipeline.

These let the scheduler and API layer distinguish failures that retrying
could fix from failures that require human action (re-authorisation).
Without this distinction a revoked token is retried forever, silently.

* :class:`PermanentAuthError` — the credentials are invalid or revoked
  (``invalid_grant``, 401/403 on auth, missing refresh token). Retrying will
  never succeed; the connection should be marked ``needs_reauth``.
* :class:`TransientSyncError` — a temporary condition (timeout, network drop,
  5xx, exhausted rate limit). Retrying on a later run may succeed.
"""


class SyncError(Exception):
    """Base class for all sync-pipeline errors."""


class PermanentAuthError(SyncError):
    """The provider credentials are permanently invalid and need re-authorisation."""


class TransientSyncError(SyncError):
    """A transient failure that a later retry may overcome."""