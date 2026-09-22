"""Unit tests for video_analysis pure functions (stdlib only).

video_analysis.py deliberately imports nothing beyond the standard library at
module scope because it runs inside the Modal container. These tests therefore
run in the normal backend suite with no video/ML dependencies installed.
"""

import pytest

from app.integrations.video_analysis import (
    _get_rom,
    _get_vbt_zone,
    _parse_gemini_json,
    _velocity_loss_pct,
    classify_view_from_frame,
    compute_consistency,
    estimate_rpe_heuristic,
    normalize_user_view,
)


class TestComputeConsistency:
    def test_fewer_than_two_measurable_reps_is_none(self):
        assert compute_consistency([]) is None
        assert compute_consistency(
            [{"concentric_time": 1.0, "amplitude_m": 0.5}]) is None

    def test_identical_reps_score_100(self):
        reps = [{"concentric_time": 1.0, "amplitude_m": 0.5} for _ in range(3)]
        out = compute_consistency(reps)
        assert out["consistency_score"] == 100.0
        assert out["tempo_consistency_cv"] == 0.0
        assert out["rep_count"] == 3

    def test_varying_tempo_lowers_score(self):
        reps = [{"concentric_time": t, "amplitude_m": 0.5} for t in (0.5, 1.0, 1.5)]
        out = compute_consistency(reps)
        assert out["tempo_consistency_cv"] > 0
        assert out["consistency_score"] < 100

    def test_none_concentric_time_ignored(self):
        reps = [
            {"concentric_time": 1.0, "amplitude_m": 0.5},
            {"concentric_time": None, "amplitude_m": 0.5},
        ]
        assert compute_consistency(reps) is None


class TestNormalizeUserView:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("side", "side"),
            ("Side", "side"),
            ("front", "front"),
            ("back_left", "three_quarter"),
            ("back_right", "three_quarter"),
            (None, "unknown"),
            ("", "unknown"),
            ("nonsense", "unknown"),
        ],
    )
    def test_mapping(self, raw, expected):
        assert normalize_user_view(raw) == expected


class TestVelocityLossPct:
    def test_linear_loss(self):
        assert _velocity_loss_pct(0.50, 0.40) == 20.0

    def test_no_loss(self):
        assert _velocity_loss_pct(0.40, 0.40) == 0.0

    def test_tiny_first_velocity_guard(self):
        assert _velocity_loss_pct(0.01, 0.0) == 0.0

    def test_negative_loss_is_reported(self):
        assert _velocity_loss_pct(0.20, 0.30) == -50.0

    def test_clamped_to_minus_100(self):
        assert _velocity_loss_pct(0.10, 0.50) == -100.0

    def test_clamped_to_plus_100(self):
        assert _velocity_loss_pct(0.20, -1.0) == 100.0


class TestVbtZone:
    def test_squat_zone_boundaries(self):
        assert _get_vbt_zone("Back Squat", 0.10) == "Absolute Strength"
        assert _get_vbt_zone("Back Squat", 0.40) == "Maximum Strength"
        assert _get_vbt_zone("Back Squat", 0.55) == "Strength-Speed"
        assert _get_vbt_zone("Back Squat", 0.70) == "Power"
        assert _get_vbt_zone("Back Squat", 1.20) == "Speed"

    def test_upper_bound_is_exclusive(self):
        assert _get_vbt_zone("Back Squat", 0.35) == "Maximum Strength"
        assert _get_vbt_zone("Back Squat", 0.50) == "Strength-Speed"

    def test_unknown_exercise_uses_default_zones(self):
        assert _get_vbt_zone("Cable Fly", 0.60) == "Strength-Speed"


class TestRomDefaults:
    def test_known_exercises(self):
        assert _get_rom("Back Squat") == 0.50
        assert _get_rom("Bench Press") == 0.40
        assert _get_rom("Deadlift") == 0.45

    def test_unknown_returns_default(self):
        assert _get_rom("Nordic Curl") == 0.45


class TestParseGeminiJson:
    def test_plain_json(self):
        assert _parse_gemini_json('{"a": 1}') == {"a": 1}

    def test_markdown_fenced_json(self):
        raw = '```json\n{"a": 1}\n```'
        assert _parse_gemini_json(raw) == {"a": 1}

    def test_bare_fence(self):
        raw = '```\n{"a": 1}\n```'
        assert _parse_gemini_json(raw) == {"a": 1}


class TestClassifyViewFromFrame:
    class _Resp:
        def __init__(self, payload):
            self._payload = payload

        def read(self):
            return self._payload

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    @classmethod
    def _response(cls, text):
        import json as _json

        return cls._Resp(_json.dumps(
            {"candidates": [{"content": {"parts": [{"text": text}]}}]}
        ).encode())

    def _run(self, monkeypatch, tmp_path, text, key="k"):
        import urllib.request

        frame = tmp_path / "frame.jpg"
        frame.write_bytes(b"\xff\xd8\xff")
        monkeypatch.setattr(
            urllib.request, "urlopen",
            lambda req, timeout=None: self._response(text),
        )
        return classify_view_from_frame(frame, key)

    @pytest.mark.parametrize(
        "text,expected",
        [
            ("side", "side"),
            ("Side.", "side"),
            ("three_quarter", "three_quarter"),
            ("three-quarter", "three_quarter"),
            ("front", "front"),
            ("rear", "rear"),
            ("banana", "unknown"),
        ],
    )
    def test_parses_label(self, monkeypatch, tmp_path, text, expected):
        assert self._run(monkeypatch, tmp_path, text) == expected

    def test_missing_key_returns_unknown(self, tmp_path):
        frame = tmp_path / "frame.jpg"
        frame.write_bytes(b"x")
        assert classify_view_from_frame(frame, "") == "unknown"

    def test_network_failure_returns_unknown(self, monkeypatch, tmp_path):
        import urllib.request

        frame = tmp_path / "frame.jpg"
        frame.write_bytes(b"x")

        def _boom(req, timeout=None):
            raise OSError("network down")

        monkeypatch.setattr(urllib.request, "urlopen", _boom)
        assert classify_view_from_frame(frame, "k") == "unknown"


class TestEstimateRpeHeuristic:
    def test_single_rep_without_reference_returns_none(self):
        rpe = estimate_rpe_heuristic({}, "Back Squat", 1)
        assert rpe["estimated_rpe"] is None
        assert rpe["confidence"] == 0.0

    def test_slow_single_rep_does_not_imply_max_effort(self):
        # A 0.087 m/s single rep has no load/1RM context; the old heuristic
        # reported 9.5 here, saturating nearly every single-rep video.
        analysis = {"velocity": {"mean_concentric_velocity": 0.087}}
        assert estimate_rpe_heuristic(analysis, "Back Squat", 1)["estimated_rpe"] is None

    def test_velocity_loss_drives_rpe_for_working_set(self):
        analysis = {"velocity": {"velocity_loss_pct": 35.0, "mean_concentric_velocity": 0.2}}
        assert estimate_rpe_heuristic(analysis, "Back Squat", 3)["estimated_rpe"] == 8.0

    def test_single_rep_with_velocity_loss_still_needs_two_reps(self):
        analysis = {"velocity": {"velocity_loss_pct": 30.0, "mean_concentric_velocity": 0.2}}
        assert estimate_rpe_heuristic(analysis, "Back Squat", 1)["estimated_rpe"] is None

    def test_major_form_breakdown_bumps_rpe(self):
        analysis = {
            "velocity": {"velocity_loss_pct": 12.0, "mean_concentric_velocity": 0.3},
            "form": {"overall_form_score": 40, "severity": "major"},
        }
        base = estimate_rpe_heuristic({"velocity": analysis["velocity"]}, "Back Squat", 3)
        bumped = estimate_rpe_heuristic(analysis, "Back Squat", 3)
        assert bumped["estimated_rpe"] > base["estimated_rpe"]
