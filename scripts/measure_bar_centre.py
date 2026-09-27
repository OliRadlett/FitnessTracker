#!/usr/bin/env python3
"""Which detector output best estimates the true bar centre?

Reference: the midpoint of the **two human plate boxes** (the plates sit either
side of the bar's midpoint). On frames that have them, compare

  * the detector's whole-bar (`barbell`) box centre,
  * the detector's two-**plate** midpoint,
  * the human `barbell` box centre (when labelled) as a sanity check,

in normalised image units and as a fraction of the bar span. Groups by camera
view, because the answer differs (a whole-bar AABB is loose when the bar is
angled; the plate pair is tight but needs both plates visible).

    $env:TRACKING_DATA = "C:\\Users\\oradl\\FitnessTracker\\labels\\bars"
    python scripts/measure_bar_centre.py --labels <data>/labels.barbell.jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.integrations.bar_detection import detect_bars_onnx

DATA = Path(os.environ.get("TRACKING_DATA", REPO_ROOT / "labels" / "bars"))
MODEL = Path(os.environ.get("TRACKING_MODEL", REPO_ROOT / "labels" / "bar_detector.onnx"))
SCAN = Path(os.environ.get(
    "TRACKING_SCAN",
    r"C:\Users\oradl\FitnessTracker\backend\tests\fixtures\video_labels.scanned.json"))
CONF = 0.25


def _view_map() -> dict[str, str]:
    if not SCAN.exists():
        return {}
    return {v["file"].rsplit(".", 1)[0]: v.get("camera_view", "?")
            for v in json.loads(SCAN.read_text(encoding="utf-8"))["videos"]}


def _centre(b: dict) -> tuple[float, float]:
    return b["x"], b["y"]


def _box_centre(d: dict) -> tuple[float, float]:
    return d["x"], d["y"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--labels", type=Path, default=DATA / "labels.barbell.jsonl")
    ap.add_argument("--data", type=Path, default=DATA)
    ap.add_argument("--model", type=Path, default=MODEL)
    ap.add_argument("--conf", type=float, default=CONF)
    args = ap.parse_args()

    view = _view_map()
    records = [json.loads(x) for x in
               args.labels.read_text(encoding="utf-8").splitlines() if x.strip()]

    # err[key][view] = list of (abs error in normalised units, error / bar span)
    err: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))

    for rec in records:
        plates = [b for b in rec["boxes"] if b["label"] == "plate"]
        if len(plates) < 2:
            continue
        p1, p2 = plates[0], plates[1]
        ref = ((p1["x"] + p2["x"]) / 2, (p1["y"] + p2["y"]) / 2)
        span = float(np.hypot(p2["x"] - p1["x"], p2["y"] - p1["y"])) or 1.0

        img = cv2.imread(str(args.data / rec["image"]))
        if img is None:
            continue
        dets = detect_bars_onnx(img, str(args.model), conf=args.conf)
        vw = view.get(Path(rec["image"]).stem.rsplit("_", 1)[0], "?")

        def add(key: str, cx: float, cy: float, vw: str = vw,
                ref: tuple = ref, span: float = span) -> None:
            e = float(np.hypot(cx - ref[0], cy - ref[1]))
            err[key][vw].append((e, e / span))

        bars = [d for d in dets if d["label"] == "barbell"]
        if bars:
            add("det_barbell_box", *_box_centre(max(bars, key=lambda d: d["confidence"])))
        dplates = sorted((d for d in dets if d["label"] == "plate"),
                         key=lambda d: d["confidence"], reverse=True)[:2]
        if len(dplates) >= 2:
            add("det_plate_mid", (dplates[0]["x"] + dplates[1]["x"]) / 2,
                (dplates[0]["y"] + dplates[1]["y"]) / 2)
        hum = [b for b in rec["boxes"]
               if b["label"] == "barbell" and b.get("source") == "human"]
        if hum:
            add("human_barbell_box", *_centre(hum[0]))

    keys = ("det_plate_mid", "det_barbell_box", "human_barbell_box")
    print(f"{'estimator':<20} {'view':<14} {'n':>5} {'err':>7} {'/span':>7}")
    for key in keys:
        for vw in ("three_quarter", "side", "front", "?"):
            vals = err[key].get(vw)
            if not vals:
                continue
            a = np.array(vals)
            print(f"{key:<20} {vw:<14} {len(a):>5} {a[:, 0].mean():>7.3f} "
                  f"{a[:, 1].mean():>7.3f}")
        allv = [v for vals in err[key].values() for v in vals]
        if allv:
            a = np.array(allv)
            print(f"{key:<20} {'ALL':<14} {len(a):>5} {a[:, 0].mean():>7.3f} "
                  f"{a[:, 1].mean():>7.3f}")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
