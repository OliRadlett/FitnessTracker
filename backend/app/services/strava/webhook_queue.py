"""Strava webhook queue — async processing + reconciliation.

Strava webhook events are persisted to ``strava_webhook_events`` and drained
here by a Celery task. Processing is ordered by ``received_at`` so create
events land before updates/deletes for the same activity. Failures retry up to
``MAX_ATTEMPTS``; permanent auth failures abort the run (the connection will
be marked ``needs_reauth`` by the scheduler).

``reconcile_strava_activities`` is the safety net for events that were lost
before the queue existed (or never arrive): it diffs the Strava list against
the DB within a bounded window and heals missed deletes and renames.
"""

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.errors import PermanentAuthError, TransientSyncError
from app.models.activity import Activity
from app.models.user import OAuthConnection
from app.models.webhook_event import StravaWebhookEvent

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 5
RECONCILE_MAX_PAGES = 10  # up to 1000 newest activities per window


async def process_pending_strava_events(
    db: AsyncSession, limit: int = 50
) -> dict[str, int]:
    """Process queued, unprocessed Strava webhook events (oldest first)."""
    from app.services.strava.webhooks import handle_strava_event

    result = await db.execute(
        select(StravaWebhookEvent)
        .where(StravaWebhookEvent.status == "pending")
        .order_by(StravaWebhookEvent.received_at.asc())
        .limit(limit)
    )
    events = list(result.scalars().all())

    processed = 0
    failed = 0
    for event in events:
        try:
            await handle_strava_event(
                db,
                object_type=event.object_type,
                object_id=int(event.object_id),
                aspect_type=event.aspect_type,
                owner_id=int(event.owner_id),
                updates=event.updates,
            )
            event.status = "processed"
            event.processed_at = datetime.now(UTC)
            event.error = None
            await db.commit()
            processed += 1
            _record_webhook_metric(event.aspect_type, "processed")
        except PermanentAuthError as e:
            # Token revoked — no point processing the rest of the queue.
            event_id = event.id
            await db.rollback()
            event = await db.get(StravaWebhookEvent, event_id)
            event.status = "failed"
            event.error = str(e)[:500]
            event.attempts += 1
            await db.commit()
            failed += 1
            _record_webhook_metric(event.aspect_type, "failed")
            logger.warning(
                f"Strava webhook queue aborted on auth failure: {e}"
            )
            break
        except (TransientSyncError, Exception) as e:
            # Discard partial work from this attempt, then retry later.
            event_id = event.id
            await db.rollback()
            event = await db.get(StravaWebhookEvent, event_id)
            event.attempts += 1
            event.error = str(e)[:500]
            if event.attempts >= MAX_ATTEMPTS:
                event.status = "failed"
                logger.error(
                    f"Strava webhook event {event.id} permanently failed "
                    f"after {MAX_ATTEMPTS} attempts: {e}"
                )
            else:
                logger.warning(
                    f"Strava webhook event {event.id} attempt "
                    f"{event.attempts}/{MAX_ATTEMPTS} failed: {e}"
                )
            await db.commit()
            failed += 1
            _record_webhook_metric(event.aspect_type, "failed")

    return {"processed": processed, "failed": failed}


def _record_webhook_metric(aspect_type: str, outcome: str) -> None:
    try:
        from app.metrics import WEBHOOK_EVENTS

        WEBHOOK_EVENTS.labels(aspect_type=aspect_type, outcome=outcome).inc()
    except Exception:  # metrics must never break the queue
        pass


async def reconcile_strava_activities(db: AsyncSession, user_id: Any) -> int:
    """Heal drift between the DB and Strava within a bounded recent window.

    For one Strava connection: fetches the newest up-to-1000 activities,
    applies renames, and deletes DB activities that are inside the fetched
    window but no longer exist on Strava (missed delete webhooks).

    Returns the number of corrections applied.
    """
    from app.integrations.strava_client import strava_client
    from app.services.strava.sync import get_strava_connection, refresh_if_needed

    connection = await get_strava_connection(db, user_id)
    if not connection or connection.status == "needs_reauth":
        return 0

    connection = await refresh_if_needed(db, connection)

    strava_by_id: dict[str, dict] = {}
    oldest_fetched_date: datetime | None = None
    for page in range(1, RECONCILE_MAX_PAGES + 1):
        batch = await strava_client.get_activities(
            access_token=connection.access_token,
            page=page,
            per_page=100,
        )
        if not batch:
            break
        for sa in batch:
            strava_by_id[str(sa["id"])] = sa
            start = datetime.fromisoformat(sa["start_date"].replace("Z", "+00:00"))
            if oldest_fetched_date is None or start < oldest_fetched_date:
                oldest_fetched_date = start
        if len(batch) < 100:
            break

    if not strava_by_id or oldest_fetched_date is None:
        return 0

    result = await db.execute(
        select(Activity).where(
            Activity.user_id == user_id,
            Activity.source == "strava",
        )
    )
    db_activities = list(result.scalars().all())

    corrections = 0
    for activity in db_activities:
        if not activity.provider_activity_id:
            continue
        provider_id = activity.provider_activity_id

        if provider_id in strava_by_id:
            # Heal missed rename events.
            remote_name = strava_by_id[provider_id].get("name")
            if remote_name and activity.name != remote_name:
                activity.name = remote_name
                corrections += 1
            continue

        # Only delete activities inside the fetched window — anything older
        # than the oldest fetched activity is legitimately out of scope.
        activity_start = activity.start_date
        if activity_start and activity_start >= oldest_fetched_date:
            await db.delete(activity)
            corrections += 1

    if corrections:
        await db.commit()
        logger.info(
            f"Strava reconciliation for user {user_id}: {corrections} corrections"
        )
    return corrections