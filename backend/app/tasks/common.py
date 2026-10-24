"""Shared plumbing for Celery tasks.

Kept out of the scheduler module so a task body and its concurrency guard are not
in the same file. The scheduler imports the guard back into its own namespace on
purpose: the task bodies resolve it as a module global, and two integration
tests monkeypatch it there to bypass Redis.
"""

import logging

logger = logging.getLogger(__name__)


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
