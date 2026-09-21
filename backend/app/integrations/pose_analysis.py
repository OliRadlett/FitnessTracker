"""Local pose-based video analysis for powerlifting form (§3.18).

All functions are pure — no DB access, no FastAPI deps.
Runs inside the Modal container with mediapipe + opencv + numpy.

Replaces Gemini Vision calls with deterministic rule-based evaluation.
"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)


# ── MediaPipe Pose Extraction ────────────────────────────────────────────────


def extract_pose_track(
    input_path: Path,
    tmpdir: str,
    trim_start: float,
    trim_end: float,
    fps: float = 10.0,
) -> dict:
    """Extract MediaPipe Pose landmarks (2D + metric 3D) from a video segment.

    Uses the mediapipe.tasks API (PoseLandmarker) — the solutions API
    was removed in mediapipe >= 0.10.30.

    Returns a dict:
        landmarks:  list per detected frame of 33 normalised 2D landmarks
        world:      parallel list of 33 metric 3D world landmarks (metres,
                    hip-origin) where the model produced them
        timestamps: per-frame timestamps in seconds (aligned to ``landmarks``)
        detected:   number of frames with a pose
        frames:     number of frames sampled

    ``world`` is shorter than ``landmarks`` when the model omitted it; callers
    must pair them by index only up to ``len(world)`` (the model emits world
    landmarks for the same frames it emits 2D ones, in order).
    """
    import cv2
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    segment_duration = trim_end - trim_start
    if segment_duration <= 0:
        return {"landmarks": [], "world": [], "timestamps": [], "detected": 0, "frames": 0}

    # Download the pose landmarker model if not cached
    model_path = Path(tmpdir) / "pose_landmarker.task"
    if not model_path.exists():
        import urllib.request
        model_url = (
            "https://storage.googleapis.com/mediapipe-models/"
            "pose_landmarker/pose_landmarker_heavy/float16/latest/"
            "pose_landmarker_heavy.task"
        )
        logger.info("Downloading pose landmarker model...")
        urllib.request.urlretrieve(model_url, str(model_path))
        logger.info("Downloaded pose landmarker model: %d bytes", model_path.stat().st_size)

    # Create PoseLandmarker with video running mode.
    # CPU delegate: proven 100% detection on powerlifting videos (heavy model,
    # 10fps, conf 0.3; benchmarked 2026-09-17). CPU-only also avoids T4 cost
    # and cold-start time. (An earlier zero-detection episode was traced to
    # the ffmpeg frame-numbering bug below, not the delegate.)
    base_options = BaseOptions(
        model_asset_path=str(model_path),
        delegate=BaseOptions.Delegate.CPU,
    )
    options = vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.3,
        min_pose_presence_confidence=0.3,
        min_tracking_confidence=0.3,
        output_segmentation_masks=False,
    )
    pose_landmarker = vision.PoseLandmarker.create_from_options(options)

    # Extract frames.
    # NOTE: -start_number 0 is load-bearing. ffmpeg's image2 muxer numbers
    # from 1 by default (pose_0001.jpg...), but the loop below reads from
    # pose_0000.jpg and breaks on the first missing file — without this flag
    # zero frames are ever processed (every video reported "No pose
    # landmarks detected"; found 2026-09-17).
    output_pattern = str(Path(tmpdir) / "pose_%04d.jpg")
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-ss", str(trim_start), "-to", str(trim_end),
            "-i", str(input_path),
            "-vf", f"fps={fps}",
            "-q:v", "2",
            "-start_number", "0",
            output_pattern,
        ],
        capture_output=True, timeout=120,
    )

    landmarks_list = []
    world_list = []
    timestamps = []
    frame_interval = 1.0 / fps
    idx = 0

    while True:
        frame_path = Path(tmpdir) / f"pose_{idx:04d}.jpg"
        if not frame_path.exists():
            break
        img = cv2.imread(str(frame_path))
        if img is None:
            idx += 1
            continue

        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=img_rgb)
        timestamp_ms = int((idx * frame_interval) * 1000)

        result = pose_landmarker.detect_for_video(mp_image, timestamp_ms)

        if result.pose_landmarks:
            # pose_landmarks is a list of NormalizedLandmarkList
            # Each element is a list of 33 landmarks for one detected pose
            landmarks_list.append(result.pose_landmarks[0])
            if result.pose_world_landmarks:
                world_list.append(result.pose_world_landmarks[0])
            t = trim_start + (idx * frame_interval) + (frame_interval / 2)
            timestamps.append(round(min(t, trim_end), 3))

        idx += 1

    pose_landmarker.close()
    logger.info(
        "Pose landmarks: %d/%d frames (%d with world landmarks)",
        len(landmarks_list), idx, len(world_list),
    )
    return {
        "landmarks": landmarks_list,
        "world": world_list,
        "timestamps": timestamps,
        "detected": len(landmarks_list),
        "frames": idx,
    }


def extract_pose_landmarks(
    input_path: Path,
    tmpdir: str,
    trim_start: float,
    trim_end: float,
    fps: float = 10.0,
) -> tuple[list, list[float]]:
    """Back-compat wrapper returning ``(landmarks, timestamps)``.

    Prefer ``extract_pose_track`` — the metric 3D world landmarks are what
    make scale and camera-view reasoning possible.
    """
    track = extract_pose_track(input_path, tmpdir, trim_start, trim_end, fps)
    return track["landmarks"], track["timestamps"]


# ── Utility Functions ─────────────────────────────────────────────────────────


def calculate_angle(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Angle at point B given three 2D points."""
    ba = a - b
    bc = c - b
    cosine = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-8)
    return float(np.degrees(np.arccos(np.clip(cosine, -1.0, 1.0))))


def _vis(lm, *idxs: int) -> float:
    """Minimum visibility over landmark indices (default 1.0 if absent).

    MediaPipe provides per-landmark visibility; synthetic/test landmarks
    may not — default keeps those usable.
    """
    return min(float(getattr(lm[i], "visibility", 1.0)) for i in idxs)


def _median_filter(values, window: int = 7) -> np.ndarray:
    """Rolling median (edge-padded). Kills single-frame landmark spikes
    (e.g. a knee reading 26° for one frame when the bar occludes it) that
    mean-smoothing merely attenuates — a live video showed such spikes
    inventing false rep boundaries and false hitching.
    """
    x = np.asarray(values, dtype=float)
    if len(x) <= window:
        return x.copy()
    pad = window // 2
    padded = np.pad(x, pad, mode="edge")
    return np.array([np.median(padded[i:i + window]) for i in range(len(x))])


def _best_extremum(
    all_landmarks: list,
    idxs: list[int],
    values,
    vis_idxs: tuple[int, ...],
    want_max: bool = True,
    min_vis: float = 0.5,
) -> int:
    """Index into idxs with max (or min) precomputed value among
    well-tracked frames.

    Values should come from a median-filtered series so isolated spikes
    can't win; visibility excludes multi-frame mistracks. Falls back to
    the plain extremum when nothing passes the visibility gate.
    """
    values = np.asarray(values, dtype=float)
    order = np.argsort(values)
    if want_max:
        order = order[::-1]
    for rank in order:
        i = idxs[int(rank)]
        if _vis(all_landmarks[i], *vis_idxs) >= min_vis:
            return i
    return idxs[int(np.argmax(values)) if want_max else int(np.argmin(values))]


def _mid(landmarks, left_idx: int, right_idx: int) -> np.ndarray:
    """Midpoint of left/right landmark."""
    return np.array([
        (landmarks[left_idx].x + landmarks[right_idx].x) / 2,
        (landmarks[left_idx].y + landmarks[right_idx].y) / 2,
    ])


def _torso_angle(landmarks) -> float:
    """Torso lean from upright, in degrees (0 = upright).

    Image y grows downward, so the raw hip-minus-shoulder angle is 180 when
    upright — subtract from 180 to get the lean deviation. (An earlier
    version returned the raw angle, making every standing frame read ~180
    and tripping all lean thresholds. Found 2026-09-17.)
    """
    shoulder = _mid(landmarks, 11, 12)
    hip = _mid(landmarks, 23, 24)
    vertical = np.array([0, -1])
    torso_vec = hip - shoulder
    cosine = np.dot(torso_vec, vertical) / (np.linalg.norm(torso_vec) + 1e-8)
    return float(180.0 - np.degrees(np.arccos(np.clip(cosine, -1.0, 1.0))))


# ── Exercise Classification ──────────────────────────────────────────────────


def classify_exercise(landmarks_per_frame: list,
                      timestamps: list[float] | None = None) -> dict:
    """Classify exercise from pose landmark sequence using joint angle patterns.

    Returns {"exercise": str, "confidence": float, "variation": str}.
    """
    if len(landmarks_per_frame) < 10:
        return {"exercise": "Unknown", "confidence": 0.0, "variation": ""}

    hip_angles = []
    knee_angles = []
    elbow_angles = []

    for lm in landmarks_per_frame:
        hip_angles.append(calculate_angle(_mid(lm, 11, 12), _mid(lm, 23, 24), _mid(lm, 25, 26)))
        knee_angles.append(calculate_angle(_mid(lm, 23, 24), _mid(lm, 25, 26), _mid(lm, 27, 28)))
        elbow_angles.append(calculate_angle(_mid(lm, 11, 12), _mid(lm, 13, 14), _mid(lm, 15, 16)))

    hip_range = max(hip_angles) - min(hip_angles)
    knee_range = max(knee_angles) - min(knee_angles)
    elbow_range = max(elbow_angles) - min(elbow_angles)

    # Torso lean profile (0 = upright). A deadlift folds the torso
    # near-horizontal at the bottom (lean 70°+); squat bottoms stay under
    # ~50°. Robust max via 95th percentile (single glitch frames skew max).
    leans = sorted(_torso_angle(lm) for lm in landmarks_per_frame)
    bottom_lean = leans[min(len(leans) - 1, int(len(leans) * 0.95))]

    # Mean shoulder-hip vertical difference (bar position indicator)
    sh_diffs = []
    for lm in landmarks_per_frame:
        shoulder_y = np.mean([lm[11].y, lm[12].y])
        hip_y = np.mean([lm[23].y, lm[24].y])
        sh_diffs.append(shoulder_y - hip_y)
    mean_sh_diff = np.mean(sh_diffs)

    exercise = "Unknown"
    confidence = 0.0
    variation = ""

    # Overhead press (strict / push press / log press): elbows extend
    # while the hands finish overhead, WITH leg drive (dip/clean). Verified
    # 2026-09-18: a strongman log clean-and-press read "Deadlift 0.95"
    # (the clean bends the torso horizontal, tripping the hinge gate).
    # Uses the longest CONSECUTIVE overhead hold (a lockout), not the share
    # of frames: in a 45s 1RM video the 1-2s lockout is a tiny fraction.
    # Threshold just above 2 frames @10fps: a Modal-side probe measured
    # 0.30s where local measured 0.40s on the same video (one frame of
    # alignment noise) — anything near 0.3 is a knife-edge. The elbow_range
    # + hip_range conjunctions carry the specificity, not this threshold.
    # The hip_range guard keeps bench press out (hips stay put on a bench
    # while the bar locks out overhead).
    longest_hold = 0.0
    hold_start = None
    if timestamps is None:  # assume 10fps extraction cadence
        timestamps = [i / 10.0 for i in range(len(landmarks_per_frame))]
    for t, lm in zip(timestamps, landmarks_per_frame):
        wrist_y = (lm[15].y + lm[16].y) / 2
        shoulder_y = (lm[11].y + lm[12].y) / 2
        if wrist_y < shoulder_y - 0.1:
            if hold_start is None:
                hold_start = t
            longest_hold = max(longest_hold, t - hold_start)
        else:
            hold_start = None

    if elbow_range > 40 and longest_hold > 0.2 and hip_range > 20:
        exercise = "Overhead Press"
        confidence = min(0.95, 0.7 + elbow_range / 200)
        variation = "Push Press" if hip_range > 30 else "Strict Press"
    # NOTE: elbow_range is deliberately NOT a veto for lower-body lifts.
    # Real squat/deadlift videos show large arm movement (unracking, bar
    # stabilization, arm swing) — e.g. hip_range=143, knee_range=118 with
    # elbow_range=179 on a confirmed back-squat video (2026-09-17).
    # Classification keys on hip/knee dominance instead.
    #
    # Hinge check: deadlifts satisfy the squat ROM thresholds too (both
    # move hips + knees through large ranges), so the squat branch would
    # shadow them — hence elif-chained AFTER the press branch above.
    # Verified 2026-09-17: two "Squat 0.95" videos were visually
    # conventional/strongman deadlifts (torso horizontal).
    elif hip_range > 35 and knee_range > 30 and bottom_lean > 60:
        exercise = "Deadlift"
        confidence = min(0.95, 0.7 + (hip_range + knee_range) / 400)
        knee_x_spread = np.mean([abs(lm[25].x - lm[26].x) for lm in landmarks_per_frame])
        variation = "Sumo Deadlift" if knee_x_spread > 0.2 else "Conventional Deadlift"
    elif hip_range > 40 and knee_range > 50:
        exercise = "Squat"
        confidence = min(0.95, 0.7 + (hip_range + knee_range) / 400)
        if mean_sh_diff > 0.05:
            variation = "Front Squat"
        else:
            # Low vs high bar by median torso lean across the set:
            # low-bar lifters ride 25-35°+ inclined throughout, high-bar
            # stay ~10-20°. Threshold 22° separates the observed cases
            # (28° vs 16°). Form thresholds are bar-style agnostic (lean
            # is measured at the standing top), so this is labeling only.
            med_lean = float(np.median(
                [_torso_angle(lm) for lm in landmarks_per_frame]))
            variation = "Low Bar Squat" if med_lean > 22 else "High Bar Squat"
    elif elbow_range > 50 and hip_range < 15 and knee_range < 15:
        exercise = "Bench Press"
        confidence = min(0.95, 0.7 + elbow_range / 200)
    elif hip_range > 35 and knee_range > 30:
        exercise = "Deadlift"
        confidence = min(0.95, 0.7 + (hip_range + knee_range) / 400)
        knee_x_spread = np.mean([abs(lm[25].x - lm[26].x) for lm in landmarks_per_frame])
        variation = "Sumo Deadlift" if knee_x_spread > 0.2 else "Conventional Deadlift"
    elif elbow_range > 40 and hip_range < 10:
        exercise = "Overhead Press"
        confidence = min(0.90, 0.6 + elbow_range / 200)

    return {"exercise": exercise, "confidence": round(confidence, 2), "variation": variation}


# ── Camera View Detection ────────────────────────────────────────────────────

VIEW_SIDE_MAX_RATIO = 0.50
VIEW_FRONTAL_MIN_RATIO = 1.10


def detect_camera_view(landmarks_per_frame: list) -> dict:
    """Estimate the camera's viewing plane relative to the lifter.

    Returns ``{"view": "side"|"three_quarter"|"frontal"|"unknown",
    "shoulder_ratio": float, "shoulder_width": float, "torso_length": float,
    "frames": int}``.

    A sagittal (side-on) view projects the lifter's left-right axis into
    camera depth, so the left/right shoulder (and hip) x-offset collapses
    toward zero. A frontal or rear view keeps that axis in the image plane,
    so the offset is a large fraction of the torso. That is the distinction
    that matters: the sagittal-plane rules (torso lean, hip-vs-knee depth,
    bar path) are only valid for ``side``; on a ``frontal`` view they must
    be gated off rather than fired.

    The scale is the shoulder-to-hip Euclidean distance, NOT the vertical
    difference — when the lifter bends over the vertical gap collapses and
    the ratio explodes (side-view squats read 0.8+ with vertical scaling,
    0.1-0.4 with Euclidean). Front and rear are deliberately not separated:
    monocular 2D pose cannot tell them apart, and both are equally invalid
    for sagittal rules.
    """
    ratios, widths, torsos = [], [], []
    for lm in landmarks_per_frame:
        sh_x = (lm[11].x + lm[12].x) / 2
        sh_y = (lm[11].y + lm[12].y) / 2
        hip_x = (lm[23].x + lm[24].x) / 2
        hip_y = (lm[23].y + lm[24].y) / 2
        torso = float(np.hypot(sh_x - hip_x, sh_y - hip_y))
        if torso < 1e-3:
            continue
        width = max(abs(lm[11].x - lm[12].x), abs(lm[23].x - lm[24].x))
        ratios.append(width / torso)
        widths.append(width)
        torsos.append(torso)

    if len(ratios) < 5:
        return {
            "view": "unknown", "shoulder_ratio": None,
            "shoulder_width": None, "torso_length": None, "frames": len(ratios),
        }

    ratio = float(np.median(ratios))
    if ratio < VIEW_SIDE_MAX_RATIO:
        view = "side"
    elif ratio < VIEW_FRONTAL_MIN_RATIO:
        view = "three_quarter"
    else:
        view = "frontal"
    return {
        "view": view,
        "shoulder_ratio": round(ratio, 3),
        "shoulder_width": round(float(np.median(widths)), 4),
        "torso_length": round(float(np.median(torsos)), 4),
        "frames": len(ratios),
    }


# ── Rep Boundary Detection ───────────────────────────────────────────────────


def detect_reps_from_pose(
    landmarks_per_frame: list,
    timestamps: list[float],
    exercise: str,
    expected_reps: int | None = None,
) -> list[dict]:
    """Detect individual reps from pose landmark sequence.

    Uses joint angle oscillation to find rep boundaries.
    Returns list of per-rep dicts with start/end indices.

    expected_reps (user-declared at upload, for calibration): when given,
    the largest-amplitude valid cycles are selected instead of all valid
    cycles — setup dips, walkout shuffles and rerack bends all oscillate
    but span less ROM than the working rep(s). Without it, every valid
    cycle is returned (legacy behavior).
    """
    if len(landmarks_per_frame) < 5:
        return []

    # Build a "depth signal" — knee angle for squat/deadlift, elbow angle for bench
    signal = _median_filter([
        calculate_angle(_mid(lm, 23, 24), _mid(lm, 25, 26), _mid(lm, 27, 28))
        if exercise in ("Squat", "Front Squat", "Back Squat", "Deadlift",
                        "Conventional Deadlift", "Sumo Deadlift") else
        calculate_angle(_mid(lm, 11, 12), _mid(lm, 13, 14), _mid(lm, 15, 16))
        for lm in landmarks_per_frame
    ], window=7)

    # Find all raw extrema, then filter by PROMINENCE (height above the
    # surrounding signal). Jitter wobbles (±2°) and setup shuffles never
    # qualify; true bottoms/tops (40-120° of relief) always do. Without
    # this, every micro-wiggle becomes a boundary and reps fragment —
    # e.g. a grinder's sticking-point hesitation split one rep into two
    # bottom-fragments with no top inside (0df141e8), and a video starting
    # mid-descent produced a lockout-less leading fragment (a0bc93ce).
    diff = np.diff(signal)
    raw_max, raw_min = [], []
    for i in range(1, len(diff)):
        if diff[i - 1] > 0 and diff[i] <= 0:
            raw_max.append(i)
        elif diff[i - 1] < 0 and diff[i] >= 0:
            raw_min.append(i)

    def _prom(idx: int, is_max: bool) -> float:
        # Topographic prominence against the best ground on EACH SIDE of
        # the whole signal (not nearest-extremum intervals: a flat bottom
        # full of wiggles must measure against the surrounding tops, not
        # sibling wiggles — nearest-neighbor scoring gave a 107°-deep bench
        # bottom prominence ~7 and dropped every rep. Found 2026-09-18 on
        # af920f0e).
        if is_max:
            left = float(np.min(signal[:idx])) if idx > 0 else float(signal[idx])
            right = (float(np.min(signal[idx + 1:]))
                     if idx + 1 < len(signal) else float(signal[idx]))
            return float(signal[idx]) - max(left, right)
        left = float(np.max(signal[:idx])) if idx > 0 else float(signal[idx])
        right = (float(np.max(signal[idx + 1:]))
                 if idx + 1 < len(signal) else float(signal[idx]))
        return min(left, right) - float(signal[idx])

    kept_max = [i for i in raw_max if _prom(i, True) >= 10.0]
    # Bottoms must also clear anatomical plausibility (<30° is beyond max
    # joint flexion: always an occlusion glitch, never a real bottom).
    kept_min = [i for i in raw_min
                if _prom(i, False) >= 25.0 and signal[i] >= 30.0]

    # Each kept bottom gets the nearest kept top on each side as bounds
    # (falling back to the signal ends for videos starting/ending mid-rep).
    # Slices sharing identical bounds are deduped, keeping the deeper one.
    candidates: dict[tuple[int, int], tuple[float, int]] = {}
    for mi in kept_min:
        left = [m for m in kept_max if m < mi]
        right = [m for m in kept_max if m > mi]
        start = left[-1] if left else 0
        end = right[0] if right else len(signal) - 1
        if end - start < 3:
            continue
        key = (start, end)
        depth = float(signal[mi])
        if key not in candidates or depth < candidates[key][0]:
            candidates[key] = (depth, mi)
    #
    # Each slice must also have enough JOINT RANGE to be a real rep:
    # standing-weight-shifts and setup steps create genuine minima but only
    # wiggle a few degrees (live: "reps" with 3° range). Powerlifters move.
    min_amp = 20.0 if exercise in ("Bench Press",) else 25.0
    reps = []
    for start, end in sorted(candidates):
        _depth, bottom_idx = candidates[(start, end)]

        duration = timestamps[min(end, len(timestamps) - 1)] - timestamps[min(start, len(timestamps) - 1)]
        if duration < 0.8 or duration > 10.0:
            continue
        seg = signal[start:end + 1]
        seg_min = float(np.min(seg))
        if seg_min < 30.0:
            # Glitch-contaminated slice (beyond max joint flexion, always
            # an occlusion gap, never a real bottom).
            continue
        amplitude = float(np.max(seg) - seg_min)
        if amplitude < min_amp:
            continue

        reps.append({
            "rep_number": len(reps) + 1,
            "start_idx": start,
            "end_idx": end,
            # Frames of the bottom and the following top, from the robust
            # (median-filtered, prominence-gated) joint-angle signal. Bar
            # velocity uses these directly instead of re-finding extrema on
            # the noisier world-landmark signal.
            "bottom_idx": bottom_idx,
            "top_idx": end,
            "bottom_depth": round(seg_min, 1),
            "amplitude": round(amplitude, 1),
            "start_time": round(timestamps[min(start, len(timestamps) - 1)], 2),
            "end_time": round(timestamps[min(end, len(timestamps) - 1)], 2),
            "duration": round(duration, 2),
        })

    # User-declared rep count: keep the largest-amplitude valid cycles (the
    # working reps), drop setup/walkout/rerack fragments. Amplitude, not
    # depth: a descent-only leading fragment shares the true bottom (tie
    # on depth) but spans half the ROM — verified 2026-09-18 on a0bc93ce,
    # where depth-ranking picked a lockout-less fragment over the full rep.
    # Re-sorted by time afterwards.
    if expected_reps is not None and expected_reps > 0:
        if len(reps) > expected_reps:
            reps = sorted(reps, key=lambda r: (-r["amplitude"], r["bottom_depth"]))[:expected_reps]
            reps = sorted(reps, key=lambda r: r["start_idx"])
            for n, r in enumerate(reps, 1):
                r["rep_number"] = n
    elif len(reps) >= 2:
        # AUTO path only: drop partial cycles (unrack/rack/setup) that clear
        # the absolute floor but span far less ROM than the working reps.
        # Prominence alone doesn't catch them (it measures against the
        # surrounding TOPS, which a shallow bend still clears). Measured on
        # the production set: real reps span >=0.81 of the set's max ROM,
        # partials <=0.71 — 0.75 separates them across lifts and distances.
        # NOT applied when the user declared the count: that path already
        # picks the top-N cycles, and the filter dropped a real rep on
        # 77ca64a0 (3 declared reps -> 2).
        max_amp = max(r["amplitude"] for r in reps)
        reps = [r for r in reps if r["amplitude"] >= 0.75 * max_amp]
        for n, r in enumerate(reps, 1):
            r["rep_number"] = n

    return reps


# ── Squat Analysis ───────────────────────────────────────────────────────────


def _check_squat_depth(
    bottom_landmarks, bottom_knee_angle: float, view: str = "unknown"
) -> bool:
    """IPF depth: hip crease below top of knee.

    The image-Y comparison only holds for a side-on, perpendicular camera
    (the view the lifter's hip-vs-knee vertical relationship is visible
    in). Phone videos are frequently shot from behind or in front, where
    that comparison is meaningless, so it is only applied when the view is
    known to be ``side``.

    The knee-flexion fallback (<95°) works from any angle and is always
    applied: a true deep squat bends the knee well under 95° (benchmarked
    bottoms read 40-65°), while partial squats stay above it.
    """
    if view == "side":
        hip_y = np.mean([bottom_landmarks[23].y, bottom_landmarks[24].y])
        knee_y = np.mean([bottom_landmarks[25].y, bottom_landmarks[26].y])
        if hip_y > knee_y:
            return True
    return bool(bottom_knee_angle < 95)


def _check_knee_valgus(landmarks) -> str:
    left_valgus = landmarks[25].x - landmarks[27].x
    right_valgus = landmarks[28].x - landmarks[26].x
    avg = (left_valgus + right_valgus) / 2
    if avg > 0.05:
        return "significant"
    elif avg > 0.02:
        return "minor"
    return "good"


def _check_heels_flat(landmarks) -> bool:
    left_flat = abs(landmarks[29].y - landmarks[27].y) < 0.03
    right_flat = abs(landmarks[30].y - landmarks[28].y) < 0.03
    return left_flat and right_flat


def analyze_squat_rep(all_landmarks: list, rep: dict, view: str = "unknown") -> dict:
    si, ei = rep["start_idx"], rep["end_idx"]
    n = len(all_landmarks)

    # Reps span bottom-to-bottom. Find the BOTTOM (max knee flexion) for
    # depth/valgus, and the TOP (standing) for lockout/posture. Evaluating
    # lockout at a bottom frame always fails (found 2026-09-17).
    #
    # Extrema come from a median-filtered series (kills single-frame spikes
    # like a 26° knee when the bar occludes it) among well-tracked frames
    # (kills multi-frame mistracks like a lost shoulder reading 150° lean).
    idxs = list(range(si, min(ei, n)))
    kvals = _median_filter([
        calculate_angle(_mid(all_landmarks[i], 23, 24), _mid(all_landmarks[i], 25, 26), _mid(all_landmarks[i], 27, 28))
        for i in idxs
    ])
    hvals = _median_filter([
        calculate_angle(_mid(all_landmarks[i], 11, 12), _mid(all_landmarks[i], 23, 24), _mid(all_landmarks[i], 25, 26))
        for i in idxs
    ])
    # Bottom: no visibility gate (min_vis=0). Deep flexion occludes knees
    # behind arms/plates, so visibility is systematically LOW at true
    # bottoms — gating rejects them and falls back shallow (verified:
    # a 95-point squat regressed to 55). Median filtering already kills
    # single-frame spikes. Tops (standing, unoccluded) keep the gate.
    bi = _best_extremum(all_landmarks, idxs, kvals, (23, 24, 25, 26),
                        want_max=False, min_vis=0.0)
    bottom_lm = all_landmarks[bi]
    bottom_knee = float(kvals[idxs.index(bi)])
    # Top = frame where BOTH knee and hip peak (weakest-link max). Pure
    # knee-argmax lands on straight-knee bent-over frames (setup grips,
    # stiff-legged finishes) whose hips never extended — verified
    # 2026-09-18 (top_knee 179 with top_hip 77 scored as the lockout).
    topvals = np.minimum(kvals, hvals)
    ti = _best_extremum(all_landmarks, idxs, topvals, (11, 12), want_max=True)
    top_lm = all_landmarks[ti]

    def _win_med(fn):
        lo = max(si, ti - 1)
        hi = min(min(ei, n) - 1, ti + 1)
        return float(np.median([fn(all_landmarks[i]) for i in range(lo, hi + 1)]))

    # Angle metrics use the median over the top frame ±1: a single glitchy
    # shoulder landmark otherwise reads as 30° of lean / failed lockout.
    knee_angle_top = _win_med(
        lambda lm: calculate_angle(_mid(lm, 23, 24), _mid(lm, 25, 26), _mid(lm, 27, 28)))
    hip_angle_top = _win_med(
        lambda lm: calculate_angle(_mid(lm, 11, 12), _mid(lm, 23, 24), _mid(lm, 25, 26)))

    depth = _check_squat_depth(bottom_lm, bottom_knee, view)
    # 160° (not 170°) admits ±10° of pose jitter on true lockouts; soft
    # lockouts still fail. Distinguish knees-locked/hips-soft (counts, cued)
    # from a genuinely bent finish (no-count): live lifters often lock knees
    # but never fully stand erect between reps.
    lockout = knee_angle_top > 160 and hip_angle_top > 160
    soft_lockout = not lockout and knee_angle_top > 160
    # View-dependent metrics: only assessed when the camera view makes them
    # meaningful. A rear/front view collapses the sagittal plane (torso
    # lean, hip-vs-knee depth, heel lift) and a side view hides knee valgus.
    # `unknown` is the safe default — report None rather than fire a flag
    # that is invalid for the camera angle (this is what produced 31 false
    # "excessive forward lean" flags across the production set).
    valgus = _check_knee_valgus(bottom_lm) if view in ("frontal", "front", "rear") else None
    heels = _check_heels_flat(top_lm) if view == "side" else None
    back_dev = round(min(90.0, _win_med(_torso_angle)), 1) if view == "side" else None

    return {
        "depth_achieved": depth,
        "lockout_complete": lockout,
        "lockout_soft": soft_lockout,
        "top_hip_angle": round(hip_angle_top, 1),
        "top_knee_angle": round(knee_angle_top, 1),
        "knee_valgus": valgus,
        "heels_flat": heels,
        "back_angle_deviation": back_dev,
        "bottom_knee_angle": round(bottom_knee, 1),
    }


# ── Bench Press Analysis ─────────────────────────────────────────────────────


def analyze_bench_rep(all_landmarks: list, rep: dict, fps: float) -> dict:
    si, ei = rep["start_idx"], rep["end_idx"]

    # Chest contact: at the bottom the bar meets the chest, i.e. the wrist
    # reaches shoulder height. Measured as the rep's closest approach
    # (an arched back raises the chest to the bar, so torso-length ratios
    # misfire on lying lifters — verified 2026-09-18: bar visibly touching
    # while the old ratio test said no contact).
    gaps = []
    for i in range(si, min(ei, len(all_landmarks))):
        sy = np.mean([all_landmarks[i][11].y, all_landmarks[i][12].y])
        wy = np.mean([all_landmarks[i][15].y, all_landmarks[i][16].y])
        gaps.append(abs(wy - sy))
    chest_contact = bool(np.min(gaps) < 0.10) if gaps else False

    # Pause: bar velocity ≈ 0 near bottom. Threshold 0.005 normalized
    # units/frame (5%/s): tracking jitter alone stays under it, while even
    # a slow grind exceeds it — the old 0.002 sat inside jitter noise.
    pause_frames = 0
    for i in range(max(si, si), min(ei, len(all_landmarks) - 1)):
        dy = abs(all_landmarks[i + 1][15].y - all_landmarks[i][15].y)
        if dy < 0.005:
            pause_frames += 1
    pause = pause_frames >= int(fps * 0.3)

    # Butt lift: hips must RISE and STAY up (sustained run below baseline),
    # not just bounce with leg drive. A momentary excursion is normal on a
    # max attempt; a lifted butt stays up for much of the rep.
    hip_ys = [np.mean([all_landmarks[i][23].y, all_landmarks[i][24].y]) for i in range(si, min(ei, len(all_landmarks)))]
    butt_lift = False
    if len(hip_ys) > 5:
        baseline = float(np.median(hip_ys))
        up = [h < baseline - 0.02 for h in hip_ys]
        longest, cur = 0, 0
        for u in up:
            cur = cur + 1 if u else 0
            longest = max(longest, cur)
        butt_lift = longest > len(hip_ys) * 0.3

    # Lockout + symmetry are evaluated at the TOP (arms extended), not at
    # the rep end (a bottom, where the elbows are always bent). Median
    # filtering + visibility gating keep glitch frames out (see squat).
    bidx = list(range(si, min(ei, len(all_landmarks))))
    bvals = _median_filter([
        calculate_angle(_mid(all_landmarks[i], 11, 12), _mid(all_landmarks[i], 13, 14), _mid(all_landmarks[i], 15, 16))
        for i in bidx
    ])
    top_lm = all_landmarks[_best_extremum(
        all_landmarks, bidx, bvals, (11, 12, 13, 14, 15, 16),
        want_max=True)]
    lockout_angle = calculate_angle(_mid(top_lm, 11, 12), _mid(top_lm, 13, 14), _mid(top_lm, 15, 16))
    lockout = lockout_angle > 160
    symmetrical = abs(top_lm[15].y - top_lm[16].y) < 0.03

    return {
        "chest_contact": chest_contact,
        "pause_achieved": pause,
        "butt_lift": butt_lift,
        "lockout_complete": lockout,
        "lockout_symmetrical": symmetrical,
    }


# ── Deadlift Analysis ────────────────────────────────────────────────────────


def _deadlift_lockout(landmarks) -> bool:
    hip_angle = calculate_angle(_mid(landmarks, 11, 12), _mid(landmarks, 23, 24), _mid(landmarks, 25, 26))
    knee_angle = calculate_angle(_mid(landmarks, 23, 24), _mid(landmarks, 25, 26), _mid(landmarks, 27, 28))
    shoulder_y = np.mean([landmarks[11].y, landmarks[12].y])
    hip_y = np.mean([landmarks[23].y, landmarks[24].y])
    # 160° admits pose jitter on true lockouts (see squat lockout note).
    return hip_angle > 160 and knee_angle > 160 and shoulder_y < hip_y


def _detect_hitching(knee_angles: list[float]) -> bool:
    """Hitching = thighs re-bending under load mid-pull.

    A clean pull extends the knees monotonically; hitching (resting the bar
    on the thighs and dipping under) shows as knee re-flexion in the second
    half. Detected from knee angles directly — wrist trajectories are
    unreliable here (hands+straps+bar merge into one blob and stick to
    static plates, which reads as a permanent "stall").
    """
    if len(knee_angles) < 5:
        return False
    n = len(knee_angles)
    mid = n * 3 // 4
    peak = max(knee_angles[:mid]) if mid > 0 else knee_angles[0]
    trough = min(knee_angles[mid:])
    # bool(): inputs may be numpy scalars (median-filtered series), and a
    # numpy bool breaks json.dumps downstream (found 2026-09-18).
    return bool((peak - trough) > 15)


def analyze_deadlift_rep(all_landmarks: list, rep: dict, view: str = "unknown") -> dict:
    si, ei = rep["start_idx"], rep["end_idx"]
    n = len(all_landmarks)

    # Reps span bottom-to-bottom. Lockout, grip and shoulder position are
    # evaluated at the TOP (standing); back rounding is the torso change
    # from bottom to top. Median filtering + visibility gating keep glitch
    # frames out (see squat).
    didx = list(range(si, min(ei, n)))
    dvals = _median_filter([
        calculate_angle(_mid(all_landmarks[i], 23, 24), _mid(all_landmarks[i], 25, 26), _mid(all_landmarks[i], 27, 28))
        for i in didx
    ])
    hvals = _median_filter([
        calculate_angle(_mid(all_landmarks[i], 11, 12), _mid(all_landmarks[i], 23, 24), _mid(all_landmarks[i], 25, 26))
        for i in didx
    ])
    # No visibility gate on the bottom (occlusion is expected at depth).
    # Top uses weakest-link max like squat (straight-knee bent-over setup
    # frames must not win over true standing lockouts).
    bottom_lm = all_landmarks[_best_extremum(
        all_landmarks, didx, dvals, (23, 24, 25, 26), want_max=False,
        min_vis=0.0)]
    top_lm = all_landmarks[_best_extremum(
        all_landmarks, didx, np.minimum(dvals, hvals), (11, 12, 23, 24),
        want_max=True)]

    lockout = _deadlift_lockout(top_lm)
    top_hip_angle = calculate_angle(_mid(top_lm, 11, 12), _mid(top_lm, 23, 24), _mid(top_lm, 25, 26))
    top_knee_angle = calculate_angle(_mid(top_lm, 23, 24), _mid(top_lm, 25, 26), _mid(top_lm, 27, 28))
    # Soft tier mirrors squat: knees locked but finish soft (common on
    # touch-and-go sets that never stand tall between reps). Counts with
    # a cue instead of failing the rep.
    soft_lockout = (not lockout and top_knee_angle > 160
                    and top_hip_angle > 150)

    knee_series = list(_median_filter([
        calculate_angle(_mid(all_landmarks[i], 23, 24), _mid(all_landmarks[i], 25, 26), _mid(all_landmarks[i], 27, 28))
        for i in range(si, min(ei, n))
    ]))
    hitching = _detect_hitching(knee_series)

    # Back position: torso change from bottom to top. Sagittal-only —
    # spine rounding is not visible from front/rear, so it is only assessed
    # on a known side view (None = not assessed).
    if view == "side":
        change = abs(_torso_angle(top_lm) - _torso_angle(bottom_lm))
        back_pos = "significant_rounding" if change > 20 else "mild_rounding" if change > 10 else "neutral"
    else:
        back_pos = None

    grip_sym = abs(top_lm[15].y - top_lm[16].y) < 0.03
    shoulders_back = top_lm[11].y < top_lm[23].y

    return {
        "lockout_complete": lockout,
        "lockout_soft": soft_lockout,
        "top_hip_angle": round(top_hip_angle, 1),
        "top_knee_angle": round(top_knee_angle, 1),
        "hitching_detected": hitching,
        "back_position": back_pos,
        "grip_symmetrical": grip_sym,
        "shoulders_back": shoulders_back,
    }


# ── Form Scoring ─────────────────────────────────────────────────────────────

COACHING_CUES = {
    "depth_not_achieved": "Focus on descending until your hip crease passes below your knee",
    "incomplete_lockout": "Drive your hips through at the top — squeeze your glutes",
    "soft_lockout": "Stand fully tall between reps — finish each rep before descending",
    "knee_valgus": "Push your knees out over your toes throughout the lift",
    "heels_lifted": "Keep your weight distributed across the whole foot",
    "excessive_forward_lean": "Keep your chest up and brace harder before descending",
    "no_chest_contact": "Ensure the bar touches your lower chest/sternum on every rep",
    "no_pause": "Pause the bar on your chest for a 1-count before pressing",
    "butt_lift": "Keep your hips pressed into the bench throughout the press",
    "hitching": "Pull the bar in a smooth, continuous motion without resting on your thighs",
    "back_rounding": "Brace your core harder — think about expanding your belt",
    "asymmetrical_lockout": "Focus on pressing equally with both arms",
}


def _average_rep_scores(rep_scores: list[float]) -> float:
    """Mean per-rep score.

    Deductions are applied per rep and averaged, NOT summed across the set:
    summing meant an 8-rep set with a single recurring fault (e.g. a lean
    flag) clamped to 0, so every multi-rep set scored 0 and every single
    scored 75-100 — the score measured rep count, not form.
    """
    if not rep_scores:
        return 0.0
    return max(0.0, min(100.0, sum(rep_scores) / len(rep_scores)))


def score_squat_form(per_rep: list[dict]) -> dict:
    deviations = []
    comp_fail = False
    cues = []
    rep_scores = []

    for r in per_rep:
        rn = r["rep_number"]
        penalty = 0.0
        if not r["depth_achieved"]:
            penalty += 25
            comp_fail = True
            deviations.append(f"Rep {rn}: Depth not achieved")
            cues.append(COACHING_CUES["depth_not_achieved"])
        if not r["lockout_complete"]:
            if r.get("lockout_soft"):
                penalty += 10
                deviations.append(f"Rep {rn}: Soft lockout (stand tall)")
                cues.append(COACHING_CUES["soft_lockout"])
            else:
                penalty += 25
                comp_fail = True
                deviations.append(f"Rep {rn}: Incomplete lockout")
                cues.append(COACHING_CUES["incomplete_lockout"])
        if r["knee_valgus"] == "significant":
            penalty += 15
            deviations.append(f"Rep {rn}: Significant knee cave")
            cues.append(COACHING_CUES["knee_valgus"])
        elif r["knee_valgus"] == "minor":
            penalty += 5
            deviations.append(f"Rep {rn}: Minor knee cave")
        if r.get("heels_flat") is False:
            penalty += 5
            deviations.append(f"Rep {rn}: Heels lifting")
            cues.append(COACHING_CUES["heels_lifted"])
        back_dev = r.get("back_angle_deviation")
        if back_dev is not None and back_dev > 10:
            penalty += 10
            deviations.append(f"Rep {rn}: Excessive forward lean ({back_dev:.0f})")
            cues.append(COACHING_CUES["excessive_forward_lean"])
        rep_scores.append(100.0 - penalty)

    return _form_result(_average_rep_scores(rep_scores), comp_fail, deviations, list(dict.fromkeys(cues))[:5])


def score_bench_form(per_rep: list[dict]) -> dict:
    deviations = []
    comp_fail = False
    cues = []
    rep_scores = []

    for r in per_rep:
        rn = r["rep_number"]
        penalty = 0.0
        if not r["chest_contact"]:
            penalty += 25
            comp_fail = True
            deviations.append(f"Rep {rn}: No chest contact")
            cues.append(COACHING_CUES["no_chest_contact"])
        if not r["pause_achieved"]:
            penalty += 25
            comp_fail = True
            deviations.append(f"Rep {rn}: No pause on chest")
            cues.append(COACHING_CUES["no_pause"])
        if r["butt_lift"]:
            penalty += 25
            comp_fail = True
            deviations.append(f"Rep {rn}: Butt lifted off bench")
            cues.append(COACHING_CUES["butt_lift"])
        if not r["lockout_symmetrical"]:
            penalty += 10
            deviations.append(f"Rep {rn}: Asymmetrical lockout")
            cues.append(COACHING_CUES["asymmetrical_lockout"])
        rep_scores.append(100.0 - penalty)

    return _form_result(_average_rep_scores(rep_scores), comp_fail, deviations, list(dict.fromkeys(cues))[:5])


def score_deadlift_form(per_rep: list[dict]) -> dict:
    deviations = []
    comp_fail = False
    cues = []
    rep_scores = []

    for r in per_rep:
        rn = r["rep_number"]
        penalty = 0.0
        if not r["lockout_complete"]:
            if r.get("lockout_soft"):
                penalty += 10
                deviations.append(f"Rep {rn}: Soft lockout (stand tall)")
                cues.append(COACHING_CUES["soft_lockout"])
            else:
                penalty += 25
                comp_fail = True
                deviations.append(f"Rep {rn}: Incomplete lockout")
                cues.append(COACHING_CUES["incomplete_lockout"])
        if r["hitching_detected"]:
            penalty += 25
            comp_fail = True
            deviations.append(f"Rep {rn}: Hitching detected")
            cues.append(COACHING_CUES["hitching"])
        if r["back_position"] == "significant_rounding":
            penalty += 15
            deviations.append(f"Rep {rn}: Significant back rounding")
            cues.append(COACHING_CUES["back_rounding"])
        elif r["back_position"] == "mild_rounding":
            penalty += 10
            deviations.append(f"Rep {rn}: Mild thoracic rounding")
        rep_scores.append(100.0 - penalty)

    return _form_result(_average_rep_scores(rep_scores), comp_fail, deviations, list(dict.fromkeys(cues))[:5])


def _form_result(score, comp_fail, deviations, cues):
    if score >= 90:
        severity = "none"
    elif score >= 75:
        severity = "minor"
    elif score >= 50:
        severity = "moderate"
    else:
        severity = "major"
    return {
        "overall_form_score": round(score, 1),
        "competition_valid": not comp_fail,
        "deviations": deviations,
        "severity": severity,
        "coaching_cues": cues,
    }


# ── Setup Analysis ───────────────────────────────────────────────────────────


def analyze_setup(
    landmarks_per_frame: list,
    timestamps: list[float],
    fps: float,
    exercise: str,
    view: str = "unknown",
) -> dict:
    """Analyze the setup phase from pose landmarks."""
    if len(landmarks_per_frame) < 5:
        return {"setup_score": 50, "setup_duration_seconds": 0, "coaching_cues": ["Insufficient data"]}

    # Find first rep start: first frame with significant hip movement
    hip_ys = [np.mean([lm[23].y, lm[24].y]) for lm in landmarks_per_frame]
    hip_diff = np.abs(np.diff(hip_ys))
    rep_start = len(hip_ys)
    for i, d in enumerate(hip_diff):
        if d > 0.03:
            rep_start = i
            break

    setup_frames = landmarks_per_frame[:rep_start]
    setup_duration = timestamps[min(rep_start, len(timestamps) - 1)] - timestamps[0]

    score = 100.0
    deviations = []
    cues = []

    # Bracing detection: stable period before movement
    bracing = False
    if len(setup_frames) > int(fps * 0.5):
        motion = []
        for i in range(1, len(setup_frames)):
            dx = abs(setup_frames[i][23].x - setup_frames[i - 1][23].x)
            dy = abs(setup_frames[i][23].y - setup_frames[i - 1][23].y)
            motion.append(dx + dy)
        win = int(fps * 0.5)
        for i in range(len(motion) - win):
            if np.mean(motion[i:i + win]) < 0.005:
                post = motion[i + win:i + 2 * win]
                if len(post) > 0 and np.mean(post) > np.mean(motion[i:i + win]) * 2:
                    bracing = True
                    break

    if not bracing:
        score -= 10
        deviations.append("No clear bracing detected")
        cues.append("Take a deep breath and brace your core before each set")

    # Duration
    if setup_duration < 2:
        score -= 5
        deviations.append(f"Rushed setup ({setup_duration:.1f}s)")
        cues.append("Take more time to set your stance and brace")
    elif setup_duration > 15:
        score -= 5
        deviations.append(f"Prolonged setup ({setup_duration:.1f}s)")

    # Back alignment (skipped for deadlift: gripping the bar off the floor
    # MEANS a bent-over setup — flagging it is always wrong; and skipped
    # unless the view is side-on, since torso lean is a sagittal measure).
    if (view == "side" and setup_frames
            and exercise not in ("Deadlift", "Conventional Deadlift",
                                 "Sumo Deadlift")):
        torso_angles = [_torso_angle(lm) for lm in setup_frames]
        mean_torso = min(90.0, float(np.mean(torso_angles)))
        if abs(mean_torso) > 20:
            score -= 10
            deviations.append(f"Excessive torso lean during setup ({mean_torso:.0f})")
            cues.append("Stand more upright during setup")

    return {
        "setup_score": max(0, min(100, round(score, 1))),
        "setup_duration_seconds": round(setup_duration, 1),
        "bracing_detected": bracing,
        "deviations": deviations,
        "coaching_cues": cues[:5],
    }


# ── Exercise Routing (user declaration wins) ─────────────────────────────


def route_exercise(user_name: str | None, auto_exercise: str,
                   auto_confidence: float) -> tuple[str, str, str]:
    """Pick the analyzer for a video. Returns (routed, source, auto).

    The user knows what they lifted; pose-only auto-classification cannot
    reliably distinguish bench (lying, foreshortened, leg drive) from
    standing presses/deadlifts with similar joint statistics — verified
    2026-09-18 (bench medians identical to a deadlift's). So a recognized
    user declaration always wins; auto is authoritative only when the user
    declared nothing (or nothing recognizable), and is always reported for
    calibration. Do NOT re-add pose-only bench gates without real data.
    """
    key = (user_name or "").strip().lower()

    def family(name: str) -> str:
        n = name.lower()
        if "bench" in n:
            return "Bench Press"
        if "deadlift" in n:
            return "Deadlift"
        if "squat" in n:
            return "Squat"
        if any(w in n for w in ("press", "overhead", "ohp", "log", "strict")):
            return "Overhead Press"
        if "stone" in n or "sandbag" in n:
            return "Squat"  # closest judged pattern (pick from crouch + stand)
        return ""

    user_family = family(key)
    auto_family = family(auto_exercise) if auto_confidence >= 0.6 else ""
    if user_family:
        return user_family, "user", auto_family
    if auto_family:
        return auto_family, "auto", auto_family
    return "", "none", auto_family


# ── Main Orchestrator ────────────────────────────────────────────────────────


def run_pose_analysis(
    input_path: Path,
    tmpdir: str,
    trim_start: float,
    trim_end: float,
    exercise_name: str,
    rep_count: int,
    weight_kg: float,
    view: str = "unknown",
    track: dict | None = None,
) -> dict:
    """Run the full local pose analysis pipeline. Returns a dict compatible
    with the existing run_full_analysis result format.

    rep_count doubles as the user-declared expected rep count (0/None =
    auto-detect): when positive, the deepest valid cycles are selected.

    ``track`` optionally supplies an already-extracted ``extract_pose_track``
    result (2D + world landmarks), avoiding a second pose-extraction pass.
    """
    result = {}

    # Extract pose landmarks (unless a pre-extracted track was supplied).
    if track is None:
        track = extract_pose_track(input_path, tmpdir, trim_start, trim_end, fps=10.0)
    landmarks = track["landmarks"]
    timestamps = track["timestamps"]
    if not landmarks:
        logger.warning("No pose landmarks extracted")
        return result

    # Classify exercise (auto guess) + route: user declaration wins.
    classification = classify_exercise(landmarks, timestamps)
    routed, source, auto_ex = route_exercise(
        exercise_name,
        classification["exercise"],
        classification["confidence"],
    )
    result["exercise_detected"] = routed
    result["exercise_routed_from"] = source
    result["auto_exercise"] = auto_ex
    result["exercise_variation"] = (
        classification["variation"] if routed == auto_ex and auto_ex else "")

    exercise = routed
    # Empty exercise flows through to generic-50 analysis below (same as
    # the old low-confidence fallback) rather than failing the video.

    # Detect reps (rep_count = user-declared expectation, if any)
    expected = rep_count if rep_count and rep_count > 0 else None
    reps = detect_reps_from_pose(landmarks, timestamps, exercise,
                                 expected_reps=expected)

    # Per-rep analysis
    per_rep = []
    for rep in reps:
        if exercise in ("Squat", "Front Squat", "Back Squat"):
            per_rep.append({"rep_number": rep["rep_number"], **analyze_squat_rep(landmarks, rep, view=view)})
        elif exercise == "Bench Press":
            per_rep.append({"rep_number": rep["rep_number"], **analyze_bench_rep(landmarks, rep, fps=10.0)})
        elif exercise in ("Deadlift", "Conventional Deadlift", "Sumo Deadlift"):
            per_rep.append({"rep_number": rep["rep_number"], **analyze_deadlift_rep(landmarks, rep, view=view)})
        else:
            per_rep.append({"rep_number": rep["rep_number"]})

    # Score form
    if exercise in ("Squat", "Front Squat", "Back Squat"):
        form = score_squat_form(per_rep)
    elif exercise == "Bench Press":
        form = score_bench_form(per_rep)
    elif exercise in ("Deadlift", "Conventional Deadlift", "Sumo Deadlift"):
        form = score_deadlift_form(per_rep)
    else:
        form = {"overall_form_score": 50, "competition_valid": None, "deviations": [], "severity": "unknown", "coaching_cues": []}

    result["form"] = form
    result["per_rep"] = per_rep
    result["rep_count_detected"] = len(reps)

    # Setup analysis
    result["setup"] = analyze_setup(landmarks, timestamps, fps=10.0, exercise=exercise, view=view)

    logger.info("Pose analysis: exercise=%s, %d reps, form_score=%.1f, severity=%s",
                exercise, len(reps), form["overall_form_score"], form["severity"])

    return result


# ── Pose-Based Bar Velocity ────────────────────────────────────────────────


def bar_velocity_from_pose(
    landmarks_per_frame: list,
    timestamps: list[float],
    pose_reps: list[dict],
    exercise: str,
    frame_height_px: float,
    rom_m: float,
) -> dict:
    """Bar velocity from pose landmarks — no optical flow needed.

    Sparse Lucas-Kanade cannot lock a fast bar on phone footage (motion
    blur + thin bar + busy static backgrounds: 95 tracked features measured
    0.0px median motion across a 1s window in which the bar moved 50-80px).
    The bar is rigidly coupled to the body — wrists for bench/deadlift (bar
    in hands), hips for squat (full ROM, central, rarely occluded) — and
    absolute per-frame positions neither drift nor lose lock.

    Velocity is measured per POSE rep (bottom -> top within each rep slice),
    so rep counts and velocities stay consistent with form scoring — unlike
    independent motion-signal pairing, which invents its own rep counts.

    Returns the same dict shape as track_barbell_optical_flow so callers
    (Modal step 8b, RPE, scheduler) work unchanged.
    """
    from app.integrations.video_analysis import (
        _get_vbt_zone,
        _smooth_signal,
        _velocity_loss_pct,
    )

    if (len(landmarks_per_frame) < 5 or not pose_reps
            or frame_height_px <= 0 or rom_m <= 0):
        return {"tracking_quality": "failed", "mean_concentric_velocity": 0.0}

    if exercise in ("Bench Press",):
        li, ri = (15, 16)  # wrists: bar in hands, clearly visible pressing
    else:
        li, ri = (23, 24)  # hips: full ROM, central, rarely occluded.
        # (Deadlift wrists are unusable: hands+straps+bar merge into one
        # blob that sticks to the static plates.)

    n = len(landmarks_per_frame)
    y_px = np.array([
        ((lm[li].y + lm[ri].y) / 2) * frame_height_px
        for lm in landmarks_per_frame
    ])
    ts = np.array(timestamps[:n])
    pos = _smooth_signal(y_px, window=5)

    excursion = float(np.max(pos) - np.min(pos))
    if excursion < 10:
        return {"tracking_quality": "failed", "mean_concentric_velocity": 0.0}
    ppm = excursion / rom_m

    velocities: list[float] = []
    rep_data: list[dict] = []
    for rep in pose_reps:
        si = max(0, rep["start_idx"])
        ei = min(n - 1, rep["end_idx"])
        if ei - si < 3:
            continue
        seg = pos[si:ei + 1]
        bi = int(np.argmax(seg))  # bottom = largest y (image coords)
        top_seg = seg[bi:]
        ti = bi + int(np.argmin(top_seg))  # first top after the bottom
        if ti <= bi:
            continue
        amp_px = float(seg[bi] - seg[ti])
        dt = float(ts[si + ti] - ts[si + bi])
        if dt <= 0:
            continue
        amp_m = amp_px / ppm if ppm > 0 else 0.0
        if amp_m < 0.10:  # partial/shallow slice, not a measurable rep
            continue
        v = amp_m / dt
        velocities.append(round(v, 3))
        rep_data.append({
            "rep_number": rep["rep_number"],
            "start_time": round(float(ts[si + bi]), 2),
            "end_time": round(float(ts[si + ti]), 2),
            "concentric_time": round(dt, 2),
            "amplitude_px": round(amp_px, 1),
            "amplitude_m": round(amp_m, 3),
            "concentric_velocity_ms": round(v, 3),
        })

    result = {
        "tracking_quality": "pose",
        "frame_count": n,
        "pixels_per_meter": round(ppm, 1),
        "rep_timings": rep_data,
        "velocities": velocities,
    }
    if velocities:
        mean_v = sum(velocities) / len(velocities)
        result["mean_concentric_velocity"] = round(mean_v, 3)
        result["peak_velocity"] = round(max(velocities), 3)
        if len(velocities) >= 2:
            result["velocity_loss_pct"] = _velocity_loss_pct(
                velocities[0], velocities[-1])
            result["vbt_zone"] = _get_vbt_zone(exercise, mean_v)
    else:
        # No measurable reps (slices below amplitude floor): report failure
        # so callers fall back to optical flow instead of storing 0.0.
        result["tracking_quality"] = "failed"
        result["mean_concentric_velocity"] = 0.0
        result["peak_velocity"] = 0.0
    return result


def _is_leg_lift(exercise: str) -> bool:
    return exercise in (
        "Squat", "Front Squat", "Back Squat",
        "Deadlift", "Conventional Deadlift", "Sumo Deadlift",
    )


def _velocity_tracked_indices(exercise: str) -> tuple[int, int]:
    """Landmark pair whose vertical motion best tracks the bar for lifts
    where the bar moves relative to the torso (presses, bench, stone)."""
    return 15, 16  # wrists


def _midpoint(w, a: int, b: int) -> np.ndarray:
    return np.array([(w[a].x + w[b].x) / 2, (w[a].y + w[b].y) / 2,
                     (w[a].z + w[b].z) / 2])


def _hip_ankle_distance(w) -> float:
    """Hip-centre to ankle-centre distance (metres).

    MediaPipe world landmarks are hip-centred, so global body translation
    (the thing bar velocity needs) is removed — the hip sits at the origin
    and never moves. But for squat/deadlift the hip's vertical travel equals
    the change in hip-to-ankle distance (the legs extend/compress against
    the planted foot), which IS measurable. Verified: world hip-y range
    0.003 m vs ankle-y range 0.49 m over a deep squat.
    """
    hip = _midpoint(w, 23, 24)
    ankle = _midpoint(w, 27, 28)
    return float(np.linalg.norm(hip - ankle))


def bar_velocity_from_world(
    world_frames: list,
    timestamps: list[float],
    pose_reps: list[dict],
    exercise: str,
    min_amplitude_m: float = 0.10,
) -> dict:
    """Metric bar velocity from MediaPipe world landmarks (metres).

    World landmarks are already in metres (hip-origin), so no
    pixels-per-metre guessing or hardcoded ROM is needed — the failure mode
    that made single-rep squats read 0.087-0.098 m/s (real ≈0.2-0.5) and
    produced negative velocity loss.

    Returns one ``rep_timings`` entry per input pose rep (velocity possibly
    ``None`` for a slice with no measurable concentric phase) so form and
    velocity rep counts always agree — the old function silently dropped
    reps, so 1/3 of production videos had mismatched counts.
    """
    from app.integrations.video_analysis import (
        _get_vbt_zone,
        _smooth_signal,
        _velocity_loss_pct,
    )

    n = min(len(world_frames), len(timestamps))
    if n < 5 or not pose_reps:
        return {"tracking_quality": "failed", "mean_concentric_velocity": 0.0}

    if _is_leg_lift(exercise):
        # Leg extension recovers the hip's vertical travel (bar travels with
        # the hips in squat/deadlift); hip y itself is the world origin.
        sig = np.array([_hip_ankle_distance(w) for w in world_frames[:n]])
    else:
        li, ri = _velocity_tracked_indices(exercise)
        sig = np.array([(w[li].y + w[ri].y) / 2 for w in world_frames[:n]])
    ts = np.array(timestamps[:n])
    pos = _smooth_signal(sig, window=3)

    velocities: list[float] = []
    rep_data: list[dict] = []
    for rep in pose_reps:
        si = max(0, rep["start_idx"])
        ei = min(n - 1, rep["end_idx"])
        entry = {
            "rep_number": rep["rep_number"],
            "start_time": None,
            "end_time": None,
            "concentric_time": None,
            "amplitude_m": None,
            "concentric_velocity_ms": None,
        }
        # Prefer the joint-angle detector's bottom/top frames (robust);
        # only fall back to re-finding extrema on the world signal.
        bi = rep.get("bottom_idx")
        ti = rep.get("top_idx")
        if bi is None or ti is None:
            if ei - si >= 3:
                seg = pos[si:ei + 1]
                bi = si + int(np.argmax(seg))
                ti = bi + int(np.argmin(pos[bi:ei + 1]))
            else:
                bi = ti = None
        if bi is not None and ti is not None and 0 <= bi < ti < n:
            # leg mode: distance is max at the top; wrist mode: y grows down
            amp_m = abs(float(pos[bi] - pos[ti]))
            dt = float(ts[ti] - ts[bi])
            if dt > 0 and amp_m >= min_amplitude_m:
                v = amp_m / dt
                velocities.append(round(v, 3))
                entry.update({
                    "start_time": round(float(ts[bi]), 2),
                    "end_time": round(float(ts[ti]), 2),
                    "concentric_time": round(dt, 2),
                    "amplitude_m": round(amp_m, 3),
                    "concentric_velocity_ms": round(v, 3),
                })
        rep_data.append(entry)

    result: dict = {
        "tracking_quality": "pose",
        "frame_count": n,
        "rep_timings": rep_data,
        "velocities": velocities,
    }
    if velocities:
        mean_v = sum(velocities) / len(velocities)
        result["mean_concentric_velocity"] = round(mean_v, 3)
        result["peak_velocity"] = round(max(velocities), 3)
        result["vbt_zone"] = _get_vbt_zone(exercise, mean_v)
        if len(velocities) >= 2:
            result["velocity_loss_pct"] = _velocity_loss_pct(
                velocities[0], velocities[-1])
    else:
        result["tracking_quality"] = "failed"
        result["mean_concentric_velocity"] = 0.0
        result["peak_velocity"] = 0.0
    return result
