"""Multi-person association + lifter selection for lift videos (§3.18 / T1).

MediaPipe's PoseLandmarker returns one landmark set per detected person in an
arbitrary order each frame, so the raw output cannot be followed across frames.
On a bench press the spotter (an upright, prominent pose) is frequently the
person the single-pose model latches onto — so the analysis scores the spotter,
not the lifter. This module turns per-frame person detections into stable
tracks and picks the lifter.

Pure NumPy + standard library (no MediaPipe import) so it is unit-testable
without the video stack. ``bar_xy`` is the strongest planned signal (the
lifter's wrists stay on the bar; a spotter's only touch intermittently) and is
accepted as an optional argument — it becomes available once bar tracking
(T3) lands, and is used automatically when supplied.
"""

from __future__ import annotations

import logging

import numpy as np

logger = logging.getLogger(__name__)


# ── Geometry helpers ─────────────────────────────────────────────────────────


def bbox_from_landmarks(landmarks, min_visibility: float = 0.3):
    """Normalised ``(x1, y1, x2, y2)`` bounding box of visible landmarks.

    Returns ``None`` when no landmark is confidently visible.
    """
    xs: list[float] = []
    ys: list[float] = []
    for lm in landmarks:
        if getattr(lm, "visibility", 1.0) >= min_visibility:
            xs.append(lm.x)
            ys.append(lm.y)
    if not xs:
        return None
    return (min(xs), min(ys), max(xs), max(ys))


def iou(a, b) -> float:
    """Intersection-over-union of two ``(x1, y1, x2, y2)`` boxes (0 if none)."""
    if a is None or b is None:
        return 0.0
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def greedy_match(prev_boxes, curr_boxes, iou_threshold: float = 0.3):
    """Greedy IoU association (highest overlap first).

    Person counts per frame are tiny (1–4), so greedy matching is
    equivalent to optimal assignment in practice and needs no SciPy.

    Returns ``(matches, unmatched_prev, unmatched_curr)`` where ``matches`` is
    a list of ``(prev_idx, curr_idx)``.
    """
    pairs: list[tuple[float, int, int]] = []
    for i, pb in enumerate(prev_boxes):
        for j, cb in enumerate(curr_boxes):
            v = iou(pb, cb)
            if v >= iou_threshold:
                pairs.append((v, i, j))
    pairs.sort(reverse=True)

    used_prev: set[int] = set()
    used_curr: set[int] = set()
    matches: list[tuple[int, int]] = []
    for _v, i, j in pairs:
        if i in used_prev or j in used_curr:
            continue
        matches.append((i, j))
        used_prev.add(i)
        used_curr.add(j)

    unmatched_prev = [i for i in range(len(prev_boxes)) if i not in used_prev]
    unmatched_curr = [j for j in range(len(curr_boxes)) if j not in used_curr]
    return matches, unmatched_prev, unmatched_curr


def _person_bbox(person):
    bbox = person.get("bbox")
    if bbox is None:
        bbox = bbox_from_landmarks(person["landmarks"])
    return bbox


# ── Track building ───────────────────────────────────────────────────────────


def build_person_tracks(
    persons_per_frame: list,
    frame_indices: list[int] | None = None,
    iou_threshold: float = 0.3,
    max_missing: int = 5,
) -> list[dict]:
    """Associate per-frame person detections into stable tracks.

    ``persons_per_frame`` is a list (one entry per frame that had ≥1 person) of
    lists of person dicts ``{landmarks, world, presence, bbox?}``. When
    ``frame_indices`` is supplied, detections are keyed by the original frame
    index, otherwise by position.

    Returns tracks sorted by detection count (desc)::

        {"id": int, "n": int, "detections": {frame_idx: person}}
    """
    order = frame_indices if frame_indices is not None else list(range(len(persons_per_frame)))
    active: dict[int, dict] = {}
    finished: list[dict] = []
    next_id = 0

    for pos, persons in enumerate(persons_per_frame):
        f = order[pos]
        boxes = [_person_bbox(p) for p in persons]
        active_ids = list(active.keys())
        active_boxes = [active[t]["last_bbox"] for t in active_ids]

        matches, _unmatched_prev, unmatched_curr = greedy_match(
            active_boxes, boxes, iou_threshold
        )
        for ai, cj in matches:
            tid = active_ids[ai]
            active[tid]["detections"][f] = persons[cj]
            active[tid]["last_bbox"] = boxes[cj]
            active[tid]["last_frame"] = f
        for cj in unmatched_curr:
            tid = next_id
            next_id += 1
            active[tid] = {
                "id": tid,
                "last_frame": f,
                "last_bbox": boxes[cj],
                "detections": {f: persons[cj]},
            }

        for tid in list(active.keys()):
            if f - active[tid]["last_frame"] > max_missing:
                finished.append(active.pop(tid))

    finished.extend(active.values())
    for t in finished:
        t["n"] = len(t["detections"])
    finished.sort(key=lambda t: t["n"], reverse=True)
    return finished


def track_series(track: dict, n_frames: int):
    """Aligned ``(landmarks, world, presence)`` lists over ``range(n_frames)``.

    Positions where the track has no detection are ``None`` (landmarks/world)
    or ``0.0`` (presence).
    """
    det = track["detections"]
    landmarks: list = [None] * n_frames
    world: list = [None] * n_frames
    presence: list[float] = [0.0] * n_frames
    for f, p in det.items():
        if 0 <= f < n_frames:
            landmarks[f] = p.get("landmarks")
            world[f] = p.get("world")
            presence[f] = float(p.get("presence", 0.0) or 0.0)
    return landmarks, world, presence


def dense_series(track: dict, frame_times: dict):
    """Dense ``(landmarks, world, timestamps, presence)`` for a track.

    One entry per frame the track was detected, in ascending frame order —
    the same "detected frames only" shape ``extract_pose_track`` returns.
    """
    idxs = sorted(track["detections"].keys())
    landmarks = [track["detections"][i]["landmarks"] for i in idxs]
    world = [track["detections"][i].get("world") for i in idxs]
    presence = [float(track["detections"][i].get("presence", 0.0) or 0.0) for i in idxs]
    timestamps = [frame_times[i] for i in idxs]
    return landmarks, world, timestamps, presence


# ── Lifter selection ─────────────────────────────────────────────────────────


def _midpoint(lm, a: int, b: int) -> tuple[float, float]:
    return ((lm[a].x + lm[b].x) / 2, (lm[a].y + lm[b].y) / 2)


def _coverage(track: dict, n_frames: int) -> float:
    return len(track["detections"]) / max(n_frames, 1)


def _movement_score(track: dict, cap: float = 0.15) -> float:
    """Vertical hip travel, normalised (lifter reps; a spotter is static)."""
    ys = [_midpoint(p["landmarks"], 23, 24)[1] for p in track["detections"].values()]
    if len(ys) < 2:
        return 0.0
    return float(min((max(ys) - min(ys)) / cap, 1.0))


def _torso_horizontality(track: dict) -> float:
    """1.0 = torso horizontal (a benching lifter), 0.0 = vertical (spotter)."""
    vals: list[float] = []
    for p in track["detections"].values():
        lm = p["landmarks"]
        sx, sy = _midpoint(lm, 11, 12)
        hx, hy = _midpoint(lm, 23, 24)
        dx, dy = abs(sx - hx), abs(sy - hy)
        vals.append(dx / (dx + dy + 1e-6))
    return float(sum(vals) / len(vals)) if vals else 0.0


def _bar_coupling(track: dict, bar_xy: list, max_dist: float = 0.15) -> float:
    """1.0 = wrists sit on the bar for the whole set (the lifter).

    ``bar_xy`` is aligned to frame index (``None`` where no bar estimate).
    """
    dists: list[float] = []
    for f, p in track["detections"].items():
        if f >= len(bar_xy) or bar_xy[f] is None:
            continue
        bx, by = bar_xy[f]
        lm = p["landmarks"]
        wx, wy = _midpoint(lm, 15, 16)
        dists.append(float(np.hypot(wx - bx, wy - by)))
    if not dists:
        return 0.0
    return float(max(0.0, 1.0 - (sum(dists) / len(dists)) / max_dist))


def score_lifter_candidate(
    track: dict,
    n_frames: int,
    exercise: str | None = None,
    bar_xy: list | None = None,
) -> dict:
    """Weighted lifter score with the contributing components exposed.

    Signal weights are fixed per scenario and normalised by their sum. Bar
    coupling dominates when available; on bench the posture prior (horizontal
    lifter vs upright spotter) is the decisive fallback.
    """
    components = {
        "coverage": _coverage(track, n_frames),
        "movement": _movement_score(track),
    }
    weights = {"coverage": 0.5, "movement": 0.5}

    if exercise == "Bench Press":
        components["posture"] = _torso_horizontality(track)
        weights = {"coverage": 0.3, "movement": 0.2, "posture": 0.5}

    if bar_xy is not None:
        components["bar_coupling"] = _bar_coupling(track, bar_xy)
        weights = {"coverage": 0.2, "movement": 0.2, "bar_coupling": 0.6}
        if exercise == "Bench Press":
            components["posture"] = _torso_horizontality(track)
            weights = {
                "coverage": 0.1,
                "movement": 0.1,
                "posture": 0.2,
                "bar_coupling": 0.6,
            }

    total_w = sum(weights.values()) or 1.0
    score = sum(components[k] * w for k, w in weights.items()) / total_w
    return {
        "track_id": track["id"],
        "score": round(float(score), 4),
        "components": {k: round(float(v), 4) for k, v in components.items()},
        "weights": weights,
    }


def select_lifter(
    tracks: list[dict],
    n_frames: int,
    exercise: str | None = None,
    bar_xy: list | None = None,
    forced_track_id: int | None = None,
) -> tuple[dict | None, dict]:
    """Pick the lifter track. Returns ``(track, selection_info)``.

    ``forced_track_id`` (a user override) wins when it matches a track; the
    selection ``source`` is then ``"manual"``.
    """
    if not tracks:
        return None, {"source": "none", "n_tracks": 0, "candidates": []}

    scored = [
        score_lifter_candidate(t, n_frames, exercise=exercise, bar_xy=bar_xy)
        for t in tracks
    ]
    scored.sort(key=lambda s: s["score"], reverse=True)

    if forced_track_id is not None:
        for t in tracks:
            if t["id"] == forced_track_id:
                return t, {
                    "source": "manual",
                    "chosen_track_id": t["id"],
                    "n_tracks": len(tracks),
                    "candidates": scored,
                }

    best = next(t for t in tracks if t["id"] == scored[0]["track_id"])
    info = {
        "source": "single" if len(tracks) == 1 else "auto",
        "chosen_track_id": best["id"],
        "n_tracks": len(tracks),
        "candidates": scored,
    }
    return best, info
