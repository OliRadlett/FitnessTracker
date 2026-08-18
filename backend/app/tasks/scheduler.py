"""Celery tasks — scheduler.py with Redis broker, Beat schedule."""

import logging

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
}


# ── Task definitions ──────────────────────────────────────────────────────────

@celery_app.task(name="app.tasks.scheduler.sync_all_strava_activities")
def sync_all_strava_activities() -> dict:
    """Sync Strava activities for all connected users.

    This task is enqueued by Celery Beat every 30 minutes.
    It imports the async sync logic and runs it in an event loop.
    After syncing, it also backfills activity-to-lifting links and
    syncs Wahoo activities for users with Wahoo connections.
    """
    import asyncio
    from sqlalchemy import select
    from app.database import async_session_factory
    from app.models.user import OAuthConnection
    from app.services.strava import sync_activities, link_all_unlinked_activities
    from app.services.merge_service import backfill_activity_route_links

    async def _run():
        async with async_session_factory() as db:
            result = await db.execute(
                select(OAuthConnection).where(OAuthConnection.provider == "strava")
            )
            connections = list(result.scalars().all())
            synced_count = 0
            linked_count = 0
            route_linked_count = 0
            for conn in connections:
                try:
                    activities = await sync_activities(db, conn.user_id)
                    synced_count += len(activities)
                except Exception as e:
                    logger.error(f"Failed to sync for user {conn.user_id}: {e}", exc_info=True)

                # Backfill links for any remaining unlinked activities
                try:
                    linked = await link_all_unlinked_activities(db, conn.user_id)
                    linked_count += linked
                except Exception as e:
                    logger.error(f"Failed to backfill links for user {conn.user_id}: {e}", exc_info=True)

                # Backfill activity-to-route links
                try:
                    rl = await backfill_activity_route_links(db, conn.user_id)
                    route_linked_count += rl
                except Exception as e:
                    logger.error(f"Failed to backfill route links for user {conn.user_id}: {e}", exc_info=True)

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
                except Exception as e:
                    logger.error(f"Failed to sync Wahoo activities for user {conn.user_id}: {e}", exc_info=True)

            await db.commit()
            return {
                "synced_activities": synced_count,
                "wahoo_synced_activities": wahoo_synced_count,
                "linked_sessions": linked_count,
                "route_linked": route_linked_count,
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
    from sqlalchemy import select, func
    from app.database import async_session_factory
    from app.models.daily_metric import DailyMetric
    from app.models.health_alert import HealthAlert
    from app.models.user import User
    from app.services.health_analysis import (
        analyze_overtraining,
        analyze_injury_risk,
        analyze_illness,
        upsert_alert,
    )

    async def _run():
        async with async_session_factory() as db:
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
                    logger.error(f"Overtraining analysis failed for user {user.id}: {e}", exc_info=True)

                try:
                    injury = await analyze_injury_risk(db, user.id)
                    if await upsert_alert(db, user.id, injury):
                        alerts_created += 1
                except Exception as e:
                    logger.error(f"Injury risk analysis failed for user {user.id}: {e}", exc_info=True)

                try:
                    illness = await analyze_illness(db, user.id)
                    if await upsert_alert(db, user.id, illness):
                        alerts_created += 1
                except Exception as e:
                    logger.error(f"Illness analysis failed for user {user.id}: {e}", exc_info=True)

                # ── Simple threshold checks (legacy) ──────────────────────
                cutoff = date.today() - timedelta(days=7)
                result = await db.execute(
                    select(DailyMetric)
                    .where(DailyMetric.user_id == user.id, DailyMetric.metric_date >= cutoff)
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
                sleep_values = [m.sleep_duration_minutes for m in metrics if m.sleep_duration_minutes]
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
                    select(func.avg(DailyMetric.respiratory_rate).label("avg_rr"))
                    .where(
                        DailyMetric.user_id == user.id,
                        DailyMetric.respiratory_rate.isnot(None),
                        DailyMetric.metric_date >= rr_cutoff,
                    )
                )
                rr_row = rr_result.one()
                if rr_row.avg_rr:
                    baseline_rr = float(rr_row.avg_rr)
                    recent_rr_values = [m.respiratory_rate for m in metrics if m.respiratory_rate]
                    if recent_rr_values:
                        current_rr = recent_rr_values[0]
                        if current_rr > baseline_rr * 1.1:
                            existing = await db.execute(
                                select(HealthAlert).where(
                                    HealthAlert.user_id == user.id,
                                    HealthAlert.alert_type == "respiratory_rate_elevated",
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
                                    evidence={"current": current_rr, "baseline": baseline_rr},
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
    from app.database import async_session_factory
    from app.models.user import OAuthConnection

    async def _run():
        async with async_session_factory() as db:
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

            for user_id, providers in user_providers.items():
                if "strava" in providers:
                    try:
                        from app.services.strava import sync_strava_routes
                        count, merged = await sync_strava_routes(db, user_id)
                        synced_total += count
                        merged_total += merged
                    except Exception as e:
                        logger.error(f"Failed to sync Strava routes for user {user_id}: {e}", exc_info=True)

                # Komoot uses Basic Auth (komoot_email/komoot_password in settings)
                from app.config import get_settings as _get_settings
                _s = _get_settings()
                if _s.komoot_email and _s.komoot_password:
                    try:
                        from app.services.komoot import sync_komoot_routes
                        count, merged = await sync_komoot_routes(db, user_id)
                        synced_total += count
                        merged_total += merged
                    except Exception as e:
                        logger.error(f"Failed to sync Komoot routes for user {user_id}: {e}", exc_info=True)

                if "wahoo" in providers:
                    try:
                        from app.services.wahoo import sync_wahoo_routes
                        count, merged = await sync_wahoo_routes(db, user_id)
                        synced_total += count
                        merged_total += merged
                    except Exception as e:
                        logger.error(f"Failed to sync Wahoo routes for user {user_id}: {e}", exc_info=True)

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
    import asyncio
    from datetime import date, timedelta
    from sqlalchemy import delete, select
    from app.database import async_session_factory
    from app.models.activity import Activity, ActivityStream

    async def _run():
        async with async_session_factory() as db:
            # Remove activity streams for activities older than 90 days
            cutoff = date.today() - timedelta(days=90)
            old_activity_ids = select(Activity.id).where(Activity.start_date < cutoff)
            result = await db.execute(
                delete(ActivityStream).where(ActivityStream.activity_id.in_(old_activity_ids))
            )
            await db.commit()
            return {"deleted_streams": result.rowcount}

    return asyncio.run(_run())


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
    from app.database import async_session_factory
    from app.models.cycling import CyclingProfile, FtpHistory
    from app.services.cycling import (
        compute_power_curve_from_streams,
        estimate_ftp_from_power_curve,
    )

    async def _run():
        async with async_session_factory() as db:
            # Find all users with auto_estimate_ftp enabled
            result = await db.execute(
                select(CyclingProfile).where(
                    CyclingProfile.auto_estimate_ftp == True,  # noqa: E712
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
                            f"Auto-estimated: {source_method} "
                            f"(was {old_ftp}W)" if source_method
                            else f"Auto-estimated (was {old_ftp}W)"
                        ),
                    )
                    db.add(ftp_entry)
                    estimated_count += 1

                except Exception as e:
                    logger.error(f"Failed to auto-estimate FTP for user {profile.user_id}: {e}", exc_info=True)

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
    """
    import asyncio
    from sqlalchemy import select
    from app.database import async_session_factory
    from app.models.user import OAuthConnection
    from app.services.whoop import (
        sync_whoop_cycles, sync_whoop_sleep, sync_whoop_workouts, sync_whoop_weight,
        refresh_if_needed,
    )

    async def _run():
        async with async_session_factory() as db:
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
                    print(f"Skipping Whoop sync for user {conn.user_id}: {e}")
                    continue

                try:
                    metrics = await sync_whoop_cycles(db, conn.user_id)
                    synced_cycles += len(metrics)
                except ValueError as e:
                    if "expired" in str(e).lower():
                        skipped_expired += 1
                    print(f"Whoop cycle sync failed for user {conn.user_id}: {e}")
                except Exception as e:
                    print(f"Whoop cycle sync error for user {conn.user_id}: {e}")

                try:
                    sleep_logs = await sync_whoop_sleep(db, conn.user_id)
                    synced_sleep += len(sleep_logs)
                except ValueError as e:
                    if "expired" in str(e).lower():
                        skipped_expired += 1
                    print(f"Whoop sleep sync failed for user {conn.user_id}: {e}")
                except Exception as e:
                    print(f"Whoop sleep sync error for user {conn.user_id}: {e}")

                try:
                    enriched = await sync_whoop_workouts(db, conn.user_id)
                    synced_workouts += len(enriched)
                except ValueError as e:
                    if "expired" in str(e).lower():
                        skipped_expired += 1
                    print(f"Whoop workout sync failed for user {conn.user_id}: {e}")
                except Exception as e:
                    print(f"Whoop workout sync error for user {conn.user_id}: {e}")

                # Sync body weight from Whoop
                try:
                    await sync_whoop_weight(db, conn.user_id)
                except ValueError as e:
                    if "expired" in str(e).lower():
                        skipped_expired += 1
                    print(f"Whoop weight sync failed for user {conn.user_id}: {e}")
                except Exception as e:
                    print(f"Whoop weight sync error for user {conn.user_id}: {e}")

            await db.commit()
            return {
                "synced_cycles": synced_cycles,
                "synced_sleep": synced_sleep,
                "synced_workouts": synced_workouts,
                "skipped_expired_tokens": skipped_expired,
                "users_processed": len(connections),
            }

    return asyncio.run(_run())
