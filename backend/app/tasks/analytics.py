"""Data enrichment and refresh tasks.

Backfills and cache refreshes that make existing rows more useful. The work
itself lives in the services. This module holds the scheduled entry points.
"""

import logging

from app.tasks.celery_app import celery_app
from app.tasks.common import _run_task_guarded

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.scheduler.backfill_streams_for_all_activities")
def backfill_streams_for_all_activities() -> dict:
    """Backfill streams for all cycling activities missing them.

    Queries all cycling activities with a Strava ``provider_activity_id``
    that have no associated ``ActivityStream`` records, fetches streams
    from Strava, and stores them.  Can be triggered on-demand or scheduled.
    """
    import asyncio

    from app.database import task_session
    from app.services.strava.sync import (
        backfill_streams_for_all_activities as _backfill_streams,
    )

    async def _run():
        async with task_session() as db:
            return await _backfill_streams(db)

    return asyncio.run(_run_task_guarded("backfill_streams_for_all_activities", _run))


@celery_app.task(name="app.tasks.scheduler.backfill_manual_activity_tss")
def backfill_manual_activity_tss() -> dict:
    """Compute TSS for imported activities that were stranded without one.

    ``import_fit`` now computes TSS on write, but two populations are still
    stranded: activities imported before that landed, and activities imported
    while no FTP was configured (the HR fallback needs LTHR and a resting HR, so
    the import legitimately produced no TSS). Setting FTP later does not
    retroactively fix them, and every load consumer skips null-tss rows - so
    those rides contribute nothing to weekly TSS, CTL/ATL, or the
    recommendation engines.

    Scoped to ``source='manual'`` so provider-synced rows are never touched, and
    to ``tss IS NULL`` so this is idempotent: a repeat run finds nothing and
    recomputes nothing. Per-user failures are rolled back and skipped so one
    bad row cannot kill the sweep.
    """
    import asyncio

    from sqlalchemy import select

    from app.database import task_session
    from app.models.user import User
    from app.services.cycling import (
        backfill_manual_activity_tss as _backfill_manual_tss,
    )

    async def _run():
        async with task_session() as db:
            users_result = await db.execute(select(User))
            users = list(users_result.scalars().all())
            total = 0
            failed = 0
            by_user: dict[str, int] = {}
            for user in users:
                try:
                    count = await _backfill_manual_tss(db, user.id)
                    if count:
                        by_user[str(user.id)] = count
                    total += count
                except Exception as e:
                    failed += 1
                    logger.error(
                        f"Manual-activity TSS backfill failed for user {user.id}: {e}",
                        exc_info=True,
                    )
                    await db.rollback()
                else:
                    await db.commit()
            return {
                "users_total": len(users),
                "activities_backfilled": total,
                "users_failed": failed,
                "by_user": by_user,
            }

    return asyncio.run(_run_task_guarded("backfill_manual_activity_tss", _run))


@celery_app.task(name="app.tasks.scheduler.refresh_weather_forecasts")
def refresh_weather_forecasts() -> dict:
    """Refresh weather forecast caches for users with a resolvable home location.

    Runs daily at 5 AM UTC. Per-user failures are logged and skipped so one
    user's failure never kills the loop. Open-Meteo outages degrade to stale
    caches rather than task failures.
    """
    import asyncio

    from sqlalchemy import select

    from app.database import task_session
    from app.models.user import User
    from app.services.weather import get_forecast, resolve_user_coords

    async def _run():
        async with task_session() as db:
            users_result = await db.execute(select(User))
            users = list(users_result.scalars().all())
            refreshed = 0
            no_location = 0

            for user in users:
                try:
                    coords = await resolve_user_coords(db, user.id)
                    if coords is None:
                        no_location += 1
                        continue
                    await get_forecast(db, user.id, coords[0], coords[1], days=7)
                    refreshed += 1
                    await db.commit()
                except Exception as e:
                    logger.warning(
                        f"Weather forecast refresh failed for user {user.id}: {e}",
                        exc_info=True,
                    )
                    await db.rollback()
            return {
                "forecasts_refreshed": refreshed,
                "users_without_location": no_location,
            }

    return asyncio.run(_run())
