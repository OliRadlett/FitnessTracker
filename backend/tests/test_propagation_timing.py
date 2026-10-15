"""C5 — strength staleness (propagation timing).

`strength_targets_stale_for_day` is pure, so it runs without a database.
"""

from __future__ import annotations

from types import SimpleNamespace

from app.services.training_plan import strength_targets_stale_for_day


def _day(sport: str, exercises: list[dict] | None) -> SimpleNamespace:
    return SimpleNamespace(sport=sport, planned_exercises=exercises)


def test_non_strength_day_is_never_stale():
    assert strength_targets_stale_for_day(_day("cycle", [{"exercise": "x", "pct_1rm": 0.8, "weight_kg": 1}]), {"x": 100}) is False


def test_manual_weight_without_basis_is_never_stale():
    day = _day("strength", [{"exercise": "Back Squat", "weight_kg": 999}])
    assert strength_targets_stale_for_day(day, {"Back Squat": 150}) is False


def test_matching_weight_is_not_stale():
    # 150 e1RM × 0.8 = 120 → matches the stored weight.
    day = _day("strength", [{"exercise": "Back Squat", "pct_1rm": 0.8, "weight_kg": 120}])
    assert strength_targets_stale_for_day(day, {"Back Squat": 150}) is False


def test_drifted_weight_is_stale():
    # 160 e1RM × 0.8 = 128 vs stored 120 → drifted beyond epsilon.
    day = _day("strength", [{"exercise": "Back Squat", "pct_1rm": 0.8, "weight_kg": 120}])
    assert strength_targets_stale_for_day(day, {"Back Squat": 160}) is True


def test_missing_basis_is_not_stale():
    day = _day("strength", [{"exercise": "Unknown Lift", "pct_1rm": 0.8, "weight_kg": 100}])
    assert strength_targets_stale_for_day(day, {"Unknown Lift": None}) is False
