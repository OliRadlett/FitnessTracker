"""Serialize a pose track to a compact, JSON-able payload (§3.18 / T5).

The interactive viewer (F2) and any future re-analysis need the per-frame
landmarks without re-running MediaPipe. This module turns the in-memory track
(MediaPipe landmark objects) into a small JSON document uploaded to R2:

    {
      "version": 1, "fps": 10.0, "exercise": "Back Squat",
      "frames": [{"t": 0.05, "lm": [[x, y, vis] x33], "w": [[x, y, z] x33] | null}, ...],
      "reps": [...], "bar_path": {...}
    }

Pure — no MediaPipe import — so it is unit-testable without the video stack.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# Bump when the pipeline's outputs change so stored videos can be reprocessed
# (see plans/lift-video-tracking-v2.md T5). 1 = original, 2 = tracking v2.
ANALYSIS_VERSION = 2
TRACK_PAYLOAD_VERSION = 1


def _lm_row(lm) -> list | None:
    """One frame's 2D landmarks as ``[[x, y, visibility], ...]``."""
    if lm is None:
        return None
    return [
        [
            round(float(p.x), 4),
            round(float(p.y), 4),
            round(float(getattr(p, "visibility", 1.0) or 1.0), 3),
        ]
        for p in lm
    ]


def _world_row(w) -> list | None:
    """One frame's metric 3D world landmarks as ``[[x, y, z], ...]``."""
    if w is None:
        return None
    return [
        [round(float(p.x), 4), round(float(p.y), 4), round(float(p.z), 4)]
        for p in w
    ]


def build_track_payload(
    track: dict,
    exercise: str = "",
    reps: list | None = None,
    bar_path: dict | None = None,
) -> dict:
    """Compact JSON-able payload for a track from ``extract_pose_track``.

    ``frames`` is aligned 1:1 with the track's landmark list; ``w`` is
    ``None`` where the model omitted world landmarks.
    """
    timestamps = track.get("timestamps") or []
    landmarks = track.get("landmarks") or []
    world = track.get("world") or []

    frames: list[dict] = []
    for i, lm in enumerate(landmarks):
        frames.append({
            "t": timestamps[i] if i < len(timestamps) else None,
            "lm": _lm_row(lm),
            "w": _world_row(world[i]) if i < len(world) else None,
        })

    payload = {
        "version": TRACK_PAYLOAD_VERSION,
        "fps": track.get("fps"),
        "exercise": exercise,
        "frames": frames,
        "reps": reps or [],
        "bar_path": bar_path,
    }
    logger.info(
        "Track payload: %d frames, exercise=%s, %.0f KB (pre-json)",
        len(frames), exercise, len(frames) * 200 / 1024,
    )
    return payload
