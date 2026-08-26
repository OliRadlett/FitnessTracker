"""Prometheus metrics for the sync pipeline.

Celery workers are separate processes from the FastAPI app that serves
``/metrics``, so these counters are process-local — wire a Pushgateway into
``main.py`` if cross-process aggregation is ever needed. They still provide
useful in-process visibility and document the sync outcome taxonomy.
"""

from prometheus_client import Counter

SYNC_RUNS = Counter(
    "fittrack_sync_runs_total",
    "Sync task runs by outcome",
    ["task", "outcome"],  # outcome: success | failure | skipped_lock | skipped_reauth
)

SYNC_ITEMS = Counter(
    "fittrack_sync_items_total",
    "Sync items processed (activities/metrics/workouts/routes)",
    ["task"],
)

CONNECTION_REAUTH = Counter(
    "fittrack_connection_reauth_total",
    "Connections marked as needing re-authorisation",
    ["provider"],
)

WEBHOOK_EVENTS = Counter(
    "fittrack_webhook_events_total",
    "Strava webhook events processed",
    ["aspect_type", "outcome"],  # outcome: processed | failed
)