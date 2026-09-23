"""Unit tests for pose-track serialization (§3.18 / T5)."""

import pytest

from app.integrations import pose_track as pt


class Lm:
    __slots__ = ("visibility", "x", "y", "z")

    def __init__(self, x=0.5, y=0.5, z=0.0, visibility=1.0):
        self.x = x
        self.y = y
        self.z = z
        self.visibility = visibility


def _frame(n=33, x=0.5):
    return [Lm(x, 0.5) for _ in range(n)]


class TestBuildTrackPayload:
    def test_frames_aligned_with_timestamps(self):
        track = {
            "fps": 10.0,
            "timestamps": [0.1, 0.2],
            "landmarks": [_frame(x=0.1), _frame(x=0.2)],
            "world": [_frame(x=0.1), None],
        }
        payload = pt.build_track_payload(track, exercise="Back Squat")
        assert payload["version"] == pt.TRACK_PAYLOAD_VERSION
        assert payload["fps"] == 10.0
        assert payload["exercise"] == "Back Squat"
        assert len(payload["frames"]) == 2
        assert payload["frames"][0]["t"] == 0.1
        assert payload["frames"][0]["lm"][0][0] == 0.1
        # world present on frame 0, None on frame 1
        assert payload["frames"][0]["w"] is not None
        assert payload["frames"][1]["w"] is None

    def test_rounds_coordinates(self):
        track = {
            "fps": 10.0,
            "timestamps": [0.0],
            "landmarks": [[Lm(0.123456789, 0.987654321, visibility=0.91234)]],
            "world": [[Lm(0.111111, 0.222222, z=0.333333)]],
        }
        payload = pt.build_track_payload(track)
        lm = payload["frames"][0]["lm"][0]
        assert lm[0] == pytest.approx(0.1235)
        assert lm[1] == pytest.approx(0.9877)
        assert lm[2] == pytest.approx(0.912)
        w = payload["frames"][0]["w"][0]
        assert w[2] == pytest.approx(0.3333)

    def test_reps_and_bar_path_passthrough(self):
        payload = pt.build_track_payload(
            {"landmarks": [], "timestamps": [], "world": []},
            reps=[{"rep_number": 1}],
            bar_path={"efficiency": 0.9},
        )
        assert payload["reps"] == [{"rep_number": 1}]
        assert payload["bar_path"] == {"efficiency": 0.9}

    def test_empty_track(self):
        payload = pt.build_track_payload({})
        assert payload["frames"] == []
        assert payload["reps"] == []
        assert payload["bar_path"] is None

    def test_missing_world_list_is_none(self):
        track = {"timestamps": [0.0], "landmarks": [_frame()]}
        payload = pt.build_track_payload(track)
        assert payload["frames"][0]["w"] is None
