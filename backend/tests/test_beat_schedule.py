"""The beat schedule must name tasks that exist, and the orphan sweep must run.

A beat entry with a mistyped task name fails at runtime, not at import, so a test
is the cheapest place to catch it. The orphan sweep is called out separately
because its review UI shipped without a producer and the queue stayed empty.
"""

from app.tasks import scheduler
from app.tasks.scheduler import celery_app

ORPHAN_TASK = "app.tasks.scheduler.quarantine_orphaned_routes_weekly"


def _beat() -> dict:
    return celery_app.conf.beat_schedule


def test_every_beat_entry_names_an_existing_task():
    missing = [
        entry["task"]
        for entry in _beat().values()
        if not hasattr(scheduler, entry["task"].rsplit(".", 1)[-1])
    ]
    assert not missing, f"beat_schedule names tasks that do not exist: {missing}"


def test_orphan_quarantine_runs_on_a_schedule():
    scheduled = {entry["task"] for entry in _beat().values()}
    assert ORPHAN_TASK in scheduled, (
        "the orphan quarantine producer must be scheduled, or the review queue stays empty"
    )
