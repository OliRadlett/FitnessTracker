"""Unit tests for bar-path tracking + metrics (§3.18 / T3, F1).

Pure NumPy/standard library — no mediapipe needed.
"""

import pytest

np = pytest.importorskip("numpy")

from app.integrations import bar_tracking as bt


class Lm:
    __slots__ = ("visibility", "x", "y", "z")

    def __init__(self, x=0.5, y=0.5, z=0.0, visibility=1.0):
        self.x = x
        self.y = y
        self.z = z
        self.visibility = visibility


def _pose(shoulder=(0.5, 0.2), wrist=(0.5, 0.4)):
    lm = [Lm() for _ in range(33)]
    for i in (11, 12):
        lm[i] = Lm(shoulder[0], shoulder[1])
    for i in (15, 16):
        lm[i] = Lm(wrist[0], wrist[1])
    return lm


def _line(x0, y0, x1, y1, n, conf=1.0):
    return [
        {
            "x": x0 + (x1 - x0) * i / (n - 1),
            "y": y0 + (y1 - y0) * i / (n - 1),
            "confidence": conf,
            "source": "pose_proxy",
        }
        for i in range(n)
    ]


class TestProxyPoint:
    def test_squat_uses_shoulder_midpoint(self):
        assert bt._proxy_point(_pose(shoulder=(0.4, 0.2)), "Squat") == pytest.approx((0.4, 0.2))

    def test_bench_uses_wrist_midpoint(self):
        assert bt._proxy_point(_pose(wrist=(0.6, 0.35)), "Bench Press") == pytest.approx((0.6, 0.35))


class TestBarTrackFromLandmarks:
    def test_track_aligns_and_uses_presence(self):
        lms = [_pose(), _pose(), _pose()]
        track = bt.bar_track_from_landmarks(lms, [0.9, 0.8, 0.7], "Squat")
        assert len(track) == 3
        assert track[0]["source"] == "pose_proxy"
        assert track[2]["confidence"] == pytest.approx(0.7)

    def test_none_landmark_is_none_entry(self):
        track = bt.bar_track_from_landmarks([_pose(), None], [1.0, 0.0], "Squat")
        assert track[1] is None


class TestPathMetrics:
    def test_vertical_path_has_full_efficiency(self):
        pts = [(0.5, y) for y in np.linspace(0.3, 0.6, 10)]
        assert bt._path_efficiency(pts) == pytest.approx(1.0, abs=1e-6)
        assert bt._drift_ratio(pts) == pytest.approx(0.0, abs=1e-6)

    def test_wobble_reduces_efficiency_and_adds_drift(self):
        ys = np.linspace(0.3, 0.6, 20)
        xs = 0.5 + 0.05 * np.sin(np.linspace(0, 3 * np.pi, 20))
        pts = list(zip(xs.tolist(), ys.tolist()))
        assert bt._path_efficiency(pts) < 0.95
        assert bt._drift_ratio(pts) > 0.1

    def test_too_few_points_is_none(self):
        assert bt._path_efficiency([(0.5, 0.3)]) is None


class TestAnalyzeBarPath:
    def _reps(self, spans):
        return [
            {"rep_number": i + 1, "start_idx": s, "end_idx": e}
            for i, (s, e) in enumerate(spans)
        ]

    def test_consistent_vertical_reps_score_high(self):
        n = 12
        track = _line(0.5, 0.3, 0.5, 0.6, n) + _line(0.5, 0.3, 0.5, 0.6, n)
        reps = self._reps([(0, n - 1), (n, 2 * n - 1)])
        out = bt.analyze_bar_path(track, reps, "Squat")
        assert out is not None
        assert out["efficiency"] == pytest.approx(1.0, abs=0.01)
        assert out["drift_ratio"] == pytest.approx(0.0, abs=0.01)
        assert out["consistency"] == pytest.approx(100.0, abs=0.1)
        assert out["source"] == "pose_proxy"
        assert "note" in out

    def test_inconsistent_reps_lower_consistency(self):
        n = 12
        rep_a = _line(0.50, 0.3, 0.50, 0.6, n)
        rep_b = _line(0.60, 0.3, 0.60, 0.6, n)  # 0.1 lateral offset
        track = rep_a + rep_b
        reps = self._reps([(0, n - 1), (n, 2 * n - 1)])
        out = bt.analyze_bar_path(track, reps, "Squat")
        # A systematic 0.1 lateral offset over 0.3 vertical travel is a real
        # mismatch, so consistency must drop well below the identical case.
        assert out["consistency"] < 80.0

    def test_fewer_than_two_measurable_reps_is_none(self):
        n = 12
        track = _line(0.5, 0.3, 0.5, 0.6, n)
        out = bt.analyze_bar_path(track, self._reps([(0, n - 1)]), "Squat")
        assert out is None

    def test_empty_inputs(self):
        assert bt.analyze_bar_path([], [], "Squat") is None


class TestF1RealBarMetrics:
    """bar-over-midfoot, J-curve (net lateral) and bar tilt (F1, needs T3)."""

    def _lm_with_feet(self, midfoot_x=0.5, foot_len=0.1):
        lm = _pose()
        for h in (29, 30):  # heels
            lm[h] = Lm(midfoot_x - foot_len / 2, 0.95)
        for f in (31, 32):  # foot index
            lm[f] = Lm(midfoot_x + foot_len / 2, 0.95)
        return lm

    def _reps(self, n):
        return [{"rep_number": 1, "start_idx": 0, "end_idx": n - 1},
                {"rep_number": 2, "start_idx": n, "end_idx": 2 * n - 1}]

    def test_midfoot_from_heel_and_foot_index(self):
        mf = bt._midfoot(self._lm_with_feet(0.4, 0.1))
        assert mf is not None
        assert mf[0] == pytest.approx(0.4)
        assert mf[1] == pytest.approx(0.1)

    def test_midfoot_none_without_foot_landmarks(self):
        assert bt._midfoot([Lm() for _ in range(20)]) is None

    def test_net_lateral_is_signed(self):
        forward = [(0.5 + 0.03 * i / 9, 0.3 + 0.3 * i / 9) for i in range(10)]
        assert bt._net_lateral(forward) > 0
        assert bt._net_lateral(list(reversed(forward))) < 0

    def test_bar_over_midfoot_reported_in_side_view(self):
        n = 12
        track = _line(0.5, 0.3, 0.5, 0.6, n) + _line(0.5, 0.3, 0.5, 0.6, n)
        lms = [self._lm_with_feet(0.5, 0.1) for _ in range(2 * n)]
        out = bt.analyze_bar_path(track, self._reps(n), "Squat",
                                  landmarks=lms, view="side")
        assert out["bar_over_midfoot"] == pytest.approx(0.0, abs=1e-6)
        assert out["per_rep"][0]["bar_over_midfoot"] == pytest.approx(0.0, abs=1e-6)

    def test_tiny_foot_is_ignored(self):
        # A barely-visible foot makes the ratio explode (a real clip read 4.7).
        n = 12
        track = _line(0.5, 0.3, 0.5, 0.6, n) + _line(0.5, 0.3, 0.5, 0.6, n)
        lms = [self._lm_with_feet(0.5, 0.01) for _ in range(2 * n)]
        out = bt.analyze_bar_path(track, self._reps(n), "Squat",
                                  landmarks=lms, view="side")
        assert "bar_over_midfoot" not in out

    def test_bar_over_midfoot_absent_without_landmarks(self):
        n = 12
        track = _line(0.5, 0.3, 0.5, 0.6, n) + _line(0.5, 0.3, 0.5, 0.6, n)
        out = bt.analyze_bar_path(track, self._reps(n), "Squat", view="side")
        assert "bar_over_midfoot" not in out

    def test_three_quarter_without_bar_centre_omits_lateral(self):
        # No resolved bar centre (single plate) -> horizontal is not attempted.
        n = 12
        track = _line(0.5, 0.3, 0.5, 0.6, n) + _line(0.5, 0.3, 0.5, 0.6, n)
        for p in track:
            p["bar_basis"] = "plate"
        lms = [self._lm_with_feet(0.5, 0.1) for _ in range(2 * n)]
        out = bt.analyze_bar_path(track, self._reps(n), "Squat",
                                  landmarks=lms, view="three_quarter")
        assert "bar_over_midfoot" not in out
        assert "net_lateral" not in out

    def test_three_quarter_lateral_when_bar_centre_resolved(self):
        # Two plates give the bar centre -> approximate lateral metrics.
        n = 12
        track = _line(0.5, 0.3, 0.5, 0.6, n) + _line(0.5, 0.3, 0.5, 0.6, n)
        for p in track:
            p["bar_basis"] = "plate_pair"
        lms = [self._lm_with_feet(0.5, 0.1) for _ in range(2 * n)]
        out = bt.analyze_bar_path(track, self._reps(n), "Squat",
                                  landmarks=lms, view="three_quarter")
        assert out["lateral_basis"] == "three_quarter"
        assert "bar_over_midfoot" in out
        assert "net_lateral" in out
        assert "3/4" in out["note"]

    def test_side_view_lateral_basis_is_sagittal(self):
        n = 12
        track = _line(0.5, 0.3, 0.5, 0.6, n) + _line(0.5, 0.3, 0.5, 0.6, n)
        lms = [self._lm_with_feet(0.5, 0.1) for _ in range(2 * n)]
        out = bt.analyze_bar_path(track, self._reps(n), "Squat",
                                  landmarks=lms, view="side")
        assert out["lateral_basis"] == "sagittal"

    def test_tilt_stays_frontal_only_in_three_quarter(self):
        # The two plates sit at different depths in a 3/4 view, so the image
        # line between them is perspective, not bar tilt (a real squat read 20°).
        n = 12
        track = _line(0.5, 0.3, 0.5, 0.6, n) + _line(0.5, 0.3, 0.5, 0.6, n)
        for p in track:
            p["tilt_deg"] = 4.0
        out = bt.analyze_bar_path(track, self._reps(n), "Squat",
                                  view="three_quarter")
        assert "tilt_deg" not in out

    def test_tilt_aggregated_from_detector_track(self):
        n = 12
        track = _line(0.5, 0.3, 0.5, 0.6, n) + _line(0.5, 0.3, 0.5, 0.6, n)
        for p in track:
            p["tilt_deg"] = 3.0
        out = bt.analyze_bar_path(track, self._reps(n), "Squat", view="frontal")
        assert out["tilt_deg"] == pytest.approx(3.0)
        assert out["tilt_frames"] == len(track)

    def test_tilt_gated_to_frontal_view(self):
        n = 12
        track = _line(0.5, 0.3, 0.5, 0.6, n) + _line(0.5, 0.3, 0.5, 0.6, n)
        for p in track:
            p["tilt_deg"] = 3.0
        out = bt.analyze_bar_path(track, self._reps(n), "Squat", view="side")
        assert "tilt_deg" not in out

    def test_tilt_absent_when_track_has_none(self):
        n = 12
        track = _line(0.5, 0.3, 0.5, 0.6, n) + _line(0.5, 0.3, 0.5, 0.6, n)
        out = bt.analyze_bar_path(track, self._reps(n), "Squat", view="frontal")
        assert "tilt_deg" not in out
