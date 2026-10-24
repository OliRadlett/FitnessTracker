"""Lift-video tasks.

The analysis pipeline itself lives in the integrations and services. This module
holds the scheduled entry points.

`process_lift_video` and `reap_stale_videos` stay in the scheduler for now,
because the reaper dispatches the processor and moving one without the other
would create an import cycle.
"""

import logging

from app.tasks.celery_app import celery_app
from app.tasks.common import _run_task_guarded

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.scheduler.aggregate_video_analyses_weekly")
def aggregate_video_analyses_weekly() -> dict:
    """Weekly per-exercise video aggregation (B-27).

    Populates lift_video_analyses from analyzed LiftVideos. Pure local
    computation — no Modal, no Gemini.
    """
    import asyncio

    from sqlalchemy import select

    from app.database import task_session
    from app.models.user import User

    async def _run():
        async with task_session() as db:
            from app.services.video_analytics import (
                aggregate_video_analyses,
                flag_injury_risks,
                recalibrate_rpe,
            )

            users = list((await db.execute(select(User))).scalars().all())
            computed = 0
            failed = 0
            exercises = 0
            injury_flags = 0
            calibrations = 0
            tss_backfilled = 0
            for user in users:
                try:
                    from app.services.lifting import backfill_lifting_tss

                    exercises += await aggregate_video_analyses(db, user.id)
                    injury_flags += await flag_injury_risks(db, user.id)
                    calibrations += await recalibrate_rpe(db, user.id)
                    # force=True: the value is derived from sets and bodyweight,
                    # both of which change after the fact (B2).
                    tss_backfilled += await backfill_lifting_tss(db, user.id, force=True)
                    computed += 1
                except Exception as e:
                    failed += 1
                    logger.error(
                        f"Video aggregation failed for user {user.id}: {e}",
                        exc_info=True,
                    )
                    await db.rollback()
                else:
                    await db.commit()
            return {
                "users_computed": computed,
                "users_failed": failed,
                "users_total": len(users),
                "exercises": exercises,
                "injury_flags": injury_flags,
                "calibrations": calibrations,
                "tss_backfilled": tss_backfilled,
            }

    return asyncio.run(_run_task_guarded("aggregate_video_analyses_weekly", _run))
