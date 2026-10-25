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


@celery_app.task(name="app.tasks.scheduler.sync_all_routes")
def sync_all_routes() -> dict:
    """Sync routes from all connected providers for all users.

    This task is enqueued by Celery Beat every 2 hours.
    It syncs routes from Strava, Komoot, and Wahoo for each connected user.
    """
    import asyncio

    from sqlalchemy import select

    from app.database import task_session
    from app.integrations.errors import PermanentAuthError, TransientSyncError
    from app.models.user import OAuthConnection
    from app.services.connection_health import CONNECTION_STATUS_NEEDS_REAUTH

    async def _run():
        async with task_session() as db:
            # Get unique users with any route-capable connection
            result = await db.execute(
                select(OAuthConnection).where(
                    OAuthConnection.provider.in_(["strava", "wahoo"])
                )
            )
            connections = list(result.scalars().all())

            # Group by user, skipping connections awaiting re-authorisation
            user_providers: dict = {}
            for conn in connections:
                if conn.status == CONNECTION_STATUS_NEEDS_REAUTH:
                    continue
                if conn.user_id not in user_providers:
                    user_providers[conn.user_id] = []
                user_providers[conn.user_id].append(conn.provider)

            synced_total = 0
            merged_total = 0

            # Komoot uses global Basic Auth — sync once, not per-user
            from app.config import get_settings as _get_settings

            _s = _get_settings()
            if _s.komoot_email and _s.komoot_password and user_providers:
                try:
                    from app.services.komoot import sync_komoot_routes

                    # Use the first user for route ownership
                    first_user = next(iter(user_providers))
                    count, merged = await sync_komoot_routes(db, first_user)
                    synced_total += count
                    merged_total += merged
                except PermanentAuthError as e:
                    logger.warning(f"Komoot route sync auth failure: {e}")
                except TransientSyncError as e:
                    logger.warning(f"Komoot route sync transient failure: {e}")
                except Exception as e:
                    logger.error(
                        f"Failed to sync Komoot routes: {e}",
                        exc_info=True,
                    )

            for user_id, providers in user_providers.items():
                try:
                    if "strava" in providers:
                        from app.services.strava import sync_strava_routes

                        count, merged = await sync_strava_routes(db, user_id)
                        synced_total += count
                        merged_total += merged

                    if "wahoo" in providers:
                        from app.services.wahoo import sync_wahoo_routes

                        count, merged = await sync_wahoo_routes(db, user_id)
                        synced_total += count
                        merged_total += merged

                    await db.commit()
                except PermanentAuthError as e:
                    logger.warning(f"Route sync auth failure for user {user_id}: {e}")
                    await db.rollback()
                except TransientSyncError as e:
                    logger.warning(
                        f"Route sync transient failure for user {user_id}: {e}"
                    )
                    await db.rollback()
                except Exception as e:
                    logger.error(
                        f"Failed to sync routes for user {user_id}: {e}",
                        exc_info=True,
                    )
                    await db.rollback()
            return {
                "routes_synced": synced_total,
                "routes_merged": merged_total,
                "users_processed": len(user_providers),
            }

    return asyncio.run(_run_task_guarded("sync_all_routes", _run))
