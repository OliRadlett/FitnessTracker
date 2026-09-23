"""Barbell path tracking + bar-path technique metrics (§3.18 / T3, F1).

Detector-agnostic: a *bar track* is a list aligned 1:1 with the pose frame
list, each entry ``{"x", "y", "confidence", "source"}`` in normalised image
coordinates (or ``None`` where unknown). Today the track is produced by the
**pose proxy** (shoulder midpoint for squats, wrist midpoint for presses/
bench/deadlift — the point the bar is rigidly coupled to). The learned ONNX
bar/plate detector (T3) will produce the same shape with ``source="detector"``,
so the metrics below need no changes.

The metrics are honest about their source: a proxy track cannot see the real
bar, so lateral drift / J-curve are labelled proxy-derived and carry the mean
landmark confidence. Only vertical path efficiency and rep-to-rep path
consistency are meaningful for either source.

Pure NumPy/standard library — unit-testable without the video stack.
"""

from __future__ import annotations

import logging

import numpy as np

logger = logging.getLogger(__name__)

_SQUAT_FAMILY = ("Squat", "Front Squat", "Back Squat")
_MIN_REP_POINTS = 4
_CONSISTENCY_SAMPLES = 20


def _proxy_point(lm, exercise: str) -> tuple[float, float]:
    """Normalised bar-proxy point: shoulder mid for squats, wrist mid else."""
    if exercise in _SQUAT_FAMILY:
        return ((lm[11].x + lm[12].x) / 2, (lm[11].y + lm[12].y) / 2)
    return ((lm[15].x + lm[16].x) / 2, (lm[15].y + lm[16].y) / 2)


def bar_track_from_landmarks(
    landmarks: list,
    presence: list[float] | None = None,
    exercise: str = "",
) -> list:
    """Pose-proxy bar track aligned to ``landmarks``.

    Each entry is ``{"x", "y", "confidence", "source"}`` or ``None`` when the
    landmark is missing. ``confidence`` is the frame presence (0–1).
    """
    track: list = []
    for i, lm in enumerate(landmarks):
        if lm is None:
            track.append(None)
            continue
        x, y = _proxy_point(lm, exercise)
        conf = float(presence[i]) if presence and i < len(presence) else 1.0
        track.append({"x": x, "y": y, "confidence": conf, "source": "pose_proxy"})
    return track


def _segment(track: list, start: int, end: int) -> list[tuple[float, float]]:
    """Valid ``(x, y)`` points in ``[start, end]`` (inclusive)."""
    pts: list[tuple[float, float]] = []
    for i in range(max(0, start), min(len(track) - 1, end) + 1):
        p = track[i]
        if p is not None:
            pts.append((float(p["x"]), float(p["y"])))
    return pts


def _resample_x(pts: list[tuple[float, float]], n: int) -> np.ndarray:
    """Resample the x-signal to ``n`` points over normalised progress."""
    arr = np.asarray(pts, dtype=float)
    if len(arr) < 2:
        return np.full(n, arr[0, 0] if len(arr) else 0.0)
    src = np.linspace(0.0, 1.0, len(arr))
    dst = np.linspace(0.0, 1.0, n)
    return np.interp(dst, src, arr[:, 0])


def _path_efficiency(pts: list[tuple[float, float]]) -> float | None:
    """Vertical travel / total path length (1.0 = perfectly vertical)."""
    if len(pts) < _MIN_REP_POINTS:
        return None
    arr = np.asarray(pts, dtype=float)
    seg = np.linalg.norm(np.diff(arr, axis=0), axis=1)
    total = float(seg.sum())
    if total <= 1e-9:
        return None
    vertical = float(arr[:, 1].max() - arr[:, 1].min())
    return max(0.0, min(1.0, vertical / total))


def _drift_ratio(pts: list[tuple[float, float]]) -> float | None:
    """Horizontal range / vertical range (0 = no lateral movement)."""
    if len(pts) < _MIN_REP_POINTS:
        return None
    arr = np.asarray(pts, dtype=float)
    vertical = float(arr[:, 1].max() - arr[:, 1].min())
    if vertical <= 1e-9:
        return None
    horizontal = float(arr[:, 0].max() - arr[:, 0].min())
    return horizontal / vertical


def analyze_bar_path(
    bar_track: list,
    pose_reps: list[dict],
    exercise: str = "",
) -> dict | None:
    """Bar-path technique metrics over the detected reps.

    Returns ``None`` when fewer than 2 measurable reps exist. ``source`` and
    ``confidence`` describe the underlying track (proxy vs detector).
    """
    if not bar_track or not pose_reps:
        return None

    sources = {p["source"] for p in bar_track if p}
    source = sources.pop() if len(sources) == 1 else "mixed"
    confs = [float(p["confidence"]) for p in bar_track if p]
    confidence = round(sum(confs) / len(confs), 3) if confs else 0.0

    per_rep: list[dict] = []
    rep_pts: list[list[tuple[float, float]]] = []
    for rep in pose_reps:
        pts = _segment(bar_track, rep.get("start_idx", 0), rep.get("end_idx", 0))
        eff = _path_efficiency(pts)
        drift = _drift_ratio(pts)
        if eff is None or drift is None:
            continue
        arr = np.asarray(pts, dtype=float)
        per_rep.append({
            "rep_number": rep.get("rep_number"),
            "efficiency": round(eff, 3),
            "drift_ratio": round(drift, 3),
            "vertical_range": round(float(arr[:, 1].max() - arr[:, 1].min()), 4),
        })
        rep_pts.append(pts)

    if len(per_rep) < 2:
        return None

    efficiencies = [r["efficiency"] for r in per_rep]
    drifts = [r["drift_ratio"] for r in per_rep]

    # Rep-to-rep path consistency: mean pairwise RMS difference of the
    # phase-resampled lateral (x) profiles, mean-centred across reps (so a
    # systematic offset counts as a mismatch) and normalised by the mean
    # vertical travel (a physical scale). 100 = identical paths.
    stack = np.vstack([_resample_x(pts, _CONSISTENCY_SAMPLES) for pts in rep_pts])
    scale = float(np.mean([r["vertical_range"] for r in per_rep])) or 1.0
    centred = (stack - stack.mean()) / scale
    diffs = [
        float(np.sqrt(np.mean((centred[i] - centred[j]) ** 2)))
        for i in range(len(centred))
        for j in range(i + 1, len(centred))
    ]
    rms_dev = float(np.mean(diffs)) if diffs else 0.0
    consistency = round(max(0.0, 1.0 - rms_dev) * 100, 1)

    result = {
        "source": source,
        "confidence": confidence,
        "n_reps": len(per_rep),
        "efficiency": round(sum(efficiencies) / len(efficiencies), 3),
        "drift_ratio": round(sum(drifts) / len(drifts), 3),
        "consistency": consistency,
        "per_rep": per_rep,
    }
    if source == "pose_proxy":
        result["note"] = (
            "Proxy track (shoulder/wrist midpoint, not the bar) — lateral "
            "drift/J-curve are indicative only until bar detection (T3)."
        )
    return result
