"""Tests for lifting service — pure functions (brzycki_1rm, calculate_session_volume)."""

import pytest
from app.services.lifting import brzycki_1rm, calculate_session_volume


class TestBrzycki1RM:
    """Brzycki formula: weight × (36 / (37 - reps))."""

    def test_single_rep(self):
        """1 rep = weight itself (36/36 = 1.0)."""
        assert brzycki_1rm(100.0, 1) == pytest.approx(100.0)

    def test_five_reps(self):
        """5 reps: 100 × (36/32) = 112.5."""
        assert brzycki_1rm(100.0, 5) == pytest.approx(112.5)

    def test_ten_reps(self):
        """10 reps: 100 × (36/27) ≈ 133.33."""
        assert brzycki_1rm(100.0, 10) == pytest.approx(133.33, abs=0.01)

    def test_three_reps(self):
        """3 reps: 100 × (36/34) ≈ 105.88."""
        assert brzycki_1rm(100.0, 3) == pytest.approx(105.88, abs=0.01)

    def test_zero_reps_returns_weight(self):
        """Guard: 0 reps returns weight directly."""
        assert brzycki_1rm(80.0, 0) == 80.0

    def test_negative_reps_returns_weight(self):
        """Guard: negative reps returns weight."""
        assert brzycki_1rm(80.0, -1) == 80.0

    def test_36_reps(self):
        """36 reps: weight × (36/1) = weight × 36."""
        assert brzycki_1rm(10.0, 36) == pytest.approx(360.0)

    def test_37_plus_reps_guard(self):
        """37+ reps guard against division by zero → returns weight × 2."""
        assert brzycki_1rm(100.0, 37) == pytest.approx(200.0)
        assert brzycki_1rm(100.0, 50) == pytest.approx(200.0)


class TestCalculateSessionVolume:
    """Volume = sum of (weight × reps) for non-warmup sets."""

    def test_basic_volume(self):
        sets = [
            {"weight_kg": 100, "reps": 5, "is_warmup": False},
            {"weight_kg": 100, "reps": 5, "is_warmup": False},
            {"weight_kg": 100, "reps": 4, "is_warmup": False},
        ]
        assert calculate_session_volume(sets) == 1400.0

    def test_warmup_sets_excluded(self):
        sets = [
            {"weight_kg": 60, "reps": 10, "is_warmup": True},
            {"weight_kg": 100, "reps": 5, "is_warmup": False},
        ]
        assert calculate_session_volume(sets) == 500.0

    def test_empty_sets(self):
        assert calculate_session_volume([]) == 0.0

    def test_all_warmup(self):
        sets = [
            {"weight_kg": 60, "reps": 10, "is_warmup": True},
            {"weight_kg": 80, "reps": 5, "is_warmup": True},
        ]
        assert calculate_session_volume(sets) == 0.0

    def test_missing_warmup_flag_defaults_false(self):
        """Sets without is_warmup key count as working sets."""
        sets = [
            {"weight_kg": 100, "reps": 5},
        ]
        assert calculate_session_volume(sets) == 500.0
