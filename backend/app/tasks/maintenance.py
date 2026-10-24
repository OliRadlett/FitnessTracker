"""Maintenance tasks.

Housekeeping that keeps tables bounded and heals rows a crashed process left
behind. Each task carries its explicit Celery name, so moving it here does not
change what beat or a queued message refers to.
"""

from app.tasks.celery_app import celery_app


@celery_app.task(name="app.tasks.scheduler.cleanup_old_data")
def cleanup_old_data() -> dict:
    """Weekly maintenance: heal orphaned live lifting sessions.

    A live lift session whose tab was killed can linger with ``ended_at IS
    NULL`` forever, polluting the lifting list and skipping Whoop matching.
    Any session with a ``started_at`` older than 24h and no ``ended_at`` is
    an abandoned live session (a genuine workout ages out in minutes) — close
    it with a short 5-minute span and an explicit auto-close note.

    Second pass: already-closed sessions with implausible durations (≥3h,
    e.g. a stale live finish that landed days late) default to their linked
    Strava activity's recorded time when one is linked.

    Activity streams are intentionally retained indefinitely (no cleanup).
    """
    import asyncio
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import select

    from app.database import task_session
    from app.models.lifting import LiftingSession

    async def _run():
        cutoff = datetime.now(UTC) - timedelta(hours=24)
        async with task_session() as db:
            result = await db.execute(
                select(LiftingSession).where(
                    LiftingSession.started_at.isnot(None),
                    LiftingSession.started_at < cutoff,
                    LiftingSession.ended_at.is_(None),
                )
            )
            orphans = list(result.scalars().all())
            for session in orphans:
                closed = session.started_at + timedelta(minutes=5)
                session.ended_at = closed
                if session.duration_seconds is None:
                    session.duration_seconds = max(
                        1, int((closed - session.started_at).total_seconds())
                    )
                session.notes = (
                    session.notes + " — " if session.notes else ""
                ) + "(auto-closed — orphaned live session)"

            # Heal already-closed sessions with implausible durations (≥3h):
            # default to the linked Strava activity's recorded time.
            from app.models.activity import Activity
            from app.services.lifting import (
                MAX_PLAUSIBLE_SESSION_DURATION_SECONDS,
                apply_strava_duration_fallback,
            )

            overlong = await db.execute(
                select(LiftingSession).where(
                    LiftingSession.duration_seconds
                    >= MAX_PLAUSIBLE_SESSION_DURATION_SECONDS,
                    LiftingSession.activity_id.isnot(None),
                )
            )
            fallbacks = 0
            for session in list(overlong.scalars().all()):
                activity = await db.get(Activity, session.activity_id)
                if activity is not None and apply_strava_duration_fallback(
                    session, activity
                ):
                    session.notes = (
                        session.notes + " — " if session.notes else ""
                    ) + "(duration defaulted to linked Strava activity)"
                    fallbacks += 1

            await db.commit()
            return {
                "auto_closed_lifting_sessions": len(orphans),
                "strava_duration_fallbacks": fallbacks,
                "deleted_streams": 0,
                "note": "Streams retained indefinitely; orphaned lifting sessions auto-closed",
            }

    return asyncio.run(_run())
