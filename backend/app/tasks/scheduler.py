"""Celery tasks — scheduler.py with Redis broker, Beat schedule."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime

import httpx
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
    from app.services.cache import LockHeldError, redis_lock

    lock = redis_lock(f"celery-task:{task_name}", ttl=3600)
    try:
        await lock.__aenter__()
    except LockHeldError:
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
    from app.services.cache import LockHeldError, redis_lock

    try:
        cm = redis_lock(f"sync:{user_id}:{provider}", ttl=ttl)
        await cm.__aenter__()
        return cm
    except LockHeldError:
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
    # Classify route terrain weekly (Saturday 2:30 AM UTC, before quality scoring)
    "classify-route-terrain": {
        "task": "app.tasks.scheduler.classify_route_terrain",
        "schedule": crontab(hour=2, minute=30, day_of_week=6),
    },
    # Recompute ride segments + efforts weekly (Sunday 3:15 AM UTC, post quality)
    "recompute-ride-segments": {
        "task": "app.tasks.scheduler.recompute_ride_segments",
        "schedule": crontab(hour=3, minute=15, day_of_week=0),
    },
    # Backfill cached ride context weekly (§1.3 — Sunday 3:30 AM UTC, post streams/segments)
    "backfill-activity-context": {
        "task": "app.tasks.scheduler.backfill_activity_context",
        "schedule": crontab(hour=3, minute=30, day_of_week=0),
    },
    # Fit personalized power models weekly (Sunday 5:30 AM UTC, post streams/FTP)
    "fit-personalized-power-models": {
        "task": "app.tasks.scheduler.fit_personalized_power_models",
        "schedule": crontab(hour=5, minute=30, day_of_week=0),
        "options": {"expires": 7200},
    },
    # Analyze weather-performance correlations weekly (Sunday 6 AM UTC)
    "analyze-weather-performance": {
        "task": "app.tasks.scheduler.analyze_weather_performance_weekly",
        "schedule": crontab(hour=6, minute=0, day_of_week=0),
        "options": {"expires": 7200},
    },
    # Analyze segments: clustering, difficulty, predictions (Sunday 6:15 AM UTC)
    "analyze-segments-intelligence": {
        "task": "app.tasks.scheduler.analyze_segments_intelligence_weekly",
        "schedule": crontab(hour=6, minute=15, day_of_week=0),
        "options": {"expires": 7200},
    },
    # Cross-domain correlation analysis (Sunday 7 AM UTC)
    "analyze-cross-domain": {
        "task": "app.tasks.scheduler.analyze_cross_domain_weekly",
        "schedule": crontab(hour=7, minute=0, day_of_week=0),
        "options": {"expires": 7200},
    },
    # Auto-estimate FTP weekly for opted-in users (every Sunday at 4 AM UTC)
    "auto-estimate-ftp-weekly": {
        "task": "app.tasks.scheduler.auto_estimate_ftp_weekly",
        "schedule": crontab(hour=4, minute=0, day_of_week=0),
    },
    # Check cycling power PRs weekly (Sunday 4:30 AM UTC — after stream backfill)
    "check-cycling-prs-weekly": {
        "task": "app.tasks.scheduler.check_cycling_prs_weekly",
        "schedule": crontab(hour=4, minute=30, day_of_week=0),
        "options": {"expires": 3600},
    },
    # FTP drift scan for non-auto users (Sunday 4:15 AM UTC, post auto-estimate)
    "check-stale-ftp": {
        "task": "app.tasks.scheduler.check_stale_ftp",
        "schedule": crontab(hour=4, minute=15, day_of_week=0),
    },
    # Sync Whoop data every 30 minutes (cycles, recovery, sleep, workouts)
    "sync-whoop-data": {
        "task": "app.tasks.scheduler.sync_all_whoop_data",
        "schedule": crontab(minute="*/30"),
        "options": {"expires": 3600},
    },
    # Sync Withings scale data every 30 minutes (weight + body composition)
    "sync-withings-data": {
        "task": "app.tasks.scheduler.sync_all_withings_data",
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
    # Nightly athlete-insight compute (Feature 3/B-15, daily 3 AM UTC)
    "compute-athlete-insights-nightly": {
        "task": "app.tasks.scheduler.compute_athlete_insights_nightly",
        "schedule": crontab(hour=3, minute=0),
        "options": {"expires": 3600},
    },
    # Weekly video aggregation (B-27, Sunday 7:30 AM UTC)
    "aggregate-video-analyses-weekly": {
        "task": "app.tasks.scheduler.aggregate_video_analyses_weekly",
        "schedule": crontab(hour=7, minute=30, day_of_week=0),
        "options": {"expires": 3600},
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
    # Weekly plan review (Monday 6:15 AM UTC, after the goal check-ins).
    # Monday 6:30/6:45 are taken by the daily event-day + countdown tasks,
    # so 6:15 is the earliest free Monday slot after the 6 AM check-ins.
    "weekly-plan-review": {
        "task": "app.tasks.scheduler.weekly_plan_review",
        "schedule": crontab(hour=6, minute=15, day_of_week=1),
    },
    # Weekly digest (B-22, Monday 8 AM UTC): weekly summary + streak
    # milestones + deload detection.
    "send-weekly-digest": {
        "task": "app.tasks.scheduler.send_weekly_digest",
        "schedule": crontab(hour=8, minute=0, day_of_week=1),
        "options": {"expires": 3600},
    },
    # Daily training-plan reminder (7 AM UTC)
    "send-plan-reminders": {
        "task": "app.tasks.scheduler.send_plan_reminders",
        "schedule": crontab(hour=7, minute=0),
    },
    # Daily event/race-day notification (6:30 AM UTC)
    "send-event-day-notifications": {
        "task": "app.tasks.scheduler.send_event_day_notifications",
        "schedule": crontab(hour=6, minute=30),
    },
    # Daily event countdown + taper-start notification (6:45 AM UTC)
    "send-event-countdown-notifications": {
        "task": "app.tasks.scheduler.send_event_countdown_notifications",
        "schedule": crontab(hour=6, minute=45),
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
                    await mark_connection_reauth(db, conn, str(e))
                    await db.rollback()
                except httpx.HTTPStatusError as e:
                    # SYNC-03: raw 401/403 mid-sync (revoked after refresh
                    # check) → needs_reauth + banner; else transient tally.
                    logger.warning(
                        f"Strava sync HTTP failure for user {conn.user_id}: {e}"
                    )
                    await handle_sync_http_error(db, conn, e)
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
                    await mark_connection_reauth(db, conn, str(e))
                    await db.rollback()
                except httpx.HTTPStatusError as e:
                    # SYNC-03: see Strava loop above.
                    logger.warning(
                        f"Wahoo sync HTTP failure for user {conn.user_id}: {e}"
                    )
                    await handle_sync_http_error(db, conn, e)
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
    from app.models.user import User
    from app.services.health_analysis import (
        analyze_illness,
        analyze_injury_risk,
        analyze_overtraining,
        analyze_regeneration_signals,
        upsert_alert,
    )
    from app.services.notifications import notify

    async def _run():
        async with task_session() as db:
            users_result = await db.execute(select(User))
            users = list(users_result.scalars().all())
            alerts_created = 0

            for user in users:
                try:
                    # §3.12 alert tuning — user-disabled alert types are skipped.
                    disabled_set = set(
                        (user.health_preferences or {}).get("disabled") or []
                    )

                    # ── Composite analysis (Phase 6) ──────────────────────────
                    if "overtraining" not in disabled_set:
                        overtraining = await analyze_overtraining(db, user.id)
                        if await upsert_alert(db, user.id, overtraining):
                            alerts_created += 1

                    if "injury_risk" not in disabled_set:
                        injury = await analyze_injury_risk(db, user.id)
                        if await upsert_alert(db, user.id, injury):
                            alerts_created += 1

                    if "illness" not in disabled_set:
                        illness = await analyze_illness(db, user.id)
                        if await upsert_alert(db, user.id, illness):
                            alerts_created += 1

                    # ── §3.12 regeneration signals ───────────────────────────
                    # performance_decline, sleep_consistency,
                    # resting_hr_elevation — respect per-user health preferences
                    # (disabled / snoozed / threshold overrides).
                    for reg in await analyze_regeneration_signals(db, user.id):
                        if await upsert_alert(db, user.id, reg):
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
                        # HRV decline (>20% drop from average). Routed through
                        # upsert_alert so disabled/snoozed prefs, dismiss
                        # quiet-period, and /health deep-links apply (QW7).
                        hrv_values = [m.hrv_ms for m in metrics if m.hrv_ms]
                        if len(hrv_values) >= 3 and "hrv_drop" not in disabled_set:
                            avg_hrv = sum(hrv_values) / len(hrv_values)
                            recent_hrv = hrv_values[0]
                            if recent_hrv < avg_hrv * 0.8:
                                if await upsert_alert(
                                    db,
                                    user.id,
                                    {
                                        "alert_type": "hrv_drop",
                                        "severity": "warning",
                                        "title": "HRV Decline Detected",
                                        "description": f"Your HRV has dropped to {recent_hrv:.0f}ms (avg: {avg_hrv:.0f}ms). Consider reducing training load.",
                                        "evidence": {
                                            "recent": recent_hrv,
                                            "average": avg_hrv,
                                        },
                                    },
                                ):
                                    alerts_created += 1

                        # Sleep decline (same upsert routing as above).
                        sleep_values = [
                            m.sleep_duration_minutes
                            for m in metrics
                            if m.sleep_duration_minutes
                        ]
                        if (
                            len(sleep_values) >= 3
                            and "sleep_decline" not in disabled_set
                        ):
                            avg_sleep = sum(sleep_values) / len(sleep_values)
                            recent_sleep = sleep_values[0]
                            if recent_sleep < avg_sleep * 0.75:
                                if await upsert_alert(
                                    db,
                                    user.id,
                                    {
                                        "alert_type": "sleep_decline",
                                        "severity": "warning",
                                        "title": "Sleep Decline Detected",
                                        "description": f"Your recent sleep ({recent_sleep:.0f}min) is significantly below average ({avg_sleep:.0f}min).",
                                        "evidence": {
                                            "recent": recent_sleep,
                                            "average": avg_sleep,
                                        },
                                    },
                                ):
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
                            if (
                                recent_rr_values
                                and "respiratory_rate_elevated" not in disabled_set
                            ):
                                current_rr = recent_rr_values[0]
                                if current_rr > baseline_rr * 1.1:
                                    if await upsert_alert(
                                        db,
                                        user.id,
                                        {
                                            "alert_type": "respiratory_rate_elevated",
                                            "severity": "warning",
                                            "title": "Elevated Respiratory Rate",
                                            "description": (
                                                f"Your respiratory rate ({current_rr:.1f} bpm) is elevated "
                                                f"compared to your baseline ({baseline_rr:.1f} bpm). "
                                                f"This can be an early sign of illness."
                                            ),
                                            "evidence": {
                                                "current": current_rr,
                                                "baseline": baseline_rr,
                                            },
                                        },
                                    ):
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


@celery_app.task(name="app.tasks.scheduler.compute_route_quality_scores")
def compute_route_quality_scores() -> dict:
    """Recompute route quality scores for all routes.

    Runs weekly. For each route, computes completeness, popularity,
    surface quality, and effort match scores, then persists to
    the route_quality table and the routes.quality_score column.
    """
    import asyncio

    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

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
                        select(Route)
                        .where(Route.user_id == user_id)
                        .options(selectinload(Route.sources))
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


@celery_app.task(name="app.tasks.scheduler.classify_route_terrain")
def classify_route_terrain() -> dict:
    """Classify terrain for all routes with elevation profiles.

    Runs weekly (Saturday 2:30 AM UTC, before quality scoring).
    Uses Modal for batch analysis when configured, falls back to
    local classification otherwise.
    """
    import asyncio

    from sqlalchemy import select

    from app.database import task_session
    from app.models.route import Route

    async def _run():
        async with task_session() as db:
            # Get all routes with elevation profiles but no terrain classification
            result = await db.execute(
                select(Route).where(
                    Route.elevation_profile.isnot(None),
                    Route.terrain_classification.is_(None),
                )
            )
            routes_to_classify = list(result.scalars().all())

            if not routes_to_classify:
                return {"classified": 0, "note": "All routes already classified"}

            # Try Modal for batch classification
            classified = 0
            try:
                from app.integrations.route_intelligence import (
                    analyze_routes_on_modal,
                    classify_route_terrain,
                )

                # Prepare route data for Modal
                routes_data = []
                for route in routes_to_classify:
                    points = []
                    if route.encoded_polyline:
                        from app.services.polyline_utils import decode_polyline

                        points = decode_polyline(route.encoded_polyline)
                    routes_data.append(
                        {
                            "id": str(route.id),
                            "polyline": [(p[0], p[1]) for p in points],
                            "distance_meters": route.distance_meters,
                            "elevation_gain_meters": route.elevation_gain_meters or 0,
                            "elevation_profile": route.elevation_profile,
                        }
                    )

                # Call Modal for batch terrain classification
                modal_result = analyze_routes_on_modal(
                    routes_data=routes_data,
                    compute_similarity=False,
                    compute_terrain=True,
                    compute_effort_predictions=False,
                )

                terrain_classifications = modal_result.get("terrain_classifications", {})

                for route in routes_to_classify:
                    terrain = terrain_classifications.get(str(route.id))
                    if terrain:
                        route.terrain_classification = terrain
                        classified += 1

                await db.commit()

            except Exception as e:
                logger.warning(
                    f"Modal terrain classification failed, falling back to local: {e}"
                )
                # Fallback: local classification
                from app.integrations.route_intelligence import classify_route_terrain

                for route in routes_to_classify:
                    try:
                        terrain = classify_route_terrain(route.elevation_profile)
                        route.terrain_classification = terrain
                        classified += 1
                    except Exception as e2:
                        logger.warning(
                            f"Local terrain classification failed for route {route.id}: {e2}"
                        )
                await db.commit()

            return {
                "classified": classified,
                "total": len(routes_to_classify),
            }

    return asyncio.run(_run_task_guarded("classify_route_terrain", _run))


@celery_app.task(name="app.tasks.scheduler.recompute_ride_segments")
def recompute_ride_segments() -> dict:
    """Recompute ride segments (§3.13) for all users with cycling routes.

    Runs weekly. For each cycling route, detects climb segments from the
    route geometry + elevation profile, then distance-aligns linked activity
    streams to compute per-segment efforts and PRs (leaderboard-of-self).
    """
    import asyncio

    from sqlalchemy import select

    from app.database import task_session
    from app.models.route import Route

    async def _run():
        from app.services.segments import recompute_all_user_segments

        async with task_session() as db:
            result = await db.execute(
                select(Route.user_id).where(Route.sport_type == "cycling").distinct()
            )
            user_ids = [r for (r,) in result.all()]

            total_segments = 0
            done = 0
            for user_id in user_ids:
                try:
                    total_segments += await recompute_all_user_segments(db, user_id)
                    await db.commit()
                    done += 1
                except Exception as e:
                    logger.error(
                        f"Segment recompute failed for user {user_id}: {e}",
                        exc_info=True,
                    )
                    await db.rollback()

            return {
                "total_segments": total_segments,
                "users_processed": done,
            }

    return asyncio.run(_run_task_guarded("recompute_ride_segments", _run))


@celery_app.task(name="app.tasks.scheduler.backfill_activity_context")
def backfill_activity_context() -> dict:
    """Precompute cached ride context (§1.3) for cycling activities that have
    streams but no `context` yet — rows predating the sync-time compute, or
    activities whose streams were backfilled later. Idempotent (skips rows
    that already have context).
    """
    import asyncio

    from sqlalchemy import select

    from app.database import task_session
    from app.models.activity import Activity

    async def _run():
        from app.services.activity_context import ensure_activity_contexts_by_id

        async with task_session() as db:
            result = await db.execute(
                select(Activity.user_id)
                .where(
                    Activity.sport_type == "cycling",
                    Activity.context.is_(None),
                )
                .distinct()
            )
            user_ids = [r for (r,) in result.all()]

            total_stored = 0
            done = 0
            for user_id in user_ids:
                try:
                    ids_result = await db.execute(
                        select(Activity.id).where(
                            Activity.user_id == user_id,
                            Activity.sport_type == "cycling",
                            Activity.context.is_(None),
                        )
                    )
                    ids = [r for (r,) in ids_result.all()]
                    total_stored += await ensure_activity_contexts_by_id(db, ids)
                    await db.commit()
                    done += 1
                except Exception as e:
                    logger.error(
                        f"Context backfill failed for user {user_id}: {e}",
                        exc_info=True,
                    )
                    await db.rollback()

            return {
                "users_processed": done,
                "contexts_stored": total_stored,
            }

    return asyncio.run(_run_task_guarded("backfill_activity_context", _run))


@celery_app.task(name="app.tasks.scheduler.fit_personalized_power_models")
def fit_personalized_power_models() -> dict:
    """Fit personalized power models for all cycling users via Modal.

    Runs weekly (Sunday 5:30 AM UTC). For each user with cycling activities:
    1. Computes the best power curve from streams → fits CP/W' (Morton 2004)
    2. Collects steady-state rides → fits personalized VO2max from power-HR regression
    3. Collects daily TSS + HRV → fits adaptive CTL/ATL time constants

    Requires MODAL_TOKEN_ID + MODAL_TOKEN_SECRET. Skips gracefully if unset.
    """
    import asyncio

    from sqlalchemy import select

    from app.database import task_session
    from app.models.activity import Activity, ActivityStream
    from app.models.cycling import CyclingPowerRecord, CyclingProfile
    from app.models.user import User
    from app.services.cycling.power_curve import (
        POWER_DURATION_BUCKETS,
        compute_power_curve_from_streams,
    )

    async def _run():
        import json

        from app.integrations.power_models import (
            _modal_configured,
            fit_personalized_vo2max,
            fit_power_models_on_modal,
        )

        if not _modal_configured():
            return {"skipped": True, "reason": "Modal not configured"}

        async with task_session() as db:
            # Get all users with a cycling profile
            result = await db.execute(
                select(CyclingProfile.user_id).distinct()
            )
            user_ids = [row[0] for row in result.all()]

            fitted_count = 0
            errors: list[str] = []

            for uid in user_ids:
                try:
                    # 1. Build power curve data from CyclingPowerRecord
                    result = await db.execute(
                        select(CyclingPowerRecord).where(
                            CyclingPowerRecord.user_id == uid
                        )
                    )
                    records = list(result.scalars().all())

                    durations = []
                    best_watts = []
                    for rec in records:
                        if rec.duration_seconds and rec.power_watts:
                            durations.append(rec.duration_seconds)
                            best_watts.append(rec.power_watts)

                    # Fall back to stream-based curve if no records
                    if not durations:
                        best_power = await compute_power_curve_from_streams(
                            db, uid, days=90
                        )
                        durations = list(best_power.keys())
                        best_watts = list(best_power.values())

                    if not durations:
                        continue

                    power_curve_data = {
                        "durations": durations,
                        "best_watts": best_watts,
                    }

                    # 2. Collect steady-state rides for VO2max fitting
                    # (activities >20min with relatively stable power)
                    result = await db.execute(
                        select(Activity).where(
                            Activity.user_id == uid,
                            Activity.sport_type == "cycling",
                            Activity.duration_seconds >= 1200,  # >20min
                            Activity.average_power.isnot(None),
                            Activity.average_heartrate.isnot(None),
                        ).order_by(Activity.start_date.desc()).limit(100)
                    )
                    activities = list(result.scalars().all())

                    steady_state_rides = []
                    for act in activities:
                        if (
                            act.average_power
                            and act.average_power > 0
                            and act.average_heartrate
                            and act.average_heartrate > 0
                        ):
                            steady_state_rides.append(
                                {
                                    "avg_watts": float(act.average_power),
                                    "avg_hr": float(act.average_heartrate),
                                    "duration_seconds": int(act.duration_seconds or 0),
                                }
                            )

                    # 3. Get weight
                    profile_result = await db.execute(
                        select(CyclingProfile).where(
                            CyclingProfile.user_id == uid
                        )
                    )
                    profile = profile_result.scalar_one_or_none()
                    weight = profile.weight_kg if profile else None

                    # 3b. Daily TSS + HRV for adaptive CTL/ATL time constants
                    # (QW: these were previously never passed, so the Modal
                    # worker always fell back to the default 42/7 constants.)
                    from datetime import date, timedelta

                    from app.models.daily_metric import DailyMetric
                    from app.services.cycling import get_daily_tss

                    today = date.today()
                    window_start = today - timedelta(days=90)
                    tss_by_day = await get_daily_tss(db, uid, window_start, today)
                    daily_tss_data = [
                        {"date": day.isoformat(), "tss": float(tss)}
                        for day, tss in tss_by_day.items()
                    ]

                    hrv_result = await db.execute(
                        select(DailyMetric.metric_date, DailyMetric.hrv_ms).where(
                            DailyMetric.user_id == uid,
                            DailyMetric.metric_date >= window_start,
                            DailyMetric.metric_date <= today,
                            DailyMetric.hrv_ms.isnot(None),
                        )
                    )
                    hrv_data = [
                        {"date": m.metric_date.isoformat(), "hrv_ms": float(m.hrv_ms)}
                        for m in hrv_result.all()
                    ]

                    # 4. Call Modal
                    results = fit_power_models_on_modal(
                        power_curve_data=power_curve_data,
                        steady_state_rides=steady_state_rides,
                        daily_tss=daily_tss_data,
                        hrv_data=hrv_data,
                        weight_kg=weight,
                    )

                    # 5. Store results in CyclingProfile
                    if profile and results.get("critical_power"):
                        cp_result = results["critical_power"]
                        if cp_result.get("cp"):
                            profile.critical_power = cp_result["cp"]
                            profile.w_prime = cp_result.get("w_prime")
                            profile.power_model_r_squared = cp_result.get(
                                "model_r_squared"
                            )
                        vo2_result = results.get("personalized_vo2max", {})
                        if vo2_result.get("vo2max"):
                            profile.personalized_vo2max = vo2_result["vo2max"]
                        constants = results.get("adaptive_constants", {})
                        if constants.get("ctl_tau"):
                            profile.ctl_tau = constants["ctl_tau"]
                        if constants.get("atl_tau"):
                            profile.atl_tau = constants["atl_tau"]
                        profile.power_model_fitted_at = datetime.now(UTC)

                        fitted_count += 1
                        await db.commit()

                except Exception as e:
                    logger.error(
                        f"Failed to fit power model for user {uid}: {e}",
                        exc_info=True,
                    )
                    errors.append(str(uid))
                    await db.rollback()

            return {
                "users_checked": len(user_ids),
                "models_fitted": fitted_count,
                "errors": errors,
            }

    return asyncio.run(_run_task_guarded("fit_personalized_power_models", _run))


@celery_app.task(name="app.tasks.scheduler.analyze_weather_performance_weekly")
def analyze_weather_performance_weekly() -> dict:
    """Analyze weather-performance correlations for all cycling users via Modal.

    Runs weekly (Sunday 6 AM UTC). For each user with enough weather-tagged
    cycling activities, collects ride data with weather conditions, computes
    personalized weather coefficients and insights via Modal, and stores
    results in the cycling profile.

    Requires MODAL_TOKEN_ID + MODAL_TOKEN_SECRET. Skips gracefully if unset.
    """
    import asyncio

    from sqlalchemy import select

    from app.database import task_session
    from app.models.activity import Activity
    from app.models.cycling import CyclingProfile

    async def _run():
        from app.integrations.weather_analysis import (
            _modal_configured,
            analyze_weather_on_modal,
        )

        if not _modal_configured():
            return {"skipped": True, "reason": "Modal not configured"}

        async with task_session() as db:
            # Get all users with a cycling profile
            result = await db.execute(
                select(CyclingProfile.user_id).distinct()
            )
            user_ids = [row[0] for row in result.all()]

            analyzed_count = 0
            errors: list[str] = []

            for uid in user_ids:
                try:
                    # Collect cycling activities with weather data
                    result = await db.execute(
                        select(Activity).where(
                            Activity.user_id == uid,
                            Activity.sport_type == "cycling",
                            Activity.weather_temperature.isnot(None),
                            Activity.average_power.isnot(None),
                            Activity.duration_seconds >= 600,  # >10min
                        ).order_by(Activity.start_date.desc()).limit(200)
                    )
                    activities = list(result.scalars().all())

                    if len(activities) < 15:
                        continue

                    # Build rides data for Modal
                    rides = []
                    for act in activities:
                        ride = {
                            "date": act.start_date.date().isoformat()
                            if act.start_date
                            else None,
                            "avg_watts": float(act.average_power)
                            if act.average_power
                            else None,
                            "normalized_power": float(act.normalized_power)
                            if act.normalized_power
                            else None,
                            # Decoupling lives in the §1.3 context JSONB, not as
                            # a model column (QW5 — hasattr was always False).
                            "decoupling_pct": float((act.context or {}).get("decoupling_pct"))
                            if (act.context or {}).get("decoupling_pct")
                            else None,
                            "avg_hr": float(act.average_heartrate)
                            if act.average_heartrate
                            else None,
                            "moving_time": int(act.duration_seconds)
                            if act.duration_seconds
                            else None,
                            "weather": {
                                "temperature": float(act.weather_temperature)
                                if act.weather_temperature
                                else None,
                                "wind_speed_kmh": float(act.weather_wind_speed_kmh)
                                if act.weather_wind_speed_kmh
                                else None,
                                "wind_direction": None,  # stored as string, parse if needed
                                "humidity": None,  # not stored on activity model
                                "precipitation_mm": float(act.weather_precipitation_mm)
                                if act.weather_precipitation_mm
                                else None,
                                "pressure_hpa": None,  # not stored on activity model
                                "conditions": act.weather_conditions,
                            },
                        }
                        rides.append(ride)

                    # Call Modal
                    results = analyze_weather_on_modal(rides)

                    # Store results in CyclingProfile
                    profile_result = await db.execute(
                        select(CyclingProfile).where(
                            CyclingProfile.user_id == uid
                        )
                    )
                    profile = profile_result.scalar_one_or_none()

                    if profile and results.get("data_quality", {}).get("sufficient"):
                        # Store the full analysis payload: the API reads
                        # power_vs_temp / power_vs_wind / decoupling_vs_temp /
                        # hr_vs_temp / weather_coefficients from this column
                        # (QW5 — previously only the nested coefficients were
                        # stored, leaving every correlation card empty).
                        # Insights live in weather_insights; skip the dup.
                        profile.weather_coefficients = {
                            k: v
                            for k, v in results.items()
                            if k != "personalized_insights"
                        }
                        profile.weather_insights = results.get(
                            "personalized_insights"
                        )
                        profile.weather_analyzed_at = datetime.now(UTC)
                        analyzed_count += 1
                        await db.commit()

                except Exception as e:
                    logger.error(
                        f"Failed to analyze weather for user {uid}: {e}",
                        exc_info=True,
                    )
                    errors.append(str(uid))
                    await db.rollback()

            return {
                "users_checked": len(user_ids),
                "users_analyzed": analyzed_count,
                "errors": errors,
            }

    return asyncio.run(_run_task_guarded("analyze_weather_performance_weekly", _run))


@celery_app.task(name="app.tasks.scheduler.analyze_segments_intelligence_weekly")
def analyze_segments_intelligence_weekly() -> dict:
    """Analyze segment intelligence: clustering, difficulty, predictions via Modal.

    Runs weekly (Sunday 6:15 AM UTC). For each user with segments, clusters
    segments by gradient signature, classifies climb types, and predicts
    personal effort for each segment.

    Requires MODAL_TOKEN_ID + MODAL_TOKEN_SECRET. Skips gracefully if unset.
    """
    import asyncio

    from sqlalchemy import select

    from app.database import task_session
    from app.models.cycling import CyclingProfile
    from app.models.segment import Segment, SegmentEffort

    async def _run():
        from app.integrations.segment_intelligence import (
            _modal_configured,
            analyze_segments_on_modal,
        )

        if not _modal_configured():
            return {"skipped": True, "reason": "Modal not configured"}

        async with task_session() as db:
            # Get all users with segments
            result = await db.execute(
                select(Segment.user_id).distinct()
            )
            user_ids = [row[0] for row in result.all()]

            analyzed_count = 0
            errors: list[str] = []

            for uid in user_ids:
                try:
                    # Get user's segments
                    result = await db.execute(
                        select(Segment).where(Segment.user_id == uid)
                    )
                    segments = list(result.scalars().all())

                    if not segments:
                        continue

                    # Get efforts for these segments
                    segment_ids = [s.id for s in segments]
                    result = await db.execute(
                        select(SegmentEffort).where(
                            SegmentEffort.segment_id.in_(segment_ids)
                        )
                    )
                    efforts = list(result.scalars().all())

                    # Get user fitness
                    profile_result = await db.execute(
                        select(CyclingProfile).where(
                            CyclingProfile.user_id == uid
                        )
                    )
                    profile = profile_result.scalar_one_or_none()
                    user_fitness = {
                        "ctl": 50,  # default
                        "atl": 30,
                        "recent_vam": 1000,
                    }
                    if profile:
                        # Use training load if available
                        from datetime import date, timedelta

                        from app.services.cycling import (
                            compute_training_load,
                            get_daily_tss,
                        )

                        today = date.today()
                        daily_tss = await get_daily_tss(
                            db, uid, today - timedelta(days=90), today
                        )
                        series = compute_training_load(
                            daily_tss, today, lookback_days=90
                        )
                        if series:
                            latest = series[-1]
                            user_fitness["ctl"] = latest.get("ctl", 50)
                            user_fitness["atl"] = latest.get("atl", 30)

                    # Build data for Modal
                    segments_data = []
                    for seg in segments:
                        segments_data.append({
                            "id": str(seg.id),
                            "route_id": str(seg.route_id),
                            "distance_m": seg.distance_m,
                            "elevation_gain_m": seg.elevation_gain_m,
                            "avg_gradient_pct": seg.avg_gradient_pct,
                            "max_gradient_pct": seg.max_gradient_pct,
                            "start_lat": seg.start_lat,
                            "start_lng": seg.start_lng,
                            "end_lat": seg.end_lat,
                            "end_lng": seg.end_lng,
                        })

                    efforts_data = []
                    for eff in efforts:
                        efforts_data.append({
                            "segment_id": str(eff.segment_id),
                            "elapsed_seconds": eff.elapsed_seconds,
                            "avg_power_watts": eff.avg_power_watts,
                            "avg_hr": eff.avg_hr,
                            "effort_vam": eff.effort_vam,
                        })

                    # Call Modal
                    results = analyze_segments_on_modal(
                        segments_data, efforts_data, user_fitness
                    )

                    # Update segments with results
                    for seg in segments:
                        seg_id = str(seg.id)
                        smoothed = results.get("smoothed_segments", {}).get(seg_id, {})
                        prediction = results.get("difficulty_predictions", {}).get(seg_id, {})

                        # Find cluster
                        cluster_id = None
                        for cluster in results.get("similarity_clusters", []):
                            if seg_id in cluster.get("segment_ids", []):
                                cluster_id = cluster.get("cluster_id")
                                break

                        seg.cluster_id = cluster_id
                        seg.climb_type = smoothed.get("climb_type")
                        seg.sustainedness = smoothed.get("sustainedness")
                        seg.difficulty_score = prediction.get("difficulty_score")
                        seg.predicted_vam = prediction.get("predicted_vam")
                        seg.predicted_time_seconds = prediction.get("predicted_time_seconds")
                        seg.predicted_power_watts = prediction.get("predicted_power_watts")
                        seg.prediction_confidence = prediction.get("confidence")
                        seg.intelligence_analyzed_at = datetime.now(UTC)

                    analyzed_count += 1
                    await db.commit()

                except Exception as e:
                    logger.error(
                        f"Failed to analyze segments for user {uid}: {e}",
                        exc_info=True,
                    )
                    errors.append(str(uid))
                    await db.rollback()

            return {
                "users_checked": len(user_ids),
                "users_analyzed": analyzed_count,
                "errors": errors,
            }

    return asyncio.run(_run_task_guarded("analyze_segments_intelligence_weekly", _run))


async def _build_race_retrospective_args(db, uid) -> tuple[dict, str | None]:
    """Assemble race-retrospective inputs for the most recent raced event (CD3).

    Finds the latest past event with a logged result (last 90 days), builds
    ``race_data`` from the best cycling activity logged on race day plus the
    stored result, ``pre_race_data`` from eve-of-race TSB / target TSS / plan
    conformity, 30 days of pre-race training, and race-day weather.

    Returns ``(modal_kwargs, event_id_str)``; ``modal_kwargs`` is empty when
    there is no eligible event or a retrospective was already stored for it.
    All values are JSON-safe for the Modal boundary.
    """
    from datetime import date, timedelta

    from sqlalchemy import func, select

    from app.models.activity import Activity
    from app.models.cross_domain import CrossDomainInsight
    from app.models.event import Event
    from app.models.training_plan import TrainingPlan
    from app.services.cycling import (
        CTL_WARMUP_DAYS,
        compute_training_load,
        get_daily_tss,
    )

    today = date.today()
    result = await db.execute(
        select(Event)
        .where(
            Event.user_id == uid,
            Event.result.isnot(None),
            # Cleared results can persist as JSON null rather than SQL NULL
            # (driver quirk) — exclude those too. jsonb_typeof(NULL) is NULL
            # (row filtered out), jsonb_typeof('null') is 'null'.
            func.jsonb_typeof(Event.result) == "object",
            Event.event_date <= today,
            Event.event_date >= today - timedelta(days=90),
        )
        .order_by(Event.event_date.desc())
        .limit(1)
    )
    event = result.scalar_one_or_none()
    if not event:
        return {}, None

    # Dedup: a retrospective was already stored for this event.
    result = await db.execute(
        select(CrossDomainInsight).where(
            CrossDomainInsight.user_id == uid,
            CrossDomainInsight.insight_type == "race_retrospective",
        )
    )
    for ins in result.scalars().all():
        if isinstance(ins.results, dict) and ins.results.get("event_id") == str(
            event.id
        ):
            return {}, None

    # Race-day actuals: best cycling activity logged on the event date.
    result = await db.execute(
        select(Activity)
        .where(
            Activity.user_id == uid,
            func.date(Activity.start_date) == event.event_date,
            Activity.sport_type == "cycling",
        )
        .order_by(Activity.tss.desc().nulls_last())
        .limit(1)
    )
    race_act = result.scalar_one_or_none()

    res = event.result or {}
    race_data = {
        "date": event.event_date.isoformat(),
        "event_name": event.name,
        "actual_watts": float(race_act.average_power)
        if race_act and race_act.average_power
        else None,
        "actual_np": float(race_act.normalized_power)
        if race_act and race_act.normalized_power
        else None,
        "actual_tss": float(race_act.tss) if race_act and race_act.tss else None,
        "actual_distance": round(float(race_act.distance_meters) / 1000, 1)
        if race_act and race_act.distance_meters
        else None,
        "actual_duration": int(race_act.duration_seconds)
        if race_act and race_act.duration_seconds
        else None,
        "actual_elevation": round(float(race_act.elevation_gain_meters), 0)
        if race_act and race_act.elevation_gain_meters
        else None,
        "finish_time": res.get("finishing_time"),
        "finish_position": res.get("finishing_position"),
        "class_position": res.get("class_position"),
        "personal_best": res.get("personal_best"),
    }

    # Eve-of-race TSB from the training-load series.
    eve = event.event_date - timedelta(days=1)
    tsb_eve = None
    try:
        daily = await get_daily_tss(
            db, uid, eve - timedelta(days=90 + CTL_WARMUP_DAYS), eve
        )
        series = compute_training_load(daily, eve, lookback_days=90)
        if series:
            tsb_eve = round(series[-1]["tsb"], 1)
    except Exception:
        tsb_eve = None

    # Plan conformity from the event-linked plan, when one exists.
    plan_pct = None
    result = await db.execute(
        select(TrainingPlan)
        .where(
            TrainingPlan.user_id == uid,
            TrainingPlan.event_id == event.id,
        )
        .order_by(TrainingPlan.created_at.desc())
        .limit(1)
    )
    plan = result.scalar_one_or_none()
    if plan is not None:
        try:
            from app.services.conformity import get_plan_conformity

            conf = await get_plan_conformity(db, uid, plan.id)
            plan_pct = conf.get("overall_pct")
        except Exception:
            plan_pct = None

    pre_race_data = {
        "tsb_projected": tsb_eve,
        "target_watts": None,
        "target_tss": float(event.target_tss)
        if event.target_tss is not None
        else None,
        "plan_conformity_pct": plan_pct,
        "fuel_plan_adherence_pct": None,
    }

    # 30 days of pre-race training load.
    window_start = event.event_date - timedelta(days=30)
    result = await db.execute(
        select(Activity)
        .where(
            Activity.user_id == uid,
            func.date(Activity.start_date) >= window_start,
            func.date(Activity.start_date) < event.event_date,
            Activity.tss.isnot(None),
        )
        .order_by(Activity.start_date.asc())
    )
    race_training = [
        {
            "date": a.start_date.date().isoformat() if a.start_date else None,
            "tss": float(a.tss),
            "type": a.sport_type,
        }
        for a in result.scalars().all()
    ]

    race_weather = None
    if race_act and (
        race_act.weather_temperature is not None
        or race_act.weather_wind_speed_kmh is not None
    ):
        race_weather = {
            "temperature": float(race_act.weather_temperature)
            if race_act.weather_temperature is not None
            else None,
            "wind_speed_kmh": float(race_act.weather_wind_speed_kmh)
            if race_act.weather_wind_speed_kmh is not None
            else None,
            "conditions": race_act.weather_conditions,
        }

    return (
        {
            "race_data": race_data,
            "pre_race_data": pre_race_data,
            "race_training_data": race_training,
            "race_weather_data": race_weather,
        },
        str(event.id),
    )


@celery_app.task(name="app.tasks.scheduler.analyze_cross_domain_weekly")
def analyze_cross_domain_weekly() -> dict:
    """Analyze cross-domain correlations: sleep-performance, cross-sport, race retrospective.

    Runs weekly (Sunday 7 AM UTC). For each user with sufficient data,
    collects sleep, training, and performance data, runs cross-domain
    analysis via Modal, and stores insights in cross_domain_insights table.

    Requires MODAL_TOKEN_ID + MODAL_TOKEN_SECRET. Skips gracefully if unset.
    """
    import asyncio
    from datetime import datetime, timedelta

    from sqlalchemy import select

    from app.database import task_session
    from app.models.activity import Activity
    from app.models.cross_domain import CrossDomainInsight
    from app.models.cycling import CyclingProfile
    from app.models.daily_metric import DailyMetric
    from app.models.event import Event
    from app.models.lifting import LiftingSession
    from app.models.sleep import SleepLog

    async def _run():
        from app.integrations.cross_domain import (
            _modal_configured,
            analyze_cross_domain_on_modal,
        )

        if not _modal_configured():
            return {"skipped": True, "reason": "Modal not configured"}

        async with task_session() as db:
            # Get all users
            result = await db.execute(
                select(CyclingProfile.user_id).distinct()
            )
            user_ids = [row[0] for row in result.all()]

            analyzed_count = 0
            errors: list[str] = []

            for uid in user_ids:
                try:
                    # Collect sleep data (last 90 days)
                    cutoff = datetime.now(UTC) - timedelta(days=90)
                    result = await db.execute(
                        select(SleepLog).where(
                            SleepLog.user_id == uid,
                            SleepLog.created_at >= cutoff,
                        ).order_by(SleepLog.sleep_date.desc())
                    )
                    sleep_logs = list(result.scalars().all())

                    sleep_data = []
                    for log in sleep_logs:
                        total_h = None
                        if log.total_sleep_seconds:
                            total_h = log.total_sleep_seconds / 3600
                        elif log.sleep_start and log.sleep_end:
                            delta = (log.sleep_end - log.sleep_start).total_seconds()
                            total_h = delta / 3600

                        deep_h = log.deep_sleep_seconds / 3600 if log.deep_sleep_seconds else None
                        rem_h = log.rem_sleep_seconds / 3600 if log.rem_sleep_seconds else None

                        sleep_data.append({
                            "date": log.sleep_date.isoformat(),
                            "total_sleep_hours": round(total_h, 2) if total_h else None,
                            "deep_sleep_hours": round(deep_h, 2) if deep_h else None,
                            "rem_sleep_hours": round(rem_h, 2) if rem_h else None,
                            "sleep_efficiency": log.sleep_efficiency,
                        })

                    # Collect performance data from DailyMetric (HRV, recovery)
                    result = await db.execute(
                        select(DailyMetric).where(
                            DailyMetric.user_id == uid,
                            DailyMetric.created_at >= cutoff,
                        ).order_by(DailyMetric.metric_date.desc())
                    )
                    daily_metrics = list(result.scalars().all())

                    # Enrich sleep data with HRV and recovery from DailyMetric
                    metric_by_date = {m.metric_date.isoformat(): m for m in daily_metrics}
                    for s in sleep_data:
                        metric = metric_by_date.get(s["date"])
                        if metric:
                            s["hrv_ms"] = metric.hrv_ms
                            s["recovery_score"] = metric.recovery_score

                    recovery_data = [
                        {
                            "date": m.metric_date.isoformat(),
                            "recovery_score": m.recovery_score,
                            "hrv_ms": m.hrv_ms,
                            "resting_hr": m.resting_hr,
                        }
                        for m in daily_metrics
                        if m.recovery_score is not None
                    ]

                    # Collect cycling performance data
                    result = await db.execute(
                        select(Activity).where(
                            Activity.user_id == uid,
                            Activity.sport_type == "cycling",
                            Activity.average_power.isnot(None),
                            Activity.duration_seconds >= 600,
                            Activity.created_at >= cutoff,
                        ).order_by(Activity.start_date.desc())
                    )
                    cycling_activities = list(result.scalars().all())

                    cycling_data = []
                    performance_data = []
                    for act in cycling_activities:
                        date_str = act.start_date.date().isoformat() if act.start_date else None
                        if not date_str:
                            continue

                        perf = {
                            "date": date_str,
                            "avg_watts": float(act.average_power) if act.average_power else None,
                            "normalized_power": float(act.normalized_power) if act.normalized_power else None,
                            "tss": float(act.tss) if act.tss else None,
                            # Decoupling lives in the §1.3 context JSONB, not as
                            # a model column (QW5 — hasattr was always False).
                            "decoupling_pct": float((act.context or {}).get("decoupling_pct"))
                            if (act.context or {}).get("decoupling_pct")
                            else None,
                        }
                        if perf["avg_watts"]:
                            performance_data.append(perf)
                        cycling_data.append({
                            "date": date_str,
                            "tss": perf["tss"],
                            "avg_watts": perf["avg_watts"],
                            "normalized_power": perf["normalized_power"],
                        })

                    # Collect lifting data
                    result = await db.execute(
                        select(LiftingSession).where(
                            LiftingSession.user_id == uid,
                            LiftingSession.created_at >= cutoff,
                        ).order_by(LiftingSession.session_date.desc())
                    )
                    lifting_sessions = list(result.scalars().all())

                    lifting_data = [
                        {
                            "date": ls.session_date.isoformat(),
                            "volume_kg": float(ls.total_volume_kg) if ls.total_volume_kg else None,
                            "duration_seconds": ls.duration_seconds,
                            "rpe": float(ls.rpe_session) if ls.rpe_session else None,
                            "focus": ls.focus,
                        }
                        for ls in lifting_sessions
                        if ls.total_volume_kg
                    ]

                    # Skip if insufficient data
                    if len(sleep_data) < 14 or len(performance_data) < 14:
                        continue

                    # CD3: feed the most recent raced event (with a logged
                    # result) into the retrospective; empty when ineligible.
                    race_kwargs, race_event_id = await _build_race_retrospective_args(
                        db, uid
                    )

                    # Call Modal
                    results = analyze_cross_domain_on_modal(
                        sleep_data=sleep_data,
                        performance_data=performance_data,
                        lifting_data=lifting_data,
                        cycling_data=cycling_data,
                        recovery_data=recovery_data,
                        **race_kwargs,
                    )

                    # Store results
                    for insight_type in ["sleep_performance", "cross_sport", "race_retrospective"]:
                        insight_data = results.get(insight_type)
                        if not insight_data:
                            continue

                        if insight_type == "race_retrospective":
                            # Tag for dedup; the retrospective worker returns
                            # no data_quality gate, so store when it actually
                            # concluded something (CD3).
                            if race_event_id:
                                insight_data = {
                                    **insight_data,
                                    "event_id": race_event_id,
                                }
                            if not any(
                                [
                                    insight_data.get("vs_projection"),
                                    insight_data.get("tsb_analysis"),
                                    insight_data.get("training_analysis"),
                                    insight_data.get("insights"),
                                ]
                            ):
                                continue
                        else:
                            # Check if data is sufficient
                            data_quality = insight_data.get("data_quality", {})
                            if not data_quality.get("sufficient", False):
                                continue

                        insight = CrossDomainInsight(
                            user_id=uid,
                            insight_type=insight_type,
                            results=insight_data,
                            insights=insight_data.get("insights", []),
                            data_quality=data_quality,
                        )
                        db.add(insight)

                    analyzed_count += 1
                    await db.commit()

                except Exception as e:
                    logger.error(
                        f"Failed to analyze cross-domain for user {uid}: {e}",
                        exc_info=True,
                    )
                    errors.append(str(uid))
                    await db.rollback()

            return {
                "users_checked": len(user_ids),
                "users_analyzed": analyzed_count,
                "errors": errors,
            }

    return asyncio.run(_run_task_guarded("analyze_cross_domain_weekly", _run))


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


@celery_app.task(name="app.tasks.scheduler.check_stale_ftp")
def check_stale_ftp() -> dict:
    """Weekly FTP drift scan — notifies when the stored FTP looks stale.

    Complements ``auto_estimate_ftp_weekly`` (which silently keeps opted-in
    users' FTP current): this scan is the "suggest a re-test" signal for
    everyone else. When recent 90-day power data estimates an FTP that
    diverges >10% (or >20 W) from the stored value, fires an ``ftp_stale``
    notification; also prompts users who have power data but no FTP at all.
    """
    import asyncio

    from sqlalchemy import select

    from app.database import task_session
    from app.models.cycling import CyclingProfile
    from app.services.cycling import (
        compute_power_curve_from_streams,
        estimate_ftp_from_power_curve,
    )
    from app.services.notifications import notify

    async def _run():
        async with task_session() as db:
            result = await db.execute(
                select(CyclingProfile).where(
                    CyclingProfile.auto_estimate_ftp == False,
                )
            )
            profiles = list(result.scalars().all())
            notified = 0
            missed = 0

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

                    current = profile.ftp_watts
                    if current:
                        # Divergence threshold: >10% or >20 W away from the
                        # performance-based estimate looks like drift/detraining.
                        if (
                            abs(estimated_ftp - current) / current <= 0.10
                            and abs(estimated_ftp - current) <= 20
                        ):
                            continue
                        direction = "higher" if estimated_ftp > current else "lower"
                        title = f"FTP may now be {direction} — consider a re-test"
                        body = (
                            f"Recent power data suggests ~{estimated_ftp:.0f} W "
                            f"(current FTP {current:.0f} W). Run a 20-min all-out "
                            "test to confirm."
                        )
                        dedup_key = f"ftp-stale:{profile.user_id}:{int(estimated_ftp)}"
                    else:
                        title = "Set a baseline FTP"
                        body = (
                            f"This week's power data suggests ~{estimated_ftp:.0f} W. "
                            "Run a 20-min all-out test and log it to unlock W/kg and "
                            "power-zone charts."
                        )
                        dedup_key = f"ftp-stale:{profile.user_id}:baseline"

                    created = await notify(
                        db,
                        profile.user_id,
                        type="ftp_stale",
                        title=title,
                        body=body,
                        severity="warning",
                        link="/cycling",
                        dedup_key=dedup_key,
                        metadata={
                            "current_ftp": current,
                            "estimated_ftp": round(estimated_ftp, 1),
                        },
                    )
                    if created:
                        notified += 1
                    await db.commit()

                except Exception as e:
                    logger.error(
                        f"Failed to check stale FTP for user {profile.user_id}: {e}",
                        exc_info=True,
                    )
                    await db.rollback()
                    missed += 1

            return {
                "users_checked": len(profiles),
                "ftp_stale_notified": notified,
                "users_failed": missed,
            }

    return asyncio.run(_run())


@celery_app.task(name="app.tasks.scheduler.check_cycling_prs_weekly")
def check_cycling_prs_weekly() -> dict:
    """Check and record cycling power PRs for all users.

    Runs weekly (Sunday 4:30 AM UTC, after stream backfill). Scans all
    cycling activities for each user and updates stored PRs from the
    all-time bests. Catches PRs that were missed during sync (e.g.
    activities whose streams were backfilled later).
    """
    import asyncio

    from sqlalchemy import select

    from app.database import task_session
    from app.models.cycling import CyclingPowerRecord
    from app.services.cycling import check_cycling_prs_all_activities

    async def _run():
        async with task_session() as db:
            result = await db.execute(
                select(CyclingPowerRecord.user_id).distinct()
            )
            user_ids = [r for (r,) in result.all()]

            # Also check users who have cycling activities but no PRs yet
            from app.models.activity import Activity

            existing_result = await db.execute(
                select(Activity.user_id)
                .where(Activity.sport_type == "cycling")
                .distinct()
            )
            all_cycling_users = {r for (r,) in existing_result.all()}
            user_ids = list(set(user_ids) | all_cycling_users)

            total_updated = 0
            done = 0
            for user_id in user_ids:
                try:
                    updated = await check_cycling_prs_all_activities(db, user_id)
                    total_updated += len(updated)
                    await db.commit()
                    done += 1
                except Exception as e:
                    logger.error(
                        f"Cycling PR check failed for user {user_id}: {e}",
                        exc_info=True,
                    )
                    await db.rollback()

            return {
                "users_checked": done,
                "prs_updated": total_updated,
            }

    return asyncio.run(_run_task_guarded("check_cycling_prs_weekly", _run))


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
        handle_sync_http_error,
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
                except httpx.HTTPStatusError as e:
                    # SYNC-03: raw 401/403 mid-sync → needs_reauth + banner.
                    logger.warning(
                        f"Whoop cycle sync HTTP failure for user {conn.user_id}: {e}"
                    )
                    await handle_sync_http_error(db, conn, e)
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
                    except httpx.HTTPStatusError as e:
                        # SYNC-03: raw 401/403 mid-sync → needs_reauth + banner.
                        logger.warning(
                            f"Whoop sleep sync HTTP failure for user {conn.user_id}: {e}"
                        )
                        await handle_sync_http_error(db, conn, e)
                        user_failed = True
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
                    except httpx.HTTPStatusError as e:
                        # SYNC-03: raw 401/403 mid-sync → needs_reauth + banner.
                        logger.warning(
                            f"Whoop workout sync HTTP failure for user {conn.user_id}: {e}"
                        )
                        await handle_sync_http_error(db, conn, e)
                        user_failed = True
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
                    except httpx.HTTPStatusError as e:
                        # SYNC-03: raw 401/403 mid-sync → needs_reauth + banner.
                        logger.warning(
                            f"Whoop weight sync HTTP failure for user {conn.user_id}: {e}"
                        )
                        await handle_sync_http_error(db, conn, e)
                        user_failed = True
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


@celery_app.task(name="app.tasks.scheduler.sync_all_withings_data")
def sync_all_withings_data() -> dict:
    """Sync Withings scale data for all connected users (weight + body composition).

    Enqueued by Celery Beat every 30 minutes. Incremental via the
    ``last_synced_at`` watermark (minus 24h overlap) computed inside
    :func:`app.services.withings.sync_withings_measurements`.
    """
    import asyncio
    from datetime import UTC

    from sqlalchemy import select

    from app.database import task_session
    from app.integrations.errors import PermanentAuthError, TransientSyncError
    from app.models.user import OAuthConnection
    from app.services.connection_health import (
        CONNECTION_STATUS_NEEDS_REAUTH,
        mark_connection_reauth,
    )
    from app.services.withings import (
        refresh_if_needed as withings_refresh,
    )
    from app.services.withings import (
        sync_withings_measurements,
    )

    async def _run():
        async with task_session() as db:
            result = await db.execute(
                select(OAuthConnection).where(
                    OAuthConnection.provider == "withings"
                )
            )
            connections = list(result.scalars().all())
            synced_weighins = 0
            skipped_reauth = 0
            skipped_locked = 0

            for conn in connections:
                if conn.status == CONNECTION_STATUS_NEEDS_REAUTH:
                    skipped_reauth += 1
                    continue

                lock = await _try_acquire_user_lock(conn.user_id, "withings")
                if lock is None:
                    logger.info(
                        f"Skipping Withings sync for user {conn.user_id} — already in progress"
                    )
                    skipped_locked += 1
                    continue

                try:
                    conn = await withings_refresh(db, conn)
                except PermanentAuthError as e:
                    skipped_reauth += 1
                    logger.warning(
                        f"Skipping Withings sync for user {conn.user_id}: {e}"
                    )
                    await lock.__aexit__(None, None, None)
                    continue
                except TransientSyncError as e:
                    logger.warning(
                        f"Withings refresh transient failure for user {conn.user_id}: {e}"
                    )
                    await lock.__aexit__(None, None, None)
                    continue

                try:
                    logs = await sync_withings_measurements(db, conn.user_id)
                    synced_weighins += len(logs)
                    from datetime import datetime

                    conn.last_synced_at = datetime.now(UTC)
                    await db.commit()
                except PermanentAuthError as e:
                    skipped_reauth += 1
                    logger.warning(
                        f"Withings sync auth failure for user {conn.user_id}: {e}"
                    )
                    await mark_connection_reauth(db, conn, str(e))
                    await db.rollback()
                except TransientSyncError as e:
                    logger.warning(
                        f"Withings sync transient failure for user {conn.user_id}: {e}"
                    )
                    await db.rollback()
                except Exception as e:
                    logger.error(
                        f"Withings sync error for user {conn.user_id}: {e}",
                        exc_info=True,
                    )
                    await db.rollback()
                finally:
                    await lock.__aexit__(None, None, None)

            return {
                "synced_weighins": synced_weighins,
                "skipped_reauth": skipped_reauth,
                "skipped_locked": skipped_locked,
                "users_processed": len(connections),
            }

    return asyncio.run(_run_task_guarded("sync_all_withings_data", _run))


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


@celery_app.task(name="app.tasks.scheduler.compute_athlete_insights_nightly")
def compute_athlete_insights_nightly() -> dict:
    """Nightly deterministic athlete-model compute (Feature 3 / B-15).

    Runs the six insight functions per user and upserts AthleteInsight rows.
    Pure local computation — no Modal, no Gemini.
    """
    import asyncio

    from sqlalchemy import select

    from app.database import task_session
    from app.models.user import User

    async def _run():
        async with task_session() as db:
            from app.services.analytics import compute_all_insights

            result = await db.execute(select(User))
            users = list(result.scalars().all())
            computed = 0
            failed = 0
            for user in users:
                try:
                    await compute_all_insights(db, user.id)
                    computed += 1
                except Exception as e:
                    failed += 1
                    logger.error(
                        f"Athlete insights failed for user {user.id}: {e}",
                        exc_info=True,
                    )
                    await db.rollback()
                else:
                    await db.commit()
            return {
                "users_computed": computed,
                "users_failed": failed,
                "users_total": len(users),
            }

    return asyncio.run(_run_task_guarded("compute_athlete_insights_nightly", _run))


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
                    tss_backfilled += await backfill_lifting_tss(db, user.id)
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


@celery_app.task(name="app.tasks.scheduler.send_event_day_notifications")
def send_event_day_notifications() -> dict:
    """Notify users whose event/race is today.

    Fires a single ``race_day`` notification per event (dedup keyed on the
    event id) at 6:30 UTC. Per-user failures are isolated.
    """
    import asyncio
    from datetime import date

    from sqlalchemy import select

    from app.database import task_session
    from app.models.event import Event
    from app.models.user import User
    from app.services.notifications import notify

    async def _run():
        today = date.today()
        notified = 0
        async with task_session() as db:
            events = list(
                (await db.execute(select(Event).where(Event.event_date == today)))
                .scalars()
                .all()
            )
            for event in events:
                user_id = event.user_id
                try:
                    created = await notify(
                        db,
                        user_id,
                        type="race_day",
                        title=f"🏁 Race day — {event.name}",
                        body=(
                            "Good luck today!"
                            if event.event_type == "race"
                            else f"Today is your {event.event_type} event: {event.name}."
                        ),
                        severity="info",
                        link="/training",
                        dedup_key=f"race_day:{event.id}",
                    )
                    if created is not None:
                        notified += 1
                    await db.commit()
                except Exception as e:
                    logger.warning(
                        f"Event-day notification failed for user {user_id}: {e}",
                        exc_info=True,
                    )
                    await db.rollback()
        return {"notified": notified}

    return asyncio.run(_run())


@celery_app.task(name="app.tasks.scheduler.send_event_countdown_notifications")
def send_event_countdown_notifications() -> dict:
    """Notify users about upcoming events (1–7 days out), taper starts, and bad weather.

    Fires ``event_countdown`` notifications for events in the next 1–7 days
    (dedup keyed on ``event_countdown:{event_id}:{days}``), ``taper_start``
    when today is the first day of an event's taper window, and ``ride_weather``
    when rain, storms, or high wind (≥50 km/h) are forecast for an event within
    the next 1 day. Runs daily at 6:45 UTC.
    """
    import asyncio
    from datetime import date, timedelta

    from sqlalchemy import select

    from app.database import task_session
    from app.models.cycling import CyclingProfile
    from app.models.event import Event
    from app.models.weather import CachedWeather
    from app.services.notifications import notify

    # WMO weather codes that indicate rain, storms, or poor conditions
    _BAD_WEATHER_CODES = {
        51,
        53,
        55,
        56,
        57,  # drizzle
        61,
        63,
        65,
        66,
        67,  # rain
        71,
        73,
        75,
        77,  # snow
        80,
        81,
        82,  # rain showers
        85,
        86,  # snow showers
        95,
        96,
        99,  # thunderstorm
    }

    async def _run():
        today = date.today()
        notified = 0
        async with task_session() as db:
            # Events in the next 1–7 days (exclude today — race_day handles that)
            upcoming = list(
                (
                    await db.execute(
                        select(Event).where(
                            Event.event_date > today,
                            Event.event_date <= today + timedelta(days=7),
                        )
                    )
                )
                .scalars()
                .all()
            )
            for event in upcoming:
                days_until = (event.event_date - today).days
                try:
                    created = await notify(
                        db,
                        event.user_id,
                        type="event_countdown",
                        title=f"⏳ {event.name} in {days_until} day{'s' if days_until != 1 else ''}",
                        body=(
                            f"Your {event.event_type} is coming up on "
                            f"{event.event_date.strftime('%A %d %B')}."
                        ),
                        severity="info",
                        link="/training",
                        dedup_key=f"event_countdown:{event.id}:{days_until}",
                    )
                    if created is not None:
                        notified += 1

                    # Taper-start: today == event_date - taper_days
                    taper_start = event.event_date - timedelta(days=event.taper_days)
                    if today == taper_start:
                        taper_created = await notify(
                            db,
                            event.user_id,
                            type="taper_start",
                            title=f"🧘 Taper started — {event.name}",
                            body=(
                                f"Your {event.taper_days}-day taper begins today. "
                                f"Focus on recovery ahead of {event.event_date.strftime('%A %d %B')}."
                            ),
                            severity="info",
                            link="/training",
                            dedup_key=f"taper_start:{event.id}",
                        )
                        if taper_created is not None:
                            notified += 1

                    # Bad-weather alert: events within 1 day
                    if days_until <= 1:
                        profile = (
                            await db.execute(
                                select(CyclingProfile).where(
                                    CyclingProfile.user_id == event.user_id
                                )
                            )
                        ).scalar_one_or_none()
                        if (
                            profile
                            and profile.home_lat is not None
                            and profile.home_lng is not None
                        ):
                            lat_r = round(profile.home_lat, 1)
                            lng_r = round(profile.home_lng, 1)
                            cached = (
                                await db.execute(
                                    select(CachedWeather).where(
                                        CachedWeather.user_id == event.user_id,
                                        CachedWeather.weather_type == "forecast",
                                        CachedWeather.latitude == lat_r,
                                        CachedWeather.longitude == lng_r,
                                    )
                                )
                            ).scalar_one_or_none()
                            if cached and cached.weather_data:
                                daily = cached.weather_data.get("daily", [])
                                target_str = event.event_date.isoformat()
                                for day in daily:
                                    if day.get("date") == target_str:
                                        code = day.get("weather_code")
                                        precip_prob = (
                                            day.get("precipitation_probability_max")
                                            or 0
                                        )
                                        wind_max = day.get("wind_speed_10m_max") or 0
                                        is_bad = (
                                            (
                                                code is not None
                                                and code in _BAD_WEATHER_CODES
                                            )
                                            or precip_prob >= 60
                                            or wind_max >= 50
                                        )
                                        if is_bad:
                                            conditions = day.get(
                                                "conditions", "poor conditions"
                                            )
                                            weather_created = await notify(
                                                db,
                                                event.user_id,
                                                type="ride_weather",
                                                title=f"🌧️ Weather alert — {event.name} tomorrow",
                                                body=(
                                                    f"Weather forecast for {event.event_date.strftime('%A')}: "
                                                    f"{conditions}. "
                                                    f"{'Rain likely.' if precip_prob >= 60 else ''}"
                                                    f"{'Wind gusts up to ' + str(int(wind_max)) + ' km/h.' if wind_max >= 50 else ''}"
                                                ),
                                                severity="warning",
                                                link="/training",
                                                dedup_key=f"ride_weather:{event.id}:{target_str}",
                                            )
                                            if weather_created is not None:
                                                notified += 1
                                        break

                    await db.commit()
                except Exception as e:
                    logger.warning(
                        f"Event-countdown notification failed for user {event.user_id}: {e}",
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


# ── Video Processing (§1.1) ────────────────────────────────────────────────


@celery_app.task(name="app.tasks.scheduler.process_lift_video")
def process_lift_video(
    video_id: str, analysis_depth: str = "full", force: bool = False
) -> dict:
    """Process an uploaded lift video: trim dead time and classify via Gemini Vision.

    Dispatches to Modal for the heavy lifting (ffmpeg + Gemini Vision API).
    Updates the LiftVideo row with results.
    """
    import asyncio

    async def _run():
        import uuid
        from datetime import datetime, timezone

        from sqlalchemy import select

        from app.config import get_settings
        from app.database import task_session
        from app.models.lifting import LiftVideo

        settings = get_settings()
        vid = uuid.UUID(video_id)

        async with task_session() as db:
            video = (
                await db.execute(select(LiftVideo).where(LiftVideo.id == vid))
            ).scalar_one_or_none()

            if video is None:
                logger.error("process_lift_video: video %s not found", video_id)
                return {"status": "not_found"}

            if video.analysis_status == "completed" and not force:
                logger.info("process_lift_video: video %s already processed", video_id)
                return {"status": "already_processed"}

            # Mark as processing
            video.analysis_status = "processing"
            await db.commit()

            try:
                from app.integrations.modal_client import process_video_on_modal
                from app.integrations.r2 import (
                    create_presigned_get,
                    create_presigned_put,
                )

                # Generate presigned URLs for Modal to use
                presigned_get = await create_presigned_get(video.r2_key)

                presigned_put = await create_presigned_put(
                    video.user_id,
                    f"trimmed-{video.file_name}",
                    "video/mp4",
                    video.size_bytes or 0,
                )
                presigned_overlay = await create_presigned_put(
                    video.user_id,
                    f"overlay-{video.file_name}",
                    "video/mp4",
                    video.size_bytes or 0,
                )
                presigned_thumbs = await create_presigned_put(
                    video.user_id,
                    f"reps-{video.file_name}.jpg",
                    "image/jpeg",
                    2 * 1024 * 1024,
                )

                # Auto-fill the load from the linked session's sets (best-effort)
                try:
                    from app.services.video_analytics import infer_video_load

                    if video.weight_kg is None:
                        inferred = await infer_video_load(db, video)
                        if inferred is not None:
                            video.weight_kg = inferred
                            logger.info("Inferred video load: %.1f kg", inferred)
                except Exception as e:
                    logger.warning("Video load inference failed: %s", e)

                # Call Modal for processing
                result = process_video_on_modal(
                    video_id=video_id,
                    r2_key=video.r2_key,
                    r2_presigned_get=presigned_get,
                    r2_presigned_put=presigned_put["upload_url"],
                    r2_upload_key=presigned_put["key"],
                    analysis_depth=analysis_depth,
                    expected_reps=video.expected_reps,
                    user_exercise=video.exercise_name,
                    camera_view=video.camera_view,
                    r2_presigned_put_overlay=presigned_overlay["upload_url"],
                    r2_upload_key_overlay=presigned_overlay["key"],
                    weight_kg=video.weight_kg or 0.0,
                    r2_presigned_put_thumbs=presigned_thumbs["upload_url"],
                    r2_upload_key_thumbs=presigned_thumbs["key"],
                    forced_lifter_track_id=video.lifter_selected,
                )

                # Update video with results
                video.trimmed_r2_key = result.get("trimmed_r2_key")
                video.overlay_r2_key = result.get("overlay_r2_key")
                video.rep_thumbnails_r2_key = result.get("rep_thumbnails_r2_key")
                video.trim_start_sec = result.get("trim_start_sec")
                video.trim_end_sec = result.get("trim_end_sec")
                video.analysis_text = result.get("analysis_text")

                # Only update exercise if user didn't set one
                if result.get("exercise") and not video.exercise_name:
                    video.exercise_auto = result["exercise"]

                if result.get("reps"):
                    video.reps_count = result["reps"]
                if result.get("weight_kg"):
                    video.weight_kg = result["weight_kg"]
                if result.get("confidence"):
                    video.confidence = result["confidence"]
                if result.get("duration_seconds"):
                    video.duration_seconds = round(result["duration_seconds"])

                # ── Form analysis (§3.18) ──────────────────────────────────
                if result.get("form_score") is not None:
                    video.form_score = result["form_score"]
                if result.get("competition_valid") is not None:
                    video.competition_valid = result["competition_valid"]
                if result.get("form_analysis_json"):
                    video.form_analysis_json = json.dumps(result["form_analysis_json"])
                if result.get("form_deviations"):
                    video.form_deviations = json.dumps(result["form_deviations"])
                if result.get("form_coaching_cues"):
                    video.form_coaching_cues = json.dumps(result["form_coaching_cues"])

                # ── Velocity / VBT (§3.18) ─────────────────────────────────
                if result.get("mean_concentric_velocity") is not None:
                    video.mean_concentric_velocity = result["mean_concentric_velocity"]
                if result.get("peak_velocity") is not None:
                    video.peak_velocity = result["peak_velocity"]
                if result.get("velocity_loss_pct") is not None:
                    video.velocity_loss_pct = result["velocity_loss_pct"]
                if result.get("velocity_profile_json") is not None:
                    video.velocity_profile_json = json.dumps(result["velocity_profile_json"])
                if result.get("vbt_zone"):
                    video.vbt_zone = result["vbt_zone"]

                # ── Bar path (F1) ──────────────────────────────────────────
                if result.get("bar_path") is not None:
                    video.bar_path_json = json.dumps(result["bar_path"])

                # ── Rest timing ────────────────────────────────────────────
                if result.get("rest_periods_json") is not None:
                    video.rest_periods_json = json.dumps(result["rest_periods_json"])
                if result.get("avg_rest_seconds") is not None:
                    video.avg_rest_seconds = result["avg_rest_seconds"]
                if result.get("rest_cv") is not None:
                    video.rest_cv = result["rest_cv"]

                # ── Rep consistency (§3.18) ────────────────────────────────
                if result.get("rep_consistency_score") is not None:
                    video.rep_consistency_score = result["rep_consistency_score"]
                if result.get("tempo_consistency_cv") is not None:
                    video.tempo_consistency_cv = result["tempo_consistency_cv"]
                if result.get("rep_timing_json"):
                    video.rep_timing_json = json.dumps(result["rep_timing_json"])

                # ── Setup analysis (§3.18) ─────────────────────────────────
                if result.get("setup_score") is not None:
                    video.setup_score = result["setup_score"]
                if result.get("setup_analysis_json"):
                    video.setup_analysis_json = json.dumps(result["setup_analysis_json"])
                if result.get("setup_duration_seconds") is not None:
                    video.setup_duration_seconds = result["setup_duration_seconds"]

                # ── RPE estimation (§3.18) ─────────────────────────────────
                if result.get("estimated_rpe") is not None:
                    video.estimated_rpe = result["estimated_rpe"]
                if result.get("rpe_confidence") is not None:
                    video.rpe_confidence = result["rpe_confidence"]
                if result.get("rpe_evidence_json"):
                    video.rpe_evidence_json = json.dumps(result["rpe_evidence_json"])

                # ── Multi-person lifter selection (T1) ─────────────────────
                lifter = result.get("lifter_selection")
                if lifter:
                    video.lifter_selection_json = json.dumps(lifter)
                    video.lifter_selected = lifter.get("chosen_track_id")

                video.analysis_status = "completed"
                video.processed_at = datetime.now(UTC)
                await db.commit()

                # Send notification
                from app.services.notifications import notify

                await notify(
                    db,
                    video.user_id,
                    type="video_processed",
                    title="Video processed",
                    body=(
                        "Your video has been processed"
                        + (
                            f" — detected: {video.exercise_auto or video.exercise_name}"
                            if video.exercise_auto or video.exercise_name
                            else ""
                        )
                    ),
                    severity="success",
                    link="/lifting/videos",
                    dedup_key=f"video_processed:{video_id}",
                )
                await db.commit()

                logger.info("process_lift_video: completed for %s", video_id)
                return {"status": "completed", "video_id": video_id}

            except Exception as e:
                logger.error(
                    "process_lift_video failed for %s: %s", video_id, e, exc_info=True
                )
                video.analysis_status = "failed"
                video.analysis_text = str(e)
                await db.commit()

                from app.services.notifications import notify

                await notify(
                    db,
                    video.user_id,
                    type="video_processed",
                    title="Video processing failed",
                    body=f"Failed to process your video: {e!s:.100}",
                    severity="error",
                    link="/lifting/videos",
                    dedup_key=f"video_failed:{video_id}",
                )
                await db.commit()

                return {"status": "failed", "error": str(e)}

    return asyncio.run(_run())


# ── Weekly plan review (FL2) ──────────────────────────────────────────────
# Runs Monday 6:15 UTC (beat: "weekly-plan-review"), after the Monday 6 AM
# goal check-ins so goal trajectories are fresh. Monday 6:30/6:45 were
# already taken by the daily event-day + countdown tasks.


def _plan_review_week_key(today) -> str:
    """ISO-week dedup token, e.g. ``2026-W39``."""
    iso = today.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


async def build_weekly_plan_review(db, user_id: uuid.UUID) -> dict | None:
    """Compute the weekly review for the user's active plan (FL2).

    Reuses ``generate_adaptive_suggestions`` (no duplicated logic) plus
    ``get_plan_conformity`` and the QW6 off-pace-goal helper, then persists
    a ``plan_review`` notification (link ``/training``) summarising the
    stance + counts (missed days, stale targets, off-pace goals).

    Returns the summary dict (with ``notified`` True/False), or None when
    the user has no active plan. Idempotent per ISO week: the notification
    dedup key carries the week token, so a re-run returns
    ``notified=False`` without writing a duplicate. Does NOT commit — the
    caller owns the transaction.
    """
    from datetime import date

    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from app.models.cycling import CyclingProfile
    from app.models.training_plan import TrainingPlan, TrainingPlanDay
    from app.services.adaptive import (
        _off_pace_performance_goals,
        generate_adaptive_suggestions,
    )
    from app.services.conformity import get_plan_conformity
    from app.services.notifications import notify
    from app.services.training_plan import targets_stale_for_day

    today = date.today()
    plans = list(
        (
            await db.execute(
                select(TrainingPlan)
                .where(
                    TrainingPlan.user_id == user_id,
                    TrainingPlan.status == "active",
                )
                .order_by(TrainingPlan.start_date.desc())
                .options(selectinload(TrainingPlan.days))
            )
        )
        .scalars()
        .all()
    )
    plan = plans[0] if plans else None
    if plan is None:
        return None

    suggestions = await generate_adaptive_suggestions(db, user_id, plan.id)
    try:
        conf = await get_plan_conformity(db, user_id, plan.id)
    except Exception:
        conf = {"overall_pct": None, "trend": None}
    conformity_pct = conf.get("overall_pct")

    days = list(plan.days)
    missed_days = [
        d
        for d in days
        if d.day_date < today
        and d.sport != "rest"
        and not d.completed
        and d.activity_id is None
        and d.lifting_session_id is None
    ]

    profile = (
        await db.execute(
            select(CyclingProfile).where(CyclingProfile.user_id == user_id)
        )
    ).scalar_one_or_none()
    ftp = profile.ftp_watts if profile else None
    lthr = profile.lactate_threshold_hr if profile else None
    stale_targets = sum(
        1
        for d in days
        if d.day_date >= today
        and not d.completed
        and targets_stale_for_day(d, ftp, lthr)
    )

    try:
        off_pace = await _off_pace_performance_goals(db, user_id)
    except Exception:
        off_pace = []

    # Headline stance from the reused suggestions (no re-derived logic).
    types = [s.get("type") for s in suggestions.get("suggestions", [])]
    if "rest_day" in types:
        stance = "rest"
    elif "intensity_cut" in types:
        stance = "ease"
    elif "intensity_raise" in types:
        stance = "build"
    else:
        stance = "maintain"

    week_key = _plan_review_week_key(today)
    conf_str = f"{conformity_pct:.0f}%" if conformity_pct is not None else "n/a"
    # Human metric names (0.7) — never leak `estimated_1rm` snake_case into
    # notification bodies.
    from app.services.goal_metrics import METRIC_REGISTRY

    def _goal_display_name(metric: str) -> str:
        definition = METRIC_REGISTRY.get(metric)
        if definition is not None:
            return definition.label
        return metric.replace("_", " ")

    goal_str = (
        ", ".join(
            f"{_goal_display_name(g['metric'])} ({g['badge']})" for g in off_pace[:3]
        )
        if off_pace
        else "none"
    )
    body = (
        f"Week-ahead ({week_key}): {stance}. "
        f"Missed {len(missed_days)} day(s), {stale_targets} stale target(s), "
        f"{len(off_pace)} off-pace goal(s) [{goal_str}]. "
        f"Conformity {conf_str}. {suggestions.get('summary', '')}"
    )[:500]

    created = await notify(
        db,
        user_id,
        type="plan_review",
        title=f"Week ahead — {plan.name}",
        body=body,
        severity="info",
        link="/training",
        dedup_key=f"plan_review:{week_key}",
        metadata={
            "plan_id": str(plan.id),
            "week": week_key,
            "stance": stance,
            "missed_days": len(missed_days),
            "stale_targets": stale_targets,
            "off_pace_goals": len(off_pace),
            "conformity_pct": conformity_pct,
        },
    )

    return {
        "plan_id": str(plan.id),
        "week": week_key,
        "stance": stance,
        "missed_days": len(missed_days),
        "stale_targets": stale_targets,
        "off_pace_goals": [g["metric"] for g in off_pace],
        "conformity_pct": conformity_pct,
        "notified": created is not None,
    }


@celery_app.task(name="app.tasks.scheduler.weekly_plan_review")
def weekly_plan_review() -> dict:
    """Weekly plan-review notification for every user with an active plan.

    Per-user failures are isolated (rollback + continue); successful users
    commit immediately. Idempotent per ISO week via the notification dedup
    key — a re-run notifies nobody twice.
    """
    import asyncio

    from sqlalchemy import select

    from app.database import task_session
    from app.models.user import User

    async def _run():
        async with task_session() as db:
            users = list((await db.execute(select(User))).scalars().all())
            reviewed = 0
            notified = 0
            skipped_no_plan = 0
            for user in users:
                try:
                    result = await build_weekly_plan_review(db, user.id)
                    if result is None:
                        skipped_no_plan += 1
                    else:
                        reviewed += 1
                        if result.get("notified"):
                            notified += 1
                    await db.commit()
                except Exception as e:
                    logger.warning(
                        f"Weekly plan review failed for user {user.id}: {e}",
                        exc_info=True,
                    )
                    await db.rollback()
            return {
                "users_total": len(users),
                "reviewed": reviewed,
                "notified": notified,
                "skipped_no_plan": skipped_no_plan,
            }

    return asyncio.run(_run())


STREAK_MILESTONES = (7, 14, 21, 30, 60, 90, 180, 365)


async def _current_streak_days(db, user_id) -> int:
    """Consecutive training days ending today/yesterday (mirrors /streaks)."""
    from datetime import date as _date
    from datetime import timedelta as _td

    from sqlalchemy import func as _func
    from sqlalchemy import select as _select

    from app.models.activity import Activity
    from app.models.lifting import LiftingSession

    today = _date.today()
    dates: set = set(
        (
            await db.execute(
                _select(LiftingSession.session_date).where(
                    LiftingSession.user_id == user_id,
                    LiftingSession.session_date >= today - _td(days=365),
                )
            )
        )
        .scalars()
        .all()
    )
    for row in (
        await db.execute(
            _select(_func.date(Activity.start_date)).where(
                Activity.user_id == user_id,
                Activity.source != "wahoo",
                Activity.start_date >= today - _td(days=365),
            )
        )
    ).all():
        dates.add(row[0])
    if not dates:
        return 0
    ordered = sorted(dates, reverse=True)
    if ordered[0] < today - _td(days=1):
        return 0
    streak, check = 0, ordered[0]
    for d in ordered:
        if d == check:
            streak += 1
            check -= _td(days=1)
        elif d < check:
            break
    return streak


@celery_app.task(name="app.tasks.scheduler.send_weekly_digest")
def send_weekly_digest() -> dict:
    """Weekly digest (B-22, Monday 8 AM UTC).

    Per user: last-week totals (``weekly_summary``), streak milestones
    (``streak_milestone`` on 7/14/21/30/60/90/180/365-day streaks), and
    deload detection (``deload_started`` when TSB crossed above +10 in the
    last 7 days). All dedup-keyed per ISO week — re-runs notify nobody twice.
    """
    import asyncio
    from datetime import date as _date
    from datetime import timedelta as _td

    from sqlalchemy import select

    from app.database import task_session
    from app.models.user import User

    async def _run():
        async with task_session() as db:
            from app.models.activity import Activity
            from app.models.lifting import LiftingSession
            from app.services.notifications import notify

            users = list((await db.execute(select(User))).scalars().all())
            today = _date.today()
            iso_year, iso_week, _ = today.isocalendar()
            week_key = f"{iso_year}-W{iso_week:02d}"
            week_start = today - _td(days=today.weekday())
            last_start = week_start - _td(days=7)
            last_end = week_start - _td(days=1)

            sent = {"weekly_summary": 0, "streak_milestone": 0, "deload_started": 0}
            for user in users:
                try:
                    # Last-week totals.
                    acts = (
                        await db.execute(
                            select(Activity).where(
                                Activity.user_id == user.id,
                                Activity.start_date >= last_start,
                                Activity.start_date < week_start,
                            )
                        )
                    ).scalars().all()
                    lifts = (
                        await db.execute(
                            select(LiftingSession).where(
                                LiftingSession.user_id == user.id,
                                LiftingSession.session_date >= last_start,
                                LiftingSession.session_date <= last_end,
                            )
                        )
                    ).scalars().all()
                    if acts or lifts:
                        tss = round(sum(a.tss or 0 for a in acts), 1)
                        vol = round(sum(s.total_volume_kg or 0 for s in lifts), 1)
                        if await notify(
                            db,
                            user.id,
                            "weekly_summary",
                            title=f"Week in review: {len(acts)} rides, {len(lifts)} lifts",
                            body=f"{tss} TSS · {vol:,.0f} kg lifted. Open the dashboard for the full breakdown.",
                            link="/dashboard",
                            dedup_key=f"weekly:{week_key}",
                        ):
                            sent["weekly_summary"] += 1

                    # Streak milestones.
                    streak = await _current_streak_days(db, user.id)
                    if streak in STREAK_MILESTONES:
                        if await notify(
                            db,
                            user.id,
                            "streak_milestone",
                            title=f"🔥 {streak}-day training streak",
                            body="Consistency compounds — keep the chain going, even an easy day counts.",
                            link="/dashboard",
                            dedup_key=f"streak:{streak}",
                        ):
                            sent["streak_milestone"] += 1

                    # Deload detection: TSB crossed above +10 in the last 7d.
                    try:
                        from app.services.cycling.training_load import (
                            training_load_for_user,
                        )

                        series = await training_load_for_user(
                            db, user.id, today, lookback_days=14
                        )
                        by_date = {}
                        for row in series:
                            d = row.get("date")
                            dd = (
                                d.date()
                                if isinstance(d, datetime)
                                else d
                                if not isinstance(d, str)
                                else _date.fromisoformat(d[:10])
                            )
                            if row.get("tsb") is not None:
                                by_date[dd] = float(row["tsb"])
                        now_tsb = by_date.get(today)
                        week_ago_tsb = by_date.get(today - _td(days=7))
                        if (
                            now_tsb is not None
                            and week_ago_tsb is not None
                            and now_tsb >= 10
                            and week_ago_tsb < 10
                        ):
                            if await notify(
                                db,
                                user.id,
                                "deload_started",
                                title="Recovery bounce — deload absorbed",
                                body=f"TSB climbed from {week_ago_tsb:.0f} to +{now_tsb:.0f}. Freshness is back; good week for quality work.",
                                link="/cycling",
                                dedup_key=f"deload:{week_key}",
                            ):
                                sent["deload_started"] += 1
                    except Exception as e:
                        logger.warning(
                            f"Deload check failed for user {user.id}: {e}"
                        )

                    await db.commit()
                except Exception as e:
                    logger.warning(
                        f"Weekly digest failed for user {user.id}: {e}",
                        exc_info=True,
                    )
                    await db.rollback()
            return {"users_total": len(users), **sent}

    return asyncio.run(_run_task_guarded("send_weekly_digest", _run))
