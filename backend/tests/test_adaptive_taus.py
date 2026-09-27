"""Adaptive CTL/ATL tau persistence rules (RMI-03).

The canonical 42/7 defaults must never be stored as if they were a personalized
fit, or the API reports them as ``hrv_recovery_fit``.
"""

from app.integrations.power_models import adaptive_taus_to_persist


def test_successful_fit_persists_fitted_values():
    assert adaptive_taus_to_persist(
        {"ctl_tau": 38, "atl_tau": 5, "method": "hrv_recovery_fit"}
    ) == (38, 5)


def test_insufficient_data_clears_to_defaults():
    assert adaptive_taus_to_persist(
        {"ctl_tau": 42, "atl_tau": 7, "method": "insufficient_data"}
    ) == (None, None)
    assert adaptive_taus_to_persist(
        {"ctl_tau": 42, "atl_tau": 7, "method": "insufficient_overlap"}
    ) == (None, None)


def test_absent_result_leaves_unchanged():
    # Transient failure / circuit breaker — no adaptive_constants key at all.
    assert adaptive_taus_to_persist({}) is None
    assert adaptive_taus_to_persist({"method": "something_else"}) is None
