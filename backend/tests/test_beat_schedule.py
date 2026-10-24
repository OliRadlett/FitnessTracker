"""The beat schedule must name tasks that exist, and the orphan sweep must run.

A beat entry with a mistyped task name fails at runtime, not at import, so a test
is the cheapest place to catch it. The orphan sweep is called out separately
because its review UI shipped without a producer and the queue stayed empty.
"""

from app.tasks import scheduler
from app.tasks.scheduler import celery_app

ORPHAN_TASK = "app.tasks.scheduler.quarantine_orphaned_routes_weekly"

# Tasks that deliberately have no clock. Everything else the scheduler registers
# must appear in the beat schedule, or it is a task that never runs.
ON_DEMAND = {
    "app.tasks.scheduler.process_lift_video",  # dispatched per upload
    "app.tasks.scheduler.push_wahoo_zones_for_user",  # triggered by FTP writes
}


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


def test_every_beat_entry_matches_the_registered_task_name():
    """A scheduled name must be the name the task was actually registered under.

    Without this, a decorator that sets a custom name can diverge from the beat
    dict and the entry silently points at a task the worker never sees.
    """
    for entry in _beat().values():
        attribute = entry["task"].rsplit(".", 1)[-1]
        task = getattr(scheduler, attribute, None)
        assert task is not None, (
            f"beat entry names a task with no definition: {entry['task']}"
        )
        assert task.name == entry["task"], (
            f"beat entry {entry['task']} points at a task registered as {task.name}"
        )


def test_every_scheduler_task_is_scheduled_or_on_demand():
    """A registered task with no clock and no on-demand entry never runs.

    This is the shape of the orphan-quarantine bug: everything was built and
    nothing called it. The allowlist is explicit so an omission is visible
    rather than silent.
    """
    scheduled = {entry["task"] for entry in _beat().values()}
    registered = {
        name for name in celery_app.tasks if name.startswith("app.tasks.scheduler.")
    }
    unscheduled = registered - scheduled - ON_DEMAND
    assert not unscheduled, (
        f"tasks are neither scheduled nor marked on demand: {sorted(unscheduled)}"
    )
