#!/usr/bin/env python3
"""Run the lift-video analysis pipeline LOCALLY (no Modal, no R2, no deploy).

Mirrors backend/app/integrations/modal_client.py::_process steps 1-8 against
a local video file, using the repo's own analysis modules. Dev loop for the
video pipeline: iterate here in seconds instead of shipping to prod.

Requires the fittrack-video venv (Python 3.12 + mediapipe + opencv + numpy):
    py -3.12 -m venv C:\\Users\\oradl\\.venvs\\fittrack-video
    C:\\Users\\oradl\\.venvs\\fittrack-video\\Scripts\\python.exe -m pip install \\
        numpy opencv-python-headless mediapipe

Usage:
    C:\\Users\\oradl\\.venvs\\fittrack-video\\Scripts\\python.exe \\
        scripts/run_video_local.py <video.mp4> [--trim-start S --trim-end E]
            [--exercise Squat] [--skip-flow] [--workdir DIR]

Outputs a human summary plus <video>.analysis.json next to the input.
"""

from __future__ import annotations

import argparse
import json
import logging
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("run_video_local")

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.integrations.pose_analysis import (  # noqa: E402
    bar_velocity_from_pose,
    classify_exercise,
    detect_reps_from_pose,
    extract_pose_landmarks,
    run_pose_analysis,
)
from app.integrations.video_analysis import (  # noqa: E402
    _get_rom,
    estimate_rpe_heuristic,
    track_barbell_optical_flow,
)

MODEL_CACHE = Path.home() / ".cache" / "fittrack" / "models"
MODEL_FILE = "pose_landmarker.task"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task"
)


def probe_duration(path: Path) -> float:
    import cv2

    cap = cv2.VideoCapture(str(path))
    n = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    cap.release()
    return n / fps if fps else 0.0


def detect_scenes(path: Path, duration: float) -> list[float]:
    """Same approach as modal _process step 3: ffmpeg scene filter."""
    out = subprocess.run(
        ["ffmpeg", "-y", "-i", str(path),
         "-vf", "select='gt(scene,0.3)',showinfo",
         "-vsync", "0", "-f", "null", "-"],
        capture_output=True, text=True, timeout=300,
    )
    times: list[float] = []
    for line in out.stderr.splitlines():
        if "pts_time:" in line:
            try:
                pts_part = line.split("pts_time:")[1].split()[0]
                times.append(float(pts_part))
            except (IndexError, ValueError):
                continue
    return times


def trim_points(scene_times: list[float], duration: float) -> tuple[float, float]:
    if len(scene_times) >= 2 and duration > 0:
        boundaries = [0.0] + scene_times + [duration]
        best = max(
            range(len(boundaries) - 1),
            key=lambda i: boundaries[i + 1] - boundaries[i],
        )
        return (
            max(0.0, boundaries[best] - 0.5),
            min(duration, boundaries[best + 1] + 0.5),
        )
    return duration * 0.1, duration * 0.9


def ensure_model(tmpdir: Path) -> None:
    """Pre-seed the pose model so extract_pose_landmarks skips its download."""
    MODEL_CACHE.mkdir(parents=True, exist_ok=True)
    cached = MODEL_CACHE / MODEL_FILE
    if not cached.exists():
        import urllib.request

        logger.info("Downloading pose landmarker model (one-time)...")
        urllib.request.urlretrieve(MODEL_URL, str(cached))
    dest = tmpdir / MODEL_FILE
    if not dest.exists():
        shutil.copyfile(cached, dest)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("video", type=Path)
    ap.add_argument("--trim-start", type=float, default=None)
    ap.add_argument("--trim-end", type=float, default=None)
    ap.add_argument("--exercise", default=None,
                    help="skip auto-classification, e.g. Squat")
    ap.add_argument("--skip-flow", action="store_true",
                    help="skip optical-flow velocity (faster)")
    ap.add_argument("--workdir", type=Path, default=None,
                    help="keep intermediates here (default: fresh tempdir)")
    ap.add_argument("--dump-trajectories", action="store_true",
                    help="write per-frame hip/shoulder y + knee angle CSV "
                         "for debugging")
    args = ap.parse_args()

    if not args.video.exists():
        print(f"not found: {args.video}", file=sys.stderr)
        return 2

    t0 = time.time()
    tmpdir = args.workdir or Path(tempfile.mkdtemp(prefix="liftvideo_"))
    tmpdir.mkdir(parents=True, exist_ok=True)
    input_path = args.video.resolve()

    duration = probe_duration(input_path)
    logger.info("duration: %.1fs", duration)

    if args.trim_start is not None and args.trim_end is not None:
        trim_start, trim_end = args.trim_start, args.trim_end
    else:
        scenes = detect_scenes(input_path, duration)
        logger.info("scene changes: %d", len(scenes))
        trim_start, trim_end = trim_points(scenes, duration)
    logger.info("trim: %.2f -> %.2f", trim_start, trim_end)

    ensure_model(tmpdir)

    # Step 7: pose extract + classify (same settings as Modal)
    landmarks, timestamps = extract_pose_landmarks(
        input_path, str(tmpdir), trim_start, trim_end, fps=10.0)
    logger.info("pose landmarks: %d/%d frames", len(landmarks),
                len(timestamps) or 0)
    if not landmarks:
        print("No pose landmarks detected.")
        return 1

    if args.exercise:
        exercise, confidence, variation = args.exercise, 1.0, ""
    else:
        cls = classify_exercise(landmarks)
        exercise, confidence, variation = (
            cls["exercise"], cls["confidence"], cls["variation"])
    print(f"Classification: {exercise} ({variation}) conf={confidence}")

    reps = detect_reps_from_pose(landmarks, timestamps, exercise)
    print(f"Reps detected: {len(reps)}")

    if args.dump_trajectories:
        import csv

        from app.integrations.pose_analysis import _mid, calculate_angle

        traj_path = input_path.with_suffix(".trajectories.csv")
        with open(traj_path, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["frame", "t", "hip_y", "sh_y", "knee_deg", "hip_deg"])
            for i, lm in enumerate(landmarks):
                w.writerow([
                    i, timestamps[i],
                    round((lm[23].y + lm[24].y) / 2, 4),
                    round((lm[11].y + lm[12].y) / 2, 4),
                    round(calculate_angle(
                        _mid(lm, 23, 24), _mid(lm, 25, 26),
                        _mid(lm, 27, 28)), 1),
                    round(calculate_angle(
                        _mid(lm, 11, 12), _mid(lm, 23, 24),
                        _mid(lm, 25, 26)), 1),
                ])
        print(f"Trajectories: {traj_path}")

    # Step 8a: full pose analysis
    pose_result = run_pose_analysis(
        input_path=input_path, tmpdir=str(tmpdir),
        trim_start=trim_start, trim_end=trim_end,
        exercise_name=exercise, rep_count=len(reps), weight_kg=0.0)
    form = pose_result.get("form", {})
    print(f"Form score: {form.get('overall_form_score')} "
          f"severity={form.get('severity')}")
    for d in form.get("deviations", [])[:12]:
        print(f"  - {d}")
    print(f"Setup: {pose_result.get('setup', {})}")

    full_result = dict(pose_result)

    # Step 8b: bar velocity — pose landmarks first, optical flow fallback
    # (same policy as Modal step 8b).
    import cv2

    if not args.skip_flow:
        vel = {"tracking_quality": "failed"}
        cap = cv2.VideoCapture(str(input_path))
        frame_h = float(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        cap.release()
        if landmarks and timestamps and frame_h > 0:
            vel = bar_velocity_from_pose(
                landmarks, timestamps, reps, exercise, frame_h,
                _get_rom(exercise))
        if vel.get("tracking_quality") == "failed":
            print("Pose velocity unavailable, trying optical flow")
            vel = track_barbell_optical_flow(
                input_path, str(tmpdir), trim_start, trim_end, exercise)
        full_result["velocity"] = {
            "mean_concentric_velocity": vel.get("mean_concentric_velocity"),
            "peak_velocity": vel.get("peak_velocity"),
            "velocities": vel.get("velocities", []),
            "velocity_loss_pct": vel.get("velocity_loss_pct"),
            "vbt_zone": vel.get("vbt_zone"),
        }
        full_result["rep_timing"] = vel.get("rep_timings", [])
        print(f"Velocity ({vel.get('tracking_quality')}): "
              f"mean={vel.get('mean_concentric_velocity')} m/s "
              f"peak={vel.get('peak_velocity')} "
              f"loss={vel.get('velocity_loss_pct')}% "
              f"zone={vel.get('vbt_zone')} "
              f"ppm={vel.get('pixels_per_meter')}")

    # Step 8c: RPE
    rpe = estimate_rpe_heuristic(
        full_result, exercise, pose_result.get("rep_count_detected", 0))
    full_result["rpe"] = rpe
    print(f"RPE: {rpe.get('estimated_rpe')} "
          f"(confidence {rpe.get('confidence')})")

    out_path = input_path.with_suffix(".analysis.json")
    out_path.write_text(json.dumps(full_result, indent=2, default=str))
    print(f"\nFull result: {out_path}")
    print(f"Elapsed: {time.time() - t0:.0f}s | workdir: {tmpdir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
