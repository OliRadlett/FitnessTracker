"""Beat double-drain protection for the Strava webhook drain (R5/R6).

``plans/quality-charter.md``:
  R5  - "Celery owns drain (50/run, 5 attempts, auth-abort)"
  R6  - "Beat owns WHEN; workers own EXECUTION under guarded locks
         (skipped_lock on contention, fail-open unlocked on outage)"

``process_strava_webhook_events`` is a Beat-scheduled Celery task. Beat can
double-fire it (a slow drain that outruns the 5-minute schedule, an
``acks_late`` redelivery after a worker crash, or two Beat instances). Each run
executes through ``_run_task_guarded``, which takes a Redis lock keyed on the
task name and returns ``{"status": "skipped_lock"}`` when the lock is already
held — so a second concurrent drain never re-drains the queue.

These tests pin that guard directly (no broker, no database): the skipped_lock
contract, the happy path, and the wiring of the Celery task itself.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.services.cache import LockHeldError


@pytest.mark.asyncio
async def test_drain_skipped_when_lock_held():
    """A second drain (Beat double-drain) is skipped, not re-drained.

    This is the double-drain guarantee: when the task lock is already held by a
    running drain, the guard must return ``skipped_lock`` and never invoke the
    drain body.
    """
    from app.tasks.scheduler import _run_task_guarded

    run_called = False

    async def _run():
        nonlocal run_called
        run_called = True
        return {"processed": 1, "failed": 0}

    held_lock = AsyncMock()
    held_lock.__aenter__.side_effect = LockHeldError("celery-task:drain held")

    with (
        patch("app.services.cache.redis_lock", return_value=held_lock),
        patch("app.metrics.SYNC_RUNS"),
    ):
        result = await _run_task_guarded("process_strava_webhook_events", _run)

    assert result == {"status": "skipped_lock"}
    assert run_called is False  # the drain body did NOT run


@pytest.mark.asyncio
async def test_drain_runs_and_releases_lock_when_free():
    """When the lock is free, the drain runs under the lock and releases it."""
    from app.tasks.scheduler import _run_task_guarded

    run_called = False

    async def _run():
        nonlocal run_called
        run_called = True
        return {"processed": 42, "failed": 0}

    free_lock = AsyncMock()
    free_lock.__aenter__.return_value = None
    free_lock.__aexit__.return_value = False

    with (
        patch("app.services.cache.redis_lock", return_value=free_lock),
        patch("app.metrics.SYNC_RUNS"),
    ):
        result = await _run_task_guarded("process_strava_webhook_events", _run)

    assert result == {"processed": 42, "failed": 0}
    assert run_called is True
    free_lock.__aenter__.assert_awaited_once()  # lock acquired
    free_lock.__aexit__.assert_awaited_once()  # lock released


def test_webhook_drain_task_is_guarded_by_lock():
    """``process_strava_webhook_events`` delegates to ``_run_task_guarded``.

    A regression that drops the guard would let Beat double-fire the drain with
    no ``skipped_lock``. This pins the wiring: the Celery task must delegate to
    the guarded wrapper keyed on its own task name (``celery-task:…``), which is
    what makes a second concurrent invocation skip instead of re-draining.

    The task lives in ``app.tasks.sync`` now, and it resolves the guard in that
    module's namespace, so the patch target follows the definition rather than
    the re-export.
    """
    from app.tasks.sync import process_strava_webhook_events

    with patch("app.tasks.sync._run_task_guarded", new_callable=AsyncMock) as spy:
        process_strava_webhook_events()

    spy.assert_called_once()
    # The lock key is derived from this exact task name.
    assert spy.call_args[0][0] == "process_strava_webhook_events"
