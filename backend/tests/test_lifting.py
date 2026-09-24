"""Tests for lifting service — pure functions (brzycki_1rm, calculate_session_volume)."""

from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

from app.services.lifting import (
    MAX_PLAUSIBLE_SESSION_DURATION_SECONDS,
    apply_strava_duration_fallback,
    brzycki_1rm,
    calculate_session_volume,
    session_duration_implausible,
    session_span_implausible,
)


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


def _lifting_session(**overrides):
    """Duck-typed session (SimpleNamespace) for the fallback helpers."""
    base = {
        "duration_seconds": None,
        "started_at": None,
        "ended_at": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _activity(**overrides):
    base = {"duration_seconds": None, "start_date": None}
    base.update(overrides)
    return SimpleNamespace(**base)


class TestSessionDurationImplausible:
    """Threshold is 3h (10800s): ≥ threshold is implausible."""

    def test_threshold_is_three_hours(self):
        assert MAX_PLAUSIBLE_SESSION_DURATION_SECONDS == 3 * 3600

    def test_none_is_plausible(self):
        assert session_duration_implausible(None) is False

    def test_normal_workout_is_plausible(self):
        assert session_duration_implausible(5219) is False  # 1h26

    def test_just_under_threshold_is_plausible(self):
        assert session_duration_implausible(3 * 3600 - 1) is False

    def test_at_threshold_is_implausible(self):
        assert session_duration_implausible(3 * 3600) is True

    def test_stale_finish_is_implausible(self):
        assert session_duration_implausible(535413) is True  # ~148h


class TestSessionSpanImplausible:
    """Triggers on stored duration OR wall-clock started_at→ended_at span."""

    def test_plausible_session(self):
        start = datetime(2026, 9, 14, 17, 38)
        session = _lifting_session(
            duration_seconds=5219,
            started_at=start,
            ended_at=start + timedelta(seconds=5219),
        )
        assert session_span_implausible(session) is False

    def test_implausible_duration_triggers(self):
        session = _lifting_session(duration_seconds=535413)
        assert session_span_implausible(session) is True

    def test_implausible_wall_clock_span_triggers(self):
        """ended_at days after started_at, even with no/short duration."""
        start = datetime(2026, 9, 14, 17, 38)
        session = _lifting_session(
            duration_seconds=None,
            started_at=start,
            ended_at=start + timedelta(days=6),
        )
        assert session_span_implausible(session) is True

    def test_open_session_without_duration_is_plausible(self):
        session = _lifting_session(
            started_at=datetime(2026, 9, 14, 17, 38), ended_at=None
        )
        assert session_span_implausible(session) is False


class TestApplyStravaDurationFallback:
    """Implausible sessions default to the linked activity's recorded time."""

    def test_applies_duration_and_realigns_window(self):
        activity_start = datetime(2026, 9, 14, 17, 38)
        session = _lifting_session(
            duration_seconds=535413,
            started_at=datetime(2026, 9, 14, 17, 38, 8),
            ended_at=datetime(2026, 9, 20, 22, 21, 41),
        )
        activity = _activity(duration_seconds=5219, start_date=activity_start)
        assert apply_strava_duration_fallback(session, activity) is True
        assert session.duration_seconds == 5219
        assert session.started_at == activity_start
        assert session.ended_at == activity_start + timedelta(seconds=5219)

    def test_noop_when_session_plausible(self):
        session = _lifting_session(duration_seconds=5219)
        activity = _activity(
            duration_seconds=3600, start_date=datetime(2026, 9, 14, 17, 38)
        )
        assert apply_strava_duration_fallback(session, activity) is False
        assert session.duration_seconds == 5219

    def test_noop_without_activity(self):
        session = _lifting_session(duration_seconds=535413)
        assert apply_strava_duration_fallback(session, None) is False
        assert session.duration_seconds == 535413

    def test_noop_when_activity_has_no_duration(self):
        session = _lifting_session(duration_seconds=535413)
        activity = _activity(
            duration_seconds=None, start_date=datetime(2026, 9, 14, 17, 38)
        )
        assert apply_strava_duration_fallback(session, activity) is False
        assert session.duration_seconds == 535413

    def test_keeps_session_start_when_activity_start_missing(self):
        """Falls back to started_at + activity duration for ended_at."""
        start = datetime(2026, 9, 14, 17, 38)
        session = _lifting_session(
            duration_seconds=535413, started_at=start, ended_at=start
        )
        activity = _activity(duration_seconds=5219, start_date=None)
        assert apply_strava_duration_fallback(session, activity) is True
        assert session.duration_seconds == 5219
        assert session.started_at == start
        assert session.ended_at == start + timedelta(seconds=5219)


class TestWeightConvention:
    """Per-arm standard: bilateral DB / dual-handle moves log one implement."""

    def test_dumbbell_moves_are_per_arm(self):
        from app.services.exercise_db import weight_convention

        for name in (
            "Hammer Curl",
            "Lateral Raise",
            "Rear Delt Fly",
            "Cable Fly",
            "Dumbbell Bench Press",
            "Incline Dumbbell Press",
            "Dumbbell Row",
            "Farmer Walk",
        ):
            assert weight_convention(name) == "per_arm", name

    def test_barbell_machine_singles_are_total(self):
        from app.services.exercise_db import weight_convention

        for name in (
            "Back Squat",
            "Bench Press",
            "Deadlift",
            "Lat Pulldown",
            "Tricep Pushdown",
            "Leg Press",
            "Kettlebell Swing",
        ):
            assert weight_convention(name) == "total", name

    def test_ambiguous_generic_names_stay_total(self):
        """Bicep Curl / Shrug may be barbell or dumbbells — never guess."""
        from app.services.exercise_db import weight_convention

        assert weight_convention("Bicep Curl") == "total"
        assert weight_convention("Shrug") == "total"

    def test_alias_input_resolves_before_convention(self):
        from app.services.exercise_db import weight_convention

        assert weight_convention("lat raise") == "per_arm"
        assert weight_convention("db bench") == "per_arm"
        assert weight_convention("triceps pushdown") == "total"

    def test_looks_like_combined_weight(self):
        from app.services.exercise_db import looks_like_combined_weight

        # 30 kg against a 15 kg per-arm median → combined total.
        assert looks_like_combined_weight("Hammer Curl", 30.0, 15.0) is True
        # Already per-arm → not combined.
        assert looks_like_combined_weight("Hammer Curl", 15.0, 15.0) is False
        # Total-convention exercises never flag.
        assert looks_like_combined_weight("Tricep Pushdown", 52.0, 26.0) is False
        # Guards.
        assert looks_like_combined_weight("Hammer Curl", 0, 15.0) is False
        assert looks_like_combined_weight("Hammer Curl", 30.0, 0) is False
