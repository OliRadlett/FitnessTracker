#!/usr/bin/env python3
"""Pre-fill detector labels with the trained ONNX model (T3 speed-up).

Runs the model over every frame and writes its boxes as ``source="auto"``
seeds; frames with human boxes are left untouched. The reviewer then only
corrects, instead of drawing from scratch.

By default only **plate** and **person** boxes are kept — the ``barbell`` class
is noisy in ¾ views (a foreshortened bar makes a huge oblique box), so it is
opt-in via ``--keep-barbell``.

    C:\\Users\\oradl\\.venvs\\fittrack-video\\Scripts\\python.exe scripts/prefill_with_model.py
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.integrations.bar_detection import detect_bars_onnx
from bar_labels import make_box

REPO_ROOT = Path(__file__).resolve().parents[1]


def _has_human(rec: dict) -> bool:
    return any(b.get("source") == "human" for b in rec["boxes"])


def _clip(image: str) -> str:
    return re.sub(r"_\d+$", "", Path(image).stem)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, default=REPO_ROOT / "labels" / "bars")
    ap.add_argument("--labels", type=Path, default=None,
                    help="input JSONL (default <data>/labels.corrected.jsonl, "
                         "falling back to labels.jsonl)")
    ap.add_argument("--model", type=Path, default=REPO_ROOT / "labels" / "bar_detector.onnx")
    ap.add_argument("--out", type=Path, default=None,
                    help="default <data>/labels.prefilled.jsonl")
    ap.add_argument("--conf", type=float, default=0.3)
    ap.add_argument("--keep-barbell", action="store_true")
    ap.add_argument("--overwrite", action="store_true",
                    help="also re-detect frames that already have human boxes")
    ap.add_argument("--skip-human-clips", action="store_true",
                    help="skip clips you've already started (their frames are "
                         "handled by propagation) so only fresh clips are filled")
    args = ap.parse_args()

    import cv2

    labels = args.labels or (args.data / "labels.corrected.jsonl")
    if not labels.exists():
        labels = args.data / "labels.jsonl"
    out = args.out or (args.data / "labels.prefilled.jsonl")
    keep = {"plate", "person", "barbell"} if args.keep_barbell else {"plate", "person"}

    records = [json.loads(l) for l in labels.read_text(encoding="utf-8").splitlines() if l.strip()]
    human_clips = {_clip(r["image"]) for r in records if _has_human(r)}
    filled = 0
    n_plate = 0
    for rec in records:
        if _has_human(rec) and not args.overwrite:
            continue
        if args.skip_human_clips and _clip(rec["image"]) in human_clips:
            continue
        img = cv2.imread(str(args.data / rec["image"]))
        if img is None:
            continue
        dets = [d for d in detect_bars_onnx(img, str(args.model), conf=args.conf)
                if d["label"] in keep]
        if dets:
            rec["boxes"] = [make_box(d["x"], d["y"], d["w"], d["h"], d["label"], "auto")
                            for d in dets]
            n_plate += sum(1 for d in dets if d["label"] == "plate")
            filled += 1

    out.write_text(
        "\n".join(json.dumps(r, separators=(",", ":")) for r in records) + "\n",
        encoding="utf-8",
    )
    print(f"pre-filled {filled} frame(s), {n_plate} plate boxes -> {out}")
    print("Load it in the labeler with:  --labels " + str(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
