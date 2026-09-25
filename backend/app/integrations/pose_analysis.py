"""Local pose-based video analysis for powerlifting form (§3.18).

All functions are pure — no DB access, no FastAPI deps.
Runs inside the Modal container with mediapipe + opencv + numpy.

Replaces Gemini Vision calls with deterministic rule-based evaluation.
"""

from __future__ import annotations

import itertools
import logging
import subprocess
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)


# ── MediaPipe Pose Extraction ────────────────────────────────────────────────


class _Lm:
    """Minimal landmark shim (x, y, z, visibility) for anchored feet.

    MediaPipe's NormalizedLandmark protos aren't safely mutable, so anchored
    foot landmarks are rebuilt as shims. Downstream code only reads
    .x/.y/.z/.visibility, so they are drop-in replacements.
    """

    __slots__ = ("visibility", "x", "y", "z")

    def __init__(self, x, y, z=0.0, visibility=1.0):
        self.x = x
        self.y = y
        self.z = z
        self.visibility = visibility


# Ankles, heels and foot indices — planted during the squat/bench/deadlift.
_PLANTED_FOOT_IDX = (27, 28, 29, 30, 31, 32)


def stabilize_planted_feet(
    landmarks_per_frame: list,
    window: int = 7,
    min_frames: int = 5,
) -> list:
    """Smooth the foot landmarks with a rolling median (overlay rendering).

    During the squat/bench/deadlift the feet are planted, so high-frequency
    wander in the foot landmarks is tracking noise. A rolling median removes
    that jitter while preserving genuine low-frequency motion (walkout,
    stepping): a planted foot collapses to its (constant) median, and a moving
    foot is followed smoothly rather than pinned.

    Applied to the overlay/sprite renderers only — NOT to the analysis path:
    the knee-angle signal is already median-filtered, and snapping the ankle
    measurably perturbed rep detection (verified via the eval harness), so the
    analysis keeps the raw landmarks.

    Returns a new frame list; the input is not mutated.
    """
    n = len(landmarks_per_frame)
    if n < min_frames:
        return landmarks_per_frame

    smoothed = {
        idx: (
            _median_filter([lm[idx].x for lm in landmarks_per_frame], window),
            _median_filter([lm[idx].y for lm in landmarks_per_frame], window),
        )
        for idx in _PLANTED_FOOT_IDX
    }

    out = []
    for i, lm in enumerate(landmarks_per_frame):
        frame = list(lm)
        for idx, (xs, ys) in smoothed.items():
            src = lm[idx]
            frame[idx] = _Lm(
                float(xs[i]), float(ys[i]),
                getattr(src, "z", 0.0),
                getattr(src, "visibility", 1.0),
            )
        out.append(frame)
    return out


def _frame_presence(lm) -> float:
    """Mean landmark presence (falls back to visibility) for one pose frame."""
    vals: list[float] = []
    for point in lm:
        p = getattr(point, "presence", None)
        if p is None:
            p = getattr(point, "visibility", None)
        if p is not None:
            vals.append(float(p))
    return float(sum(vals) / len(vals)) if vals else 0.0


def extract_pose_track(
    input_path: Path,
    tmpdir: str,
    trim_start: float,
    trim_end: float,
    fps: float = 10.0,
    num_poses: int = 1,
    select: bool = True,
    exercise: str | None = None,
    bar_xy: list | None = None,
    forced_track_id: int | None = None,
    gpu_delegate: bool = False,
) -> dict:
    """Extract MediaPipe Pose landmarks (2D + metric 3D) from a video segment.

    Uses the mediapipe.tasks API (PoseLandmarker) — the solutions API
    was removed in mediapipe >= 0.10.30.

    With ``num_poses > 1`` every detected person is tracked across frames
    (``person_tracking.build_person_tracks``) and the lifter is chosen over a
    spotter/bystander (``select_lifter``); the primary lists below then carry
    the *lifter's* track. Pass ``exercise`` (e.g. ``"Bench Press"``) to enable
    the posture prior, and ``bar_xy`` (aligned to frame index) for bar
    coupling once bar tracking exists.

    Returns a dict:
        landmarks:  list per detected lifter frame of 33 normalised 2D landmarks
        world:      list aligned 1:1 with ``landmarks`` of 33 metric 3D world
                    landmarks (metres, hip-origin), or ``None`` for a frame
                    where the model omitted them
        timestamps: per-frame timestamps in seconds (aligned to ``landmarks``)
        presence:   per-frame mean landmark presence (aligned to ``landmarks``)
        records:    per-frame dicts ``{frame_idx, t, landmarks, world,
                    presence}`` (aligned to ``landmarks``)
        persons:    per-track summaries ``{id, n, coverage}``
        tracks:     full track objects (for re-selection once exercise is known)
        lifter:     selection info ``{source, chosen_track_id, n_tracks,
                    candidates}``
        frame_times: ``{sampled_frame_idx: timestamp}``
        detected:   number of frames with the lifter's pose
        frames:     number of frames sampled
        num_poses:  poses requested per frame

    ``world`` is always the same length as ``landmarks`` (``None``-padded), so
    index ``i`` refers to the same frame across every list. The previous
    implementation appended to ``world`` only when the model emitted world
    landmarks, so a single 2D-but-no-world frame silently shifted every later
    world index — corrupting velocity for the rest of the clip.
    """
    import cv2
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    from app.integrations.person_tracking import (
        bbox_from_landmarks,
        build_person_tracks,
        dense_series,
        select_lifter,
    )

    num_poses = max(1, int(num_poses))

    segment_duration = trim_end - trim_start
    if segment_duration <= 0:
        return {
            "landmarks": [], "world": [], "timestamps": [], "presence": [],
            "records": [], "detected": 0, "frames": 0, "persons": [],
            "tracks": [], "lifter": {"source": "none", "n_tracks": 0, "candidates": []},
            "frame_times": {}, "num_poses": num_poses, "pose_frames": 0,
        }

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
    # T2: `gpu_delegate=True` opts into the GPU delegate (needs EGL + a GPU
    # Modal worker + mediapipe>=0.10.32) so a flat 30–60 fps stays affordable.
    delegate = (
        BaseOptions.Delegate.GPU if gpu_delegate else BaseOptions.Delegate.CPU
    )
    base_options = BaseOptions(
        model_asset_path=str(model_path),
        delegate=delegate,
    )
    options = vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=vision.RunningMode.VIDEO,
        num_poses=num_poses,
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

    persons_by_frame: dict[int, list[dict]] = {}
    frame_times: dict[int, float] = {}
    frame_interval = 1.0 / fps
    idx = 0
    world_count = 0

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
            # pose_landmarks is a list (one entry per person) of 33 landmarks
            world_lms = result.pose_world_landmarks or []
            persons: list[dict] = []
            for pi, lm in enumerate(result.pose_landmarks):
                world = world_lms[pi] if pi < len(world_lms) else None
                if world is not None:
                    world_count += 1
                persons.append({
                    "landmarks": lm,
                    "world": world,
                    "presence": round(_frame_presence(lm), 4),
                    "bbox": bbox_from_landmarks(lm),
                })
            t = trim_start + (idx * frame_interval) + (frame_interval / 2)
            persons_by_frame[idx] = persons
            frame_times[idx] = round(min(t, trim_end), 3)

        idx += 1

    pose_landmarker.close()

    det_frame_idxs = sorted(persons_by_frame.keys())

    if num_poses == 1:
        # Single-person path: keep the historical behaviour exactly — one
        # dense series over every frame with a pose, no track association
        # (association could split one person across a long gap).
        tracks: list[dict] = []
        selection: dict = {
            "source": "single", "chosen_track_id": 0,
            "n_tracks": 1 if det_frame_idxs else 0, "candidates": [],
        }
        landmarks = [persons_by_frame[i][0]["landmarks"] for i in det_frame_idxs]
        world = [persons_by_frame[i][0]["world"] for i in det_frame_idxs]
        presence = [persons_by_frame[i][0]["presence"] for i in det_frame_idxs]
        timestamps = [frame_times[i] for i in det_frame_idxs]
        persons_summary: list[dict] = []
    else:
        tracks = build_person_tracks(
            [persons_by_frame[i] for i in det_frame_idxs],
            frame_indices=det_frame_idxs,
        )
        lifter = None
        selection = {"source": "none", "n_tracks": len(tracks), "candidates": []}
        if tracks:
            if select:
                lifter, selection = select_lifter(
                    tracks, idx, exercise=exercise, bar_xy=bar_xy,
                    forced_track_id=forced_track_id)
            else:
                lifter = tracks[0]
                selection = {
                    "source": "single" if len(tracks) == 1 else "largest",
                    "chosen_track_id": lifter["id"],
                    "n_tracks": len(tracks),
                    "candidates": [],
                }
        if lifter is None:
            logger.info("Pose landmarks: none detected in %d frames", idx)
            return {
                "landmarks": [], "world": [], "timestamps": [], "presence": [],
                "records": [], "detected": 0, "frames": idx, "persons": [],
            "tracks": [], "lifter": selection, "frame_times": frame_times,
            "num_poses": num_poses, "pose_frames": 0,
        }
        landmarks, world, timestamps, presence = dense_series(lifter, frame_times)
        det_frame_idxs = sorted(lifter["detections"].keys())
        persons_summary = [
            {"id": t["id"], "n": t["n"], "coverage": round(t["n"] / max(idx, 1), 3)}
            for t in tracks
        ]

    records = [
        {
            "frame_idx": fi,
            "t": timestamps[k],
            "landmarks": landmarks[k],
            "world": world[k],
            "presence": presence[k],
        }
        for k, fi in enumerate(det_frame_idxs)
    ]

    logger.info(
        "Pose landmarks: %d/%d frames (%d with world landmarks), "
        "%d person track(s), lifter=%s (%s)",
        len(landmarks), idx, world_count, len(tracks),
        selection.get("chosen_track_id"), selection.get("source"),
    )
    return {
        "landmarks": landmarks,
        "world": world,
        "timestamps": timestamps,
        "presence": presence,
        "records": records,
        "detected": len(landmarks),
        "frames": idx,
        "persons": persons_summary,
        "tracks": tracks,
        "lifter": selection,
        "frame_times": frame_times,
        "num_poses": num_poses,
        # Frames where *any* pose was detected (not just the selected lifter) —
        # the pose-detection quality signal. For bench-with-spotter the lifter
        # is only present for part of the clip, so using the lifter's frame
        # count as "detection rate" would wrongly report "unusable".
        "pose_frames": len(persons_by_frame),
        # Extraction rate — rep detection scales its frame windows by this.
        "fps": fps,
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


def reselect_lifter(
    track: dict,
    exercise: str | None = None,
    bar_xy: list | None = None,
    forced_track_id: int | None = None,
) -> dict:
    """Re-pick the lifter on an extracted multi-person track and rebuild the
    primary lists (landmarks/world/timestamps/presence/records).

    ``extract_pose_track`` picks a default lifter before the exercise is
    known; once classification is available (the bench posture prior needs
    it) call this to re-select. ``forced_track_id`` (a user override) wins.
    No-op when the track holds ≤1 person.
    """
    from app.integrations.person_tracking import dense_series, select_lifter

    tracks = track.get("tracks") or []
    if len(tracks) <= 1:
        return track

    frame_times = track.get("frame_times") or {}
    n_frames = int(track.get("frames") or 0)
    lifter, selection = select_lifter(
        tracks, n_frames, exercise=exercise, bar_xy=bar_xy,
        forced_track_id=forced_track_id,
    )
    if lifter is None:
        return track

    landmarks, world, timestamps, presence = dense_series(lifter, frame_times)
    det_idxs = sorted(lifter["detections"].keys())
    updated = dict(track)
    updated.update({
        "landmarks": landmarks,
        "world": world,
        "timestamps": timestamps,
        "presence": presence,
        "detected": len(landmarks),
        "lifter": selection,
        "records": [
            {
                "frame_idx": fi,
                "t": timestamps[k],
                "landmarks": landmarks[k],
                "world": world[k],
                "presence": presence[k],
            }
            for k, fi in enumerate(det_idxs)
        ],
    })
    logger.info(
        "Lifter re-selected: track=%s (%s) exercise=%s",
        selection.get("chosen_track_id"), selection.get("source"), exercise,
    )
    return updated


# ── Pose Overlay Rendering ───────────────────────────────────────────────────

_SKELETON_EDGES = (
    (11, 12), (11, 23), (12, 24), (23, 24),
    (11, 13), (13, 15), (12, 14), (14, 16),
    (23, 25), (25, 27), (27, 29), (29, 31),
    (24, 26), (26, 28), (28, 30), (30, 32),
)

_MAX_TRAIL_POINTS = 200


def _tracked_bar_point(lm, exercise: str) -> tuple[float, float]:
    """2D normalised bar-tracking point (matches bar_velocity_from_world)."""
    if exercise in ("Squat", "Front Squat", "Back Squat"):
        return ((lm[11].x + lm[12].x) / 2, (lm[11].y + lm[12].y) / 2)
    return ((lm[15].x + lm[16].x) / 2, (lm[15].y + lm[16].y) / 2)


def _draw_skeleton(frame, lm, w: int, h: int) -> None:
    """Draw the 33-landmark skeleton onto ``frame`` in place (yellow)."""
    import cv2

    for a, b in _SKELETON_EDGES:
        if lm[a].visibility > 0.3 and lm[b].visibility > 0.3:
            cv2.line(
                frame,
                (int(lm[a].x * w), int(lm[a].y * h)),
                (int(lm[b].x * w), int(lm[b].y * h)),
                (0, 255, 255), 2,
            )
    for k in range(33):
        if lm[k].visibility > 0.3:
            cv2.circle(
                frame, (int(lm[k].x * w), int(lm[k].y * h)),
                3, (0, 255, 255), -1,
            )


def render_rep_sprite(
    input_path: Path,
    landmarks: list,
    timestamps: list[float],
    pose_reps: list[dict],
    out_path: Path,
    time_offset: float = 0.0,
    tile_w: int = 220,
) -> bool:
    """Tile each rep's bottom frame (skeleton drawn) into one JPEG.

    A single image (one presigned PUT) gives an at-a-glance view of every
    rep's depth/position without scrubbing the overlay video. Returns True on
    success; never raises.
    """
    import cv2

    try:
        n = min(len(landmarks), len(timestamps))
        if n == 0 or not pose_reps:
            return False
        landmarks = stabilize_planted_feet(landmarks[:n])
        cap = cv2.VideoCapture(str(input_path))
        if not cap.isOpened():
            return False
        vid_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if w <= 0 or h <= 0:
            cap.release()
            return False

        ts = list(timestamps[:n])
        tiles = []
        for rep in pose_reps:
            bi = rep.get("bottom_idx")
            if bi is None or bi >= n:
                continue
            frame_i = int(round((ts[bi] - time_offset) * vid_fps))
            cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, frame_i))
            ok, frame = cap.read()
            if not ok:
                continue
            _draw_skeleton(frame, landmarks[bi], w, h)
            cv2.putText(frame, f"R{rep['rep_number']}", (10, 42),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.3, (255, 255, 255), 3)
            scale = tile_w / w
            tiles.append(cv2.resize(frame, (tile_w, int(h * scale))))
        cap.release()
        if not tiles:
            return False

        tile_h = tiles[0].shape[0]
        sprite = np.zeros((tile_h, tile_w * len(tiles), 3), dtype=np.uint8)
        for k, tile in enumerate(tiles):
            sprite[:, k * tile_w:(k + 1) * tile_w] = tile
        return bool(cv2.imwrite(str(out_path), sprite))
    except Exception as e:
        logger.warning("Rep sprite render failed: %s", e)
        return False


def render_overlay_video(
    input_path: Path,
    landmarks: list,
    timestamps: list[float],
    out_path: Path,
    time_offset: float = 0.0,
    exercise: str = "",
    fps: float = 30.0,
) -> bool:
    """Render a skeleton + bar-path overlay onto a video.

    Draws the MediaPipe skeleton and the bar-tracking point trail so the user
    can see what the analyzer saw. ``timestamps`` are absolute (source-video)
    times; ``time_offset`` is the source start time of ``input_path`` (the
    trim start), so output frame time t maps to source time t + offset.

    Returns True on success; never raises (a failed overlay must not fail the
    analysis).
    """
    import bisect
    import subprocess

    import cv2

    try:
        n = min(len(landmarks), len(timestamps))
        if n == 0:
            return False
        landmarks = stabilize_planted_feet(landmarks[:n])
        cap = cv2.VideoCapture(str(input_path))
        if not cap.isOpened():
            return False
        vid_fps = cap.get(cv2.CAP_PROP_FPS) or fps
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if w <= 0 or h <= 0:
            cap.release()
            return False

        ts = list(timestamps[:n])
        raw_path = Path(str(out_path) + ".raw.mp4")
        writer = cv2.VideoWriter(
            str(raw_path), cv2.VideoWriter_fourcc(*"mp4v"), vid_fps, (w, h))
        if not writer.isOpened():
            cap.release()
            return False

        trail: list[tuple[int, int]] = []
        i = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            t = time_offset + (i / vid_fps)
            j = bisect.bisect_left(ts, t)
            if j >= n:
                j = n - 1
            elif j > 0 and abs(ts[j - 1] - t) <= abs(ts[j] - t):
                j -= 1
            lm = landmarks[j]
            _draw_skeleton(frame, lm, w, h)
            bx, by = _tracked_bar_point(lm, exercise)
            point = (int(bx * w), int(by * h))
            trail.append(point)
            if len(trail) > _MAX_TRAIL_POINTS:
                trail.pop(0)
            for k in range(1, len(trail)):
                cv2.line(frame, trail[k - 1], trail[k], (255, 0, 255), 2)
            cv2.circle(frame, point, 6, (255, 0, 255), -1)
            writer.write(frame)
            i += 1

        cap.release()
        writer.release()

        # Re-encode to H.264 so browsers can play it.
        result = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw_path),
             "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
             "-movflags", "+faststart", str(out_path)],
            capture_output=True, timeout=300, check=False,
        )
        raw_path.unlink(missing_ok=True)
        return result.returncode == 0 and Path(out_path).exists()
    except Exception as e:
        logger.warning("Overlay render failed: %s", e)
        return False


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

    # Hand height relative to the shoulders — the squat/deadlift discriminator.
    # A squat's hands stay on the bar at the shoulders; a deadlift's hands hang
    # to the bar at the floor. View-tolerant (vertical ordering survives ¾ /
    # behind cameras), unlike torso lean.
    mean_wrist_below_shoulder = float(np.mean([
        ((lm[15].y + lm[16].y) / 2) - ((lm[11].y + lm[12].y) / 2)
        for lm in landmarks_per_frame
    ]))
    # Calibrated on the labelled set: squats read ≈0.00, deadlifts ≈0.10–0.12.
    hands_low = mean_wrist_below_shoulder > 0.05

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
    elif hip_range > 35 and knee_range > 30:
        # Both a squat and a deadlift move hips + knees through large ranges,
        # so they used to be split by torso lean — which a ¾/behind view
        # inflates, mislabelling most squats as deadlifts (2026-09-23: 5/7 on
        # the labelled set). Hand height separates them cleanly and
        # view-tolerantly (lean is no longer used — it mislabelled squats).
        if hands_low:
            exercise = "Deadlift"
            knee_x_spread = np.mean(
                [abs(lm[25].x - lm[26].x) for lm in landmarks_per_frame])
            variation = (
                "Sumo Deadlift" if knee_x_spread > 0.2 else "Conventional Deadlift"
            )
        else:
            exercise = "Squat"
            if mean_sh_diff > 0.05:
                variation = "Front Squat"
            else:
                # Low vs high bar by median torso lean across the set:
                # low-bar lifters ride 25-35°+ inclined throughout, high-bar
                # stay ~10-20°. Form thresholds are bar-style agnostic (lean
                # is measured at the standing top), so this is labeling only.
                med_lean = float(np.median(
                    [_torso_angle(lm) for lm in landmarks_per_frame]))
                variation = "Low Bar Squat" if med_lean > 22 else "High Bar Squat"
        confidence = min(0.95, 0.7 + (hip_range + knee_range) / 400)
    elif elbow_range > 50 and hip_range < 15 and knee_range < 15:
        exercise = "Bench Press"
        confidence = min(0.95, 0.7 + elbow_range / 200)
    elif elbow_range > 40 and hip_range < 10:
        exercise = "Overhead Press"
        confidence = min(0.90, 0.6 + elbow_range / 200)

    return {"exercise": exercise, "confidence": round(confidence, 2), "variation": variation}


# ── Camera View Detection ────────────────────────────────────────────────────

# Calibrated against the labelled fixtures (2026-09-23): the true side-on squat
# reads shoulder/torso ratio 0.30, while ¾ clips read 0.35–0.96. 0.32 separates
# them (0.50 called the 0.35 ¾ squat "side", enabling sagittal rules wrongly).
VIEW_SIDE_MAX_RATIO = 0.32
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

_LEG_EXERCISES = (
    "Squat", "Front Squat", "Back Squat", "Deadlift",
    "Conventional Deadlift", "Sumo Deadlift", "Stone",
)


def _rep_signal(landmarks_per_frame: list, exercise: str, window: int):
    """Return ``(signal, is_angle)`` for rep detection.

    Legs → knee angle; overhead presses → elbow angle; **bench press → the
    barbell height (wrist-y)**. The bench lifter is horizontal and, with a
    spotter present, its multi-person track is fragmented — the elbow
    landmarks are too noisy to segment reps, but the bar (wrists) stays
    legible. The bar-height signal is normalised to an angle-like 0–180 scale
    so the shared prominence/amplitude gates apply.
    """
    ex = exercise or ""
    if ex == "Bench Press":
        raw = [-float(_mid(lm, 15, 16)[1]) for lm in landmarks_per_frame]
    elif ex in _LEG_EXERCISES or "stone" in ex.lower() or "sandbag" in ex.lower():
        raw = [
            calculate_angle(_mid(lm, 23, 24), _mid(lm, 25, 26), _mid(lm, 27, 28))
            for lm in landmarks_per_frame
        ]
    else:
        raw = [
            calculate_angle(_mid(lm, 11, 12), _mid(lm, 13, 14), _mid(lm, 15, 16))
            for lm in landmarks_per_frame
        ]

    signal = _median_filter(raw, window=window)
    if ex == "Bench Press":
        lo, hi = float(np.min(signal)), float(np.max(signal))
        if hi - lo > 1e-6:
            signal = (signal - lo) / (hi - lo) * 180.0
        return signal, False
    return signal, True


def detect_reps_from_pose(
    landmarks_per_frame: list,
    timestamps: list[float],
    exercise: str,
    expected_reps: int | None = None,
    fps: float = 10.0,
) -> list[dict]:
    """Detect individual reps from pose landmark sequence.

    Uses joint angle oscillation to find rep boundaries.
    Returns list of per-rep dicts with start/end indices.

    expected_reps (user-declared at upload, for calibration): when given,
    the largest-amplitude valid cycles are selected instead of all valid
    cycles — setup dips, walkout shuffles and rerack bends all oscillate
    but span less ROM than the working rep(s). Without it, every valid
    cycle is returned (legacy behavior).

    ``fps`` scales the frame-based smoothing/gap windows so a higher-fps
    track is filtered over the same wall-clock span (7 frames @10 fps →
    21 @30 fps). Without it, 30 fps extraction smoothed ~3× less and dropped
    reps (8 → 7 on the labelled 8-rep squat).
    """
    if len(landmarks_per_frame) < 5:
        return []

    # Frame-based windows scale with fps so smoothing/gaps are ~constant in
    # seconds regardless of extraction rate (7 frames @10 fps ≈ 0.7 s).
    _win = max(3, int(round(0.7 * fps)) | 1)
    _min_gap = max(3, int(round(0.3 * fps)))

    # Build the rep signal (knee angle / elbow angle / bench bar-height).
    signal, angle_signal = _rep_signal(landmarks_per_frame, exercise, _win)

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
                if _prom(i, False) >= 25.0
                and (not angle_signal or signal[i] >= 30.0)]

    # Each kept bottom gets the nearest kept top on each side as bounds
    # (falling back to the signal ends for videos starting/ending mid-rep).
    # Slices sharing identical bounds are deduped, keeping the deeper one.
    candidates: dict[tuple[int, int], tuple[float, int]] = {}
    for mi in kept_min:
        left = [m for m in kept_max if m < mi]
        right = [m for m in kept_max if m > mi]
        start = left[-1] if left else 0
        end = right[0] if right else len(signal) - 1
        if end - start < _min_gap:
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
        if angle_signal and seg_min < 30.0:
            # Glitch-contaminated slice (beyond max joint flexion, always
            # an occlusion gap, never a real bottom). Only meaningful for
            # joint-angle signals.
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
            # Pick the best CONSECUTIVE run of the declared length, not the
            # globally largest cycles. A working set is contiguous; picking
            # by amplitude globally could grab a setup/walk-in cycle from
            # elsewhere in the video (which the untrimmed fallback exposes).
            best_i, best_score = 0, -1.0
            for i in range(len(reps) - expected_reps + 1):
                score = sum(r["amplitude"] for r in reps[i:i + expected_reps])
                if score > best_score:
                    best_score, best_i = score, i
            reps = reps[best_i:best_i + expected_reps]
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


def _squat_lockout(
    knee_angle_top: float, hip_angle_top: float, view: str
) -> tuple[bool, bool]:
    """Return (lockout_complete, lockout_soft).

    The hip-extension test is sagittal: a low-bar squat's forward torso lean
    (and any non-side camera, which foreshortens the hip angle) reads ~147°
    while genuinely standing, below the 160° threshold. Verified: low-bar
    singles 140/130 kg read top_hip 147-148 standing (falsely "soft
    lockout"), high-bar 150 kg reads 170. So only assess hip extension on a
    side view; otherwise lockout = knees locked (reliable from any angle).
    """
    if view == "side":
        lockout = knee_angle_top > 160 and hip_angle_top > 160
        return lockout, (not lockout and knee_angle_top > 160)
    return knee_angle_top > 160, False


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
    lockout, soft_lockout = _squat_lockout(knee_angle_top, hip_angle_top, view)
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


def _deadlift_lockout(landmarks, view: str = "unknown") -> bool:
    hip_angle = calculate_angle(_mid(landmarks, 11, 12), _mid(landmarks, 23, 24), _mid(landmarks, 25, 26))
    knee_angle = calculate_angle(_mid(landmarks, 23, 24), _mid(landmarks, 25, 26), _mid(landmarks, 27, 28))
    shoulder_y = np.mean([landmarks[11].y, landmarks[12].y])
    hip_y = np.mean([landmarks[23].y, landmarks[24].y])
    # 160° admits pose jitter on true lockouts (see squat lockout note).
    # The hip-angle test is sagittal — only applied on a side view.
    if view == "side":
        return hip_angle > 160 and knee_angle > 160 and shoulder_y < hip_y
    return knee_angle > 160 and shoulder_y < hip_y


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

    lockout = _deadlift_lockout(top_lm, view)
    top_hip_angle = calculate_angle(_mid(top_lm, 11, 12), _mid(top_lm, 23, 24), _mid(top_lm, 25, 26))
    top_knee_angle = calculate_angle(_mid(top_lm, 23, 24), _mid(top_lm, 25, 26), _mid(top_lm, 27, 28))
    # Soft tier mirrors squat: knees locked but finish soft (common on
    # touch-and-go sets that never stand tall between reps). Counts with
    # a cue instead of failing the rep. Hip extension is sagittal — only
    # assessed on a side view.
    soft_lockout = (view == "side" and not lockout and top_knee_angle > 160
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


def _is_press(exercise: str) -> bool:
    """Overhead/standing press family (never bench, which is its own lift)."""
    n = (exercise or "").lower()
    return "bench" not in n and any(w in n for w in ("press", "ohp", "strict"))


def _is_pull(exercise: str) -> bool:
    """Pull-up / chin-up / row family."""
    n = (exercise or "").lower()
    return any(w in n for w in ("pull", "chin", "row"))


def analyze_pull_rep(all_landmarks: list, rep: dict, view: str = "unknown") -> dict:
    """Vertical pull (pull-up/chin-up/row): judged on full range of motion.

    Bottom = arms extended (elbow ~180°), top = arms flexed (elbow small).
    """
    si, ei = rep["start_idx"], rep["end_idx"]
    n = len(all_landmarks)
    idxs = list(range(si, min(ei, n)))
    if not idxs:
        return {"full_rom": False, "bottom_elbow": None, "top_elbow": None}
    evals = _median_filter([
        calculate_angle(_mid(all_landmarks[i], 11, 12),
                        _mid(all_landmarks[i], 13, 14),
                        _mid(all_landmarks[i], 15, 16))
        for i in idxs
    ])
    vis = (11, 12, 13, 14, 15, 16)
    bot_lm = all_landmarks[_best_extremum(all_landmarks, idxs, evals, vis, want_max=True)]
    top_lm = all_landmarks[_best_extremum(all_landmarks, idxs, evals, vis, want_max=False)]
    bottom_elbow = calculate_angle(
        _mid(bot_lm, 11, 12), _mid(bot_lm, 13, 14), _mid(bot_lm, 15, 16))
    top_elbow = calculate_angle(
        _mid(top_lm, 11, 12), _mid(top_lm, 13, 14), _mid(top_lm, 15, 16))
    return {
        "full_rom": bool(bottom_elbow > 160 and top_elbow < 70),
        "bottom_elbow": round(float(bottom_elbow), 1),
        "top_elbow": round(float(top_elbow), 1),
    }


def analyze_press_rep(all_landmarks: list, rep: dict, view: str = "unknown") -> dict:
    """Overhead press: the judged criterion is a locked-out elbow at the top.

    (Layback/bar-path are sagittal and need a side view; not assessed yet.)
    """
    si, ei = rep["start_idx"], rep["end_idx"]
    n = len(all_landmarks)
    idxs = list(range(si, min(ei, n)))
    if not idxs:
        return {"lockout_complete": False, "top_elbow_angle": None}
    evals = _median_filter([
        calculate_angle(_mid(all_landmarks[i], 11, 12),
                        _mid(all_landmarks[i], 13, 14),
                        _mid(all_landmarks[i], 15, 16))
        for i in idxs
    ])
    top_lm = all_landmarks[_best_extremum(
        all_landmarks, idxs, evals, (11, 12, 13, 14, 15, 16), want_max=True)]
    top_elbow = calculate_angle(
        _mid(top_lm, 11, 12), _mid(top_lm, 13, 14), _mid(top_lm, 15, 16))
    return {
        "lockout_complete": bool(top_elbow > 160),
        "top_elbow_angle": round(float(top_elbow), 1),
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


# Forward lean (torso angle from upright, degrees) above which a squat rep is
# flagged "excessive". Real squat lean runs ~20–40° (low-bar especially), so
# the old 10° threshold flagged almost every squat — a clean 150 kg squat read
# 11° and was penalised. Tune against the labelled set when calibrating.
_SQUAT_EXCESSIVE_LEAN_DEG = 30.0


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
        if back_dev is not None and back_dev > _SQUAT_EXCESSIVE_LEAN_DEG:
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


def score_press_form(per_rep: list[dict]) -> dict:
    deviations = []
    comp_fail = False
    cues = []
    rep_scores = []

    for r in per_rep:
        rn = r["rep_number"]
        penalty = 0.0
        if not r.get("lockout_complete", True):
            penalty += 25
            comp_fail = True
            deviations.append(f"Rep {rn}: Press not locked out")
            cues.append(COACHING_CUES.get(
                "incomplete_lockout", "Lock the elbows out overhead"))
        rep_scores.append(100.0 - penalty)

    return _form_result(_average_rep_scores(rep_scores), comp_fail, deviations, list(dict.fromkeys(cues))[:5])


def score_pull_form(per_rep: list[dict]) -> dict:
    deviations = []
    cues = []
    rep_scores = []

    for r in per_rep:
        rn = r["rep_number"]
        penalty = 0.0
        if not r.get("full_rom", True):
            penalty += 25
            deviations.append(f"Rep {rn}: Partial range")
            cues.append("Full range: dead hang to chin over bar")
        rep_scores.append(100.0 - penalty)

    # Not a competition lift — no IPF validity.
    return _form_result(_average_rep_scores(rep_scores), False, deviations, list(dict.fromkeys(cues))[:5])


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
            # Crouch+stand like a squat, but squat FORM rules (depth, heels,
            # lean) are meaningless for a stone — route to its own family so
            # it gets rep/velocity analysis without bogus flags.
            return "Stone"
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
    bar_detection: bool = False,
    bar_detector_model: str | None = None,
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
    fps = float(track.get("fps") or 10.0)
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
                                 expected_reps=expected, fps=fps)

    # Rest between reps (cluster sets / deliberate pauses) — fills the
    # rest-timing columns; None for a continuous set.
    rest = segment_rest(track.get("world") or [], timestamps, reps, exercise)
    if rest:
        result["rest"] = rest

    # Per-rep analysis
    per_rep = []
    for rep in reps:
        if exercise in ("Squat", "Front Squat", "Back Squat"):
            per_rep.append({"rep_number": rep["rep_number"], **analyze_squat_rep(landmarks, rep, view=view)})
        elif exercise == "Bench Press":
            per_rep.append({"rep_number": rep["rep_number"], **analyze_bench_rep(landmarks, rep, fps=10.0)})
        elif exercise in ("Deadlift", "Conventional Deadlift", "Sumo Deadlift"):
            per_rep.append({"rep_number": rep["rep_number"], **analyze_deadlift_rep(landmarks, rep, view=view)})
        elif _is_press(exercise):
            per_rep.append({"rep_number": rep["rep_number"], **analyze_press_rep(landmarks, rep, view=view)})
        elif _is_pull(exercise):
            per_rep.append({"rep_number": rep["rep_number"], **analyze_pull_rep(landmarks, rep, view=view)})
        else:
            per_rep.append({"rep_number": rep["rep_number"]})

    # Score form
    if exercise in ("Squat", "Front Squat", "Back Squat"):
        form = score_squat_form(per_rep)
    elif exercise == "Bench Press":
        form = score_bench_form(per_rep)
    elif exercise in ("Deadlift", "Conventional Deadlift", "Sumo Deadlift"):
        form = score_deadlift_form(per_rep)
    elif _is_press(exercise):
        form = score_press_form(per_rep)
    elif _is_pull(exercise):
        form = score_pull_form(per_rep)
    else:
        form = {"overall_form_score": 50, "competition_valid": None, "deviations": [], "severity": "unknown", "coaching_cues": []}

    result["form"] = form
    result["per_rep"] = per_rep
    result["rep_count_detected"] = len(reps)

    # Analysis quality gate: the pipeline used to always emit a confident-
    # looking score even when pose detection was degraded or no reps were
    # found. Surface an explicit quality so the UI can say "refilm" instead
    # of presenting a meaningless number.
    frames = int(track.get("frames") or len(landmarks) or 0)
    # Detection quality = frames with *any* pose / sampled frames. Using the
    # selected lifter's count here would penalise bench-with-spotter clips
    # (the lifter is absent while the spotter is tracked) and report them
    # "unusable" even when the lift was analysed fine.
    detected_frames = int(track.get("pose_frames") or len(landmarks) or 0)
    detection_rate = (detected_frames / frames) if frames else 0.0
    if frames < 5 or detection_rate < 0.4 or not reps:
        level = "unusable"
    elif detection_rate < 0.7:
        level = "fair"
    else:
        level = "good"

    # Multi-person clips (e.g. bench with a spotter): a pose is detected every
    # frame, but MediaPipe may return the *lifter* for only part of the clip
    # (the upright spotter wins the rest). That fragments the lifter's signal
    # and softens every downstream number, so cap the level on lifter coverage.
    lifter_frames = len(landmarks)
    lifter_rate = (lifter_frames / frames) if frames else 0.0
    multi_person = len(track.get("tracks") or []) > 1
    if multi_person and lifter_rate < 0.5 and level == "good":
        level = "fair"
    result["quality"] = {
        "level": level,
        "detection_rate": round(detection_rate, 2),
        "lifter_rate": round(lifter_rate, 2),
        "multi_person": multi_person,
        "reps": len(reps),
        "view": view,
    }

    # Bar-path metrics (F1). Prefer the real barbell plate detection (T3) when
    # it fires on enough frames; ``bar_track_from_frame_paths`` falls back to
    # the pose proxy internally below its detection threshold, so the metrics
    # are never left empty and the two sources are labelled (``source``).
    from app.integrations.bar_tracking import (
        analyze_bar_path,
        bar_track_from_landmarks,
    )

    use_detection = bar_detection or bool(bar_detector_model)
    bar_track = None
    records = (track.get("records") or []) if use_detection else []
    if records:
        frame_dir = Path(tmpdir)
        frame_paths = [
            frame_dir / f"pose_{r['frame_idx']:04d}.jpg" for r in records
        ]
        if all(p.exists() for p in frame_paths):
            from app.integrations.bar_detection import bar_track_from_frame_paths

            bar_track = bar_track_from_frame_paths(
                frame_paths, [r["landmarks"] for r in records], exercise,
                model_path=bar_detector_model or None)
    if bar_track is None:
        bar_track = bar_track_from_landmarks(
            landmarks, track.get("presence"), exercise)
    bar_path = analyze_bar_path(bar_track, reps, exercise)
    if bar_path:
        result["bar_path"] = bar_path

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


def _world_signal(world_frames: list, exercise: str):
    """Per-frame 1-D vertical signal from world landmarks, NaN-interpolated.

    ``world_frames`` is aligned 1:1 with the landmark/timestamp lists and may
    contain ``None`` entries (frames where the model omitted world landmarks;
    see ``extract_pose_track``). Missing frames are linearly interpolated so
    downstream rep indices (which index the aligned list) stay valid.

    Returns ``None`` when no frame has usable world landmarks.
    """
    vals: list[float] = []
    for w in world_frames:
        if w is None:
            vals.append(np.nan)
        elif _is_leg_lift(exercise):
            vals.append(_hip_ankle_distance(w))
        else:
            li, ri = _velocity_tracked_indices(exercise)
            vals.append((w[li].y + w[ri].y) / 2)
    arr = np.asarray(vals, dtype=float)
    if arr.size == 0 or np.all(np.isnan(arr)):
        return None
    mask = ~np.isnan(arr)
    if not mask.all():
        idx = np.arange(arr.size)
        arr = np.interp(idx, idx[mask], arr[mask])
    return arr


def _sticking_point(pos, ts, bi: int, ti: int) -> dict | None:
    """Where along the concentric phase the bar moves slowest (F3).

    ``pos`` is the smoothed world signal (metres: hip→ankle distance for
    legs, wrist-y for presses), ``bi``/``ti`` the bottom/top frame indices.
    Returns ``{"position_pct": 0–100, "min_velocity_ms": m/s}`` or ``None``
    when the slice is too short. Position 0% = bottom (start), 100% = top
    (lockout) — "sticking just above parallel" reads as a low %.
    """
    from app.integrations.video_analysis import _smooth_signal

    if bi is None or ti is None or ti - bi < 4:
        return None
    seg = np.asarray(pos[bi:ti + 1], dtype=float)
    tseg = np.asarray(ts[bi:ti + 1], dtype=float)
    dt = np.diff(tseg)
    dt[dt <= 0] = 1e-6
    speed = np.abs(np.diff(seg) / dt)
    if speed.size < 3:
        return None
    speed = _smooth_signal(speed, window=3)
    k = int(np.argmin(speed))
    return {
        "sticking_position_pct": round(float((k + 0.5) / speed.size) * 100, 1),
        "sticking_min_velocity_ms": round(float(speed[k]), 3),
        # Absolute index into the aligned landmark list — lets callers read the
        # joint angle at the sticking point.
        "sticking_frame_idx": int(bi) + k,
    }


def sticking_joint_angle(landmarks: list, frame_idx, exercise: str) -> float | None:
    """Knee (leg lifts) or elbow (presses) angle at the sticking frame (F3)."""
    if frame_idx is None or not (0 <= int(frame_idx) < len(landmarks)):
        return None
    lm = landmarks[int(frame_idx)]
    if lm is None:
        return None
    if _is_leg_lift(exercise):
        return round(
            calculate_angle(_mid(lm, 23, 24), _mid(lm, 25, 26), _mid(lm, 27, 28)), 1
        )
    return round(
        calculate_angle(_mid(lm, 11, 12), _mid(lm, 13, 14), _mid(lm, 15, 16)), 1
    )


def segment_rest(
    world_frames: list,
    timestamps: list[float],
    pose_reps: list[dict],
    exercise: str,
    min_rest_s: float = 1.5,
    still_range_m: float = 0.008,
) -> dict | None:
    """Detect genuine rest between reps: a gap where the bar stays still.

    A continuous set has no such gap (returns ``None``); a cluster set or a set
    with deliberate pauses does. Populates the rest-timing columns (T6).
    """
    sig = _world_signal(world_frames, exercise)
    if sig is None or len(pose_reps) < 2:
        return None
    ts = np.asarray(timestamps, dtype=float)

    # Group reps into sets: a gap longer than set_gap_s starts a new set (a
    # long session video — untrimmed — otherwise reads as one huge set).
    set_gap_s = max(min_rest_s, 60.0)
    reps_per_set: list[int] = []
    run = 0
    prev_end = None
    for r in pose_reps:
        i0 = min(int(r.get("start_idx", 0)), len(ts) - 1)
        if prev_end is not None and float(ts[i0] - prev_end) > set_gap_s:
            reps_per_set.append(run)
            run = 0
        run += 1
        prev_end = float(ts[min(int(r.get("end_idx", i0)), len(ts) - 1)])
    if run:
        reps_per_set.append(run)

    periods: list[dict] = []
    for prev, nxt in itertools.pairwise(pose_reps):
        i0 = prev.get("end_idx", prev.get("top_idx"))
        i1 = nxt.get("start_idx", nxt.get("bottom_idx"))
        if i0 is None or i1 is None or i1 <= i0 + 1 or i1 >= len(sig):
            continue
        # Longest run of near-stationary frames inside the gap (a pause, not a
        # continuous descent).
        run_start = None
        best = 0.0
        for i in range(i0 + 1, i1 + 1):
            if abs(sig[i] - sig[i - 1]) <= still_range_m:
                if run_start is None:
                    run_start = i - 1
                best = max(best, float(ts[i] - ts[run_start]))
            else:
                run_start = None
        if best >= min_rest_s:
            periods.append({
                "after_rep": prev.get("rep_number"),
                "seconds": round(best, 1),
            })

    base = {"n_sets": len(reps_per_set), "reps_per_set": reps_per_set}
    if not periods:
        # Continuous set: no rest, but still report the set grouping.
        return {**base, "periods": [], "avg_seconds": None, "cv": None}
    vals = np.array([p["seconds"] for p in periods], dtype=float)
    mean = float(vals.mean())
    return {
        **base,
        "periods": periods,
        "avg_seconds": round(mean, 1),
        "cv": round(float(vals.std() / mean), 3) if mean > 0 else 0.0,
    }


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

    # Leg extension recovers the hip's vertical travel (bar travels with the
    # hips in squat/deadlift); hip y itself is the world origin. Presses/bench
    # track wrist y (bar moves relative to the torso). ``None`` world frames
    # (2D-only) are interpolated; no usable frame → failed.
    sig = _world_signal(world_frames[:n], exercise)
    if sig is None:
        return {"tracking_quality": "failed", "mean_concentric_velocity": 0.0}
    ts = np.array(timestamps[:n])
    # Median smoothing (validated). A one-euro filter was evaluated (T2) but
    # its lag shrinks the rep's peak-to-trough amplitude — measured 0.244 m/s
    # vs 0.277 for a clean 150 kg squat — so it is not used here.
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
                sp = _sticking_point(pos, ts, bi, ti)
                if sp:
                    entry.update(sp)
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
            # Velocity loss is a fatigue measure and is non-negative by
            # definition; a "negative" value means the last rep was measured
            # faster (a segmentation/mistrack artifact). Clamp to 0 = "no
            # measurable loss" rather than surfacing e.g. -100%.
            result["velocity_loss_pct"] = max(
                0.0, _velocity_loss_pct(velocities[0], velocities[-1]))
    else:
        result["tracking_quality"] = "failed"
        result["mean_concentric_velocity"] = 0.0
        result["peak_velocity"] = 0.0
    return result
