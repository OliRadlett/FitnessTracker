#!/usr/bin/env python3
"""Track the barbell plate through a clip, seeded by the human labels (T3).

The learned detector under-performed (sim-to-real gap), but the human plate
boxes are excellent **anchors**. Between two anchors of the same clip the plate
moves smoothly, so a template-matching tracker initialised at each anchor —
re-initialised at the next anchor so drift is bounded — recovers a real bar
track with **no training**.

    C:\\Users\\oradl\\.venvs\\fittrack-video\\Scripts\\python.exe scripts/track_bars.py

Writes ``labels/bars/labels.tracked.jsonl`` (per-frame plate boxes,
``source="tracker"``) and prints per-clip coverage.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bar_labels import make_box

REPO_ROOT = Path(__file__).resolve().parents[1]


def _clip_and_frame(image: str) -> tuple[str, int]:
    stem = Path(image).stem
    m = re.search(r"_(\d+)$", stem)
    return (re.sub(r"_\d+$", "", stem), int(m.group(1)) if m else 0)


def _xyxy(box, w, h):
    return (
        int((box["x"] - box["w"] / 2) * w), int((box["y"] - box["h"] / 2) * h),
        int((box["x"] + box["w"] / 2) * w), int((box["y"] + box["h"] / 2) * h),
    )


def _match(cv2, gray, template, prev_xyxy, w, h, pad=0.3):
    """Best template location in a window around ``prev_xyxy``."""
    x1, y1, x2, y2 = prev_xyxy
    bw, bh = x2 - x1, y2 - y1
    mx, my = int(bw * pad) + 8, int(bh * pad) + 8
    sx1, sy1 = max(0, x1 - mx), max(0, y1 - my)
    sx2, sy2 = min(w, x2 + mx), min(h, y2 + my)
    if sx2 - sx1 < bw or sy2 - sy1 < bh:
        return None, 0.0
    res = cv2.matchTemplate(gray[sy1:sy2, sx1:sx2], template, cv2.TM_CCOEFF_NORMED)
    _min, maxv, _mn, maxloc = cv2.minMaxLoc(res)
    nx, ny = sx1 + maxloc[0], sy1 + maxloc[1]
    return (nx, ny, nx + bw, ny + bh), float(maxv)


def track_clip(cv2, frames: list, anchors: list, min_score: float = 0.45) -> dict:
    """Return ``{frame_index: plate_box}`` tracked from the anchors.

    Each anchor seeds a template; it is matched frame-to-frame forward until the
    next anchor (which re-seeds), so drift never accumulates across the clip.
    """
    by_idx = dict(frames)
    boxes: dict[int, dict] = {}
    for k, (i0, box0) in enumerate(anchors):
        img0 = cv2.imread(str(by_idx[i0]), cv2.IMREAD_GRAYSCALE)
        if img0 is None:
            continue
        h, w = img0.shape[:2]
        x1, y1, x2, y2 = _xyxy(box0, w, h)
        if x2 - x1 < 4 or y2 - y1 < 4:
            continue
        template = img0[y1:y2, x1:x2].copy()
        boxes[i0] = box0
        end = anchors[k + 1][0] - 1 if k + 1 < len(anchors) else max(by_idx)
        prev = (x1, y1, x2, y2)
        for i in range(i0 + 1, end + 1):
            if i not in by_idx:
                continue
            gray = cv2.imread(str(by_idx[i]), cv2.IMREAD_GRAYSCALE)
            if gray is None:
                continue
            nxt, score = _match(cv2, gray, template, prev, w, h)
            if nxt is None or score < min_score:
                break  # lost between anchors; leave the gap for interpolation
            prev = nxt
            nx1, ny1, nx2, ny2 = nxt
            boxes[i] = make_box(
                ((nx1 + nx2) / 2) / w, ((ny1 + ny2) / 2) / h,
                (nx2 - nx1) / w, (ny2 - ny1) / h, "plate", "tracker")
    return boxes


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, default=REPO_ROOT / "labels" / "bars")
    ap.add_argument("--labels", type=Path, default=None)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--min-score", type=float, default=0.45)
    args = ap.parse_args()

    import cv2

    labels = args.labels or (args.data / "labels.corrected.jsonl")
    out_path = args.out or (args.data / "labels.tracked.jsonl")
    records = [json.loads(l) for l in labels.read_text(encoding="utf-8").splitlines() if l.strip()]

    clips: dict[str, dict] = {}
    for r in records:
        clip, frame = _clip_and_frame(r["image"])
        c = clips.setdefault(clip, {"frames": [], "anchors": []})
        c["frames"].append((frame, args.data / r["image"]))
        plates = [b for b in r["boxes"]
                  if b.get("source") == "human" and b["label"] == "plate"]
        if plates:
            # use the largest human plate box as the anchor
            c["anchors"].append((frame, max(plates, key=lambda b: b["w"] * b["h"])))

    # Track and write per-frame plate boxes.
    tracked: dict[str, dict] = {}
    for clip, c in clips.items():
        c["frames"].sort()
        c["anchors"].sort()
        if not c["anchors"]:
            continue
        tracked[clip] = track_clip(cv2, c["frames"], c["anchors"], args.min_score)

    n_frames = sum(len(v) for v in tracked.values())
    for r in records:
        clip, frame = _clip_and_frame(r["image"])
        boxes = tracked.get(clip)
        if not boxes or frame not in boxes:
            continue
        # keep human boxes; replace/append the tracked plate
        kept = [b for b in r["boxes"] if b.get("source") == "human"]
        r["boxes"] = kept + [boxes[frame]]

    out_path.write_text(
        "\n".join(json.dumps(r, separators=(",", ":")) for r in records) + "\n",
        encoding="utf-8",
    )
    print(f"tracked {n_frames} frames across {len(tracked)} clip(s) -> {out_path}")
    print("Load it in the labeler with:  --labels " + str(out_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
