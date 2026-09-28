"""Unit tests for metric 3D bar tracking (`plans/bar-tracking-3d.md`).

Pure NumPy — no mediapipe, cv2 or video needed. The fixtures are a synthetic
body projected through the same weak-perspective camera the module fits, so
the expected numbers are exact rather than golden-file approximations.
"""

from typing import ClassVar

import pytest

np = pytest.importorskip("numpy")

from app.integrations import bar_tracking_3d as b3

# Camera: a phone-ish portrait frame, subject 3 m away.
W, H = 1080, 1920
F = 800.0
Z = 3.0


class P:
    """Landmark stub: image landmarks are normalised, world ones metric."""

    __slots__ = ("visibility", "x", "y", "z")

    def __init__(self, x=0.0, y=0.0, z=0.0, visibility=1.0):
        self.x = x
        self.y = y
        self.z = z
        self.visibility = visibility


def _world_body() -> np.ndarray:
    """33 metric landmarks: camera-axis aligned, midfoot at the origin.

    Proportions of a ~1.6 m head-to-heel figure with the bar-on-the-back squat
    shoulder height at 1.30 m, so a squat bar sits at ~1.35 m — the range the
    plan says a correct calibration must land in.
    """
    w = np.zeros((33, 3))

    def put(i, x, y, z):
        w[i] = (x, y, z)

    for i in (0, 1, 2, 3, 4, 5, 6, 7, 8):  # head
        put(i, 0.0, -1.60, -0.02)
    put(11, -0.20, -1.30, 0.0)
    put(12, 0.20, -1.30, 0.0)
    put(13, -0.26, -0.95, 0.02)
    put(14, 0.26, -0.95, 0.02)
    put(15, -0.24, -0.60, 0.06)
    put(16, 0.24, -0.60, 0.06)
    for i in (17, 19, 21):
        put(i, -0.24, -0.70, 0.08)
    for i in (18, 20, 22):
        put(i, 0.24, -0.70, 0.08)
    put(23, -0.16, -0.90, 0.0)
    put(24, 0.16, -0.90, 0.0)
    put(25, -0.16, -0.45, 0.0)
    put(26, 0.16, -0.45, 0.0)
    put(27, -0.16, -0.08, 0.0)
    put(28, 0.16, -0.08, 0.0)
    put(29, -0.16, 0.0, -0.09)  # heels
    put(30, 0.16, 0.0, -0.09)
    put(31, -0.16, 0.0, 0.09)  # foot index: fwd = +z
    put(32, 0.16, 0.0, 0.09)
    return w


WORLD = _world_body()
# The lifter's height *is* this body's head->heel, so passing it as the
# calibration anchor must leave the world landmarks untouched.
LIFTER_HEIGHT_M = float(np.linalg.norm(WORLD[0] - (WORLD[29] + WORLD[30]) / 2.0))


def _image(xyz: np.ndarray) -> list:
    """Project camera-axis-aligned metric coordinates to normalised image."""
    out = []
    for x, y, z in xyz:
        z = z + Z  # the body sits Z in front of the camera
        out.append(P(x * F / z / W + 0.5, y * F / z / H + 0.5, 0.0))
    return out


IMAGE = _image(WORLD)


def _world_frame(xyz: np.ndarray) -> list:
    return [P(*(float(v) for v in p)) for p in xyz]


def _camera(**over):
    cam = {
        "focal_px": F,
        "width": W,
        "height": H,
        "cx": W / 2,
        "cy": H / 2,
        "height_scale": 1.0,
        "px_per_m": F / Z,
        "subject_distance_m": Z,
    }
    cam.update(over)
    return cam


def _bar_at(y=-1.35, x=0.0, z=0.0, depth=0.0, **over):
    """A bar_track entry whose point is ``(x, y, z)`` metres in the scene.

    ``depth`` is the distance the detector's box is assumed to sit at. The
    module unprojects the image point at the *anchor* depth (the joint the bar
    is held at), so a fixture that moves the bar's depth must move this too or
    the two disagree and the frame is (correctly) dropped as implausible.
    """
    zz = z + depth + Z
    entry = {
        "x": x * F / zz / W + 0.5,
        "y": y * F / zz / H + 0.5,
        "bar_x": x * F / zz / W + 0.5,
        "bar_y": y * F / zz / H + 0.5,
        "confidence": 0.9,
        "source": "proxy_offset",
        "bar_basis": "plate_pair",
    }
    entry.update(over)
    return entry


def _feet_at(mid_z, length=0.18):
    """The synthetic body with its midfoot moved along the depth axis."""
    body = WORLD.copy()
    for i, x in ((29, -0.16), (30, 0.16)):
        body[i] = (x, 0.0, mid_z - length / 2)
    for i, x in ((31, -0.16), (32, 0.16)):
        body[i] = (x, 0.0, mid_z + length / 2)
    return body


class TestBodyHeightScale:
    def test_unknown_height_is_identity(self):
        assert b3.body_height_scale([_world_frame(WORLD)], None) == 1.0

    def test_scales_by_measured_head_to_heel(self):
        # A 1.6 m body described by a 1.3 m prior needs a 1.23x correction.
        assert b3.body_height_scale([_world_frame(WORLD)], 2.0) == pytest.approx(
            2.0 / 1.60, rel=1e-3
        )

    def test_ignores_absurd_estimates(self):
        assert b3.body_height_scale([_world_frame(WORLD * 0.01)], 1.6) == 1.0


class TestFitClipCamera:
    def _clip(self, n=10):
        return [IMAGE] * n, [_world_frame(WORLD)] * n

    def test_requires_the_focal(self):
        lms, wld = self._clip()
        assert b3.fit_clip_camera(lms, wld, 0, W, H, LIFTER_HEIGHT_M) is None

    def test_requires_the_lifter_height(self):
        # MediaPipe's world scale is an average-body prior, so without a real
        # height every metric number is ~2x out.
        lms, wld = self._clip()
        assert b3.fit_clip_camera(lms, wld, F, W, H, None) is None

    def test_requires_a_usable_frame_size(self):
        lms, wld = self._clip()
        assert b3.fit_clip_camera(lms, wld, F, 0, H, LIFTER_HEIGHT_M) is None

    def test_too_few_frames(self):
        lms, wld = self._clip(2)
        assert b3.fit_clip_camera(lms, wld, F, W, H, LIFTER_HEIGHT_M) is None

    def test_recovers_the_scale_and_distance(self):
        lms, wld = self._clip()
        cam = b3.fit_clip_camera(lms, wld, F, W, H, LIFTER_HEIGHT_M)
        assert cam is not None
        # The synthetic body is not planar in z, so the least-squares scale is
        # a depth-weighted average of f/Z rather than f/Z exactly — the same
        # (small) departure the real world landmarks show.
        assert cam["px_per_m"] == pytest.approx(F / Z, rel=0.02)
        assert cam["subject_distance_m"] == pytest.approx(Z, rel=0.02)
        assert cam["scale_spread"] == pytest.approx(0.0, abs=1e-3)
        # The principal point is the image centre, never fitted from the pose.
        assert (cam["cx"], cam["cy"]) == (W / 2, H / 2)
        assert cam["height_scale"] == pytest.approx(1.0, rel=1e-3)

    def test_skips_frames_without_a_pose(self):
        lms, wld = self._clip(10)
        lms[3] = None
        wld[4] = None
        cam = b3.fit_clip_camera(lms, wld, F, W, H, LIFTER_HEIGHT_M)
        assert cam["n_frames"] == 8

    def test_height_scale_changes_the_fitted_distance(self):
        """A 2x-small body prior must move the subject further away."""
        lms = [IMAGE] * 10
        wld = [_world_frame(WORLD * 0.5)] * 10
        cam = b3.fit_clip_camera(lms, wld, F, W, H, LIFTER_HEIGHT_M)
        assert cam["height_scale"] == pytest.approx(2.0, rel=1e-3)
        assert cam["subject_distance_m"] == pytest.approx(Z, rel=0.05)


class TestLiftBar3D:
    def _track(self, n=4, **over):
        return [_bar_at(**over) for _ in range(n)]

    def test_bar_height_above_the_midfoot(self):
        out = b3.lift_bar_3d(
            [IMAGE] * 2,
            [_world_frame(WORLD)] * 2,
            self._track(2),
            _camera(),
            "Back Squat",
        )
        assert out[0] is not None
        # A bar on the back sits just above a 1.30 m shoulder height.
        assert out[0]["height_m"] == pytest.approx(1.35, abs=0.01)
        assert out[0]["lateral_mm"] == pytest.approx(0.0, abs=1.0)

    def test_no_camera_gives_no_track(self):
        assert b3.lift_bar_3d(
            [IMAGE], [_world_frame(WORLD)], self._track(1), None, "Back Squat"
        ) == [None]

    def test_a_single_plate_is_not_a_bar_centre(self):
        """A lone plate box is the bar's end — metres wrong once lifted."""
        out = b3.lift_bar_3d(
            [IMAGE],
            [_world_frame(WORLD)],
            [_bar_at(bar_basis="plate")],
            _camera(),
            "Back Squat",
        )
        assert out == [None]

    def test_pose_proxy_track_is_not_lifted(self):
        entry = _bar_at()
        entry.pop("bar_x")
        entry.pop("bar_y")
        entry["source"] = "pose_proxy"
        assert b3.lift_bar_3d(
            [IMAGE], [_world_frame(WORLD)], [entry], _camera(), "Back Squat"
        ) == [None]

    def test_missing_pose_or_world_frame(self):
        track = self._track(3)
        assert (
            b3.lift_bar_3d(
                [IMAGE, None, IMAGE],
                [_world_frame(WORLD)] * 3,
                track,
                _camera(),
                "Back Squat",
            )[1]
            is None
        )
        assert (
            b3.lift_bar_3d(
                [IMAGE] * 3,
                [_world_frame(WORLD), None, _world_frame(WORLD)],
                track,
                _camera(),
                "Back Squat",
            )[1]
            is None
        )

    def test_wild_per_frame_scale_is_dropped(self):
        """A frame whose own scale disagrees with the clip is a bad pose."""
        far = _image(WORLD * 2.0)  # the lifter doubled in size
        lms = [IMAGE] * 4
        lms[2] = far
        out = b3.lift_bar_3d(
            lms, [_world_frame(WORLD)] * 4, self._track(4), _camera(), "Back Squat"
        )
        assert out[2] is None
        assert out[1] is not None

    def test_implausible_offset_is_dropped(self):
        out = b3.lift_bar_3d(
            [IMAGE],
            [_world_frame(WORLD)],
            [_bar_at(y=-40.0)],
            _camera(),
            "Back Squat",
        )
        assert out == [None]

    def test_depth_anchor_follows_the_joint_the_bar_is_at(self):
        """Shoulders for a squat, wrists otherwise — a forward lean must count."""
        lean = WORLD.copy()
        lean[11] = (-0.20, -1.30, 0.40)  # shoulders 0.40 m nearer the camera
        lean[12] = (0.20, -1.30, 0.40)
        image, world = [_image(lean)], [_world_frame(lean)]
        flat = b3.lift_bar_3d(
            [IMAGE], [_world_frame(WORLD)], [_bar_at()], _camera(), "Back Squat"
        )[0]
        squat = b3.lift_bar_3d(
            image, world, [_bar_at(depth=0.40)], _camera(), "Back Squat"
        )[0]
        bench = b3.lift_bar_3d(
            image, world, [_bar_at(depth=0.06)], _camera(), "Bench Press"
        )[0]
        # Each is unprojected at its own anchor depth, so the bar sits 0.40 m
        # (squat) or 0.06 m (press) nearer the camera than the un-anchored fit.
        assert squat["depth_m"] - flat["depth_m"] == pytest.approx(0.40, abs=0.1)
        assert bench["depth_m"] - flat["depth_m"] == pytest.approx(0.06, abs=0.1)
        # ...and each is unprojected at *its own* depth, so the metric height
        # comes out the same either way — only the depth estimate moves.
        assert squat["height_m"] == pytest.approx(1.35, abs=0.02)
        assert bench["height_m"] == pytest.approx(1.35, abs=0.02)

    def test_front_back_follows_the_heel_to_toe_axis(self):
        """The foot points to +z, so a bar behind the midfoot reads positive."""
        fb = []
        for mid_z in (-0.30, 0.30):
            body = _feet_at(mid_z)
            out = b3.lift_bar_3d(
                [_image(body)],
                [_world_frame(body)],
                [_bar_at()],
                _camera(),
                "Back Squat",
            )[0]
            fb.append(out["front_back_mm"])
        # The bar is at the shoulder depth, so with the midfoot 0.30 m either
        # side of it the two readings are +300 / -300 mm.
        assert fb[0] == pytest.approx(300.0, abs=10.0)
        assert fb[1] == pytest.approx(-300.0, abs=10.0)

    def test_lateral_is_the_axis_across_the_body(self):
        """A side view: 'lateral' must be the depth axis, not the image x."""
        body = WORLD.copy()
        # Turn the lifter 90 degrees: the feet point along +x, so the hip line
        # (across the body) becomes the depth axis.
        for i in (29, 30):
            body[i] = (-0.09, 0.0, -0.25)
        for i in (31, 32):
            body[i] = (0.09, 0.0, -0.25)
        for i, z in ((23, -0.09), (24, 0.09)):
            body[i] = (0.0, -0.90, z)
        out = b3.lift_bar_3d(
            [_image(body)], [_world_frame(body)], [_bar_at()], _camera(), "Back Squat"
        )[0]
        # Hip 23 sits nearer the camera than 24, so its axis points -z: the bar
        # being 0.25 m behind the midfoot reads as -250 mm of lateral.
        assert out["lateral_mm"] == pytest.approx(-250.0, abs=10.0)
        assert out["front_back_mm"] == pytest.approx(0.0, abs=1.0)


class TestRemapReps:
    # The pose runs at 10 fps, so the dense series is 0.1 s per frame and a
    # ~1.4 s rep spans ~15 frames. Two reps, at 1.0-2.4 s and 3.0-4.4 s.
    DENSE_TIMES: ClassVar = [round(i * 0.1, 2) for i in range(48)]

    def _reps(self):
        return [
            {
                "rep_number": 1,
                "start_idx": 10,
                "end_idx": 24,
                "start_time": 1.0,
                "end_time": 2.4,
            },
            {
                "rep_number": 2,
                "start_idx": 30,
                "end_idx": 44,
                "start_time": 3.0,
                "end_time": 4.4,
            },
        ]

    def test_agrees_with_the_dense_indices_when_nothing_is_missing(self):
        """The common single-person case: the two series are the same list."""
        out = b3.remap_reps(self._reps(), self.DENSE_TIMES)
        assert [(r["start_idx"], r["end_idx"]) for r in out] == [(10, 24), (30, 44)]

    def test_shifts_indices_onto_a_sparser_series(self):
        """The lifter missed frames, so the records series is shorter.

        Without the remap the rep windows would read frames 10-24 of a series
        that is 10 frames shorter — the wrong part of the lift entirely.
        """
        times = [t for i, t in enumerate(self.DENSE_TIMES) if i not in range(4, 9)]
        assert len(times) == 43
        out = b3.remap_reps(self._reps(), times)
        # Frames 4-8 (0.4-0.8 s) are missing: everything after shifts by 5.
        assert [(r["start_idx"], r["end_idx"]) for r in out] == [(5, 19), (25, 39)]
        assert [r["rep_number"] for r in out] == [1, 2]

    def test_drops_a_rep_with_too_few_detector_frames(self):
        # The detector saw only the first two frames of rep 1 (0.1 s) — too
        # few for a percentile over a rep, so it is dropped, not extrapolated.
        times = [0.95, 1.05, 1.15] + self.DENSE_TIMES[25:45]
        out = b3.remap_reps(self._reps(), times)
        assert [r["rep_number"] for r in out] == [2]

    def test_preserves_the_other_rep_fields(self):
        out = b3.remap_reps(self._reps(), self.DENSE_TIMES)
        assert out[0]["start_time"] == 1.0
        assert out[0]["end_time"] == 2.4

    def test_no_times_means_no_reps(self):
        assert b3.remap_reps(self._reps(), []) == []

    def test_reps_without_a_window_are_dropped_not_guessed(self):
        """An index from a foreign series is worse than no rep at all."""
        out = b3.remap_reps(
            [{"rep_number": 1, "start_idx": 10, "end_idx": 24}],
            self.DENSE_TIMES,
        )
        assert out == []

    def test_tolerates_missing_timestamps_without_renumbering(self):
        # A record with no clock entry must not shift the indices after it.
        times = list(self.DENSE_TIMES)
        times[12] = None
        out = b3.remap_reps(self._reps(), times)
        assert [(r["start_idx"], r["end_idx"]) for r in out] == [(10, 24), (30, 44)]


class TestAnalyzeBarPath3D:
    def _reps(self, spans):
        return [
            {"rep_number": i + 1, "start_idx": s, "end_idx": e}
            for i, (s, e) in enumerate(spans)
        ]

    def _rep(self, n, height=1.35, lateral=None, basis="plate_pair"):
        out = []
        for i in range(n):
            la = lateral(i) if lateral else 0.0
            out.append(
                {
                    "height_m": height,
                    "front_back_mm": 0.0,
                    "lateral_mm": la,
                    "depth_m": Z,
                    "basis": basis,
                    "confidence": 0.9,
                }
            )
        return out

    def test_needs_two_reps(self):
        track = self._rep(8)
        assert b3.analyze_bar_path_3d(track, self._reps([(0, 7)])) is None
        assert b3.analyze_bar_path_3d([], self._reps([(0, 7)])) is None
        assert b3.analyze_bar_path_3d(track, []) is None

    def test_aggregates_a_clean_track(self):
        track = self._rep(8) + self._rep(8, height=1.15)
        out = b3.analyze_bar_path_3d(track, self._reps([(0, 7), (8, 15)]), _camera())
        assert out["basis"] == "metric_3d"
        assert out["n_reps"] == 2
        assert out["bar_height_top_m"] == pytest.approx(1.25, abs=0.01)
        assert out["lateral_mm"] == pytest.approx(0.0, abs=0.1)
        assert out["net_lateral_mm"] == pytest.approx(0.0, abs=0.1)
        assert out["per_rep"][0]["n_frames"] == 8
        assert "note" in out

    def test_reports_real_vertical_range(self):
        """The one number a 2D view genuinely cannot give: metres travelled."""
        top = self._rep(8, height=1.35)
        track = top + self._rep(8, height=0.75)
        out = b3.analyze_bar_path_3d(track, self._reps([(0, 7), (8, 15)]))
        assert out["vertical_range_m"] == pytest.approx(0.0, abs=0.01)
        # Within a rep, the bar descends then ascends.
        wave = [
            {
                "height_m": h,
                "front_back_mm": 0.0,
                "lateral_mm": 0.0,
                "depth_m": Z,
                "basis": "plate_pair",
                "confidence": 0.9,
            }
            for h in (1.35, 1.2, 0.75, 0.75, 1.2, 1.35, 1.35, 1.35)
        ]
        out = b3.analyze_bar_path_3d(wave + self._rep(8), self._reps([(0, 7), (8, 15)]))
        assert out["per_rep"][0]["vertical_range_m"] == pytest.approx(0.6, abs=0.01)

    def test_net_lateral_catches_a_drift(self):
        drift = self._rep(8, lateral=lambda i: 20.0 * i)
        track = drift + drift
        out = b3.analyze_bar_path_3d(track, self._reps([(0, 7), (8, 15)]))
        # First quarter mean 10 mm, last quarter mean 130 mm.
        assert out["net_lateral_mm"] == pytest.approx(120.0, abs=1.0)

    def test_rejects_outlier_frames(self):
        pts = self._rep(8)
        pts[4] = dict(pts[4], lateral_mm=1000.0)  # a spare plate on the rack
        track = pts + self._rep(8)
        out = b3.analyze_bar_path_3d(track, self._reps([(0, 7), (8, 15)]))
        assert out["lateral_mm"] == pytest.approx(0.0, abs=1.0)
        assert out["per_rep"][0]["n_frames"] == 7

    def test_echoes_the_calibration(self):
        cam = _camera(height_scale=1.234, lifter_height_m=1.6, scale_spread=0.02)
        out = b3.analyze_bar_path_3d(
            self._rep(8) + self._rep(8), self._reps([(0, 7), (8, 15)]), cam
        )
        assert out["calibration"]["focal_px"] == F
        assert out["calibration"]["lifter_height_m"] == 1.6
        assert out["calibration"]["height_scale"] == 1.234
        assert "No 3D ground truth" in out["note"]

    def test_flags_mixed_bar_centre_sources(self):
        track = self._rep(8) + self._rep(8, basis="barbell")
        out = b3.analyze_bar_path_3d(track, self._reps([(0, 7), (8, 15)]))
        assert "Mixed bar-centre sources" in out["note"]


class TestEndToEnd:
    def test_image_lands_on_a_metric_bar_path(self):
        """body -> camera fit -> 3D lift -> metrics, with no UI in between."""
        # One descent-and-ascent per rep: the summary is the *mean over reps* of
        # each rep's 90th/10th percentile, so a clip of two reps pinned at one
        # height would only ever report that height.
        wave = (1.35, 1.05, 0.75, 0.75, 1.05, 1.35, 1.35, 1.35)
        heights = wave * 2
        world, image, track = [], [], []
        for h in heights:
            # The bar sits directly over the midfoot (z = 0), so the scene y of
            # -h is exactly h above the foot.
            world.append(_world_frame(WORLD))
            image.append(IMAGE)
            track.append(_bar_at(y=-h))
        reps = [
            {"rep_number": 1, "start_idx": 0, "end_idx": 7},
            {"rep_number": 2, "start_idx": 8, "end_idx": 15},
        ]
        cam = b3.fit_clip_camera(image, world, F, W, H, LIFTER_HEIGHT_M)
        out = b3.analyze_bar_path_3d(
            b3.lift_bar_3d(image, world, track, cam, "Back Squat"), reps, cam
        )
        assert out["basis"] == "metric_3d"
        assert out["bar_height_top_m"] == pytest.approx(1.35, abs=0.01)
        assert out["bar_height_bottom_m"] == pytest.approx(0.75, abs=0.01)
        # The one number a 2D view cannot give: metres actually travelled.
        assert out["vertical_range_m"] == pytest.approx(0.60, abs=0.01)
        # The bar is over the midfoot by construction, in both axes.
        assert out["front_back_mm"] == pytest.approx(0.0, abs=1.0)
        assert out["lateral_mm"] == pytest.approx(0.0, abs=1.0)
        assert out["n_frames"] == 16
        # The fit self-checks: it must recover the camera it was handed.
        assert out["calibration"]["subject_distance_m"] == pytest.approx(Z, rel=0.02)
