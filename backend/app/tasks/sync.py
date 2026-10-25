"""Provider sync tasks.

The sync implementations live in the integration and service modules. This module
holds the scheduled entry points that drive them.

More provider syncs still live in the scheduler. They move here as they are
measured, not as a batch, because a moved task must keep its Celery name and its
re-export or beat stops resolving it.
"""

import logging

from app.tasks.celery_app import celery_app
from app.tasks.common import _run_task_guarded

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.scheduler.process_strava_webhook_events")
def process_strava_webhook_events() -> dict:
    """Drain queued Strava webhook events (async processing with retries)."""
    import asyncio

    from app.database import task_session
    from app.services.strava.webhook_queue import process_pending_strava_events

    async def _run():
        async with task_session() as db:
            return await process_pending_strava_events(db)

    return asyncio.run(_run_task_guarded("process_strava_webhook_events", _run))


@celery_app.task(name="app.tasks.scheduler.reconcile_strava_activities")
def reconcile_strava_activities() -> dict:
    """Weekly safety net — heal drift (missed deletes/renames) against Strava."""
    import asyncio

    from sqlalchemy import select

    from app.database import task_session
    from app.integrations.errors import PermanentAuthError, TransientSyncError
    from app.models.user import OAuthConnection
    from app.services.connection_health import (
        CONNECTION_STATUS_NEEDS_REAUTH,
        handle_sync_http_error,
        mark_connection_reauth,
    )
    from app.services.strava.webhook_queue import (
        reconcile_strava_activities as _reconcile,
    )

    async def _run():
        async with task_session() as db:
            result = await db.execute(
                select(OAuthConnection).where(OAuthConnection.provider == "strava")
            )
            total = 0
            for conn in result.scalars().all():
                if conn.status == CONNECTION_STATUS_NEEDS_REAUTH:
                    continue
                try:
                    total += await _reconcile(db, conn.user_id)
                except PermanentAuthError as e:
                    logger.warning(
                        f"Reconciliation auth failure for user {conn.user_id}: {e}"
                    )
                    await db.rollback()
                except Exception as e:
                    logger.error(
                        f"Reconciliation failed for user {conn.user_id}: {e}",
                        exc_info=True,
                    )
                    await db.rollback()
            return {"corrections": total}

    return asyncio.run(_run_task_guarded("reconcile_strava_activities", _run))
