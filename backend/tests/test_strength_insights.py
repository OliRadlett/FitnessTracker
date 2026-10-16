"""Deload-adherence verdict — deterministic, over tonnage + the Jev deload label."""

from __future__ import annotations

from datetime import date, timedelta

from app.services.strength_insights import deload_verdict, phase_read


def _weeks(values, start=date(2026, 1, 5)) -> dict[str, float]:
    """ISO-week keys for a list of tonnages, oldest first (start is a Monday)."""
    return {(start + timedelta(weeks=i)).isoformat(): v for i, v in enumerate(values)}


TODAY = date(2026, 3, 10)


def test_flags_rising_block_with_no_deload_ever():
    verdict = deload_verdict(_weeks([1000, 1000, 1000, 1000, 1200, 1200, 1200, 1200]), [], TODAY)
    assert verdict is not None
    assert verdict["weeks_since_deload"] is None
    assert verdict["recent_avg_volume_kg"] == 1200.0
    assert "consider a lighter week" in verdict["message"]


def test_flags_when_last_deload_is_old():
    old = TODAY - timedelta(weeks=8)
    verdict = deload_verdict(
        _weeks([1000, 1000, 1000, 1000, 1200, 1200, 1200, 1200]), [old], TODAY
    )
    assert verdict is not None
    assert verdict["weeks_since_deload"] == 8


def test_clears_when_a_recent_deload_exists():
    recent = TODAY - timedelta(weeks=2)
    assert (
        deload_verdict(
            _weeks([1000, 1000, 1000, 1000, 1200, 1200, 1200, 1200]), [recent], TODAY
        )
        is None
    )


def test_ignores_flat_or_falling_block():
    assert deload_verdict(_weeks([1000] * 8), [], TODAY) is None
    assert deload_verdict(_weeks([1200, 1200, 1200, 1200, 900, 900, 900, 900]), [], TODAY) is None


def test_none_without_enough_history():
    assert deload_verdict(_weeks([1000, 1100, 1200]), [], TODAY) is None
    assert deload_verdict({}, [], TODAY) is None


def test_zero_prior_baseline_is_guarded():
    assert deload_verdict(_weeks([0, 0, 0, 0, 1200, 1200, 1200, 1200]), [], TODAY) is None


# ── phase read ───────────────────────────────────────────────────────────────


def test_phase_read_names_a_dominant_block():
    accumulation = phase_read({"volume_hypertrophy": 4, "max_strength": 1})
    assert accumulation is not None and "accumulation" in accumulation
    assert "intensification" in phase_read({"max_strength": 5})
    assert "deload" in phase_read({"deload": 3, "technique": 1})


def test_phase_read_is_silent_when_mixed_or_empty():
    assert phase_read({}) is None
    assert phase_read({"max_strength": 2, "volume_hypertrophy": 2, "technique": 1}) is None


def test_phase_read_ignores_an_unknown_dominant():
    assert phase_read({"weird_label": 5}) is None
