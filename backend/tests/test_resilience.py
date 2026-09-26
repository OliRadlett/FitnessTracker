"""Tests for the Modal circuit breaker (RMI-13).

Pure (no DB) — exercises ``app/integrations/resilience.py`` directly.
"""

import time

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


def test_half_open_after_cooldown():
    br = ModalCircuitBreaker(failures_before_open=1, cooldown_seconds=0.05)
    br.record("task", False)
    assert br.allow("task") is False
    time.sleep(0.06)
    assert br.allow("task") is True
    assert br.state("task") == "half-open"


def test_tasks_are_independent():
    br = ModalCircuitBreaker(failures_before_open=1, cooldown_seconds=600)
    br.record("modal-a", False)
    assert br.allow("modal-a") is False
    assert br.allow("modal-b") is True
