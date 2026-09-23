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

    def test_fps_scaling_keeps_rep_count_at_30fps(self):
        # Frame-based windows must scale with fps, or a 30 fps track smooths
        # ~3x less and drops reps (8 -> 7 on the labelled squat).
        seq10 = _squat_sequence(reps=3)
        ts10 = [i / 10.0 for i in range(len(seq10))]
        assert len(pa.detect_reps_from_pose(seq10, ts10, "Squat", fps=10.0)) == 3

        seq30 = [lm for lm in seq10 for _ in range(3)]  # upsample ~3x
        ts30 = [i / 30.0 for i in range(len(seq30))]
        assert len(pa.detect_reps_from_pose(seq30, ts30, "Squat", fps=30.0)) == 3


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

    def test_stone_routes_to_its_own_family(self):
        # Not Squat: squat form rules (depth/heels/lean) are meaningless for a
        # stone and produced bogus flags.
        assert pa.route_exercise("Atlas Stone", "Squat", 0.9)[0] == "Stone"

    def test_log_press_routes_to_press(self):
        assert pa.route_exercise("Log Press", "Overhead Press", 0.95)[0] == "Overhead Press"


class TestFootStabilization:
    @staticmethod
    def _frames_with_feet(positions):
        frames = []
        for fx, fy in positions:
            lms = [Lm(0.5, 0.5) for _ in range(33)]
            for i in (27, 28, 29, 30, 31, 32):
                lms[i] = Lm(fx, fy)
            frames.append(lms)
        return frames

    def test_planted_foot_jitter_is_removed(self):
        jitter = [0.004, -0.003, 0.002, -0.004, 0.003, -0.002, 0.001, -0.001,
                  0.004, -0.003, 0.002, -0.004, 0.003, -0.002, 0.001, -0.001,
                  0.002, -0.002, 0.003, -0.003]
        positions = [(0.4 + d, 0.9) for d in jitter]
        frames = self._frames_with_feet(positions)
        out = pa.stabilize_planted_feet(frames)
        xs = [f[27].x for f in out]
        input_range = max(p[0] for p in positions) - min(p[0] for p in positions)
        assert max(xs) - min(xs) < input_range  # jitter reduced
        assert max(xs) - min(xs) < 0.01

    def test_moving_foot_is_followed_not_pinned(self):
        positions = [(0.4 + 0.02 * i, 0.9) for i in range(20)]  # walking
        frames = self._frames_with_feet(positions)
        out = pa.stabilize_planted_feet(frames)
        xs = [f[27].x for f in out]
        assert max(xs) - min(xs) > 0.3  # still spans the movement
        assert xs[0] < xs[-1]           # trend preserved

    def test_too_few_frames_returned_unchanged(self):
        frames = self._frames_with_feet([(0.4, 0.9)] * 3)
        assert pa.stabilize_planted_feet(frames) is frames


class TestAnalysisQuality:
    def _run(self, tmp_path, seq, exercise="Back Squat", reps=0):
        ts = [i * 0.1 for i in range(len(seq))]
        track = {
            "landmarks": seq, "world": [], "timestamps": ts,
            "detected": len(seq), "frames": len(seq),
        }
        return pa.run_pose_analysis(
            tmp_path / "x.mp4", str(tmp_path), 0.0, len(seq) * 0.1,
            exercise, reps, 0.0, track=track,
        )

    def test_no_reps_is_unusable(self, tmp_path):
        seq = [_pose(170.0) for _ in range(20)]  # standing, no reps
        assert self._run(tmp_path, seq)["quality"]["level"] == "unusable"

    def test_full_detection_with_reps_is_good(self, tmp_path):
        seq = _squat_sequence(reps=3)
        out = self._run(tmp_path, seq, reps=3)
        assert out["quality"]["level"] == "good"
        assert out["quality"]["detection_rate"] == 1.0

    def test_low_detection_rate_is_fair(self, tmp_path):
        # 6 detected of 20 frames = 0.3 rate -> unusable; 0.5 -> fair.
        seq = _squat_sequence(reps=2)
        track = {
            "landmarks": seq, "world": [], "timestamps": [i * 0.1 for i in range(len(seq))],
            "detected": len(seq), "frames": len(seq) * 2,
        }
        out = pa.run_pose_analysis(
            tmp_path / "x.mp4", str(tmp_path), 0.0, len(seq) * 0.1,
            "Back Squat", 2, 0.0, track=track,
        )
        assert out["quality"]["level"] == "fair"


class TestRepSprite:
    def test_empty_inputs_return_false(self, tmp_path):
        assert pa.render_rep_sprite(
            tmp_path / "x.mp4", [], [], [], tmp_path / "out.jpg") is False


class TestPullFamily:
    def test_is_pull(self):
        assert pa._is_pull("Pull-up")
        assert pa._is_pull("Chin-up")
        assert pa._is_pull("Barbell Row")
        assert not pa._is_pull("Bench Press")
        assert not pa._is_pull("Back Squat")


class TestPullFormScoring:
    def test_full_rom_scores_100(self):
        result = pa.score_pull_form([{"rep_number": 1, "full_rom": True}])
        assert result["overall_form_score"] == 100.0

    def test_partial_range_flagged(self):
        result = pa.score_pull_form([{"rep_number": 1, "full_rom": False}])
        assert result["overall_form_score"] == 75.0
        assert any("Partial range" in d for d in result["deviations"])


class TestPressFamily:
    def test_is_press_excludes_bench(self):
        assert pa._is_press("Overhead Press")
        assert pa._is_press("Log Press")
        assert pa._is_press("Strict Press")
        assert not pa._is_press("Bench Press")
        assert not pa._is_press("Back Squat")


class TestPressFormScoring:
    def test_clean_lockout_scores_100(self):
        reps = [{"rep_number": 1, "lockout_complete": True}]
        result = pa.score_press_form(reps)
        assert result["overall_form_score"] == 100.0
        assert result["competition_valid"] is True

    def test_missing_lockout_fails(self):
        reps = [{"rep_number": 1, "lockout_complete": False}]
        result = pa.score_press_form(reps)
        assert result["overall_form_score"] == 75.0
        assert result["competition_valid"] is False
        assert any("locked out" in d for d in result["deviations"])


class TestOverlayTrackedPoint:
    def test_squat_uses_shoulder_midpoint(self):
        lm = _pose(170.0)
        expected = ((lm[11].x + lm[12].x) / 2, (lm[11].y + lm[12].y) / 2)
        assert pa._tracked_bar_point(lm, "Back Squat") == pytest.approx(expected)

    def test_deadlift_uses_wrist_midpoint(self):
        lm = _pose(170.0)
        expected = ((lm[15].x + lm[16].x) / 2, (lm[15].y + lm[16].y) / 2)
        assert pa._tracked_bar_point(lm, "Deadlift") == pytest.approx(expected)


class TestSquatLockout:
    def test_side_view_requires_hip_extension(self):
        assert pa._squat_lockout(178.0, 150.0, "side") == (False, True)
        assert pa._squat_lockout(178.0, 172.0, "side") == (True, False)
        assert pa._squat_lockout(150.0, 172.0, "side") == (False, False)

    def test_non_side_only_checks_knees(self):
        # Low-bar 140kg single, 3/4 view: knees locked, hip reads 148 standing.
        # Must NOT be flagged soft (hip angle is sagittal / view-distorted).
        assert pa._squat_lockout(180.0, 148.0, "three_quarter") == (True, False)
        assert pa._squat_lockout(150.0, 148.0, "three_quarter") == (False, False)


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

    def test_moderate_lean_is_not_excessive(self):
        # A real squat leans ~20-40°; the old 10° threshold penalised a clean
        # 150 kg squat that measured 11°. Only genuine collapse should flag.
        rep = {
            "rep_number": 1,
            "depth_achieved": True,
            "lockout_complete": True,
            "lockout_soft": False,
            "knee_valgus": "good",
            "heels_flat": True,
            "back_angle_deviation": 11.0,
        }
        result = pa.score_squat_form([rep])
        assert result["overall_form_score"] == 100.0
        assert not any("forward lean" in d for d in result["deviations"])

    def test_excessive_lean_is_flagged(self):
        rep = {
            "rep_number": 1,
            "depth_achieved": True,
            "lockout_complete": True,
            "lockout_soft": False,
            "knee_valgus": "good",
            "heels_flat": True,
            "back_angle_deviation": 35.0,
        }
        result = pa.score_squat_form([rep])
        assert any("forward lean" in d for d in result["deviations"])
        assert result["overall_form_score"] == 90.0


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


class _LmWithPresence:
    __slots__ = ("presence", "visibility", "x", "y", "z")

    def __init__(self, x=0.5, y=0.5, z=0.0, visibility=0.5, presence=1.0):
        self.x = x
        self.y = y
        self.z = z
        self.visibility = visibility
        self.presence = presence


class TestFramePresence:
    def test_presence_preferred_over_visibility(self):
        lm = [_LmWithPresence(visibility=0.2, presence=0.8) for _ in range(4)]
        assert pa._frame_presence(lm) == pytest.approx(0.8)

    def test_falls_back_to_visibility(self):
        # Lm has no `presence` attribute -> use visibility.
        assert pa._frame_presence([Lm(visibility=0.6) for _ in range(3)]) == pytest.approx(0.6)

    def test_empty_is_zero(self):
        assert pa._frame_presence([]) == 0.0


class TestWorldSignal:
    """The world list is None-padded/aligned to landmarks. `_world_signal`
    must interpolate missing frames rather than crash or shift indices."""

    @staticmethod
    def _leg_frames(profile):
        frames = []
        for y in profile:
            lms = [Lm(0.5, 0.0) for _ in range(33)]
            for i in (23, 24):
                lms[i] = Lm(0.5, 0.0)
            for i in (27, 28):
                lms[i] = Lm(0.5, y)
            frames.append(lms)
        return frames

    def test_missing_frame_is_interpolated_in_place(self):
        frames = self._leg_frames([0.0, 0.0, 0.5, 0.5])
        frames[2] = None  # a 2D-but-no-world frame
        sig = pa._world_signal(frames, "Back Squat")
        assert sig is not None
        assert len(sig) == 4
        # idx2 interpolates between 0.0 (idx1) and 0.5 (idx3) -> 0.25
        assert sig[2] == pytest.approx(0.25, abs=1e-9)

    def test_all_missing_returns_none(self):
        assert pa._world_signal([None, None, None], "Back Squat") is None

    def test_empty_returns_none(self):
        assert pa._world_signal([], "Back Squat") is None

    def test_press_uses_wrist_y(self):
        frames = []
        for y in (0.2, 0.4):
            lms = [Lm(0.5, 0.0) for _ in range(33)]
            lms[15] = Lm(0.5, y)
            lms[16] = Lm(0.5, y)
            frames.append(lms)
        assert list(pa._world_signal(frames, "Overhead Press")) == pytest.approx([0.2, 0.4])


class TestStickingPoint:
    def test_min_speed_position_within_concentric(self):
        # Fast, then a slow (sticking) segment around the middle, then fast.
        pos = [0.0, 0.2, 0.4, 0.6, 0.8, 0.81, 0.82, 0.83, 1.0, 1.4, 1.8, 2.0]
        ts = [i * 0.1 for i in range(len(pos))]
        sp = pa._sticking_point(pos, ts, 0, len(pos) - 1)
        assert sp is not None
        assert 35.0 <= sp["sticking_position_pct"] <= 65.0
        assert sp["sticking_min_velocity_ms"] < 0.5

    def test_too_short_returns_none(self):
        assert pa._sticking_point([0.0, 0.1, 0.2], [0.0, 0.1, 0.2], 0, 2) is None

    def test_none_indices_returns_none(self):
        assert pa._sticking_point([0.0] * 10, [i * 0.1 for i in range(10)], None, None) is None

    def test_rep_timing_entry_carries_sticking_fields(self):
        n = 12
        frames = TestWorldVelocity._frames([0.0] * 3 + [0.5] * 6 + [1.0] * 3)
        ts = [i * 0.1 for i in range(n)]
        reps = [{"rep_number": 1, "start_idx": 0, "end_idx": n - 1,
                 "bottom_idx": 0, "top_idx": n - 1}]
        res = pa.bar_velocity_from_world(frames, ts, reps, "Back Squat")
        assert "sticking_position_pct" in res["rep_timings"][0]


class TestWorldVelocityNoneSafe:
    def test_none_world_frame_preserves_rep_count(self):
        # Regression: a single None world frame used to shift every later
        # index (world appended only when present). It must now interpolate.
        frames = TestWorldVelocity._frames([0.0] * 5 + [0.5] * 10 + [0.0] * 10)
        frames[3] = None
        ts = [i / 10 for i in range(len(frames))]
        reps = [{"rep_number": 1, "start_idx": 0, "end_idx": len(frames) - 1}]
        res = pa.bar_velocity_from_world(frames, ts, reps, "Back Squat")
        assert len(res["rep_timings"]) == 1
        assert res["mean_concentric_velocity"] is not None

    def test_all_none_world_fails_gracefully(self):
        frames = [None] * 20
        ts = [i / 10 for i in range(len(frames))]
        reps = [{"rep_number": 1, "start_idx": 0, "end_idx": len(frames) - 1}]
        res = pa.bar_velocity_from_world(frames, ts, reps, "Back Squat")
        assert res["tracking_quality"] == "failed"
        assert res["mean_concentric_velocity"] == 0.0
