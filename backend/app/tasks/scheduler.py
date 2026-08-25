"""Celery tasks — scheduler.py with Redis broker, Beat schedule."""

import logging
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

# ── Beat schedule ─────────────────────────────────────────────────────────────

celery_app.conf.beat_schedule = {
    # Sync Strava activities every 30 minutes
    "sync-strava-activities": {
        "task": "app.tasks.scheduler.sync_all_strava_activities",
        "schedule": crontab(minute="*/30"),
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
    # Weekly streams backfill (Saturday 3 AM UTC) — fills gaps for cycling activities missing streams
    "backfill-streams": {
        "task": "app.tasks.scheduler.backfill_streams_for_all_activities",
        "schedule": crontab(hour=3, minute=0, day_of_week=6),
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
    from app.models.user import OAuthConnection
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
                # Compute incremental window: watermark minus 24h overlap
                after = None
                if conn.last_synced_at:
                    after = conn.last_synced_at - timedelta(hours=24)

                try:
                    activities = await sync_activities(
                        db, conn.user_id, after=after
                    )
                    synced_count += len(activities)
                    # Update watermark on success
                    from datetime import datetime

                    conn.last_synced_at = datetime.now(UTC)
                except Exception as e:
                    logger.error(
                        f"Failed to sync for user {conn.user_id}: {e}", exc_info=True
                    )

                # Tag recent activities with historical weather — must never fail the sync
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

                    plan_linked = await link_activities_to_plan_days(db, conn.user_id)
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

            # Also sync Wahoo activities for users with Wahoo connections
            wahoo_result = await db.execute(
                select(OAuthConnection).where(OAuthConnection.provider == "wahoo")
            )
            wahoo_connections = list(wahoo_result.scalars().all())
            wahoo_synced_count = 0
            for conn in wahoo_connections:
                try:
                    from app.services.wahoo import sync_wahoo_activities

                    activities = await sync_wahoo_activities(db, conn.user_id)
                    wahoo_synced_count += len(activities)
                    # Update watermark on success
                    from datetime import datetime

                    conn.last_synced_at = datetime.now(UTC)
                except Exception as e:
                    logger.error(
                        f"Failed to sync Wahoo activities for user {conn.user_id}: {e}",
                        exc_info=True,
                    )

            await db.commit()
            return {
                "synced_activities": synced_count,
                "wahoo_synced_activities": wahoo_synced_count,
                "linked_sessions": linked_count,
                "route_linked": route_linked_count,
                "weather_tagged": weather_tagged_count,
                "plan_day_linked": plan_day_linked_count,
                "users_processed": len(connections) + len(wahoo_connections),
            }

    return asyncio.run(_run())


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
                # ── Composite analysis (Phase 6) ──────────────────────────
                try:
                    overtraining = await analyze_overtraining(db, user.id)
                    if await upsert_alert(db, user.id, overtraining):
                        alerts_created += 1
                except Exception as e:
                    logger.error(
                        f"Overtraining analysis failed for user {user.id}: {e}",
                        exc_info=True,
                    )

                try:
                    injury = await analyze_injury_risk(db, user.id)
                    if await upsert_alert(db, user.id, injury):
                        alerts_created += 1
                except Exception as e:
                    logger.error(
                        f"Injury risk analysis failed for user {user.id}: {e}",
                        exc_info=True,
                    )

                try:
                    illness = await analyze_illness(db, user.id)
                    if await upsert_alert(db, user.id, illness):
                        alerts_created += 1
                except Exception as e:
                    logger.error(
                        f"Illness analysis failed for user {user.id}: {e}",
                        exc_info=True,
                    )

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

                if len(metrics) < 3:
                    continue

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
                                evidence={"recent": recent_hrv, "average": avg_hrv},
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
                                evidence={"recent": recent_sleep, "average": avg_sleep},
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
                        m.respiratory_rate for m in metrics if m.respiratory_rate
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
    from app.models.user import OAuthConnection

    async def _run():
        async with task_session() as db:
            # Get unique users with any route-capable connection
            result = await db.execute(
                select(OAuthConnection).where(
                    OAuthConnection.provider.in_(["strava", "wahoo"])
                )
            )
            connections = list(result.scalars().all())

            # Group by user
            user_providers: dict = {}
            for conn in connections:
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
                except Exception as e:
                    logger.error(
                        f"Failed to sync Komoot routes: {e}",
                        exc_info=True,
                    )

            for user_id, providers in user_providers.items():
                if "strava" in providers:
                    try:
                        from app.services.strava import sync_strava_routes

                        count, merged = await sync_strava_routes(db, user_id)
                        synced_total += count
                        merged_total += merged
                    except Exception as e:
                        logger.error(
                            f"Failed to sync Strava routes for user {user_id}: {e}",
                            exc_info=True,
                        )

                if "wahoo" in providers:
                    try:
                        from app.services.wahoo import sync_wahoo_routes

                        count, merged = await sync_wahoo_routes(db, user_id)
                        synced_total += count
                        merged_total += merged
                    except Exception as e:
                        logger.error(
                            f"Failed to sync Wahoo routes for user {user_id}: {e}",
                            exc_info=True,
                        )

            await db.commit()
            return {
                "routes_synced": synced_total,
                "routes_merged": merged_total,
                "users_processed": len(user_providers),
            }

    return asyncio.run(_run())


@celery_app.task(name="app.tasks.scheduler.cleanup_old_data")
def cleanup_old_data() -> dict:
    """Clean up old activity streams and raw data to save space."""
    return {
        "deleted_streams": 0,
        "note": "Stream cleanup disabled — streams are retained indefinitely",
    }


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

                except Exception as e:
                    logger.error(
                        f"Failed to auto-estimate FTP for user {profile.user_id}: {e}",
                        exc_info=True,
                    )

            await db.commit()
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
    from app.models.user import OAuthConnection
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
            skipped_expired = 0

            for conn in connections:
                # Auto-refresh token if needed
                try:
                    conn = await refresh_if_needed(db, conn)
                except ValueError as e:
                    skipped_expired += 1
                    logger.warning(f"Skipping Whoop sync for user {conn.user_id}: {e}")
                    continue

                # Compute incremental window: watermark minus 24h overlap
                start = None
                if conn.last_synced_at:
                    start = (conn.last_synced_at - timedelta(hours=24)).strftime(
                        "%Y-%m-%dT%H:%M:%S.000Z"
                    )

                try:
                    metrics = await sync_whoop_cycles(db, conn.user_id, start=start)
                    synced_cycles += len(metrics)
                except ValueError as e:
                    if "expired" in str(e).lower():
                        skipped_expired += 1
                    logger.warning(
                        f"Whoop cycle sync failed for user {conn.user_id}: {e}"
                    )
                except Exception as e:
                    logger.error(
                        f"Whoop cycle sync error for user {conn.user_id}: {e}",
                        exc_info=True,
                    )

                try:
                    sleep_logs = await sync_whoop_sleep(db, conn.user_id, start=start)
                    synced_sleep += len(sleep_logs)
                except ValueError as e:
                    if "expired" in str(e).lower():
                        skipped_expired += 1
                    logger.warning(
                        f"Whoop sleep sync failed for user {conn.user_id}: {e}"
                    )
                except Exception as e:
                    logger.error(
                        f"Whoop sleep sync error for user {conn.user_id}: {e}",
                        exc_info=True,
                    )

                try:
                    enriched = await sync_whoop_workouts(db, conn.user_id, start=start)
                    synced_workouts += len(enriched)
                except ValueError as e:
                    if "expired" in str(e).lower():
                        skipped_expired += 1
                    logger.warning(
                        f"Whoop workout sync failed for user {conn.user_id}: {e}"
                    )
                except Exception as e:
                    logger.error(
                        f"Whoop workout sync error for user {conn.user_id}: {e}",
                        exc_info=True,
                    )

                # Sync body weight from Whoop
                try:
                    await sync_whoop_weight(db, conn.user_id)
                except ValueError as e:
                    if "expired" in str(e).lower():
                        skipped_expired += 1
                    logger.warning(
                        f"Whoop weight sync failed for user {conn.user_id}: {e}"
                    )
                except Exception as e:
                    logger.error(
                        f"Whoop weight sync error for user {conn.user_id}: {e}",
                        exc_info=True,
                    )

                # Update watermark on success
                from datetime import datetime

                conn.last_synced_at = datetime.now(UTC)

            await db.commit()
            return {
                "synced_cycles": synced_cycles,
                "synced_sleep": synced_sleep,
                "synced_workouts": synced_workouts,
                "skipped_expired_tokens": skipped_expired,
                "users_processed": len(connections),
            }

    return asyncio.run(_run())


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
            for user in users:
                try:
                    from app.services.llm_analysis import run_llm_analysis

                    await run_llm_analysis(db, user.id)
                    analyzed += 1
                except Exception as e:
                    logger.error(
                        f"LLM analysis failed for user {user.id}: {e}", exc_info=True
                    )
            await db.commit()
            return {"users_analyzed": analyzed, "users_total": len(users)}

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

    return asyncio.run(_run())


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
                except Exception as e:
                    logger.warning(
                        f"Weather forecast refresh failed for user {user.id}: {e}",
                        exc_info=True,
                    )

            await db.commit()
            return {
                "users_total": len(users),
                "forecasts_refreshed": refreshed,
                "users_without_location": no_location,
            }

    return asyncio.run(_run())


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
                except Exception as e:
                    logger.warning(
                        f"Goal check-ins failed for user {user.id}: {e}",
                        exc_info=True,
                    )

            await db.commit()
            return {
                "users_total": len(users),
                "goals_active": goals_active,
                "checkins_recorded": checkins_recorded,
            }

    return asyncio.run(_run())
