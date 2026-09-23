"""Unit tests for multi-person association + lifter selection (§3.18 / T1).

Pure NumPy/standard library — no mediapipe needed, so these run anywhere
numpy is installed.
"""

import pytest

np = pytest.importorskip("numpy")

from app.integrations import person_tracking as pt


class Lm:
    __slots__ = ("presence", "visibility", "x", "y", "z")

    def __init__(self, x=0.5, y=0.5, z=0.0, visibility=1.0, presence=1.0):
        self.x = x
        self.y = y
        self.z = z
        self.visibility = visibility
        self.presence = presence


def _person(bbox=None, landmarks=None, presence=1.0):
    return {
        "landmarks": landmarks if landmarks is not None else [],
        "world": None,
        "presence": presence,
        "bbox": bbox,
    }


def _lms(shoulder_y=0.2, hip_y=0.7, shoulder_x=0.5, hip_x=0.5, wrist=(0.5, 0.5)):
    lm = [Lm(0.5, 0.5) for _ in range(33)]
    for i in (11, 12):
        lm[i] = Lm(shoulder_x, shoulder_y)
    for i in (23, 24):
        lm[i] = Lm(hip_x, hip_y)
    for i in (15, 16):
        lm[i] = Lm(wrist[0], wrist[1])
    return lm


def _track(tid, lm, frames=(0, 1, 2)):
    return {
        "id": tid,
        "n": len(frames),
        "detections": {f: {"landmarks": lm, "world": None, "presence": 1.0} for f in frames},
    }


class TestBboxAndIou:
    def test_bbox_uses_visible_landmarks(self):
        lm = [Lm(0.1, 0.2, visibility=0.9), Lm(0.4, 0.6, visibility=0.8),
              Lm(0.9, 0.9, visibility=0.1)]  # ignored
        assert pt.bbox_from_landmarks(lm) == pytest.approx((0.1, 0.2, 0.4, 0.6))

    def test_bbox_none_when_nothing_visible(self):
        assert pt.bbox_from_landmarks([Lm(visibility=0.1)]) is None

    def test_iou_identical_is_one(self):
        assert pt.iou((0, 0, 1, 1), (0, 0, 1, 1)) == pytest.approx(1.0)

    def test_iou_disjoint_is_zero(self):
        assert pt.iou((0, 0, 0.2, 0.2), (0.5, 0.5, 0.7, 0.7)) == 0.0

    def test_iou_none_is_zero(self):
        assert pt.iou(None, (0, 0, 1, 1)) == 0.0


class TestGreedyMatch:
    def test_matches_by_overlap(self):
        prev = [(0.0, 0.0, 0.2, 0.2), (0.5, 0.5, 0.7, 0.7)]
        curr = [(0.51, 0.51, 0.71, 0.71), (0.0, 0.0, 0.2, 0.2)]
        matches, up, uc = pt.greedy_match(prev, curr, 0.3)
        assert matches == [(0, 1), (1, 0)]
        assert up == [] and uc == []

    def test_unmatched_curr_creates_new(self):
        matches, up, uc = pt.greedy_match([(0, 0, 0.2, 0.2)], [(0.5, 0.5, 0.7, 0.7)], 0.3)
        assert matches == []
        assert up == [0] and uc == [0]

    def test_proximity_matches_when_iou_low(self):
        # Low overlap (bbox jitter/occlusion) but centres are close.
        prev = [(0.0, 0.0, 0.1, 0.1)]
        curr = [(0.05, 0.05, 0.15, 0.15)]
        assert pt.iou(prev[0], curr[0]) < 0.3
        matches, up, uc = pt.greedy_match(prev, curr, 0.3, max_center_dist=0.12)
        assert matches == [(0, 0)] and up == [] and uc == []

    def test_far_boxes_do_not_match(self):
        matches, up, uc = pt.greedy_match(
            [(0, 0, 0.1, 0.1)], [(0.5, 0.5, 0.6, 0.6)], 0.3, max_center_dist=0.12
        )
        assert matches == []


class TestBuildPersonTracks:
    def test_stable_ids_across_order_swaps(self):
        # Two people; the model returns them in a different order each frame.
        a = _person(bbox=(0.0, 0.0, 0.2, 0.5))
        b = _person(bbox=(0.5, 0.0, 0.7, 0.5))
        frames = [
            [a, b],
            [b, a],  # swapped
            [a, b],
        ]
        tracks = pt.build_person_tracks(frames, frame_indices=[0, 1, 2])
        assert len(tracks) == 2
        assert all(t["n"] == 3 for t in tracks)
        # The track seeded by A (frame0 first) must hold A's box throughout.
        a_track = next(t for t in tracks if t["detections"][0]["bbox"] == a["bbox"])
        assert a_track["detections"][1]["bbox"] == a["bbox"]
        assert a_track["detections"][2]["bbox"] == a["bbox"]

    def test_short_gap_does_not_split_track(self):
        a = _person(bbox=(0.0, 0.0, 0.2, 0.5))
        # Person absent in frame 1, back in frame 2 (max_missing=5).
        tracks = pt.build_person_tracks([[a], [], [a]], frame_indices=[0, 1, 2])
        assert len(tracks) == 1
        assert tracks[0]["n"] == 2

    def test_long_gap_splits_track(self):
        a = _person(bbox=(0.0, 0.0, 0.2, 0.5))
        frames = [[a]] + [[] for _ in range(8)] + [[a]]
        idxs = list(range(10))
        tracks = pt.build_person_tracks(frames, frame_indices=idxs, max_missing=5)
        assert len(tracks) == 2

    def test_gap_within_default_bridges_same_person(self):
        # A ~1.2s detection dropout must not split one person into two tracks.
        a = _person(bbox=(0.0, 0.0, 0.2, 0.5))
        frames = [[a]] + [[] for _ in range(12)] + [[a]]
        idxs = list(range(14))
        tracks = pt.build_person_tracks(frames, frame_indices=idxs)
        assert len(tracks) == 1
        assert tracks[0]["n"] == 2

    def test_bbox_computed_from_landmarks_when_absent(self):
        lm = _lms()
        p = {"landmarks": lm, "world": None, "presence": 1.0}
        tracks = pt.build_person_tracks([[p]], frame_indices=[0])
        assert tracks[0]["n"] == 1


class TestSeriesAlignment:
    def test_track_series_none_pads_missing_frames(self):
        track = {"id": 0, "detections": {0: {"landmarks": "L0", "world": "W0", "presence": 0.9},
                                         2: {"landmarks": "L2", "world": None, "presence": 0.8}}}
        landmarks, world, presence = pt.track_series(track, 3)
        assert landmarks == ["L0", None, "L2"]
        assert world == ["W0", None, None]
        assert presence == [0.9, 0.0, 0.8]

    def test_dense_series_orders_by_frame(self):
        det = {
            2: {"landmarks": "L2", "world": None, "presence": 0.8},
            0: {"landmarks": "L0", "world": "W0", "presence": 0.9},
        }
        track = {"id": 0, "detections": det}
        lms, world, ts, pres = pt.dense_series(track, {0: 1.0, 2: 3.0})
        assert lms == ["L0", "L2"]
        assert ts == [1.0, 3.0]
        assert pres == [0.9, 0.8]


class TestSelectionSignals:
    def test_horizontal_torso_scores_high(self):
        bench = _track(0, _lms(shoulder_y=0.5, hip_y=0.5, shoulder_x=0.2, hip_x=0.8))
        assert pt._torso_horizontality(bench) == pytest.approx(1.0, abs=0.01)

    def test_vertical_torso_scores_low(self):
        stand = _track(0, _lms(shoulder_y=0.2, hip_y=0.8, shoulder_x=0.5, hip_x=0.5))
        assert pt._torso_horizontality(stand) == pytest.approx(0.0, abs=0.01)

    def test_movement_rewards_vertical_hip_travel(self):
        mover = _track(0, _lms(hip_y=0.8))
        mover["detections"][1]["landmarks"] = _lms(hip_y=0.4)
        mover["detections"][2]["landmarks"] = _lms(hip_y=0.8)
        assert pt._movement_score(mover) > 0.5


class TestSelectLifter:
    def test_bench_picks_horizontal_lifter_over_upright_spotter(self):
        lifter = _track(0, _lms(shoulder_y=0.5, hip_y=0.5, shoulder_x=0.2, hip_x=0.8))
        spotter = _track(1, _lms(shoulder_y=0.2, hip_y=0.8, shoulder_x=0.5, hip_x=0.5))
        best, info = pt.select_lifter([spotter, lifter], n_frames=3, exercise="Bench Press")
        assert best["id"] == 0
        assert info["source"] == "auto"
        assert len(info["candidates"]) == 2

    def test_bar_coupling_wins_when_available(self):
        # Both upright; only the lifter's wrists sit on the bar.
        lifter = _track(0, _lms(wrist=(0.5, 0.5)))
        spotter = _track(1, _lms(wrist=(0.05, 0.05)))
        bar_xy = [(0.5, 0.5)] * 3
        best, info = pt.select_lifter([spotter, lifter], n_frames=3, bar_xy=bar_xy)
        assert best["id"] == 0
        comp = next(c for c in info["candidates"] if c["track_id"] == 0)
        assert comp["components"]["bar_coupling"] == pytest.approx(1.0, abs=0.01)

    def test_single_track_is_selected(self):
        only = _track(7, _lms())
        best, info = pt.select_lifter([only], n_frames=3)
        assert best["id"] == 7
        assert info["source"] == "single"

    def test_forced_track_id_wins(self):
        # User override: pick the spotter (id 1) even though posture favours 0.
        lifter = _track(0, _lms(shoulder_y=0.5, hip_y=0.5, shoulder_x=0.2, hip_x=0.8))
        spotter = _track(1, _lms(shoulder_y=0.2, hip_y=0.8, shoulder_x=0.5, hip_x=0.5))
        best, info = pt.select_lifter(
            [lifter, spotter], n_frames=3, exercise="Bench Press", forced_track_id=1
        )
        assert best["id"] == 1
        assert info["source"] == "manual"

    def test_unknown_forced_track_falls_back_to_auto(self):
        lifter = _track(0, _lms(shoulder_y=0.5, hip_y=0.5, shoulder_x=0.2, hip_x=0.8))
        best, info = pt.select_lifter([lifter], n_frames=3, forced_track_id=99)
        assert best["id"] == 0
        assert info["source"] == "single"

    def test_no_tracks(self):
        best, info = pt.select_lifter([], n_frames=3)
        assert best is None
        assert info["source"] == "none"


class TestReselectLifter:
    def test_noop_for_single_track(self):
        from app.integrations import pose_analysis as pa

        track = {"tracks": [{"id": 0, "detections": {}}], "frames": 3}
        assert pa.reselect_lifter(track, "Bench Press") is track

    def test_picks_lifter_once_exercise_known(self):
        from app.integrations import pose_analysis as pa

        lifter = _track(0, _lms(shoulder_y=0.5, hip_y=0.5, shoulder_x=0.2, hip_x=0.8))
        spotter = _track(1, _lms(shoulder_y=0.2, hip_y=0.8, shoulder_x=0.5, hip_x=0.5))
        track = {
            "tracks": [spotter, lifter],
            "frames": 3,
            "frame_times": {0: 0.1, 1: 0.2, 2: 0.3},
            "landmarks": ["spotter"] * 3,
        }
        out = pa.reselect_lifter(track, "Bench Press")
        assert out["lifter"]["chosen_track_id"] == 0
        assert len(out["landmarks"]) == 3
        assert out["records"][0]["t"] == 0.1
