"""Modal resilience helpers — circuit breaker for weekly compute jobs.

Pure-compute with no DB access and stdlib-only imports, so Modal remote
containers (bare ``debian_slim`` images) and dependency-light test
environments can both import this module safely.

RMI-13: every weekly Modal job loops over users calling a remote function
with up to a 300 s timeout. When Modal (or its credentials, or the network
path to it) is down, each per-user call blocks to timeout one after another
— for dozens of users that is hours of dead worker time. The breaker trips
after N consecutive Modal failures and the remaining users are skipped fast
until a later run observes a success.
"""

import time
from collections.abc import Callable


class ModalCircuitBreaker:
    """Consecutive-failure circuit breaker, keyed by task name.

    Closed (allow) by default. ``record(task, ok=False)`` increments the
    consecutive-failure count; any success resets it. Once failures reach
    ``failures_before_open``, ``allow(task)`` returns False for
    ``cooldown_seconds``; after the cooldown one trial call is let through
    (half-open) and its outcome decides the next state.

    In-memory per worker process by design: Celery workers don't share
    memory, so each process trips on its own observations. That only
    shortens the failure cascade (fail-open elsewhere is unchanged).
    """

    def __init__(
        self,
        failures_before_open: int = 3,
        cooldown_seconds: float = 600.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.failures_before_open = failures_before_open
        self.cooldown_seconds = cooldown_seconds
        self._clock = clock
        self._failures: dict[str, int] = {}
        self._opened_at: dict[str, float] = {}
        # task -> time the trial was claimed. A claim that is never recorded
        # (a caller that skips the remote call) expires instead of wedging the
        # task forever.
        self._half_open: dict[str, float] = {}

    def allow(self, task: str) -> bool:
        """Whether a Modal call for ``task`` may proceed.

        A half-open state grants exactly one trial; other callers wait for its
        outcome. A failed trial re-arms the cooldown.
        """
        failures = self._failures.get(task, 0)
        if failures < self.failures_before_open:
            return True
        now = self._clock()
        claimed = self._half_open.get(task)
        if claimed is not None and (now - claimed) < self.cooldown_seconds:
            return False
        opened = self._opened_at.get(task, 0.0)
        if (now - opened) < self.cooldown_seconds:
            return False
        self._half_open[task] = now
        return True

    def record(self, task: str, ok: bool) -> None:
        """Record a Modal call outcome for ``task``."""
        self._half_open.pop(task, None)
        if ok:
            self._failures[task] = 0
            self._opened_at.pop(task, None)
        else:
            self._failures[task] = self._failures.get(task, 0) + 1
            if self._failures[task] >= self.failures_before_open:
                # Re-arm on every failed trial, not only the first failure.
                self._opened_at[task] = self._clock()

    def state(self, task: str) -> str:
        """Human-readable state for logging: closed/open/half-open."""
        if self._failures.get(task, 0) < self.failures_before_open:
            return "closed"
        if task in self._half_open:
            return "half-open"
        opened = self._opened_at.get(task, 0.0)
        return (
            "half-open"
            if (self._clock() - opened) >= self.cooldown_seconds
            else "open"
        )
