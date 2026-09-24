#!/usr/bin/env python3
"""Propagate human-labelled boxes across a clip's frames (T3 speed-up).

Within one clip the bar/plates move smoothly, so a box on frame N is a good
first guess for frame N±1. This linearly interpolates each label's box between
the human-labelled **anchor** frames of the same clip and pre-fills the frames
in between (and holds the nearest anchor outside the anchor range). Propagated
boxes are marked ``source="auto"`` so the reviewer knows to check them.

    C:\\Users\\oradl\\.venvs\\fittrack-video\\Scripts\\python.exe scripts/propagate_labels.py
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


def _lerp(a: dict, b: dict, t: float) -> dict:
    return make_box(
        a["x"] + (b["x"] - a["x"]) * t,
        a["y"] + (b["y"] - a["y"]) * t,
        a["w"] + (b["w"] - a["w"]) * t,
        a["h"] + (b["h"] - a["h"]) * t,
        a["label"],
        "auto",
    )


def _human_boxes(rec: dict) -> dict:
    return {b["label"]: b for b in rec["boxes"] if b.get("source") == "human"}


def propagate(records: list, fill_all: bool = False) -> int:
    """Interpolate boxes between anchors; returns how many frames were filled."""
    by_clip: dict[str, list[tuple[int, int]]] = {}
    for i, r in enumerate(records):
        clip, frame = _clip_and_frame(r["image"])
        by_clip.setdefault(clip, []).append((frame, i))

    filled = 0
    for clip, entries in by_clip.items():
        entries.sort()
        anchors = [(f, i) for f, i in entries if _human_boxes(records[i])]
        if len(anchors) < 1:
            continue
        for frame, i in entries:
            rec = records[i]
            if _human_boxes(rec) and not fill_all:
                continue  # never overwrite human work
            # nearest anchors bracketing this frame
            left = [a for a in anchors if a[0] <= frame]
            right = [a for a in anchors if a[0] >= frame]
            if left and right and left[-1][0] != right[0][0]:
                f0, i0 = left[-1]
                f1, i1 = right[0]
                t = (frame - f0) / (f1 - f0)
                srcs = {**_human_boxes(records[i0]), **_human_boxes(records[i1])}
                new = [
                    _lerp(_human_boxes(records[i0]).get(lbl, b),
                          _human_boxes(records[i1]).get(lbl, b), t)
                    for lbl, b in srcs.items()
                ]
            elif left:
                new = [make_box(b["x"], b["y"], b["w"], b["h"], b["label"], "auto")
                       for b in _human_boxes(records[left[-1][1]]).values()]
            elif right:
                new = [make_box(b["x"], b["y"], b["w"], b["h"], b["label"], "auto")
                       for b in _human_boxes(records[right[0][1]]).values()]
            else:
                continue
            # keep any existing auto person box the propagator didn't cover
            existing = {b["label"]: b for b in rec["boxes"]
                        if b.get("source") != "human"}
            for lbl, b in existing.items():
                if lbl not in {x["label"] for x in new}:
                    new.append(b)
            rec["boxes"] = new
            filled += 1
    return filled


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--labels", type=Path,
                    default=REPO_ROOT / "labels" / "bars" / "labels.corrected.jsonl")
    ap.add_argument("--out", type=Path,
                    default=REPO_ROOT / "labels" / "bars" / "labels.prefilled.jsonl")
    ap.add_argument("--fill-all", action="store_true",
                    help="also (re)fill frames that already have human boxes")
    args = ap.parse_args()

    records = [json.loads(l) for l in args.labels.read_text(encoding="utf-8").splitlines() if l.strip()]
    filled = propagate(records, args.fill_all)
    args.out.write_text(
        "\n".join(json.dumps(r, separators=(",", ":")) for r in records) + "\n",
        encoding="utf-8",
    )
    print(f"propagated boxes into {filled} frame(s) -> {args.out}")
    print("Load it in the labeler with:  --labels " + str(args.out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
