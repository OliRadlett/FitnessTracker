"""Non-Strava webhook ingestion: verify, enqueue, drain.

The shape is Strava's, generalised rather than copied: **the HTTP handler verifies
and enqueues only** (AGENTS pitfall 9), and a Celery task does the work. That is
what makes a webhook a hint instead of a request the provider can slow down or
retry into a duplicate.

Whoop is the first provider here:

* it signs each delivery — ``X-WHOOP-Signature`` is base64(HMAC-SHA256 of
  ``X-WHOOP-Signature-Timestamp`` + the raw body) keyed on the client secret — so
  a wrong signature is rejected *before* anything is written;
* it sends a ``trace_id`` per event and retries, so ``dedupe_key`` makes a
  redelivery a no-op;
* the payload carries no data, only "sleep/recovery/workout N changed". The
  handler therefore re-reads the newest slice through the existing syncs rather
  than trying to apply the event.

Wahoo (shared token, no signature) and Withings (nothing verifiable) will reuse
``enqueue`` with their own verifier; the latter must be treated as ``hint_only``
and re-fetched, which is why the verifier's job is to return *whether we trust the
payload*, not to return data.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import OAuthConnection
from app.models.webhook_event import ProviderWebhookEvent

logger = logging.getLogger(__name__)

# Whoop's six event types. Anything else is stored and skipped rather than failed:
# a provider adding an event we do not handle is not an error on our side.
WHOOP_HANDLED = (
    "sleep.updated",
    "sleep.deleted",
    "recovery.updated",
    "recovery.deleted",
    "workout.updated",
    "workout.deleted",
)

# A webhook is a nudge to re-read the newest slice, not a request for history.
WEBHOOK_SYNC_LIMIT = 25


def whoop_signature_valid(
    raw_body: bytes,
    timestamp: str | None,
    signature: str | None,
    secret: str,
) -> bool:
    """True when a Whoop delivery carries a signature we can reproduce.

    The signed message is the timestamp header concatenated with the raw body —
    the timestamp is inside the digest, which is what stops a captured delivery
    being replayed later. Comparison is constant-time.

    An empty secret returns False: without it we cannot verify anything, and
    accepting unverified payloads would let any caller move a user's health data.
    """
    if not secret or not timestamp or not signature:
        return False
    expected = base64.b64encode(
        hmac.new(
            secret.encode(),
            timestamp.encode() + raw_body,
            hashlib.sha256,
        ).digest()
    ).decode()
    return hmac.compare_digest(expected, signature)


async def enqueue(
    db: AsyncSession,
    *,
    provider: str,
    event_type: str,
    payload: dict,
    provider_user_id: str | None = None,
    dedupe_key: str | None = None,
) -> bool:
    """Persist one event. Returns False when it was a duplicate.

    ``on_conflict_do_nothing`` with no target covers the partial unique index —
    naming ``index_elements`` would not match a partial index without also
    repeating its WHERE clause here.
    """
    stmt = (
        pg_insert(ProviderWebhookEvent)
        .values(
            provider=provider,
            event_type=event_type,
            payload=payload,
            provider_user_id=provider_user_id,
            dedupe_key=dedupe_key,
        )
        .on_conflict_do_nothing()
        .returning(ProviderWebhookEvent.id)
    )
    inserted = (await db.execute(stmt)).scalar_one_or_none()
    return inserted is not None


async def _connection_for(
    db: AsyncSession, provider: str, provider_user_id: str | None
) -> OAuthConnection | None:
    if not provider_user_id:
        return None
    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.provider == provider,
            OAuthConnection.provider_user_id == str(provider_user_id),
        )
    )
    return result.scalar_one_or_none()


async def _apply(db: AsyncSession, event: ProviderWebhookEvent) -> None:
    """Nudge the provider's syncs for the affected user.

    The event says *what* changed and for whom; it carries no values, so the
    cheapest correct response is "re-read the newest slice". A deleted event is
    handled by the same read — the row is gone at the provider, so the next sync
    is what reconciles it.
    """
    connection = await _connection_for(db, event.provider, event.provider_user_id)
    if connection is None:
        raise LookupError(
            f"no {event.provider} connection for user {event.provider_user_id}"
        )
    if event.provider != "whoop":
        return

    from app.services.whoop import sync_whoop_cycles, sync_whoop_sleep

    if event.event_type.startswith("sleep"):
        await sync_whoop_sleep(db, connection.user_id, limit=WEBHOOK_SYNC_LIMIT)
    else:
        # recovery.* and workout.* both live on the cycle/recovery path, which
        # also tops up any recovery that was still unscored when it was queued.
        await sync_whoop_cycles(db, connection.user_id, limit=WEBHOOK_SYNC_LIMIT)


async def process_pending_events(db: AsyncSession, limit: int = 50) -> dict[str, int]:
    """Drain pending events oldest-first. Returns counts for logging."""
    stats = {"processed": 0, "skipped": 0, "failed": 0}
    result = await db.execute(
        select(ProviderWebhookEvent)
        .where(ProviderWebhookEvent.status == "pending")
        .order_by(ProviderWebhookEvent.received_at.asc())
        .limit(limit)
    )
    for event in result.scalars().all():
        if event.provider == "whoop" and event.event_type not in WHOOP_HANDLED:
            event.status = "skipped"
            event.processed_at = datetime.now(UTC)
            stats["skipped"] += 1
            continue

        event.attempts = (event.attempts or 0) + 1
        try:
            await _apply(db, event)
        except Exception as exc:  # a bad event must not stop the queue
            event.error = f"{type(exc).__name__}: {exc}"[:500]
            # Three attempts then park it as failed: a permanently broken event
            # must not occupy the oldest-first window forever.
            event.status = "failed" if event.attempts >= 3 else "pending"
            stats["failed"] += 1
            logger.warning(
                "Provider webhook %s %s failed (attempt %s): %s",
                event.provider,
                event.event_type,
                event.attempts,
                exc,
            )
        else:
            event.status = "processed"
            event.processed_at = datetime.now(UTC)
            event.error = None
            stats["processed"] += 1
    await db.commit()
    return stats
