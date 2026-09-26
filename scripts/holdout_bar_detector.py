#!/usr/bin/env python3
"""Clip-level holdout test for the T3 bar detector.

The normal val split is frame-level (held-out frames from clips the model also
trained on), so it over-states generalisation. This holds out whole **clips**:
train without them, then score on those clips' human frames.

    $env:TRACKING_DATA = "C:\\Users\\oradl\\FitnessTracker\\labels\\bars"
    python scripts/holdout_bar_detector.py build --holdout 6
    python scripts/holdout_bar_detector.py train --epochs 40
    python scripts/holdout_bar_detector.py score
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from bar_labels import box_to_xyxy_norm, load_jsonl
from eval_cotracker import all_clips
from train_bar_detector import prepare_dataset, train_on_modal

DATA = Path(os.environ.get("TRACKING_DATA", REPO_ROOT / "labels" / "bars"))
SYNTH = Path(
    os.environ.get(
        "TRACKING_SYNTHETIC", r"C:\Users\oradl\FitnessTracker\labels\bars_synthetic"
    )
)
WORK = REPO_ROOT / "labels" / "bar_holdout"
DATASET = REPO_ROOT / "labels" / "bar_dataset_holdout"
MODEL_NAME = "bar_detector_holdout"


def build(n_holdout: int, seed: int, real_repeat: int) -> int:
    clips = all_clips()
    rng = random.Random(seed)
    holdout = sorted(rng.sample(clips, min(n_holdout, max(1, len(clips) - 1))))
    held = set(holdout)
    WORK.mkdir(parents=True, exist_ok=True)

    recs = load_jsonl(DATA / "labels.human.jsonl")
    keep = [r for r in recs if Path(r["image"]).stem.rsplit("_", 1)[0] not in held]
    kept_path = WORK / "human_train.jsonl"
    kept_path.write_text("\n".join(json.dumps(r) for r in keep), encoding="utf-8")

    # GT for the held-out frames (image path + plate box).
    gt = {}
    for r in recs:
        if Path(r["image"]).stem.rsplit("_", 1)[0] not in held:
            continue
        plates = [
            b
            for b in r["boxes"]
            if b.get("source") == "human" and b["label"] == "plate"
        ]
        if plates:
            b = max(plates, key=lambda x: x["w"] * x["h"])
            gt[str(DATA / r["image"])] = list(box_to_xyxy_norm(b))
    (WORK / "holdout_gt.json").write_text(
        json.dumps({"clips": holdout, "frames": gt}), encoding="utf-8"
    )

    sources = [(DATA, kept_path, max(1, real_repeat))]
    synth_labels = SYNTH / "labels.jsonl"
    if synth_labels.exists():
        sources.append((SYNTH, synth_labels, 1))
    prepare_dataset(sources, DATASET)
    print(f"holdout clips ({len(holdout)}): {holdout}")
    print(f"held-out frames with plate GT: {len(gt)}  -> {WORK / 'holdout_gt.json'}")
    return 0


def score(conf: float) -> int:
    import cv2
    import numpy as np

    sys.path.insert(0, str(REPO_ROOT / "backend"))
    from app.integrations.bar_detection import detect_bars_onnx

    meta = json.loads((WORK / "holdout_gt.json").read_text(encoding="utf-8"))
    gt = meta["frames"]
    model = str(REPO_ROOT / "labels" / f"{MODEL_NAME}.onnx")
    if not Path(model).exists():
        print(f"no model at {model} -- run `train` first")
        return 1

    def iou(a, b):
        ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
        ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
        inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
        ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
        return inter / ua if ua > 0 else 0.0

    per_clip: dict[str, list] = {}
    ious, contained, cyerr = [], 0, []
    for path, g in gt.items():
        img = cv2.imread(path)
        dets = [
            d
            for d in detect_bars_onnx(img, model, conf=conf)
            if d["label"] in ("plate", "barbell")
        ]
        boxes = [
            (
                d["x"] - d["w"] / 2,
                d["y"] - d["h"] / 2,
                d["x"] + d["w"] / 2,
                d["y"] + d["h"] / 2,
            )
            for d in dets
        ]
        gx, gy = (g[0] + g[2]) / 2, (g[1] + g[3]) / 2
        i = max((iou(b, g) for b in boxes), default=0.0)
        ious.append(i)
        if any(b[0] <= gx <= b[2] and b[1] <= gy <= b[3] for b in boxes):
            contained += 1
        if dets:
            cyerr.append(min(abs(d["y"] - gy) for d in dets))
        clip = Path(path).stem.rsplit("_", 1)[0]
        per_clip.setdefault(clip, []).append(i)

    a = np.array(ious)
    ce = np.array(cyerr) if cyerr else np.array([1.0])
    print(
        f"CLIP-LEVEL HOLDOUT ({len(a)} frames, {len(per_clip)} unseen clips), "
        f"conf={conf}"
    )
    print(
        f"  recall@0.5={(a > 0.5).mean():.3f}  mean_IoU={a.mean():.3f}  "
        f"contained={contained / len(a):.3f}  cy_err<0.05={(ce < 0.05).mean():.3f}"
    )
    for clip, vals in sorted(per_clip.items(), key=lambda kv: -np.mean(kv[1])):
        v = np.array(vals)
        print(
            f"    {clip[:36]:<37} n={len(v):>2} recall={(v > 0.5).mean():.2f} "
            f"IoU={v.mean():.3f}"
        )
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_b = sub.add_parser("build")
    p_b.add_argument("--holdout", type=int, default=6)
    p_b.add_argument("--seed", type=int, default=0)
    p_b.add_argument("--real-repeat", type=int, default=6)
    p_t = sub.add_parser("train")
    p_t.add_argument("--epochs", type=int, default=40)
    p_t.add_argument("--gpu", default="T4")
    p_t.add_argument("--imgsz", type=int, default=640)
    p_s = sub.add_parser("score")
    p_s.add_argument("--conf", type=float, default=0.25)
    args = ap.parse_args()

    if args.cmd == "build":
        return build(args.holdout, args.seed, args.real_repeat)
    if args.cmd == "train":
        train_on_modal(
            args.epochs, args.gpu, args.imgsz, dataset=DATASET, out_name=MODEL_NAME
        )
        return 0
    return score(args.conf)


if __name__ == "__main__":
    raise SystemExit(main())
