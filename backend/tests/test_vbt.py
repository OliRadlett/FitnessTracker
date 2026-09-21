"""Unit tests for the VBT load-velocity profile service."""

import pytest

from app.services.vbt import (
    DEFAULT_MVT,
    load_velocity_profile,
    mvt_for,
)


class TestMvt:
    def test_known_lifts(self):
        assert mvt_for("Back Squat") == 0.30
        assert mvt_for("Bench Press") == 0.15
        assert mvt_for("Deadlift") == 0.15
        assert mvt_for("Overhead Press") == 0.20

    def test_unknown_and_none_use_default(self):
        assert mvt_for("Cable Fly") == DEFAULT_MVT
        assert mvt_for(None) == DEFAULT_MVT

    def test_case_and_whitespace_insensitive(self):
        assert mvt_for("  squat  ") == 0.30


class TestLoadVelocityProfile:
    def test_perfect_line_gives_exact_1rm(self):
        # v = 1.0 - 0.002*load  -> squat MVT 0.30 at 350 kg
        pts = [(100.0, 0.8), (150.0, 0.7), (200.0, 0.6)]
        p = load_velocity_profile(pts, "Back Squat")
        assert p.n == 3
        assert p.slope == pytest.approx(-0.002)
        assert p.intercept == pytest.approx(1.0)
        assert p.r2 == pytest.approx(1.0)
        assert p.est_1rm_kg == pytest.approx(350.0, abs=0.1)

    def test_default_mvt_when_exercise_unknown(self):
        pts = [(100.0, 0.8), (200.0, 0.6)]
        p = load_velocity_profile(pts)
        assert p.mvt == DEFAULT_MVT
        assert p.est_1rm_kg == pytest.approx(400.0, abs=0.1)

    def test_positive_slope_gives_no_1rm(self):
        # Faster with heavier load is physically impossible -> no estimate.
        pts = [(100.0, 0.5), (200.0, 0.9)]
        p = load_velocity_profile(pts, "Back Squat")
        assert p.slope > 0
        assert p.est_1rm_kg is None

    def test_single_point_is_insufficient(self):
        p = load_velocity_profile([(100.0, 0.5)], "Back Squat")
        assert p.n == 1
        assert p.slope is None
        assert p.est_1rm_kg is None
        assert p.confidence == "insufficient"

    def test_same_load_twice_has_no_slope(self):
        p = load_velocity_profile([(100.0, 0.5), (100.0, 0.55)], "Back Squat")
        assert p.slope is None
        assert p.confidence == "insufficient"

    def test_absurd_extrapolation_is_rejected(self):
        # A near-flat line puts the MVT crossing far beyond the observed loads.
        pts = [(100.0, 0.50), (200.0, 0.48)]
        p = load_velocity_profile(pts, "Back Squat")
        assert p.est_1rm_kg is None

    def test_zero_load_points_are_ignored(self):
        p = load_velocity_profile(
            [(0.0, 0.5), (100.0, 0.8), (200.0, 0.6)], "Back Squat")
        assert p.n == 2

    def test_confidence_scales_with_data(self):
        tight = [(100, 0.8), (120, 0.76), (140, 0.72), (160, 0.68),
                 (180, 0.64), (200, 0.60)]
        assert load_velocity_profile(tight, "Back Squat").confidence == "high"

        medium = [(100, 0.8), (120, 0.76), (140, 0.70), (160, 0.68)]
        assert load_velocity_profile(medium, "Back Squat").confidence in (
            "medium", "low")

        assert load_velocity_profile(
            [(100, 0.8), (140, 0.6)], "Back Squat").confidence == "insufficient"

    def test_est_1rm_is_none_without_enough_points(self):
        assert load_velocity_profile([], "Back Squat").est_1rm_kg is None
