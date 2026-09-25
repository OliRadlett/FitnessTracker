#!/usr/bin/env python3
"""Scan a folder of lift videos: classify exercise/view, count reps, emit an
eval-label stub (video_labels.json compatible).

For each video not already in the label file: extract pose (default 3 fps),
classify the exercise + camera view, detect reps, and print a row. With
``--out-labels`` it writes the existing labels + the new entries (exercise and
view auto-filled, reps auto-counted) so the clip set can grow cheaply.

    C:\\Users\\oradl\\.venvs\\fittrack-video\\Scripts\\python.exe scripts/scan_lift_videos.py \\
        --out-labels backend/tests/fixtures/video_labels.scanned.json
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import run_video_local as rvl
from app.integrations.pose_analysis import (
    classify_exercise,
    detect_camera_view,
    detect_reps_from_pose,
    extract_pose_track,
)

VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"}
VIEW_MAP = {"frontal": "front", "side": "side", "three_quarter": "three_quarter"}


def scan_one(path: Path, fps: float = 3.0) -> dict:
    tmp = Path(tempfile.mkdtemp(prefix="scan_"))
    try:
        dur = rvl.probe_duration(path)
        trim_start, trim_end = rvl.trim_points(rvl.detect_scenes(path, dur), dur)
        track = extract_pose_track(path, str(tmp), trim_start, trim_end, fps=fps)
        lms, tss = track["landmarks"], track["timestamps"]
        frames = int(track.get("frames") or 0)
        det = len(lms)
        if det == 0:
            return {"duration_s": round(dur, 1), "detection_rate": 0.0,
                    "exercise": "Unknown", "confidence": 0.0, "view": "unknown",
                    "reps": 0}
        cls = classify_exercise(lms, tss)
        view = detect_camera_view(lms)["view"]
        reps = detect_reps_from_pose(lms, tss, cls["exercise"], fps=fps)
        return {
            "duration_s": round(dur, 1),
            "detection_rate": round(det / frames, 2) if frames else 0.0,
            "exercise": cls["exercise"],
            "confidence": cls["confidence"],
            "view": view,
            "reps": len(reps),
        }
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--videos-dir", type=Path,
                    default=REPO_ROOT / "backend" / "tests" / "fixtures" / "videos")
    ap.add_argument("--labels", type=Path,
                    default=REPO_ROOT / "backend" / "tests" / "fixtures" / "video_labels.json")
    ap.add_argument("--out-labels", type=Path, default=None)
    ap.add_argument("--fps", type=float, default=3.0)
    args = ap.parse_args()

    existing: dict[str, dict] = {}
    if args.labels.exists():
        for v in json.loads(args.labels.read_text(encoding="utf-8"))["videos"]:
            existing[v["file"]] = v

    files = sorted(
        p for p in args.videos_dir.iterdir()
        if p.is_file() and p.suffix.lower() in VIDEO_EXTS
        and ".overlay." not in p.name and ".trimmed." not in p.name
    )
    new_entries = []
    for path in files:
        if path.name in existing:
            continue
        info = scan_one(path, args.fps)
        print(f"  {path.name[:44]:<45} dur={info['duration_s']:>5}s "
              f"det={info['detection_rate']:.2f} {info['exercise']:<13} "
              f"{info['view']:<13} reps={info['reps']}")
        new_entries.append({
            "file": path.name,
            "exercise": info["exercise"],
            "camera_view": VIEW_MAP.get(info["view"]),
            "reps": info["reps"] or None,
            "notes": "scanned — verify exercise/view/reps",
        })

    if args.out_labels and new_entries:
        merged = list(existing.values()) + new_entries
        args.out_labels.parent.mkdir(parents=True, exist_ok=True)
        args.out_labels.write_text(
            json.dumps({"videos": merged}, indent=2), encoding="utf-8")
        print(f"\nwrote {len(merged)} labels ({len(new_entries)} new) -> {args.out_labels}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
