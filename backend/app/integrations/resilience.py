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
        self, failures_before_open: int = 3, cooldown_seconds: float = 600.0
    ) -> None:
        self.failures_before_open = failures_before_open
        self.cooldown_seconds = cooldown_seconds
        self._failures: dict[str, int] = {}
        self._opened_at: dict[str, float] = {}

    def allow(self, task: str) -> bool:
        """Whether a Modal call for ``task`` may proceed."""
        failures = self._failures.get(task, 0)
        if failures < self.failures_before_open:
            return True
        opened = self._opened_at.get(task, 0.0)
        # Half-open: one trial per cooldown window.
        return (time.monotonic() - opened) >= self.cooldown_seconds

    def record(self, task: str, ok: bool) -> None:
        """Record a Modal call outcome for ``task``."""
        if ok:
            self._failures[task] = 0
            self._opened_at.pop(task, None)
        else:
            self._failures[task] = self._failures.get(task, 0) + 1
            if self._failures[task] >= self.failures_before_open:
                self._opened_at.setdefault(task, time.monotonic())

    def state(self, task: str) -> str:
        """Human-readable state for logging: closed/open/half-open."""
        if self._failures.get(task, 0) < self.failures_before_open:
            return "closed"
        return "half-open" if self.allow(task) else "open"
