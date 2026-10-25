"""Maintenance tasks.

Housekeeping that keeps tables bounded and heals rows a crashed process left
behind. Each task carries its explicit Celery name, so moving it here does not
change what beat or a queued message refers to.
"""

import logging

from app.tasks.celery_app import celery_app
from app.tasks.common import _run_task_guarded

logger = logging.getLogger(__name__)


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


@celery_app.task(name="app.tasks.scheduler.quarantine_orphaned_routes_weekly")
def quarantine_orphaned_routes_weekly() -> dict:
    """Stamp routes with no linked activities so the review queue has entries.

    The quarantine review UI and its /orphans endpoints shipped, but nothing
    produced the quarantined set, so the queue could never fill. Weekly is
    enough, because a route becomes an orphan only when its last activity link
    is removed, and a re-run skips rows already stamped.
    """
    import asyncio

    from sqlalchemy import select

    from app.database import task_session
    from app.models.user import User
    from app.services.route_quarantine import quarantine_orphaned_routes

    async def _run():
        async with task_session() as db:
            user_ids = (await db.execute(select(User.id))).scalars().all()
            quarantined = 0
            for user_id in user_ids:
                result = await quarantine_orphaned_routes(db, user_id, dry_run=False)
                quarantined += result["quarantined_now"]
            await db.commit()
            return {"users": len(user_ids), "quarantined": quarantined}

    return asyncio.run(_run_task_guarded("quarantine_orphaned_routes_weekly", _run))


@celery_app.task(name="app.tasks.scheduler.prune_expired_undo_logs")
def prune_expired_undo_logs() -> dict:
    """Drop undo claims past their retention window (plan §8, §2.4).

    Past ``expires_at`` an operation can no longer be reversed, so the row is
    audit data only and keeping it serves nothing but growth. Kept as a task
    rather than a request-path delete so a read never has to clean up after
    itself.

    Claims that have been *undone* are deliberately kept until they also expire:
    "this happened and was reversed" is more informative than deleting it, and
    it is the only trace that the operation was compensated at all.
    """
    import asyncio

    from app.database import task_session
    from app.services.undo import prune_expired

    async def _run():
        async with task_session() as db:
            removed = await prune_expired(db)
            await db.commit()
            return removed

    return asyncio.run(_run_task_guarded("prune_expired_undo_logs", _run))


@celery_app.task(name="app.tasks.scheduler.backup_database")
def backup_database() -> dict:
    """Run pg_dump to create a compressed backup of the database.

    Backups are saved to the configured backup directory (default /backups).
    Old backups (older than 30 days) are automatically cleaned up.

    NOTE: This task runs inside the Docker container. The backup directory
    should be a mounted volume for persistence across container restarts.
    """
    import glob
    import os
    import subprocess
    from datetime import UTC, datetime, timedelta

    from app.config import get_settings

    settings = get_settings()
    backup_dir = settings.backup_dir
    os.makedirs(backup_dir, exist_ok=True)

    timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    filename = f"fittrack_backup_{timestamp}.sql.gz"
    filepath = os.path.join(backup_dir, filename)

    db_url = settings.database_url

    # Parse connection details from the async URL
    # postgresql+asyncpg://user:pass@host:port/dbname -> user, pass, host, port, dbname
    from urllib.parse import urlparse

    parsed = urlparse(db_url.replace("postgresql+asyncpg://", "postgresql://"))
    db_user = parsed.username or "fittrack"
    db_host = parsed.hostname or "db"
    db_port = str(parsed.port or 5432)
    db_name = (parsed.path or "/fittrack").lstrip("/")

    try:
        cmd = [
            "pg_dump",
            "-h",
            db_host,
            "-p",
            db_port,
            "-U",
            db_user,
            "-d",
            db_name,
            "--no-password",
            "--compress=zstd:3",
        ]

        with open(filepath, "wb") as f:
            result = subprocess.run(
                cmd,
                stdout=f,
                stderr=subprocess.PIPE,
                timeout=3600,  # 1 hour timeout
                env={**os.environ, "PGPASSWORD": parsed.password or ""},
            )

        if result.returncode != 0:
            logger.error(
                "Database backup failed: pg_dump exited with code %d: %s",
                result.returncode,
                result.stderr.decode() if result.stderr else "no stderr",
            )
            # Clean up partial file
            if os.path.exists(filepath):
                os.remove(filepath)
            return {
                "status": "failed",
                "error": result.stderr.decode() if result.stderr else "unknown",
            }

        file_size = os.path.getsize(filepath)
        logger.info(
            "Database backup completed: %s (%.2f MB)",
            filepath,
            file_size / (1024 * 1024),
        )

    except subprocess.TimeoutExpired:
        logger.error("Database backup timed out after 1 hour")
        if os.path.exists(filepath):
            os.remove(filepath)
        return {"status": "failed", "error": "timeout"}
    except FileNotFoundError:
        logger.error(
            "pg_dump not found — ensure postgresql-client is installed in the container"
        )
        return {"status": "failed", "error": "pg_dump not found"}
    except Exception as e:
        logger.error("Database backup failed: %s", e, exc_info=True)
        if os.path.exists(filepath):
            os.remove(filepath)
        return {"status": "failed", "error": str(e)}

    # Clean up backups older than 30 days
    cutoff = datetime.now(UTC) - timedelta(days=30)
    deleted_count = 0
    for old_backup in glob.glob(os.path.join(backup_dir, "fittrack_backup_*.sql.gz")):
        try:
            # Extract timestamp from filename: fittrack_backup_YYYYMMDD_HHMMSS.sql.gz
            basename = os.path.basename(old_backup)
            ts_str = basename.replace("fittrack_backup_", "").replace(".sql.gz", "")
            backup_dt = datetime.strptime(ts_str, "%Y%m%d_%H%M%S")
            if backup_dt < cutoff:
                os.remove(old_backup)
                deleted_count += 1
                logger.info("Deleted old backup: %s", old_backup)
        except (ValueError, OSError) as e:
            logger.warning("Could not process old backup %s: %s", old_backup, e)

    return {
        "status": "success",
        "filepath": filepath,
        "size_mb": round(file_size / (1024 * 1024), 2),
        "deleted_old_backups": deleted_count,
    }
