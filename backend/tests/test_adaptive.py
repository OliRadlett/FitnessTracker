"""Unit tests for adaptive suggestion inference (§3.11).

The advice engine is a pure function (``derive_adaptive_advice``) so these
tests run without a database.
"""

import pytest

from app.services.adaptive import (
    CONFORMITY_EASY_LOW,
    CONFORMITY_FULL_HIGH,
    CUT_FACTOR,
    RAISE_FACTOR,
    RECOVERY_LOW,
    TSB_FATIGUE_THRESHOLD,
    TSB_OVERLOAD_THRESHOLD,
    derive_adaptive_advice,
)


def _types(advice) -> list[str]:
    return [s["type"] for s in advice["suggestions"]]


# ── Load / fatigue ───────────────────────────────────────────────────────


def test_deep_fatigue_recommends_cut():
    advice = derive_adaptive_advice(tsb=-30.0, ctl=70.0, atl=100.0)
    assert advice["fatigue"] == "fatigued"
    assert advice["summary"] == "Signals favour easing back this week."
    assert advice["axes"][0]["stance"] == "recover"
    assert advice["axes"][0]["severity"] == "critical"
    assert advice["suggestions"][0]["type"] == "intensity_cut"
    assert "15%" in advice["suggestions"][0]["detail"]
    assert advice["suggestions"][0]["severity"] == "critical"


def test_freshness_recommends_raise():
    advice = derive_adaptive_advice(tsb=10.0, ctl=60.0, atl=50.0)
    assert advice["fatigue"] == "fresher"
    assert advice["suggestions"][0]["type"] == "intensity_raise"
    assert "8%" in advice["suggestions"][0]["detail"]


def test_balanced_tsb_favours_maintain():
    advice = derive_adaptive_advice(tsb=0.0, ctl=65.0, atl=65.0)
    assert advice["fatigue"] == "balanced"
    assert not [
        s
        for s in advice["suggestions"]
        if s["type"] in ("intensity_cut", "intensity_raise")
    ]
    assert advice["axes"][0]["stance"] == "maintain"


# ── Recovery ─────────────────────────────────────────────────────────────


def test_low_recovery_swaps_in_rest_day():
    advice = derive_adaptive_advice(tsb=2.0, recovery=35.0)
    assert "rest_day" in _types(advice)
    assert advice["axes"][0]["stance"] == "rest"
    assert (
        advice["summary"]
        == "Recovery is low — the headline advice is rest, not more work."
    )


def test_healthy_recovery_no_rest_suggestion():
    advice = derive_adaptive_advice(tsb=2.0, recovery=78.0)
    assert "rest_day" not in _types(advice)


# ── Conformity ───────────────────────────────────────────────────────────


def test_low_conformity_eases_plan():
    advice = derive_adaptive_advice(
        tsb=0.0,
        conformity_pct=CONFORMITY_EASY_LOW - 5,
        conformity_classification="Deviation",
    )
    assert advice["axes"][0]["stance"] == "ease"
    assert "conformity" in _types(advice) or "intensity_cut" in _types(advice)


def test_full_conformity_builds():
    advice = derive_adaptive_advice(
        tsb=0.0, conformity_pct=CONFORMITY_FULL_HIGH + 5, conformity_trend="stable"
    )
    assert advice["axes"][0]["stance"] == "build"
    assert "intensity_raise" in _types(advice)


def test_full_conformity_but_declining_trend_stays_neutral():
    advice = derive_adaptive_advice(
        tsb=0.0, conformity_pct=CONFORMITY_FULL_HIGH + 5, conformity_trend="declining"
    )
    assert "intensity_raise" not in _types(advice)


# ── Health alerts / deficiencies / data gaps ──────────────────────────────


def test_active_alerts_override_other_advice():
    advice = derive_adaptive_advice(
        tsb=10.0, active_alerts=2, alert_severity="critical"
    )
    assert (
        advice["summary"]
        == "Health signals are flagging — resolve those before adjusting load."
    )
    assert (
        next(a for a in advice["axes"] if a["key"] == "health")["severity"]
        == "critical"
    )
    assert "health_check" in _types(advice)


def test_top_deficiency_adds_advisory():
    advice = derive_adaptive_advice(
        top_deficiency="Squat strength is a priority weakness."
    )
    assert advice["suggestions"][-1]["type"] == "deficiency"
    assert not advice["suggestions"][-1]["actions"]


def test_insufficient_data_is_honest():
    advice = derive_adaptive_advice()
    assert advice["fatigue"] is None
    assert "not enough data" in advice["summary"].lower()
    assert advice["axes"][0]["key"] == "data"
    assert advice["suggestions"] == []


# ── Sanity on thresholds ──────────────────────────────────────────────────


def test_thresholds_are_sane():
    assert TSB_FATIGUE_THRESHOLD < TSB_OVERLOAD_THRESHOLD
    assert CONFORMITY_EASY_LOW < CONFORMITY_FULL_HIGH
    assert 0 < RECOVERY_LOW < 100
    assert 0 < CUT_FACTOR < 1
    assert RAISE_FACTOR > 1
    assert abs((1 - CUT_FACTOR) - 0.15) < 1e-9
    assert abs((RAISE_FACTOR - 1) - 0.08) < 1e-9


def test_no_side_effects_on_inputs():
    tsb, rec = -40.0, 30.0
    derive_adaptive_advice(tsb=tsb, recovery=rec)
    assert tsb == -40.0
    assert rec == 30.0
