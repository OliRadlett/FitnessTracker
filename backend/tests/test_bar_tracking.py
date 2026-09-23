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
