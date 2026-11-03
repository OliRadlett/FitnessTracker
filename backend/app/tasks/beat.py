"""The Celery beat schedule.

Kept apart from the task definitions so the cadence of every job lives in one
place a reviewer can read, rather than inside a 4,600-line module. Task names
stay strings on purpose: beat config and queued messages carry them, so a task
can move module without its name changing.

``app.tasks.scheduler`` assigns this to the Celery app on import.
"""

from celery.schedules import crontab

beat_schedule: dict = {
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
    # Undo retention (plan §8). Daily at 03:40 UTC: past `expires_at` the rows
    # are audit-only, and a daily sweep keeps the table bounded without any read
    # path having to clean up after itself.
    "prune-expired-undo-logs": {
        "task": "app.tasks.scheduler.prune_expired_undo_logs",
        "schedule": crontab(hour=3, minute=40),
        "options": {"expires": 1800},
    },
    # Generate daily health alerts at 6 AM UTC
    "generate-health-alerts": {
        "task": "app.tasks.scheduler.generate_health_alerts",
        "schedule": crontab(hour=6, minute=0),
        "options": {"expires": 3600},
    },
    # Clean up old webhook events weekly
    "cleanup-old-data": {
        "task": "app.tasks.scheduler.cleanup_old_data",
        "schedule": crontab(hour=3, minute=0, day_of_week=0),
        "options": {"expires": 1800},
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
        "options": {"expires": 7200},
    },
    # Classify route terrain weekly (Saturday 2:30 AM UTC, before quality scoring)
    "classify-route-terrain": {
        "task": "app.tasks.scheduler.classify_route_terrain",
        "schedule": crontab(hour=2, minute=30, day_of_week=6),
        "options": {"expires": 7200},
    },
    # Phase 2 — map-match routes to the OSM road graph + embed, weekly
    # (Sunday 2:50 AM UTC, before the similarity graph task consumes them).
    "map-match-routes": {
        "task": "app.tasks.scheduler.map_match_routes",
        "schedule": crontab(hour=2, minute=50, day_of_week=0),
        "options": {"expires": 7200},
    },
    # Phase 2 — map-match activities to the OSM road graph (Sunday 3:00 AM UTC,
    # after route matching so the OSM graph + road cache are ready). Edge sets
    # enable section-repeat / lap detection across rides.
    "map-match-activities": {
        "task": "app.tasks.scheduler.map_match_activities",
        "schedule": crontab(hour=3, minute=0, day_of_week=0),
        "options": {"expires": 7200},
    },
    # Recompute the route similarity graph + auto-merge dups weekly
    # (Sunday 3:05 AM UTC, after quality, before segment recompute).
    "recompute-route-similarity": {
        "task": "app.tasks.scheduler.recompute_route_similarity",
        "schedule": crontab(hour=3, minute=5, day_of_week=0),
        "options": {"expires": 7200},
    },
    # Recompute ride segments + efforts weekly (Sunday 3:15 AM UTC, post quality)
    "recompute-ride-segments": {
        "task": "app.tasks.scheduler.recompute_ride_segments",
        "schedule": crontab(hour=3, minute=15, day_of_week=0),
        "options": {"expires": 7200},
    },
    # Backfill cached ride context weekly (§1.3 — Sunday 3:30 AM UTC, post streams/segments)
    "backfill-activity-context": {
        "task": "app.tasks.scheduler.backfill_activity_context",
        "schedule": crontab(hour=3, minute=30, day_of_week=0),
        "options": {"expires": 7200},
    },
    # Tag lifting-session notes with Jev (Phase 1). The inline post-write
    # trigger covers most rows; this backfills anything missed. No-op without Jev.
    "backfill-free-text-tags": {
        "task": "app.tasks.scheduler.backfill_free_text_tags",
        "schedule": crontab(hour=3, minute=45, day_of_week=0),
        "options": {"expires": 7200},
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
        "options": {"expires": 3600},
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
        "options": {"expires": 3600},
    },
    # Backfill TSS for imported activities stranded without one (Sunday 4:45 AM
    # UTC — deliberately after auto-estimate-ftp and check-stale-ftp, so rides
    # imported before FTP was configured become computable once FTP exists).
    # No-op when there is nothing to fill.
    "backfill-manual-activity-tss": {
        "task": "app.tasks.scheduler.backfill_manual_activity_tss",
        "schedule": crontab(hour=4, minute=45, day_of_week=0),
        "options": {"expires": 3600},
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
        "options": {"expires": 7200},
    },
    # Weekly LLM cycling analysis (Sunday 5 AM UTC)
    "weekly-llm-analysis": {
        "task": "app.tasks.scheduler.weekly_llm_analysis",
        "schedule": crontab(hour=5, minute=0, day_of_week=0),
        "options": {"expires": 7200},
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
    # Weekly orphan-route quarantine (Sunday 6:30 AM UTC). The review queue and
    # its /orphans endpoints shipped before anything produced the quarantined
    # set, so the queue could never fill.
    "quarantine-orphaned-routes-weekly": {
        "task": "app.tasks.scheduler.quarantine_orphaned_routes_weekly",
        "schedule": crontab(hour=6, minute=30, day_of_week=0),
        "options": {"expires": 3600},
    },
    # Refresh weather forecast caches daily at 5 AM UTC
    "refresh-weather-forecasts": {
        "task": "app.tasks.scheduler.refresh_weather_forecasts",
        "schedule": crontab(hour=5, minute=0),
        "options": {"expires": 3600},
    },
    # Weekly goal check-ins (Monday 6 AM UTC)
    "record-goal-checkins": {
        "task": "app.tasks.scheduler.record_goal_checkins",
        "schedule": crontab(hour=6, minute=0, day_of_week=1),
        "options": {"expires": 3600},
    },
    # Weekly plan review (Monday 6:15 AM UTC, after the goal check-ins).
    # Monday 6:30/6:45 are taken by the daily event-day + countdown tasks,
    # so 6:15 is the earliest free Monday slot after the 6 AM check-ins.
    "weekly-plan-review": {
        "task": "app.tasks.scheduler.weekly_plan_review",
        "schedule": crontab(hour=6, minute=15, day_of_week=1),
        "options": {"expires": 3600},
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
        "options": {"expires": 3600},
    },
    # Daily event/race-day notification (6:30 AM UTC)
    "send-event-day-notifications": {
        "task": "app.tasks.scheduler.send_event_day_notifications",
        "schedule": crontab(hour=6, minute=30),
        "options": {"expires": 3600},
    },
    # Daily event countdown + taper-start notification (6:45 AM UTC)
    "send-event-countdown-notifications": {
        "task": "app.tasks.scheduler.send_event_countdown_notifications",
        "schedule": crontab(hour=6, minute=45),
        "options": {"expires": 3600},
    },
    # Weekly streams backfill (Saturday 3 AM UTC) — fills gaps for cycling activities missing streams
    "backfill-streams": {
        "task": "app.tasks.scheduler.backfill_streams_for_all_activities",
        "schedule": crontab(hour=3, minute=0, day_of_week=6),
        "options": {"expires": 3600},
    },
    # Unstick lift videos left in processing/queued (e.g. a deploy killed the worker)
    "reap-stale-videos": {
        "task": "app.tasks.scheduler.reap_stale_videos",
        "schedule": crontab(minute=15),
        "options": {"expires": 900},
    },
}
