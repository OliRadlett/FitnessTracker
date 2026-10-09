"""Adaptive CTL/ATL tau persistence rules (RMI-03) + F7 quality gates.

The canonical 42/7 defaults must never be stored as if they were a personalized
fit, or the API reports them as ``hrv_recovery_fit``.

F7: a fit is only persisted when it clears a sample floor (≥45 overlapping
days) and a signal floor (R² ≥ 0.10 on the fitted TSB↔HRV relationship).
"""

import uuid
from datetime import date, timedelta
from types import SimpleNamespace

from app.integrations.power_models import (
    ADAPTIVE_TAU_MIN_N,
    ADAPTIVE_TAU_MIN_R2,
    adaptive_taus_to_persist,
    fit_adaptive_time_constants,
)


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


# ── F7: persist-level gates ────────────────────────────────────────────────


def test_strong_fit_with_diagnostics_persists():
    assert adaptive_taus_to_persist(
        {
            "ctl_tau": 38,
            "atl_tau": 5,
            "method": "hrv_recovery_fit",
            "correlation": 0.8,
            "r_squared": 0.64,
            "data_points_used": 60,
        }
    ) == (38, 5)


def test_small_n_fit_does_not_persist():
    # Below the sample floor → clear, even with a strong correlation.
    assert adaptive_taus_to_persist(
        {
            "ctl_tau": 38,
            "atl_tau": 5,
            "method": "hrv_recovery_fit",
            "correlation": 0.9,
            "r_squared": 0.81,
            "data_points_used": ADAPTIVE_TAU_MIN_N - 1,
        }
    ) == (None, None)


def test_weak_signal_fit_does_not_persist():
    # Plenty of days but the fitted TSB barely tracks HRV → clear.
    assert adaptive_taus_to_persist(
        {
            "ctl_tau": 38,
            "atl_tau": 5,
            "method": "hrv_recovery_fit",
            "correlation": 0.2,
            "r_squared": 0.04,
            "data_points_used": 90,
        }
    ) == (None, None)


def test_weak_fit_gated_clears_to_defaults():
    assert adaptive_taus_to_persist(
        {
            "ctl_tau": 42,
            "atl_tau": 7,
            "method": "weak_fit_gated",
            "correlation": 0.1,
            "data_points_used": 60,
        }
    ) == (None, None)
    assert adaptive_taus_to_persist(
        {"ctl_tau": 42, "atl_tau": 7, "method": "no_valid_fit"}
    ) == (None, None)


# ── F7: fitter-level gates ─────────────────────────────────────────────────

_ZERO = date(2026, 1, 1)


def _dates(n: int) -> list[str]:
    return [(_ZERO + timedelta(days=i)).isoformat() for i in range(n)]


def _strong_signal_days(n: int = 60) -> tuple[list[dict], list[dict]]:
    """TSS blocks (hard/easy weeks) with HRV tracking default-tau TSB."""
    import math

    days = _dates(n)
    tss = [
        {"date": d, "tss": 110.0 if (i // 7) % 2 == 0 else 35.0}
        for i, d in enumerate(days)
    ]
    ctl = atl = 0.0
    dc, da = 1 - math.exp(-1 / 42), 1 - math.exp(-1 / 7)
    hrv = []
    for i, d in enumerate(days):
        t = tss[i]["tss"]
        ctl += (t - ctl) * dc
        atl += (t - atl) * da
        hrv.append({"date": d, "hrv_ms": 50.0 + 0.4 * (ctl - atl)})
    return tss, hrv


def test_fitter_strong_signal_personalises():
    tss, hrv = _strong_signal_days(60)
    result = fit_adaptive_time_constants(tss, hrv)
    assert result["method"] == "hrv_recovery_fit"
    assert result["data_points_used"] >= ADAPTIVE_TAU_MIN_N
    assert result["r_squared"] >= ADAPTIVE_TAU_MIN_R2
    assert adaptive_taus_to_persist(result) == (
        result["ctl_tau"],
        result["atl_tau"],
    )


def test_fitter_small_n_gates_despite_strong_signal():
    # 35 overlapping days clear the fitter's own floor (30) but not the
    # persistence floor (45) → gated.
    tss, hrv = _strong_signal_days(35)
    result = fit_adaptive_time_constants(tss, hrv)
    assert result["method"] == "weak_fit_gated"
    assert result["data_points_used"] == 35
    assert adaptive_taus_to_persist(result) == (None, None)


def test_fitter_weak_signal_gates_despite_enough_days():
    days = _dates(60)
    tss = [{"date": d, "tss": 50.0 + (i % 5) * 20.0} for i, d in enumerate(days)]
    hrv = [{"date": d, "hrv_ms": 55.0 + 0.001 * (i % 2)} for i, d in enumerate(days)]
    result = fit_adaptive_time_constants(tss, hrv)
    assert result["method"] == "weak_fit_gated"
    assert result["r_squared"] < ADAPTIVE_TAU_MIN_R2
    assert adaptive_taus_to_persist(result) == (None, None)


# ── F7: taint via training_load_for_user ───────────────────────────────────


class _FakeResult:
    def __init__(self, profile):
        self._profile = profile

    def scalar_one_or_none(self):
        return self._profile


class _FakeDB:
    def __init__(self, profile):
        self._profile = profile

    async def execute(self, *args, **kwargs):
        return _FakeResult(self._profile)


async def test_training_load_meta_flags_personalized(monkeypatch):
    import app.services.cycling.tss as tss_mod
    from app.services.cycling.training_load import training_load_for_user

    async def _no_tss(db, user_id, start, end):
        return {}

    monkeypatch.setattr(tss_mod, "get_daily_tss", _no_tss)
    uid = uuid.uuid4()
    db = _FakeDB(SimpleNamespace(ctl_tau=30, atl_tau=5))

    series, meta = await training_load_for_user(
        db, uid, date(2026, 3, 1), lookback_days=7, include_meta=True
    )
    assert isinstance(series, list) and len(series) == 8
    assert meta == {"ctl_tau": 30.0, "atl_tau": 5.0, "personalized": True}


async def test_training_load_meta_flags_defaults(monkeypatch):
    import app.services.cycling.tss as tss_mod
    from app.services.cycling.training_load import training_load_for_user

    async def _no_tss(db, user_id, start, end):
        return {}

    monkeypatch.setattr(tss_mod, "get_daily_tss", _no_tss)
    uid = uuid.uuid4()

    # No profile row at all → defaults, not personalized.
    series, meta = await training_load_for_user(
        _FakeDB(None), uid, date(2026, 3, 1), lookback_days=7, include_meta=True
    )
    assert meta == {"ctl_tau": 42.0, "atl_tau": 7.0, "personalized": False}

    # Default without the flag still returns just the series.
    series_only = await training_load_for_user(
        _FakeDB(None), uid, date(2026, 3, 1), lookback_days=7
    )
    assert isinstance(series_only, list)
    assert [p["tsb"] for p in series_only] == [p["tsb"] for p in series]
