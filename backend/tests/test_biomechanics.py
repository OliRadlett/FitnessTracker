"""Unit tests for joint-moment estimates (§3.18 / F9)."""

import pytest

from app.integrations import biomechanics as bm


class Lm:
    __slots__ = ("visibility", "x", "y", "z")

    def __init__(self, x=0.0, y=0.0, z=0.0, visibility=1.0):
        self.x = x
        self.y = y
        self.z = z
        self.visibility = visibility


def _world(shoulder_x=0.10, hip_x=0.02, knee_x=0.0, vis=1.0):
    w = [Lm(visibility=vis) for _ in range(33)]
    for i in (11, 12):
        w[i] = Lm(shoulder_x, 0.0, 0.0, vis)
    for i in (15, 16):
        w[i] = Lm(shoulder_x, 0.1, 0.0, vis)
    for i in (23, 24):
        w[i] = Lm(hip_x, 0.5, 0.0, vis)
    for i in (25, 26):
        w[i] = Lm(knee_x, 0.9, 0.0, vis)
    return w


class TestJointMoments:
    def test_knee_and_hip_moments_from_arms(self):
        out = bm.joint_moments(_world(shoulder_x=0.10, hip_x=0.02), 100.0, "Back Squat")
        assert out is not None
        # 100 kg * 9.81 * 0.10 m
        assert out["knee_moment_nm"] == pytest.approx(98.1, abs=0.5)
        assert out["knee_moment_arm_m"] == pytest.approx(0.10, abs=1e-6)
        assert out["hip_moment_arm_m"] == pytest.approx(0.08, abs=1e-6)
        assert out["confidence"] == pytest.approx(1.0)

    def test_press_uses_wrist_as_the_load_point(self):
        w = _world(shoulder_x=0.10)
        for i in (15, 16):
            w[i] = Lm(0.30, 0.1, 0.0, 1.0)  # wrists far forward
        out = bm.joint_moments(w, 50.0, "Overhead Press")
        assert out["knee_moment_arm_m"] == pytest.approx(0.30, abs=1e-6)

    def test_none_without_load(self):
        assert bm.joint_moments(_world(), None, "Back Squat") is None
        assert bm.joint_moments(_world(), 0.0, "Back Squat") is None

    def test_none_when_joints_not_visible(self):
        assert bm.joint_moments(_world(vis=0.1), 100.0, "Back Squat") is None

    def test_none_for_missing_frame(self):
        assert bm.joint_moments(None, 100.0, "Back Squat") is None
