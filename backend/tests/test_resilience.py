"""Tests for the Modal circuit breaker (RMI-13).

Pure (no DB) — exercises ``app/integrations/resilience.py`` directly.
"""

from app.integrations.resilience import ModalCircuitBreaker


def test_closed_initially():
    br = ModalCircuitBreaker()
    assert br.allow("task") is True
    assert br.state("task") == "closed"


def test_opens_after_threshold_failures():
    br = ModalCircuitBreaker(failures_before_open=3, cooldown_seconds=600)
    br.record("task", False)
    br.record("task", False)
    assert br.allow("task") is True
    br.record("task", False)
    assert br.allow("task") is False
    assert br.state("task") == "open"


def test_success_resets():
    br = ModalCircuitBreaker(failures_before_open=2, cooldown_seconds=600)
    br.record("task", False)
    br.record("task", True)
    assert br.allow("task") is True
    assert br.state("task") == "closed"


def test_half_open_after_cooldown_allows_one_trial():
    now = 0.0
    br = ModalCircuitBreaker(
        failures_before_open=1, cooldown_seconds=0.05, clock=lambda: now
    )
    br.record("task", False)
    assert br.allow("task") is False

    now = 0.06
    assert br.state("task") == "half-open"
    assert br.allow("task") is True
    # The trial is claimed; other callers wait for its outcome.
    assert br.allow("task") is False
    assert br.state("task") == "half-open"


def test_failed_half_open_trial_rearms_the_cooldown():
    now = 0.0
    br = ModalCircuitBreaker(
        failures_before_open=1, cooldown_seconds=10.0, clock=lambda: now
    )
    br.record("task", False)
    now = 11.0
    assert br.allow("task") is True

    br.record("task", False)
    assert br.allow("task") is False
    assert br.state("task") == "open"

    now = 21.0
    assert br.allow("task") is True


def test_tasks_are_independent():
    br = ModalCircuitBreaker(failures_before_open=1, cooldown_seconds=600)
    br.record("modal-a", False)
    assert br.allow("modal-a") is False
    assert br.allow("modal-b") is True
