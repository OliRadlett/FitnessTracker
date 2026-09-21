"""Unit tests for pose_analysis pure functions on synthetic landmark series.

pose_analysis imports numpy at module scope, so these are skipped wherever
numpy is unavailable (e.g. the slim backend test image). Run them locally with
the video venv:

    C:\\Users\\oradl\\.venvs\\fittrack-video\\Scripts\\python.exe -m pytest \\
        backend/tests/test_pose_analysis.py -q
"""

import math

import pytest

np = pytest.importorskip("numpy")

from app.integrations import pose_analysis as pa


class Lm:
    __slots__ = ("visibility", "x", "y", "z")

    def __init__(self, x=0.5, y=0.5, z=0.0, visibility=1.0):
        self.x = x
        self.y = y
        self.z = z
        self.visibility = visibility


def _side_pair(x, y, spread=0.01):
    return Lm(x - spread, y), Lm(x + spread, y)


def _pose(knee_angle_deg, hip_y=0.40, thigh=0.15):
    """Symmetric SIDE-VIEW pose. Left/right joints nearly coincide so the
    midpoint-based angle math in pose_analysis sees one bent leg."""
    lms = [Lm(0.5, 0.5) for _ in range(33)]
    for idx, (x, y) in {
        11: (0.5, 0.20), 12: (0.5, 0.20),
        23: (0.5, hip_y), 24: (0.5, hip_y),
        13: (0.5, 0.30), 14: (0.5, 0.30),
        15: (0.5, 0.40), 16: (0.5, 0.40),
    }.items():
        lms[idx] = Lm(x, y)

    phi = math.radians((180.0 - knee_angle_deg) / 2.0)
    knee_x = 0.5 - thigh * math.sin(phi)
    knee_y = hip_y + thigh * math.cos(phi)
    ankle_y = hip_y + 2 * thigh * math.cos(phi)
    lms[23], lms[24] = _side_pair(0.5, hip_y)
    lms[25], lms[26] = _side_pair(knee_x, knee_y)
    lms[27], lms[28] = _side_pair(0.5, ankle_y)
    return lms


def _spread_pose(knee_angle_deg, spread):
    """Synthetic pose with left/right joints separated horizontally by
    ``spread`` — simulates a frontal/rear camera instead of side-on."""
    lms = _pose(knee_angle_deg)
    for left, right in ((11, 12), (23, 24), (25, 26), (27, 28), (13, 14), (15, 16)):
        mid = (lms[left].x + lms[right].x) / 2
        lms[left] = Lm(mid - spread, lms[left].y)
        lms[right] = Lm(mid + spread, lms[right].y)
    return lms


def _cycle_angles(top, bottom, n=20):
    """One smooth top->bottom->top cycle (starts and ends at the top)."""
    return [
        (top + bottom) / 2 + (top - bottom) / 2 * math.cos(2 * math.pi * i / (n - 1))
        for i in range(n)
    ]


def _squat_sequence(reps=3, top=170.0, bottom=70.0, frames_per_rep=20):
    total = reps * frames_per_rep
    mid = (top + bottom) / 2
    amp = (top - bottom) / 2
    return [
        _pose(mid + amp * math.cos(2 * math.pi * (i / frames_per_rep)))
        for i in range(total + 1)
    ]


class TestCalculateAngle:
    def test_right_angle(self):
        assert pa.calculate_angle(np.array([0.0, 1.0]), np.array([0.0, 0.0]), np.array([1.0, 0.0])) == pytest.approx(90.0)

    def test_straight_line(self):
        assert pa.calculate_angle(np.array([0.0, -1.0]), np.array([0.0, 0.0]), np.array([0.0, 1.0])) == pytest.approx(180.0, abs=0.05)

    def test_degenerate_vectors_do_not_raise(self):
        # Coincident points would divide by zero without the epsilon guard.
        assert pa.calculate_angle(np.array([0.0, 0.0]), np.array([0.0, 0.0]), np.array([0.0, 0.0])) == pytest.approx(90.0)


class TestMedianFilter:
    def test_kills_single_frame_spike(self):
        signal = [10.0] * 5 + [100.0] + [10.0] * 5
        filtered = pa._median_filter(signal, window=5)
        assert filtered[5] == 10.0

    def test_short_signal_returned_unchanged(self):
        signal = [1.0, 2.0, 3.0]
        assert list(pa._median_filter(signal, window=7)) == signal


class TestTorsoAngle:
    def test_upright_is_zero(self):
        assert pa._torso_angle(_pose(170.0)) == pytest.approx(0.0, abs=0.05)

    def test_lean_is_positive(self):
        lm = _pose(170.0)
        lm[11], lm[12] = Lm(0.4, 0.20), Lm(0.4, 0.20)
        assert pa._torso_angle(lm) == pytest.approx(26.57, abs=0.5)


class TestSquatDepth:
    def test_deep_squat_achieves_depth(self):
        deep = _pose(70.0)
        assert pa._check_squat_depth(deep, 70.0) is True

    def test_shallow_squat_fails_depth(self):
        shallow = _pose(150.0)
        assert pa._check_squat_depth(shallow, 150.0) is False


class TestDetectRepsFromPose:
    def test_counts_reps_in_synthetic_squat(self):
        seq = _squat_sequence(reps=3)
        ts = [i / 10.0 for i in range(len(seq))]
        reps = pa.detect_reps_from_pose(seq, ts, "Squat")
        assert len(reps) == 3

    def test_expected_reps_selects_deepest_cycles(self):
        seq = _squat_sequence(reps=4)
        ts = [i / 10.0 for i in range(len(seq))]
        reps = pa.detect_reps_from_pose(seq, ts, "Squat", expected_reps=2)
        assert len(reps) == 2

    def test_too_few_frames_returns_empty(self):
        assert pa.detect_reps_from_pose([], [], "Squat") == []

    def test_auto_path_drops_shallow_partial_cycle(self):
        # A shallow cycle (140 deg) then a full rep (70 deg). The shallow one
        # clears the absolute amplitude floor and prominence, but is <75% of
        # the full rep's ROM, so the auto path must drop it.
        angles = _cycle_angles(170, 140) + _cycle_angles(170, 70)
        seq = [_pose(a) for a in angles]
        ts = [i * 0.1 for i in range(len(seq))]
        assert len(pa.detect_reps_from_pose(seq, ts, "Squat")) == 1

    def test_declared_path_keeps_shallow_working_rep(self):
        # 2 deep reps + 1 shallow (a fatigued last rep). The user declared 3,
        # so all three must survive (the auto filter must not apply).
        angles = _cycle_angles(170, 70) * 2 + _cycle_angles(170, 140)
        seq = [_pose(a) for a in angles]
        ts = [i * 0.1 for i in range(len(seq))]
        assert len(pa.detect_reps_from_pose(seq, ts, "Squat", expected_reps=3)) == 3


class TestClassifyExercise:
    def test_synthetic_squat_classified_as_squat(self):
        seq = _squat_sequence(reps=2)
        ts = [i / 10.0 for i in range(len(seq))]
        result = pa.classify_exercise(seq, ts)
        assert result["exercise"] == "Squat"
        assert result["confidence"] > 0.6

    def test_short_sequence_is_unknown(self):
        assert pa.classify_exercise([_pose(170.0)] * 3)["exercise"] == "Unknown"


class TestCameraView:
    def test_side_view_detected(self):
        seq = _squat_sequence(reps=2)
        assert pa.detect_camera_view(seq)["view"] == "side"

    def test_frontal_view_detected(self):
        seq = [_spread_pose(170.0, 0.12) for _ in range(10)]
        assert pa.detect_camera_view(seq)["view"] == "frontal"

    def test_three_quarter_view_detected(self):
        seq = [_spread_pose(170.0, 0.075) for _ in range(10)]
        assert pa.detect_camera_view(seq)["view"] == "three_quarter"

    def test_too_few_frames_is_unknown(self):
        assert pa.detect_camera_view([_pose(170.0)])["view"] == "unknown"


class TestRouteExercise:
    def test_user_declaration_wins(self):
        assert pa.route_exercise("Back Squat", "Deadlift", 0.95) == ("Squat", "user", "Deadlift")

    def test_auto_used_when_user_silent(self):
        assert pa.route_exercise(None, "Deadlift", 0.95) == ("Deadlift", "auto", "Deadlift")

    def test_low_confidence_auto_is_ignored(self):
        assert pa.route_exercise(None, "Deadlift", 0.4) == ("", "none", "")

    def test_stone_routes_to_squat_analyzer(self):
        assert pa.route_exercise("Atlas Stone", "Squat", 0.9)[0] == "Squat"

    def test_log_press_routes_to_press(self):
        assert pa.route_exercise("Log Press", "Overhead Press", 0.95)[0] == "Overhead Press"


class TestSquatFormScoring:
    def test_clean_single_rep_scores_100(self):
        rep = {
            "rep_number": 1,
            "depth_achieved": True,
            "lockout_complete": True,
            "lockout_soft": False,
            "knee_valgus": "good",
            "heels_flat": True,
            "back_angle_deviation": 4.0,
        }
        result = pa.score_squat_form([rep])
        assert result["overall_form_score"] == 100.0
        assert result["competition_valid"] is True
        assert result["deviations"] == []

    def test_multi_rep_set_averages_per_rep_scores(self):
        # 3 reps each losing 25 (depth) + 25 (lockout) = 50 each -> 50 overall.
        # The old summed-deduction code returned 0 for any multi-rep set.
        rep = {
            "rep_number": 1,
            "depth_achieved": False,
            "lockout_complete": False,
            "lockout_soft": False,
            "knee_valgus": "good",
            "heels_flat": True,
            "back_angle_deviation": 4.0,
        }
        reps = [{**rep, "rep_number": n} for n in (1, 2, 3)]
        result = pa.score_squat_form(reps)
        assert result["overall_form_score"] == pytest.approx(50.0)
        assert result["competition_valid"] is False

    def test_one_bad_rep_does_not_tank_a_good_set(self):
        good = {
            "rep_number": 1,
            "depth_achieved": True,
            "lockout_complete": True,
            "lockout_soft": False,
            "knee_valgus": "good",
            "heels_flat": True,
            "back_angle_deviation": 4.0,
        }
        bad = {**good, "depth_achieved": False}
        reps = [good, good, good, good, {**bad, "rep_number": 5}]
        assert pa.score_squat_form(reps)["overall_form_score"] >= 90.0


class TestWorldVelocity:
    @staticmethod
    def _frames(profile):
        # Leg-lift mode measures hip->ankle distance, so the profile is the
        # ankle y with the hip fixed at the origin (0).
        frames = []
        for y in profile:
            lms = [Lm(0.5, 0.0) for _ in range(33)]
            for i in (23, 24):
                lms[i] = Lm(0.5, 0.0)
            for i in (27, 28):
                lms[i] = Lm(0.5, y)
            frames.append(lms)
        return frames

    @staticmethod
    def _reps(n_frames):
        return [{"rep_number": 1, "start_idx": 0, "end_idx": n_frames - 1}]

    def test_metric_velocity_is_plausible(self):
        # A 0.5 m squat rep over 1 s must read ~0.5 m/s. The old 2D path
        # (excursion/hardcoded-ROM scaling) returned ~0.09 m/s.
        profile = [0.0] * 5 + [0.5] * 10 + [0.0] * 10
        ts = [i / 10 for i in range(len(profile))]
        res = pa.bar_velocity_from_world(
            self._frames(profile), ts, self._reps(len(profile)), "Back Squat"
        )
        assert 0.3 <= res["mean_concentric_velocity"] <= 0.6

    def test_velocity_scales_with_amplitude(self):
        ts = [i / 10 for i in range(25)]
        small = pa.bar_velocity_from_world(
            self._frames([0.0] * 5 + [0.25] * 10 + [0.0] * 10), ts,
            self._reps(25), "Back Squat",
        )
        large = pa.bar_velocity_from_world(
            self._frames([0.0] * 5 + [0.50] * 10 + [0.0] * 10), ts,
            self._reps(25), "Back Squat",
        )
        ratio = large["mean_concentric_velocity"] / small["mean_concentric_velocity"]
        assert 1.8 <= ratio <= 2.2

    def test_negative_velocity_loss_is_clamped_to_zero(self):
        # rep 2 measurably faster than rep 1 -> raw loss negative -> report 0.
        profile = [0.30] * 6 + [0.15] * 5 + [0.30] * 5 + [0.15] * 3 + [0.30] * 3
        ts = [i * 0.1 for i in range(len(profile))]
        reps = [
            {"rep_number": 1, "start_idx": 0, "end_idx": 15},
            {"rep_number": 2, "start_idx": 15, "end_idx": len(profile) - 1},
        ]
        res = pa.bar_velocity_from_world(self._frames(profile), ts, reps, "Back Squat")
        assert res["velocity_loss_pct"] == 0.0

    def test_rep_count_preserved_when_unmeasurable(self):
        # A sub-threshold wobble must not silently drop the rep (this is what
        # made 1/3 of production videos have form reps != velocity reps).
        profile = [0.0] * 5 + [0.02] * 10 + [0.0] * 10
        ts = [i / 10 for i in range(len(profile))]
        reps = [
            {"rep_number": 1, "start_idx": 0, "end_idx": len(profile) - 1},
            {"rep_number": 2, "start_idx": 0, "end_idx": 5},
        ]
        res = pa.bar_velocity_from_world(self._frames(profile), ts, reps, "Back Squat")
        assert len(res["rep_timings"]) == 2
        assert all(e["concentric_velocity_ms"] is None for e in res["rep_timings"])
