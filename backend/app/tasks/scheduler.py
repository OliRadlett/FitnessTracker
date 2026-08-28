"""Celery tasks — scheduler.py with Redis broker, Beat schedule."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC

from celery import Celery
from celery.schedules import crontab

from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

# ── Celery app ────────────────────────────────────────────────────────────────

celery_app = Celery(
    "fittrack",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    result_expires=3600,
)


# ── Concurrency guards ────────────────────────────────────────────────────────
# Celery Beat can enqueue a task while a previous instance is still running
# (a slow sync > 30 min, or an acks_late redelivery after a worker crash).
# Redis locks make each sync task single-instance and prevent manual syncs
# from overlapping the scheduled ones for the same user.


async def _run_task_guarded(task_name: str, _run) -> dict:
    """Run a task's ``_run()`` coroutine under a Redis lock.

    Returns ``{"status": "skipped_lock"}`` if another instance is running.
    A Redis outage fails open (logs a warning, runs unlocked) so a broker
    problem never silently halts all syncing.
    """
    from app.metrics import SYNC_RUNS
    from app.services.cache import redis_lock

    lock = redis_lock(f"celery-task:{task_name}", ttl=3600)
    try:
        await lock.__aenter__()
    except RuntimeError:
        logger.warning(f"{task_name} skipped — another instance is running")
        SYNC_RUNS.labels(task=task_name, outcome="skipped_lock").inc()
        return {"status": "skipped_lock"}
    except Exception as e:
        logger.warning(f"{task_name}: Redis unavailable — running without a lock ({e})")
        return await _run()
    try:
        result = await _run()
        SYNC_RUNS.labels(task=task_name, outcome="success").inc()
        return result
    except Exception:
        SYNC_RUNS.labels(task=task_name, outcome="failure").inc()
        raise
    finally:
        await lock.__aexit__(None, None, None)


class _NoopLock:
    """Async context manager that does nothing — used when Redis is down so
    per-user sync still proceeds without the concurrency guard."""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


async def _try_acquire_user_lock(user_id, provider: str, ttl: int = 1800):
    """Best-effort acquire the ``sync:{user}:{provider}`` lock.

    Returns the lock context manager, ``None`` if it is genuinely held by
    another run (scheduled task or manual sync), or a no-op lock if Redis
    is unavailable (fail open — a Redis outage must not stop syncing).
    """
    from app.services.cache import redis_lock

    try:
        cm = redis_lock(f"sync:{user_id}:{provider}", ttl=ttl)
        await cm.__aenter__()
        return cm
    except RuntimeError:
        return None
    except Exception as e:
        logger.warning(
            f"Redis unavailable for sync lock ({e}) — proceeding without lock"
        )
        return _NoopLock()


# ── Beat schedule ─────────────────────────────────────────────────────────────

celery_app.conf.beat_schedule = {
    # Sync Strava activities every 30 minutes
    "sync-strava-activities": {
        "task": "app.tasks.scheduler.sync_all_strava_activities",
        "schedule": crontab(minute="*/30"),
        "options": {"expires": 3600},
    },
    # Drain the Strava webhook queue (async, with retries)
    "process-strava-webhook-events": {
        "task": "app.tasks.scheduler.process_strava_webhook_events",
        "schedule": crontab(minute="*/5"),
        "options": {"expires": 900},
    },
    # Weekly Strava reconciliation — heals missed deletes/renames
    "reconcile-strava-activities": {
        "task": "app.tasks.scheduler.reconcile_strava_activities",
        "schedule": crontab(hour=4, minute=30, day_of_week=0),
        "options": {"expires": 3600},
    },
    # Generate daily health alerts at 6 AM UTC
    "generate-health-alerts": {
        "task": "app.tasks.scheduler.generate_health_alerts",
        "schedule": crontab(hour=6, minute=0),
    },
    # Clean up old webhook events weekly
    "cleanup-old-data": {
        "task": "app.tasks.scheduler.cleanup_old_data",
        "schedule": crontab(hour=3, minute=0, day_of_week=0),
    },
    # Sync routes from all providers every 2 hours
    "sync-routes": {
        "task": "app.tasks.scheduler.sync_all_routes",
        "schedule": crontab(minute=0, hour="*/2"),
        "options": {"expires": 3600},
    },
    # Compute route quality scores weekly (Sunday 3 AM UTC)
    "compute-route-quality": {
        "task": "app.tasks.scheduler.compute_route_quality_scores",
        "schedule": crontab(hour=3, minute=0, day_of_week=0),
    },
    # Auto-estimate FTP weekly for opted-in users (every Sunday at 4 AM UTC)
    "auto-estimate-ftp-weekly": {
        "task": "app.tasks.scheduler.auto_estimate_ftp_weekly",
        "schedule": crontab(hour=4, minute=0, day_of_week=0),
    },
    # Sync Whoop data every 30 minutes (cycles, recovery, sleep, workouts)
    "sync-whoop-data": {
        "task": "app.tasks.scheduler.sync_all_whoop_data",
        "schedule": crontab(minute="*/30"),
        "options": {"expires": 3600},
    },
    # Weekly database backup (Sunday 2 AM UTC)
    "backup-database": {
        "task": "app.tasks.scheduler.backup_database",
        "schedule": crontab(hour=2, minute=0, day_of_week=0),
    },
    # Weekly LLM cycling analysis (Sunday 5 AM UTC)
    "weekly-llm-analysis": {
        "task": "app.tasks.scheduler.weekly_llm_analysis",
        "schedule": crontab(hour=5, minute=0, day_of_week=0),
    },
    # Refresh weather forecast caches daily at 5 AM UTC
    "refresh-weather-forecasts": {
        "task": "app.tasks.scheduler.refresh_weather_forecasts",
        "schedule": crontab(hour=5, minute=0),
    },
    # Weekly goal check-ins (Monday 6 AM UTC)
    "record-goal-checkins": {
        "task": "app.tasks.scheduler.record_goal_checkins",
        "schedule": crontab(hour=6, minute=0, day_of_week=1),
    },
    # Daily training-plan reminder (7 AM UTC)
    "send-plan-reminders": {
        "task": "app.tasks.scheduler.send_plan_reminders",
        "schedule": crontab(hour=7, minute=0),
    },
    # Weekly streams backfill (Saturday 3 AM UTC) — fills gaps for cycling activities missing streams
    "backfill-streams": {
        "task": "app.tasks.scheduler.backfill_streams_for_all_activities",
        "schedule": crontab(hour=3, minute=0, day_of_week=6),
        "options": {"expires": 3600},
    },
}


# ── Task definitions ──────────────────────────────────────────────────────────


@celery_app.task(name="app.tasks.scheduler.sync_all_strava_activities")
def sync_all_strava_activities() -> dict:
    """Sync Strava activities for all connected users.

    This task is enqueued by Celery Beat every 30 minutes.
    It imports the async sync logic and runs it in an event loop.
    After syncing, it also backfills activity-to-lifting links and
    syncs Wahoo activities for users with Wahoo connections.

    Uses last_synced_at watermark to only fetch activities newer than
    the last successful sync (minus 24h overlap for late-arriving edits).
    """
    import asyncio
    from datetime import UTC, timedelta

    from sqlalchemy import select

    from app.database import task_session
    from app.integrations.errors import PermanentAuthError, TransientSyncError
    from app.models.user import OAuthConnection
    from app.services.connection_health import CONNECTION_STATUS_NEEDS_REAUTH
    from app.services.merge_service import backfill_activity_route_links
    from app.services.strava import link_all_unlinked_activities, sync_activities

    async def _run():
        async with task_session() as db:
            result = await db.execute(
                select(OAuthConnection).where(OAuthConnection.provider == "strava")
            )
            connections = list(result.scalars().all())
            synced_count = 0
            linked_count = 0
            route_linked_count = 0
            weather_tagged_count = 0
            plan_day_linked_count = 0
            for conn in connections:
                # BUG-072: skip connections awaiting re-authorisation — a dead
                # token would otherwise be retried (and fail) every 30 minutes.
                if conn.status == CONNECTION_STATUS_NEEDS_REAUTH:
                    continue

                # Don't overlap a manual sync (or a backfill) for the same user.
                lock = await _try_acquire_user_lock(conn.user_id, "strava")
                if lock is None:
                    logger.info(
                        f"Skipping Strava sync for user {conn.user_id} — already in progress"
                    )
                    continue

                # Compute incremental window: watermark minus 24h overlap
                after = None
                if conn.last_synced_at:
                    after = conn.last_synced_at - timedelta(hours=24)

                try:
                    truncated_ref: list[bool] = []
                    activities = await sync_activities(
                        db, conn.user_id, after=after, truncated_ref=truncated_ref
                    )
                    synced_count += len(activities)
                    # If the incremental window still has unfetched activities
                    # (backlog larger than one page), hold the watermark so the
                    # next run continues draining instead of permanently losing
                    # everything older than the fetched page.
                    if truncated_ref and truncated_ref[0]:
                        logger.warning(
                            f"Strava sync for user {conn.user_id} truncated — "
                            "more activities remain in the sync window; "
                            "watermark not advanced"
                        )
                        await db.commit()
                        continue
                    # Update watermark on success
                    from datetime import datetime

                    conn.last_synced_at = datetime.now(UTC)

                    # Tag recent activities with historical weather
                    try:
                        from app.services.weather import tag_recent_activities

                        tagged = await tag_recent_activities(db, conn.user_id)
                        weather_tagged_count += tagged
                    except Exception as e:
                        logger.warning(
                            f"Weather tagging failed for user {conn.user_id}: {e}",
                            exc_info=True,
                        )

                    # Auto-link activities/lifting sessions to training-plan days
                    try:
                        from app.services.conformity import link_activities_to_plan_days

                        plan_linked = await link_activities_to_plan_days(
                            db, conn.user_id
                        )
                        plan_day_linked_count += plan_linked
                    except Exception as e:
                        logger.warning(
                            f"Plan-day linking failed for user {conn.user_id}: {e}",
                            exc_info=True,
                        )

                    # Backfill links for any remaining unlinked activities
                    try:
                        linked = await link_all_unlinked_activities(db, conn.user_id)
                        linked_count += linked
                    except Exception as e:
                        logger.error(
                            f"Failed to backfill links for user {conn.user_id}: {e}",
                            exc_info=True,
                        )

                    # Backfill activity-to-route links
                    try:
                        rl = await backfill_activity_route_links(db, conn.user_id)
                        route_linked_count += rl
                    except Exception as e:
                        logger.error(
                            f"Failed to backfill route links for user {conn.user_id}: {e}",
                            exc_info=True,
                        )

                    # Commit this user's data (watermark + hooks) so a later
                    # crash doesn't roll back a successful sync.
                    await db.commit()
                except PermanentAuthError as e:
                    logger.warning(
                        f"Strava sync auth failure for user {conn.user_id}: {e}"
                    )
                    await db.rollback()
                except TransientSyncError as e:
                    logger.warning(
                        f"Strava sync transient failure for user {conn.user_id}: {e}"
                    )
                    await db.rollback()
                except Exception as e:
                    logger.error(
                        f"Failed to sync for user {conn.user_id}: {e}", exc_info=True
                    )
                    await db.rollback()
                finally:
                    await lock.__aexit__(None, None, None)

            # Also sync Wahoo activities for users with Wahoo connections
            wahoo_result = await db.execute(
                select(OAuthConnection).where(OAuthConnection.provider == "wahoo")
            )
            wahoo_connections = list(wahoo_result.scalars().all())
            wahoo_synced_count = 0
            for conn in wahoo_connections:
                if conn.status == CONNECTION_STATUS_NEEDS_REAUTH:
                    continue
                lock = await _try_acquire_user_lock(conn.user_id, "wahoo")
                if lock is None:
                    logger.info(
                        f"Skipping Wahoo sync for user {conn.user_id} — already in progress"
                    )
                    continue
                try:
                    from app.services.wahoo import sync_wahoo_activities

                    activities = await sync_wahoo_activities(db, conn.user_id)
                    wahoo_synced_count += len(activities)
                    # Only advance watermark if we actually got data back.
                    # If the API returned empty (or errored silently earlier),
                    # holding the watermark prevents permanently skipping data.
                    from datetime import datetime

                    if activities:
                        conn.last_synced_at = datetime.now(UTC)
                    await db.commit()
                except PermanentAuthError as e:
                    logger.warning(
                        f"Wahoo sync auth failure for user {conn.user_id}: {e}"
                    )
                    await db.rollback()
                except TransientSyncError as e:
                    logger.warning(
                        f"Wahoo sync transient failure for user {conn.user_id}: {e}"
                    )
                    await db.rollback()
                except Exception as e:
                    logger.error(
                        f"Failed to sync Wahoo activities for user {conn.user_id}: {e}",
                        exc_info=True,
                    )
                    await db.rollback()
                finally:
                    await lock.__aexit__(None, None, None)

            return {
                "synced_activities": synced_count,
                "wahoo_synced_activities": wahoo_synced_count,
                "linked_sessions": linked_count,
                "route_linked": route_linked_count,
                "weather_tagged": weather_tagged_count,
                "plan_day_linked": plan_day_linked_count,
                "users_processed": len(connections) + len(wahoo_connections),
            }

    return asyncio.run(_run_task_guarded("sync_all_strava_activities", _run))


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
    from app.integrations.errors import PermanentAuthError
    from app.models.user import OAuthConnection
    from app.services.connection_health import CONNECTION_STATUS_NEEDS_REAUTH
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


@celery_app.task(name="app.tasks.scheduler.generate_health_alerts")
def generate_health_alerts() -> dict:
    """Analyze recent metrics and generate health alerts.

    Uses HealthAnalysisService for composite scoring:
    - Overtraining (TSB + recovery + HRV + sleep efficiency)
    - Injury risk (volume spikes + rest days)
    - Illness detection (respiratory rate + HRV + sleep + unexplained fatigue)

    Also retains the original simple threshold checks for backward compatibility.
    """
    import asyncio
    from datetime import date, timedelta

    from sqlalchemy import func, select

    from app.database import task_session
    from app.models.daily_metric import DailyMetric
    from app.models.health_alert import HealthAlert
    from app.models.user import User
    from app.services.health_analysis import (
        analyze_illness,
        analyze_injury_risk,
        analyze_overtraining,
        upsert_alert,
    )

    async def _run():
        async with task_session() as db:
            users_result = await db.execute(select(User))
            users = list(users_result.scalars().all())
            alerts_created = 0

            for user in users:
                try:
                    # ── Composite analysis (Phase 6) ──────────────────────────
                    overtraining = await analyze_overtraining(db, user.id)
                    if await upsert_alert(db, user.id, overtraining):
                        alerts_created += 1

                    injury = await analyze_injury_risk(db, user.id)
                    if await upsert_alert(db, user.id, injury):
                        alerts_created += 1

                    illness = await analyze_illness(db, user.id)
                    if await upsert_alert(db, user.id, illness):
                        alerts_created += 1

                    # ── Simple threshold checks (legacy) ──────────────────────
                    cutoff = date.today() - timedelta(days=7)
                    result = await db.execute(
                        select(DailyMetric)
                        .where(
                            DailyMetric.user_id == user.id,
                            DailyMetric.metric_date >= cutoff,
                        )
                        .order_by(DailyMetric.metric_date.desc())
                    )
                    metrics = list(result.scalars().all())

                    if len(metrics) >= 3:
                        # HRV decline (>20% drop from average)
                        hrv_values = [m.hrv_ms for m in metrics if m.hrv_ms]
                        if len(hrv_values) >= 3:
                            avg_hrv = sum(hrv_values) / len(hrv_values)
                            recent_hrv = hrv_values[0]
                            if recent_hrv < avg_hrv * 0.8:
                                existing = await db.execute(
                                    select(HealthAlert).where(
                                        HealthAlert.user_id == user.id,
                                        HealthAlert.alert_type == "hrv_drop",
                                        HealthAlert.status == "active",
                                    )
                                )
                                if not existing.scalar_one_or_none():
                                    alert = HealthAlert(
                                        user_id=user.id,
                                        alert_type="hrv_drop",
                                        severity="warning",
                                        title="HRV Decline Detected",
                                        description=f"Your HRV has dropped to {recent_hrv:.0f}ms (avg: {avg_hrv:.0f}ms). Consider reducing training load.",
                                        evidence={
                                            "recent": recent_hrv,
                                            "average": avg_hrv,
                                        },
                                        detected_date=date.today(),
                                    )
                                    db.add(alert)
                                    alerts_created += 1

                        # Sleep decline
                        sleep_values = [
                            m.sleep_duration_minutes
                            for m in metrics
                            if m.sleep_duration_minutes
                        ]
                        if len(sleep_values) >= 3:
                            avg_sleep = sum(sleep_values) / len(sleep_values)
                            recent_sleep = sleep_values[0]
                            if recent_sleep < avg_sleep * 0.75:
                                existing = await db.execute(
                                    select(HealthAlert).where(
                                        HealthAlert.user_id == user.id,
                                        HealthAlert.alert_type == "sleep_decline",
                                        HealthAlert.status == "active",
                                    )
                                )
                                if not existing.scalar_one_or_none():
                                    alert = HealthAlert(
                                        user_id=user.id,
                                        alert_type="sleep_decline",
                                        severity="warning",
                                        title="Sleep Decline Detected",
                                        description=f"Your recent sleep ({recent_sleep:.0f}min) is significantly below average ({avg_sleep:.0f}min).",
                                        evidence={
                                            "recent": recent_sleep,
                                            "average": avg_sleep,
                                        },
                                        detected_date=date.today(),
                                    )
                                    db.add(alert)
                                    alerts_created += 1

                        # Respiratory rate elevation
                        rr_cutoff = date.today() - timedelta(days=30)
                        rr_result = await db.execute(
                            select(
                                func.avg(DailyMetric.respiratory_rate).label("avg_rr")
                            ).where(
                                DailyMetric.user_id == user.id,
                                DailyMetric.respiratory_rate.isnot(None),
                                DailyMetric.metric_date >= rr_cutoff,
                            )
                        )
                        rr_row = rr_result.one()
                        if rr_row.avg_rr:
                            baseline_rr = float(rr_row.avg_rr)
                            recent_rr_values = [
                                m.respiratory_rate
                                for m in metrics
                                if m.respiratory_rate
                            ]
                            if recent_rr_values:
                                current_rr = recent_rr_values[0]
                                if current_rr > baseline_rr * 1.1:
                                    existing = await db.execute(
                                        select(HealthAlert).where(
                                            HealthAlert.user_id == user.id,
                                            HealthAlert.alert_type
                                            == "respiratory_rate_elevated",
                                            HealthAlert.status == "active",
                                        )
                                    )
                                    if not existing.scalar_one_or_none():
                                        alert = HealthAlert(
                                            user_id=user.id,
                                            alert_type="respiratory_rate_elevated",
                                            severity="warning",
                                            title="Elevated Respiratory Rate",
                                            description=(
                                                f"Your respiratory rate ({current_rr:.1f} bpm) is elevated "
                                                f"compared to your baseline ({baseline_rr:.1f} bpm). "
                                                f"This can be an early sign of illness."
                                            ),
                                            evidence={
                                                "current": current_rr,
                                                "baseline": baseline_rr,
                                            },
                                            detected_date=date.today(),
                                        )
                                        db.add(alert)
                                        alerts_created += 1

                    await db.commit()
                except Exception as e:
                    logger.error(
                        f"Health alert generation failed for user {user.id}: {e}",
                        exc_info=True,
                    )
                    await db.rollback()
            return {"alerts_created": alerts_created, "users_analyzed": len(users)}

    return asyncio.run(_run())


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


@celery_app.task(name="app.tasks.scheduler.cleanup_old_data")
def cleanup_old_data() -> dict:
    """Clean up old activity streams and raw data to save space."""
    return {
        "deleted_streams": 0,
        "note": "Stream cleanup disabled — streams are retained indefinitely",
    }


@celery_app.task(name="app.tasks.scheduler.compute_route_quality_scores")
def compute_route_quality_scores() -> dict:
    """Recompute route quality scores for all routes.

    Runs weekly. For each route, computes completeness, popularity,
    surface quality, and effort match scores, then persists to
    the route_quality table and the routes.quality_score column.
    """
    import asyncio

    from sqlalchemy import select

    from app.database import task_session
    from app.models.route import Route

    async def _run():
        from app.services.route_quality_service import compute_and_store_quality

        async with task_session() as db:
            # Get all users with routes
            result = await db.execute(select(Route.user_id).distinct())
            user_ids = [r for (r,) in result.all()]

            total_routes = 0
            updated_routes = 0

            for user_id in user_ids:
                try:
                    result = await db.execute(
                        select(Route).where(Route.user_id == user_id)
                    )
                    routes = list(result.scalars().all())

                    for route in routes:
                        try:
                            await compute_and_store_quality(db, route, user_id)
                            updated_routes += 1
                        except Exception as e:
                            logger.warning(
                                f"Quality scoring failed for route {route.id}: {e}"
                            )
                    await db.commit()
                    total_routes += len(routes)
                except Exception as e:
                    logger.error(
                        f"Quality scoring batch failed for user {user_id}: {e}",
                        exc_info=True,
                    )
                    await db.rollback()

            return {
                "total_routes": total_routes,
                "updated_routes": updated_routes,
                "users_processed": len(user_ids),
            }

    return asyncio.run(_run_task_guarded("compute_route_quality_scores", _run))


@celery_app.task(name="app.tasks.scheduler.auto_estimate_ftp_weekly")
def auto_estimate_ftp_weekly() -> dict:
    """Auto-estimate FTP for all users with auto_estimate_ftp=True.

    Runs weekly. For each opted-in user, computes the best power curve from
    the last 90 days of stream data, estimates FTP, and records it in FTP history.
    Also updates the user's cycling profile if the estimate differs from current FTP.
    """
    import asyncio
    from datetime import date

    from sqlalchemy import select

    from app.database import task_session
    from app.models.cycling import CyclingProfile, FtpHistory
    from app.services.cycling import (
        compute_power_curve_from_streams,
        estimate_ftp_from_power_curve,
    )

    async def _run():
        async with task_session() as db:
            # Find all users with auto_estimate_ftp enabled
            result = await db.execute(
                select(CyclingProfile).where(
                    CyclingProfile.auto_estimate_ftp == True,
                )
            )
            profiles = list(result.scalars().all())

            estimated_count = 0
            for profile in profiles:
                try:
                    best_power = await compute_power_curve_from_streams(
                        db, profile.user_id, days=90
                    )
                    if not best_power:
                        continue

                    estimated_ftp = estimate_ftp_from_power_curve(best_power)
                    if not estimated_ftp:
                        continue

                    # Only update if the estimate differs meaningfully (>2W)
                    if profile.ftp_watts and abs(estimated_ftp - profile.ftp_watts) < 2:
                        continue

                    old_ftp = profile.ftp_watts
                    profile.ftp_watts = estimated_ftp

                    # Determine source method for notes
                    source_method = None
                    if 1200 in best_power:
                        source_method = f"20-min: {best_power[1200]} W × 0.95"
                    elif 480 in best_power:
                        source_method = f"8-min: {best_power[480]} W × 0.855"
                    elif 300 in best_power:
                        source_method = f"5-min: {best_power[300]} W × 0.95"

                    ftp_entry = FtpHistory(
                        user_id=profile.user_id,
                        ftp_watts=estimated_ftp,
                        effective_date=date.today(),
                        source="estimated",
                        notes=(
                            f"Auto-estimated: {source_method} (was {old_ftp}W)"
                            if source_method
                            else f"Auto-estimated (was {old_ftp}W)"
                        ),
                    )
                    db.add(ftp_entry)
                    estimated_count += 1
                    await db.commit()

                except Exception as e:
                    logger.error(
                        f"Failed to auto-estimate FTP for user {profile.user_id}: {e}",
                        exc_info=True,
                    )
                    await db.rollback()
            return {
                "users_checked": len(profiles),
                "ftp_estimated": estimated_count,
            }

    return asyncio.run(_run())


@celery_app.task(name="app.tasks.scheduler.sync_all_whoop_data")
def sync_all_whoop_data() -> dict:
    """Sync all Whoop data for connected users: cycles, recovery, sleep, workouts.

    This task is enqueued by Celery Beat every 30 minutes.
    It fetches Whoop cycles (with recovery), sleep data, and workout data.
    Workout enrichment matches to existing Strava activities.
    Auto-refreshes expired tokens when a refresh_token is available.

    Uses last_synced_at watermark to only fetch recent data (minus 24h overlap).
    """
    import asyncio
    from datetime import UTC, timedelta

    from sqlalchemy import select

    from app.database import task_session
    from app.integrations.errors import PermanentAuthError, TransientSyncError
    from app.models.user import OAuthConnection
    from app.services.connection_health import (
        CONNECTION_STATUS_NEEDS_REAUTH,
        mark_connection_reauth,
    )
    from app.services.whoop import (
        refresh_if_needed,
        sync_whoop_cycles,
        sync_whoop_sleep,
        sync_whoop_weight,
        sync_whoop_workouts,
    )

    async def _run():
        async with task_session() as db:
            result = await db.execute(
                select(OAuthConnection).where(OAuthConnection.provider == "whoop")
            )
            connections = list(result.scalars().all())
            synced_cycles = 0
            synced_sleep = 0
            synced_workouts = 0
            skipped_reauth = 0
            skipped_transient = 0

            for conn in connections:
                # BUG-072: never keep hammering a provider whose token has been
                # revoked/expired — require the user to re-authorise first.
                if conn.status == CONNECTION_STATUS_NEEDS_REAUTH:
                    skipped_reauth += 1
                    continue

                # Don't overlap a manual sync for the same user.
                lock = await _try_acquire_user_lock(conn.user_id, "whoop")
                if lock is None:
                    logger.info(
                        f"Skipping Whoop sync for user {conn.user_id} — already in progress"
                    )
                    skipped_transient += 1
                    continue

                # Auto-refresh token if needed
                try:
                    conn = await refresh_if_needed(db, conn)
                except PermanentAuthError as e:
                    skipped_reauth += 1
                    logger.warning(f"Skipping Whoop sync for user {conn.user_id}: {e}")
                    await lock.__aexit__(None, None, None)
                    continue
                except TransientSyncError as e:
                    skipped_transient += 1
                    logger.warning(
                        f"Whoop refresh transient failure for user {conn.user_id}: {e}"
                    )
                    await lock.__aexit__(None, None, None)
                    continue

                # Compute incremental window: watermark minus 24h overlap
                start = None
                if conn.last_synced_at:
                    start = (conn.last_synced_at - timedelta(hours=24)).strftime(
                        "%Y-%m-%dT%H:%M:%S.000Z"
                    )

                user_failed = False

                try:
                    metrics = await sync_whoop_cycles(db, conn.user_id, start=start)
                    synced_cycles += len(metrics)
                except PermanentAuthError as e:
                    skipped_reauth += 1
                    logger.warning(
                        f"Whoop cycle sync auth failure for user {conn.user_id}: {e}"
                    )
                    await mark_connection_reauth(db, conn, str(e))
                    user_failed = True
                except TransientSyncError as e:
                    logger.warning(
                        f"Whoop cycle sync transient failure for user {conn.user_id}: {e}"
                    )
                    user_failed = True
                except Exception as e:
                    logger.error(
                        f"Whoop cycle sync error for user {conn.user_id}: {e}",
                        exc_info=True,
                    )
                    user_failed = True

                if not user_failed:
                    try:
                        sleep_logs = await sync_whoop_sleep(
                            db, conn.user_id, start=start
                        )
                        synced_sleep += len(sleep_logs)
                    except PermanentAuthError as e:
                        skipped_reauth += 1
                        logger.warning(
                            f"Whoop sleep sync auth failure for user {conn.user_id}: {e}"
                        )
                        await mark_connection_reauth(db, conn, str(e))
                        user_failed = True
                    except TransientSyncError as e:
                        logger.warning(
                            f"Whoop sleep sync transient failure for user {conn.user_id}: {e}"
                        )
                    except Exception as e:
                        logger.error(
                            f"Whoop sleep sync error for user {conn.user_id}: {e}",
                            exc_info=True,
                        )

                if not user_failed:
                    try:
                        enriched = await sync_whoop_workouts(
                            db, conn.user_id, start=start
                        )
                        synced_workouts += len(enriched)
                    except PermanentAuthError as e:
                        skipped_reauth += 1
                        logger.warning(
                            f"Whoop workout sync auth failure for user {conn.user_id}: {e}"
                        )
                        await mark_connection_reauth(db, conn, str(e))
                        user_failed = True
                    except TransientSyncError as e:
                        logger.warning(
                            f"Whoop workout sync transient failure for user {conn.user_id}: {e}"
                        )
                    except Exception as e:
                        logger.error(
                            f"Whoop workout sync error for user {conn.user_id}: {e}",
                            exc_info=True,
                        )

                if not user_failed:
                    # Sync body weight from Whoop
                    try:
                        await sync_whoop_weight(db, conn.user_id)
                    except PermanentAuthError as e:
                        skipped_reauth += 1
                        logger.warning(
                            f"Whoop weight sync auth failure for user {conn.user_id}: {e}"
                        )
                        await mark_connection_reauth(db, conn, str(e))
                        user_failed = True
                    except TransientSyncError as e:
                        logger.warning(
                            f"Whoop weight sync transient failure for user {conn.user_id}: {e}"
                        )
                    except Exception as e:
                        logger.error(
                            f"Whoop weight sync error for user {conn.user_id}: {e}",
                            exc_info=True,
                        )

                if user_failed:
                    await db.rollback()
                else:
                    # Update watermark on success and commit
                    from datetime import datetime

                    conn.last_synced_at = datetime.now(UTC)
                    await db.commit()
                await lock.__aexit__(None, None, None)
            return {
                "synced_cycles": synced_cycles,
                "synced_sleep": synced_sleep,
                "synced_workouts": synced_workouts,
                "skipped_reauth": skipped_reauth,
                "skipped_transient": skipped_transient,
                "users_processed": len(connections),
            }

    return asyncio.run(_run_task_guarded("sync_all_whoop_data", _run))


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
    from datetime import datetime, timedelta, timezone

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


@celery_app.task(name="app.tasks.scheduler.weekly_llm_analysis")
def weekly_llm_analysis() -> dict:
    """Run LLM cycling analysis for all users with Gemini API key configured."""
    import asyncio

    from sqlalchemy import select

    from app.database import task_session
    from app.models.user import User

    settings = get_settings()
    if not settings.gemini_api_key:
        return {"status": "skipped", "reason": "GEMINI_API_KEY not configured"}

    async def _run():
        async with task_session() as db:
            result = await db.execute(select(User))
            users = list(result.scalars().all())
            analyzed = 0
            failed = 0
            for user in users:
                try:
                    from app.services.llm_analysis import run_llm_analysis

                    await run_llm_analysis(db, user.id)
                    analyzed += 1
                except Exception as e:
                    failed += 1
                    logger.error(
                        f"LLM analysis failed for user {user.id}: {e}", exc_info=True
                    )
                    # Roll back the poisoned session so a failing user's
                    # partially-flushed writes don't leak into the next user's
                    # commit (per-user isolation like every other task loop).
                    await db.rollback()
                else:
                    # Commit per user so a mid-task crash doesn't discard the
                    # analyses already written for other users.
                    await db.commit()
            return {
                "users_analyzed": analyzed,
                "users_failed": failed,
                "users_total": len(users),
            }

    return asyncio.run(_run())


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


async def _goal_milestone_notifications(db, user_id: uuid.UUID) -> int:
    """Fire notifications when an active goal crosses 50/75/100% progress.

    Progress is computed as absolute movement toward the target (sign-aware for
    both increase and decrease goals), compared against the previous check-in.
    Dedup keys make each crossing fire exactly once.
    """
    from datetime import date

    from sqlalchemy import select

    from app.models.goal import Goal, GoalCheckIn
    from app.services.notifications import notify

    today = date.today()
    goals = list(
        (
            await db.execute(
                select(Goal).where(Goal.user_id == user_id, Goal.status == "active")
            )
        )
        .scalars()
        .all()
    )
    fired = 0
    for goal in goals:
        if goal.current_value is None or goal.starting_value is None:
            continue
        target_delta = goal.target_value - goal.starting_value
        if target_delta == 0:
            continue

        prev_result = await db.execute(
            select(GoalCheckIn.value)
            .where(
                GoalCheckIn.goal_id == goal.id,
                GoalCheckIn.check_in_date < today,
            )
            .order_by(GoalCheckIn.check_in_date.desc(), GoalCheckIn.created_at.desc())
            .limit(1)
        )
        prev = prev_result.scalar_one_or_none()
        prev_pct = (
            round((prev - goal.starting_value) / target_delta * 100, 1)
            if prev is not None
            else 0.0
        )
        cur_pct = round(
            (goal.current_value - goal.starting_value) / target_delta * 100, 1
        )

        label = f"{goal.metric} — target {goal.target_value:g}"
        for threshold in (50, 75):
            if prev_pct < threshold <= cur_pct:
                await notify(
                    db,
                    user_id,
                    type="goal_milestone",
                    title=f"Goal {threshold:.0f}% reached",
                    body=label,
                    severity="info",
                    link="/goals",
                    dedup_key=f"goal:{goal.id}:{threshold:.0f}",
                    metadata={"metric": goal.metric, "progress_pct": cur_pct},
                )
                fired += 1
        if goal.status == "achieved" and prev_pct < 100:
            await notify(
                db,
                user_id,
                type="goal_milestone",
                title="Goal achieved",
                body=label,
                severity="success",
                link="/goals",
                dedup_key=f"goal:{goal.id}:achieved",
                metadata={"metric": goal.metric, "progress_pct": cur_pct},
            )
            fired += 1
    return fired


@celery_app.task(name="app.tasks.scheduler.send_plan_reminders")
def send_plan_reminders() -> dict:
    """Daily morning reminder for today's planned training session.

    One notification per user per day (dedup keyed on the date) when an active
    plan schedules a non-rest session today. Per-user failures are isolated.
    """
    import asyncio
    from datetime import date

    from sqlalchemy import select

    from app.database import task_session
    from app.models.training_plan import TrainingPlan, TrainingPlanDay
    from app.models.user import User
    from app.services.notifications import notify

    async def _run():
        today = date.today()
        notified = 0
        async with task_session() as db:
            users = list((await db.execute(select(User))).scalars().all())
            for user in users:
                try:
                    day = await _find_today_plan_day(db, user.id, today)
                    if day is None:
                        continue
                    created = await notify(
                        db,
                        user.id,
                        type="plan_reminder",
                        title="Today's plan",
                        body=_plan_reminder_body(day),
                        severity="info",
                        link="/training",
                        dedup_key=f"plan_reminder:{today}",
                        metadata={"focus": day.planned_focus},
                    )
                    if created is not None:
                        notified += 1
                    await db.commit()
                except Exception as e:
                    logger.warning(
                        f"Plan reminder failed for user {user.id}: {e}",
                        exc_info=True,
                    )
                    await db.rollback()
        return {"notified": notified}

    return asyncio.run(_run())


async def _find_today_plan_day(db, user_id: uuid.UUID, today) -> TrainingPlanDay | None:
    """Return today's non-rest plan day across the user's active plans."""
    from sqlalchemy import select

    from app.models.training_plan import TrainingPlan, TrainingPlanDay

    plans = list(
        (
            await db.execute(
                select(TrainingPlan).where(
                    TrainingPlan.user_id == user_id,
                    TrainingPlan.status == "active",
                    TrainingPlan.start_date <= today,
                    TrainingPlan.end_date >= today,
                )
            )
        )
        .scalars()
        .all()
    )
    for plan in plans:
        days = list(
            (
                await db.execute(
                    select(TrainingPlanDay).where(
                        TrainingPlanDay.plan_id == plan.id,
                        TrainingPlanDay.day_date == today,
                    )
                )
            )
            .scalars()
            .all()
        )
        for day in days:
            if day.sport != "rest":
                return day
    return None


def _plan_reminder_body(day: TrainingPlanDay) -> str:
    """Human-readable summary of a planned day for the reminder body."""
    focus = day.planned_focus or "training"
    if day.planned_exercises:
        try:
            names = ", ".join(
                str(e.get("exercise") or e.get("name") or e)
                for e in day.planned_exercises[:5]
            )
            if names:
                return f"{focus} — {names}"
        except Exception:
            pass
    if day.planned_volume_kg:
        return f"{focus} — {day.planned_volume_kg:,.0f} kg volume"
    if day.planned_duration_min:
        return f"{focus} — {day.planned_duration_min} min"
    if day.workout_description:
        return f"{focus} — {day.workout_description[:120]}"
    if day.planned_tss:
        return f"{focus} — {day.planned_tss:.0f} TSS"
    return f"{focus} — planned session"


@celery_app.task(name="app.tasks.scheduler.record_goal_checkins")
def record_goal_checkins() -> dict:
    """Weekly goal check-in snapshot (Monday 6 AM UTC).

    For every user, snapshots each ACTIVE goal's metric value into
    ``goal_checkins`` (source="auto") with the alignment score at that moment.
    Goals that already have a check-in for today are skipped. Per-user
    failures are logged and skipped so one bad goal never kills the loop.
    """
    import asyncio

    from sqlalchemy import select

    from app.database import task_session
    from app.models.goal import Goal
    from app.models.user import User
    from app.services.goals import record_all_check_ins

    async def _run():
        async with task_session() as db:
            users_result = await db.execute(select(User))
            users = list(users_result.scalars().all())
            checkins_recorded = 0
            goals_active = 0
            milestone_notifications = 0

            for user in users:
                try:
                    active = await db.execute(
                        select(Goal.id).where(
                            Goal.user_id == user.id, Goal.status == "active"
                        )
                    )
                    goals_active += len(list(active.scalars().all()))
                    recorded = await record_all_check_ins(db, user.id)
                    checkins_recorded += recorded
                    milestone_notifications = await _goal_milestone_notifications(
                        db, user.id
                    )
                    await db.commit()
                except Exception as e:
                    logger.warning(
                        f"Goal check-ins failed for user {user.id}: {e}",
                        exc_info=True,
                    )
                    await db.rollback()

            return {
                "users_total": len(users),
                "goals_active": goals_active,
                "checkins_recorded": checkins_recorded,
                "milestone_notifications": milestone_notifications,
            }

    return asyncio.run(_run())
