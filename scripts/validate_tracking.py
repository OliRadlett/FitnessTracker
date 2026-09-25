#!/usr/bin/env python3
"""Validate the automatic bar-track chain against the human ground truth.

For each clip's hand-labelled frames it runs the real pipeline entry point
(``bar_track_from_frame_paths``) and scores the resulting bar position against
the plate centres the human marked.

    $env:TRACKING_DATA = "C:\\Users\\oradl\\FitnessTracker\\labels\\bars"
    C:\\Users\\oradl\\.venvs\\fittrack-video\\Scripts\\python.exe scripts/validate_tracking.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task"
)
DATA = Path(os.environ.get("TRACKING_DATA", REPO_ROOT / "labels" / "bars"))


def main() -> int:
    import mediapipe as mp
    from app.integrations.bar_detection import bar_track_from_frame_paths
    from mediapipe.tasks.python import BaseOptions, vision

    scanned_path = Path(os.environ.get(
        "TRACKING_SCANNED",
        REPO_ROOT / "backend" / "tests" / "fixtures" / "video_labels.scanned.json",
    ))
    scanned = {}
    if scanned_path.exists():
        scanned = {
            v["file"].rsplit(".", 1)[0]: v
            for v in json.loads(scanned_path.read_text(encoding="utf-8"))["videos"]
        }
    records = [
        json.loads(line)
        for line in (DATA / "labels.human.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    by_clip: dict[str, list] = defaultdict(list)
    for rec in records:
        plates = [b for b in rec["boxes"]
                  if b.get("source") == "human" and b["label"] == "plate"]
        if not plates:
            continue
        gt = max(plates, key=lambda b: b["w"] * b["h"])
        clip = Path(rec["image"]).stem.rsplit("_", 1)[0]
        by_clip[clip].append((rec["image"], gt))

    model = Path(os.environ.get("TRACKING_MODEL", DATA.parent / "pose_landmarker.task"))
    if not model.exists():
        model.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(MODEL_URL, str(model))
    landmarker = vision.PoseLandmarker.create_from_options(
        vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(model)),
            running_mode=vision.RunningMode.IMAGE, num_poses=1,
            min_pose_detection_confidence=0.3,
        )
    )

    err: list[float] = []
    err_by_source: dict[str, list[float]] = defaultdict(list)
    src_counts: dict[str, int] = defaultdict(int)
    for clip, frames in by_clip.items():
        frames = sorted(frames, key=lambda f: f[0])
        paths = [DATA / img for img, _gt in frames]
        landmarks, presence, gts = [], [], []
        for path, _img in [(p, img) for p, (img, _g) in zip(paths, frames)]:
            res = landmarker.detect(mp.Image.create_from_file(str(path)))
            if res.pose_landmarks:
                lm = res.pose_landmarks[0]
                landmarks.append(lm)
                presence.append(float(np.mean([p.presence for p in lm])))
            else:
                landmarks.append(None)
                presence.append(0.0)
        gts = [gt for _img, gt in frames]
        exercise = scanned.get(clip, {}).get("exercise") or ""

        track = bar_track_from_frame_paths(
            paths, landmarks, exercise, presence=presence)
        clip_source = next((t["source"] for t in track if t), "none")
        src_counts[clip_source] += 1
        for t, gt in zip(track, gts):
            if t is None:
                continue
            e = float(np.hypot(t["x"] - gt["x"], t["y"] - gt["y"]))
            err.append(e)
            err_by_source[clip_source].append(e)

    landmarker.close()
    a = np.array(err)
    print(f"AUTOMATIC bar-track error vs human plate centre ({len(a)} frames)")
    print(f"  mean={a.mean():.3f} median={np.median(a):.3f} p90={np.percentile(a, 90):.3f}")
    print(f"  sources (clips): {dict(src_counts)}")
    for src, vals in sorted(err_by_source.items()):
        v = np.array(vals)
        print(f"  {src:<14} n={len(v):>3} mean={v.mean():.3f} median={np.median(v):.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
