#!/usr/bin/env python3
"""Auto-label barbell frames for the T3 detector (seed labels).

For each video: extract frames (default 2 fps), run pose to get the **person**
box + the bar proxy, then run the classical plate detector seeded by the proxy
to get the **plate** box. Emits `labels/bars/labels.jsonl` + the frames, ready
for the human-correction pass (`scripts/label_tool/index.html`).

    C:\\Users\\oradl\\.venvs\\fittrack-video\\Scripts\\python.exe scripts/autolabel_bars.py

Labels are a *seed* (source "auto", ~67% detection on clean side views); the
human tool fixes the rest. Auto-labels from the current detector are biased to
face-on views — that bias is exactly what the fine-tuned model must correct,
which is why a human pass is required.
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
from app.integrations.bar_detection import detect_bar_circle
from app.integrations.bar_tracking import _proxy_point
from app.integrations.person_tracking import bbox_from_landmarks
from app.integrations.pose_analysis import extract_pose_track
from bar_labels import make_box, make_record, write_jsonl

DEFAULT_VIDEOS = REPO_ROOT / "backend" / "tests" / "fixtures" / "videos"
DEFAULT_LABELS = REPO_ROOT / "backend" / "tests" / "fixtures" / "video_labels.json"
DEFAULT_OUT = REPO_ROOT / "labels" / "bars"


def label_video(
    video_path: Path,
    out_dir: Path,
    exercise: str | None,
    view: str | None,
    fps: float = 2.0,
) -> list[dict]:
    import cv2

    stem = video_path.stem
    frames_dir = out_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    tmp = Path(tempfile.mkdtemp(prefix="autolabel_"))
    duration = rvl.probe_duration(video_path)
    scenes = rvl.detect_scenes(video_path, duration)
    trim_start, trim_end = rvl.trim_points(scenes, duration)

    track = extract_pose_track(
        video_path, str(tmp), trim_start, trim_end, fps=fps, num_poses=1
    )

    records: list[dict] = []
    for rec in track.get("records", []):
        src = tmp / f"pose_{rec['frame_idx']:04d}.jpg"
        if not src.exists():
            continue
        out_name = f"{stem}_{rec['frame_idx']:04d}.jpg"
        shutil.copyfile(src, frames_dir / out_name)

        img = cv2.imread(str(src))
        h, w = img.shape[:2]
        lm = rec["landmarks"]
        boxes = []

        pbox = bbox_from_landmarks(lm)
        if pbox is not None:
            x1, y1, x2, y2 = pbox
            boxes.append(make_box((x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1,
                                  "person", "auto"))

        px, py = _proxy_point(lm, exercise or "")
        hit = detect_bar_circle(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (px, py))
        if hit is not None:
            r = hit["r"]
            boxes.append(make_box(hit["x"], hit["y"], 2 * r, 2 * r, "plate", "auto"))

        if boxes:
            records.append(make_record(f"frames/{out_name}", w, h, boxes,
                                       exercise, view))
    shutil.rmtree(tmp, ignore_errors=True)
    return records


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--videos-dir", type=Path, default=DEFAULT_VIDEOS)
    ap.add_argument("--labels", type=Path, default=DEFAULT_LABELS)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--fps", type=float, default=2.0)
    args = ap.parse_args()

    labels = {v["file"]: v for v in json.loads(args.labels.read_text())["videos"]}
    # Only the labelled source clips — never the generated overlay/trimmed files
    # that also land in the fixtures folder.
    files = sorted(
        args.videos_dir / name
        for name in labels
        if (args.videos_dir / name).exists()
    )
    if args.limit:
        files = files[: args.limit]

    all_records: list[dict] = []
    for video_path in files:
        meta = labels.get(video_path.name, {})
        recs = label_video(video_path, args.out, meta.get("exercise"),
                           meta.get("camera_view"), args.fps)
        n_plate = sum(1 for r in recs for b in r["boxes"] if b["label"] == "plate")
        print(f"  {video_path.name[:40]:<41} {len(recs)} frames, {n_plate} plate boxes")
        all_records.extend(recs)

    write_jsonl(args.out / "labels.jsonl", all_records)

    # Ship the correction tool with the data so a static server serves both.
    tool_src = REPO_ROOT / "scripts" / "label_tool"
    tool_dst = args.out / "label_tool"
    if tool_src.exists():
        tool_dst.mkdir(parents=True, exist_ok=True)
        for f in tool_src.iterdir():
            shutil.copyfile(f, tool_dst / f.name)

    print(f"\nwrote {len(all_records)} records -> {args.out / 'labels.jsonl'}")
    print(f"Correct with:  python -m http.server 8000 --directory {args.out}"
          "  then open http://localhost:8000/label_tool/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
