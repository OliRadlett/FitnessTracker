"""Reliability-gated joint-moment estimates (§3.18 / F9).

From the metric 3D world landmarks + the load, estimate the **external joint
moments** at a frame: moment = load × horizontal distance from the joint to the
barbell's line of action (gravity is vertical, so the moment arm is the sagittal
horizontal offset). This is a *relative* estimate — it ignores body-segment
weight and the depth (z) component — so use it to compare reps/sessions and to
flag asymmetries, not as an absolute biomechanics readout. Emitted only when the
required joints are confidently visible.

Pure NumPy — unit-testable without the video stack.
"""

from __future__ import annotations

import logging

import numpy as np

logger = logging.getLogger(__name__)

GRAVITY = 9.81

_LEG = (
    "Squat", "Front Squat", "Back Squat", "Deadlift",
    "Conventional Deadlift", "Sumo Deadlift", "Stone",
)

_SHOULDER = (11, 12)
_WRIST = (15, 16)
_HIP = (23, 24)
_KNEE = (25, 26)


def _mid(w, a: int, b: int) -> np.ndarray:
    return np.array([
        (w[a].x + w[b].x) / 2,
        (w[a].y + w[b].y) / 2,
        (w[a].z + w[b].z) / 2,
    ])


def _bar_point(w, exercise: str) -> np.ndarray:
    if exercise in _LEG:
        return _mid(w, *_SHOULDER)
    return _mid(w, *_WRIST)


def joint_moments(
    world_frame,
    load_kg: float | None,
    exercise: str,
    min_visibility: float = 0.3,
) -> dict | None:
    """External knee/hip moments (Nm) at one frame, or ``None`` if unreliable.

    ``world_frame`` is the metric world landmarks for that frame (or ``None``).
    """
    if world_frame is None or not load_kg or load_kg <= 0:
        return None
    w = world_frame
    vis = min(
        float(getattr(w[i], "visibility", 1.0) or 1.0)
        for i in (*_SHOULDER, *_HIP, *_KNEE)
    )
    if vis < min_visibility:
        return None

    bar = _bar_point(w, exercise)
    knee = _mid(w, *_KNEE)
    hip = _mid(w, *_HIP)
    load_n = float(load_kg) * GRAVITY
    knee_arm = abs(float(bar[0] - knee[0]))
    hip_arm = abs(float(bar[0] - hip[0]))
    return {
        "knee_moment_nm": round(load_n * knee_arm, 1),
        "hip_moment_nm": round(load_n * hip_arm, 1),
        "knee_moment_arm_m": round(knee_arm, 3),
        "hip_moment_arm_m": round(hip_arm, 3),
        "confidence": round(vis, 3),
    }
