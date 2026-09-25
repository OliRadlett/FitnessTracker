"""Unit tests for pose-seeded plate detection (§3.18 / T3 v1).

Synthetic frames (a dark circle on a light field) — no mediapipe needed.
"""

import pytest

np = pytest.importorskip("numpy")
cv2 = pytest.importorskip("cv2")

from app.integrations import bar_detection as bd


def _frame_with_circle(cx, cy, r, bg=200, fg=35, size=(600, 800)):
    """A plate-like dark disc: solid body, rim, rings + sensor noise."""
    rng = np.random.default_rng(0)
    img = np.full(size, bg, dtype=np.uint8)
    cv2.circle(img, (cx, cy), r, int(fg), -1)
    cv2.circle(img, (cx, cy), r, 20, 4)
    cv2.circle(img, (cx, cy), int(r * 0.62), 60, 2)
    cv2.circle(img, (cx, cy), int(r * 0.33), 90, 3)
    img = np.clip(
        img.astype(np.int16) + rng.normal(0, 8, img.shape), 0, 255
    ).astype(np.uint8)
    return img


class TestDetectBarCircle:
    def test_detects_a_dark_circle_at_the_seed(self):
        img = _frame_with_circle(400, 300, 120)
        hit = bd.detect_bar_circle(img, (0.5, 0.5))
        assert hit is not None
        assert hit["source"] == "detector"
        assert abs(hit["x"] - 0.5) < 0.06
        assert abs(hit["y"] - 0.5) < 0.06
        assert hit["confidence"] >= bd._MIN_CONFIDENCE

    def test_blank_frame_detects_nothing(self):
        img = np.full((600, 800), 200, dtype=np.uint8)
        assert bd.detect_bar_circle(img, (0.5, 0.5)) is None

    def test_circle_outside_the_search_window_is_ignored(self):
        # Circle at the far left; seed at the far right → nothing near the seed.
        img = _frame_with_circle(80, 300, 100)
        assert bd.detect_bar_circle(img, (0.9, 0.5)) is None


class TestInterpolateGaps:
    def test_fills_missing_frames_linearly(self):
        track = [
            {"x": 0.0, "y": 0.0, "confidence": 0.8, "source": "detector"},
            {"x": 0.0, "y": 0.0, "confidence": 0.5, "source": "pose_proxy"},
            {"x": 0.4, "y": 0.4, "confidence": 0.8, "source": "detector"},
        ]
        out = bd._interpolate_gaps(track)
        assert out[1]["source"] == "detector"
        assert out[1]["x"] == pytest.approx(0.2, abs=1e-6)
        assert out[1]["y"] == pytest.approx(0.2, abs=1e-6)
        assert out[1].get("interpolated") is True

    def test_noop_with_fewer_than_two_detections(self):
        track = [
            {"x": 0.0, "y": 0.0, "confidence": 0.5, "source": "pose_proxy"},
            {"x": 0.1, "y": 0.1, "confidence": 0.8, "source": "detector"},
        ]
        assert bd._interpolate_gaps(track) == track


class TestEdgeAndDarkness:
    def test_dark_circle_has_positive_darkness(self):
        img = _frame_with_circle(400, 300, 120)
        assert bd._interior_darkness(img, 400, 300, 120) > 0.3

    def test_edge_support_high_on_a_sharp_circle(self):
        img = _frame_with_circle(400, 300, 120)
        assert bd._edge_support(img, 400, 300, 120) > 0.4

    def test_edge_support_zero_on_a_blank_frame(self):
        img = np.full((600, 800), 200, dtype=np.uint8)
        assert bd._edge_support(img, 400, 300, 120) == 0.0


class TestSeededPlateTracker:
    def test_tracks_a_moving_patch_from_the_seed(self, tmp_path):
        rng = np.random.default_rng(0)
        patch = rng.integers(0, 255, (20, 20), dtype=np.uint8)
        paths = []
        for k in range(6):
            img = np.zeros((100, 100), dtype=np.uint8)
            y = 10 + k * 5  # patch moves down 5 px per frame
            img[y:y + 20, 30:50] = patch
            p = tmp_path / f"f{k}.jpg"
            cv2.imwrite(str(p), img)
            paths.append(p)
        seed = {"x": 0.4, "y": 0.25, "w": 0.2, "h": 0.2}
        track = bd.track_plate_from_seed(paths, 0, seed)
        assert all(t is not None for t in track)
        assert all(t["source"] == "tracker" for t in track)
        assert track[-1]["y"] > track[0]["y"]  # followed the downward motion

    def test_bad_seed_returns_empty_track(self, tmp_path):
        img = np.zeros((50, 50), dtype=np.uint8)
        cv2.imwrite(str(tmp_path / "f0.jpg"), img)
        track = bd.track_plate_from_seed([tmp_path / "f0.jpg"], 0,
                                         {"x": 0.5, "y": 0.5, "w": 0.0, "h": 0.0})
        assert track == [None]
