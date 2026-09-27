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

# MediaPipe pose foot landmarks (heel, foot index) — used for the midfoot line.
_HEEL_IDX = (29, 30)
_FOOT_IDX = (31, 32)
# Minimum foot length (fraction of the image) before the midfoot normalisation
# is trusted — a tiny / partly-occluded foot makes the ratio explode (a real
# clip read 4.7 foot-lengths because the feet were barely in frame).
_MIN_FOOT_LEN = 0.04

# View gating (F1). Horizontal *image* position is only a real-world horizontal
# in a sagittal (side) view — in a 3/4 view it conflates depth, and the
# detector's box is the plate at the bar's *end*, not the bar centre. Bar tilt
# (one plate higher) is conversely a frontal-plane property, only visible from
# the front/back where the two plates sit side by side.
_SAGITTAL_VIEWS = ("side",)
_FRONTAL_VIEWS = ("frontal", "front", "rear")
_THREE_QUARTER_VIEWS = ("three_quarter",)
# In a 3/4 view the horizontal metrics are only attempted when most frames
# resolved the bar *centre* (whole-bar box or the two-plate midpoint) rather
# than a single plate at the bar's end.
_MIN_PAIR_RATE_3Q = 0.5


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


def _midfoot(lm) -> tuple[float, float] | None:
    """Midfoot x (image-normalised) + foot length, from the pose foot landmarks.

    Midfoot = the midpoint of the heel and foot-index landmarks (the middle of
    the foot), averaged over whichever feet are visible. Returns ``None`` when
    no foot landmark is usable.
    """
    xs: list[float] = []
    lengths: list[float] = []
    for heel_i, foot_i in zip(_HEEL_IDX, _FOOT_IDX):
        try:
            heel, foot = lm[heel_i], lm[foot_i]
        except (IndexError, TypeError):
            continue
        xs.extend((float(heel.x), float(foot.x)))
        lengths.append(float(np.hypot(foot.x - heel.x, foot.y - heel.y)))
    if not xs:
        return None
    return float(np.mean(xs)), float(np.mean(lengths))


def _net_lateral(pts: list[tuple[float, float]]) -> float | None:
    """Signed net horizontal travel / vertical travel (the J-curve's 'hook').

    Positive = the bar ends to the +x side of where it started. A near-vertical
    pull is ~0; a pronounced J shows the classic back-then-forward pair.
    """
    if len(pts) < _MIN_REP_POINTS:
        return None
    arr = np.asarray(pts, dtype=float)
    vertical = float(arr[:, 1].max() - arr[:, 1].min())
    if vertical <= 1e-9:
        return None
    return float(arr[-1, 0] - arr[0, 0]) / vertical


def analyze_bar_path(
    bar_track: list,
    pose_reps: list[dict],
    exercise: str = "",
    landmarks: list | None = None,
    view: str = "",
) -> dict | None:
    """Bar-path technique metrics over the detected reps.

    Returns ``None`` when fewer than 2 measurable reps exist. ``source`` and
    ``confidence`` describe the underlying track (proxy vs detector).

    The *horizontal* metrics are only meaningful in the view they are defined
    for, so they are gated on ``view`` and omitted (never guessed) otherwise:
    **bar-over-midfoot** and **net lateral (J-curve)** need a sagittal view,
    **bar tilt** needs a frontal view. ``landmarks`` (index-aligned with
    ``bar_track``) supplies the midfoot; the detector track carries the
    optional per-frame ``tilt_deg``.
    """
    if not bar_track or not pose_reps:
        return None

    sagittal = view in _SAGITTAL_VIEWS
    frontal = view in _FRONTAL_VIEWS
    three_q = view in _THREE_QUARTER_VIEWS

    sources = {p["source"] for p in bar_track if p}
    source = sources.pop() if len(sources) == 1 else "mixed"
    confs = [float(p["confidence"]) for p in bar_track if p]
    confidence = round(sum(confs) / len(confs), 3) if confs else 0.0

    # How often the track located the bar *centre* (not a plate at its end).
    known = [p for p in bar_track if p]
    pair_rate = (
        sum(1 for p in known
            if p.get("bar_basis") in ("barbell", "plate_pair")) / len(known)
        if known else 0.0
    )
    # 3/4 horizontal metrics are approximate (perspective) — only attempt them
    # when the bar centre was actually resolved.
    lateral_ok = sagittal or (three_q and pair_rate >= _MIN_PAIR_RATE_3Q)

    tilts = []
    if frontal or three_q:
        tilts = [abs(float(p["tilt_deg"])) for p in bar_track
                 if p and p.get("tilt_deg") is not None]
        tilts = [min(t, 90.0) for t in tilts]

    per_rep: list[dict] = []
    rep_pts: list[list[tuple[float, float]]] = []
    for rep in pose_reps:
        start, end = rep.get("start_idx", 0), rep.get("end_idx", 0)
        pts = _segment(bar_track, start, end)
        eff = _path_efficiency(pts)
        drift = _drift_ratio(pts)
        if eff is None or drift is None:
            continue
        arr = np.asarray(pts, dtype=float)
        entry = {
            "rep_number": rep.get("rep_number"),
            "efficiency": round(eff, 3),
            "drift_ratio": round(drift, 3),
            "vertical_range": round(float(arr[:, 1].max() - arr[:, 1].min()), 4),
        }
        net = _net_lateral(pts) if lateral_ok else None
        if net is not None:
            entry["net_lateral"] = round(net, 3)
        # Bar-over-midfoot: mean signed horizontal offset from the midfoot,
        # as a fraction of foot length (+ = bar toward the +x side).
        if lateral_ok and landmarks:
            offs: list[float] = []
            for i in range(max(0, start), min(len(bar_track), end) + 1):
                if i >= len(landmarks) or bar_track[i] is None:
                    continue
                lm = landmarks[i]
                mf = _midfoot(lm) if lm is not None else None
                if mf and mf[1] >= _MIN_FOOT_LEN:
                    offs.append((float(bar_track[i]["x"]) - mf[0]) / mf[1])
            if offs:
                entry["bar_over_midfoot"] = round(float(np.mean(offs)), 3)
        per_rep.append(entry)
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

    net_laterals = [r["net_lateral"] for r in per_rep if "net_lateral" in r]
    midfoot = [r["bar_over_midfoot"] for r in per_rep
               if "bar_over_midfoot" in r]

    result = {
        "source": source,
        "confidence": confidence,
        "n_reps": len(per_rep),
        "efficiency": round(sum(efficiencies) / len(efficiencies), 3),
        "drift_ratio": round(sum(drifts) / len(drifts), 3),
        "consistency": consistency,
        "per_rep": per_rep,
    }
    if net_laterals:
        result["net_lateral"] = round(sum(net_laterals) / len(net_laterals), 3)
    if midfoot:
        result["bar_over_midfoot"] = round(sum(midfoot) / len(midfoot), 3)
    if lateral_ok and (net_laterals or midfoot):
        # Distinguishes exact (sagittal) from perspective-approximate (3/4).
        result["lateral_basis"] = "sagittal" if sagittal else "three_quarter"
    if tilts:
        result["tilt_deg"] = round(float(np.mean(tilts)), 2)
        result["tilt_frames"] = len(tilts)
    notes: list[str] = []
    if source == "pose_proxy":
        notes.append(
            "Proxy track (shoulder/wrist midpoint, not the bar) — vertical "
            "metrics only."
        )
    elif source == "proxy_offset":
        notes.append(
            "Detector-tracked bar: vertical metrics are accurate; lateral ones "
            "follow the pose proxy."
        )
    if three_q and lateral_ok:
        notes.append(
            "3/4 view: lateral metrics are approximate (bar centre taken from "
            "the two plates)."
        )
    elif not lateral_ok:
        notes.append("Bar-over-midfoot / net lateral need a side view.")
    if not frontal and not three_q:
        notes.append("Bar tilt needs a front/back view.")
    if notes:
        result["note"] = " ".join(notes)
    return result
