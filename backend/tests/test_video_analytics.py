"""Unit tests for video→session load inference (no DB; duck-typed sets)."""

from types import SimpleNamespace

import pytest

pytest.importorskip("sqlalchemy")

from app.services.video_analytics import match_set_load


def _set(name, weight, reps, warmup=False):
    return SimpleNamespace(
        exercise_name=name, weight_kg=weight, reps=reps, is_warmup=warmup
    )


class TestMatchSetLoad:
    def test_unique_match_by_exercise(self):
        sets = [_set("Back Squat", 100, 5), _set("Bench Press", 80, 5)]
        assert match_set_load(sets, "Back Squat", 5) == 100

    def test_declared_reps_disambiguates(self):
        sets = [_set("Back Squat", 60, 8), _set("Back Squat", 100, 5)]
        assert match_set_load(sets, "Back Squat", 5) == 100

    def test_ambiguous_returns_none(self):
        sets = [_set("Back Squat", 100, 5), _set("Back Squat", 105, 5)]
        assert match_set_load(sets, "Back Squat", 5) is None

    def test_warmups_ignored(self):
        sets = [_set("Back Squat", 60, 5, warmup=True), _set("Back Squat", 100, 5)]
        assert match_set_load(sets, "Back Squat", 5) == 100

    def test_no_match_returns_none(self):
        assert match_set_load([_set("Deadlift", 180, 1)], "Back Squat", 5) is None

    def test_alias_normalisation_matches(self):
        # "squat" should normalise to the same family as "Back Squat".
        sets = [_set("Back Squat", 100, 5)]
        assert match_set_load(sets, "squat", 5) == 100
