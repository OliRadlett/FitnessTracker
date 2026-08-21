"""Strava service — sync logic, webhook handling, activity-to-lifting linking."""

# Re-export everything for backward compatibility.
# Existing imports like `from app.services.strava import sync_activities` continue to work.

from app.services.strava.linking import (
    MATCH_THRESHOLD,
    STRENGTH_SPORT_TYPES,
    link_activity_to_lifting_sessions,
    link_all_unlinked_activities,
)
from app.services.strava.sync import (
    backfill_all_activities,
    get_strava_connection,
    refresh_if_needed,
    sync_activities,
    sync_strava_routes,
)
from app.services.strava.webhooks import handle_strava_event
