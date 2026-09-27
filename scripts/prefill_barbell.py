#!/usr/bin/env python3
"""Pre-fill whole-bar (`barbell`) boxes for the human-correction pass.

The real label set is plate-only, so the detector's whole-bar class only learned
from synthetic frames and is unreliable on real footage (front-on only). This
adds a *suggested* `barbell` box per frame for the reviewer to correct in
`label_tool`:

1. the detector's whole-bar box when it fires, else
2. the hull of the two plate boxes (the bar runs plate-to-plate), else
3. nothing — the reviewer draws it.

Suggestions are ``source="auto"``; the reviewer's edits become ``"human"``.

    $env:TRACKING_DATA = "C:\\Users\\oradl\\FitnessTracker\\labels\\bars"
    python scripts/prefill_barbell.py --labels <data>/labels.human.jsonl \\
        --out <data>/labels.barbell.jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import cv2

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from app.integrations.bar_detection import detect_bars_onnx
from bar_labels import make_box

DATA = Path(os.environ.get("TRACKING_DATA", REPO_ROOT / "labels" / "bars"))
MODEL = Path(os.environ.get("TRACKING_MODEL", REPO_ROOT / "labels" / "bar_detector.onnx"))
CONF = 0.25


def _barbell_box(img, model: Path, conf: float) -> dict | None:
    """Suggested whole-bar box for one frame, normalised, or ``None``."""
    dets = detect_bars_onnx(img, str(model), conf=conf)
    bars = [d for d in dets if d["label"] == "barbell"]
    if bars:
        b = max(bars, key=lambda d: d["confidence"])
        return make_box(b["x"], b["y"], b["w"], b["h"], "barbell", "auto")
    plates = sorted((d for d in dets if d["label"] == "plate"),
                    key=lambda d: d["confidence"], reverse=True)[:2]
    if len(plates) < 2:
        return None
    x1 = min(p["x"] - p["w"] / 2 for p in plates)
    y1 = min(p["y"] - p["h"] / 2 for p in plates)
    x2 = max(p["x"] + p["w"] / 2 for p in plates)
    y2 = max(p["y"] + p["h"] / 2 for p in plates)
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    return make_box(cx, cy, x2 - x1, y2 - y1, "barbell", "auto")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--labels", type=Path, default=DATA / "labels.human.jsonl")
    ap.add_argument("--out", type=Path, default=DATA / "labels.barbell.jsonl")
    ap.add_argument("--model", type=Path, default=MODEL)
    ap.add_argument("--data", type=Path, default=DATA)
    ap.add_argument("--conf", type=float, default=CONF)
    args = ap.parse_args()

    records = [json.loads(x) for x in
               args.labels.read_text(encoding="utf-8").splitlines() if x.strip()]
    n_bar = n_none = n_kept = 0
    for rec in records:
        # Drop any previous *auto* suggestion, keep human boxes.
        rec["boxes"] = [b for b in rec["boxes"]
                        if not (b["label"] == "barbell" and b.get("source") == "auto")]
        if any(b["label"] == "barbell" for b in rec["boxes"]):
            n_kept += 1  # already labelled by hand — leave it alone
            continue
        img = cv2.imread(str(args.data / rec["image"]))
        box = None if img is None else _barbell_box(img, args.model, args.conf)
        if box is None:
            n_none += 1
        else:
            rec["boxes"].append(box)
            n_bar += 1

    args.out.write_text(
        "\n".join(json.dumps(r, separators=(",", ":")) for r in records) + "\n",
        encoding="utf-8")
    total_bar = sum(1 for r in records
                    for b in r["boxes"] if b["label"] == "barbell")
    print(f"{len(records)} frames -> {args.out}")
    print(f"  already labelled: {n_kept}")
    print(f"  new suggestions:  {n_bar}   (draw by hand: {n_none})")
    print(f"  frames with a barbell box now: "
          f"{sum(1 for r in records if any(b['label'] == 'barbell' for b in r['boxes']))}"
          f" / {len(records)}  ({total_bar} boxes total)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
