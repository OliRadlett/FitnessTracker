#!/usr/bin/env python3
"""Zero-shot barbell/plate detection with YOLO-World, scored vs the human GT.

Tests whether an open-vocabulary detector (no training) localises the barbell
well enough to replace the classical Hough/ellipse detector. Runs on Modal GPU.

  # 1. stage the human-labelled frames (local, free)
  C:\\Users\\oradl\\.venvs\\fittrack-video\\Scripts\\python.exe scripts/eval_yolo_world.py prepare

  # 2. probe which prompts fire on a few frames
  python scripts/eval_yolo_world.py diag

  # 3. full evaluation on Modal GPU
  python scripts/eval_yolo_world.py eval

No labels, no fine-tuning — prompts only.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from bar_labels import box_to_xyxy_norm  # noqa: E402

DATA = Path(os.environ.get("TRACKING_DATA",
                           r"C:\Users\oradl\FitnessTracker\labels\bars"))
STAGE = REPO_ROOT / "labels" / "yolo_eval"
PROMPTS = ["barbell", "weight plate", "dumbbell"]
MODEL = "yolov8x-worldv2.pt"
CONF = 0.05


def _image() -> "object":
    import modal

    return (
        modal.Image.debian_slim()
        .apt_install("git", "libgl1", "libglib2.0-0")
        .pip_install("ultralytics",
                     "git+https://github.com/ultralytics/CLIP.git")
        .add_local_dir(str(STAGE), "/data", copy=True)
    )


def prepare() -> int:
    (STAGE / "images").mkdir(parents=True, exist_ok=True)
    gt: dict[str, list[float]] = {}
    for line in (DATA / "labels.human.jsonl").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        plates = [b for b in rec["boxes"]
                  if b.get("source") == "human" and b["label"] == "plate"]
        if not plates:
            continue
        b = max(plates, key=lambda x: x["w"] * x["h"])
        name = Path(rec["image"]).name
        shutil.copyfile(DATA / rec["image"], STAGE / "images" / name)
        gt[name] = list(box_to_xyxy_norm(b))
    (STAGE / "gt.json").write_text(json.dumps(gt), encoding="utf-8")
    print(f"staged {len(gt)} frames -> {STAGE}")
    return 0


def diagnose(gpu: str, model_name: str) -> int:
    import modal

    app = modal.App("fittrack-yolo-diag")
    image = _image()

    @app.function(image=image, gpu=gpu, timeout=1800, serialized=True)
    def run() -> dict:
        import glob

        from ultralytics import YOLO

        model = YOLO(model_name)
        prompt_sets = [
            ["person"], ["barbell"], ["dumbbell"], ["weight plate"],
            ["barbell", "weight plate", "dumbbell"], ["bar"],
        ]
        imgs = sorted(glob.glob("/data/images/*.jpg"))[:12]
        out: dict = {"_imgs": len(imgs), "_model": model_name}
        for ps in prompt_sets:
            model.set_classes(ps)
            confs = []
            for im in imgs:
                res = model.predict(im, conf=0.01, verbose=False)[0]
                if res.boxes is not None and len(res.boxes):
                    confs += [float(c) for c in res.boxes.conf]
            out["+".join(ps)] = {
                "n": len(confs),
                "max_conf": round(max(confs), 3) if confs else 0.0,
            }
        return out

    with app.run():
        return run.remote()


def evaluate(gpu: str, model_name: str, conf: float, prompts: list[str]) -> int:
    import modal

    app = modal.App("fittrack-yolo-eval")
    image = _image()

    @app.function(image=image, gpu=gpu, timeout=1800, serialized=True)
    def run() -> dict:
        import os as _os

        _os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

        import numpy as np
        from ultralytics import YOLO

        gt = json.loads(Path("/data/gt.json").read_text())
        names = sorted(gt)
        model = YOLO(model_name)
        model.set_classes(prompts)
        preds_by_img: dict[str, list[list[float]]] = {n: [] for n in names}
        for n in names:
            res = model.predict(f"/data/images/{n}", conf=conf,
                                verbose=False, imgsz=640)[0]
            preds_by_img[n] = (res.boxes.xyxyn.tolist()
                               if res.boxes is not None and len(res.boxes) else [])

        def iou(a, b):
            ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
            ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
            inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
            ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
            return inter / ua if ua > 0 else 0.0

        ious, contains, cy_err, yerr_plain, n_preds = [], [], [], [], []
        for n in names:
            g = gt[n]
            ps = preds_by_img[n]
            n_preds.append(len(ps))
            ious.append(max((iou(p, g) for p in ps), default=0.0))
            cx, cy = (g[0] + g[2]) / 2, (g[1] + g[3]) / 2
            hit = [p for p in ps if p[0] <= cx <= p[2] and p[1] <= cy <= p[3]]
            contains.append(1.0 if hit else 0.0)
            if hit:
                best = min(hit, key=lambda p: abs((p[1] + p[3]) / 2 - cy))
                cy_err.append(abs((best[1] + best[3]) / 2 - cy))
            if ps:
                best = min(ps, key=lambda p: abs((p[1] + p[3]) / 2 - cy))
                yerr_plain.append(abs((best[1] + best[3]) / 2 - cy))

        a, c = np.array(ious), np.array(contains)
        ce = np.full(len(names), 1.0)
        for i, n in enumerate(names):
            ps = preds_by_img[n]
            if ps:
                _, gt_y = 0, (gt[n][1] + gt[n][3]) / 2
                ce[i] = min(abs((p[1] + p[3]) / 2 - gt_y) for p in ps)
        return {
            "n": int(a.size),
            "recall@0.5": round(float((a > 0.5).mean()), 3),
            "plate_centre_contained": round(float(c.mean()), 3),
            "mean_best_iou": round(float(a.mean()), 3),
            "mean_cy_err_closest": round(float(ce.mean()), 3),
            "cy_err<0.03": round(float((ce < 0.03).mean()), 3),
            "cy_err<0.05": round(float((ce < 0.05).mean()), 3),
            "cy_err<0.10": round(float((ce < 0.10).mean()), 3),
            "mean_preds": round(float(np.mean(n_preds)), 2),
        }

    with app.run():
        return run.remote()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("prepare")
    for cmd in ("diag", "eval"):
        p = sub.add_parser(cmd)
        p.add_argument("--gpu", default="T4")
        p.add_argument("--model", default=MODEL)
        if cmd == "eval":
            p.add_argument("--conf", type=float, default=CONF)
            p.add_argument("--prompts", default=",".join(PROMPTS))
    args = ap.parse_args()

    if args.cmd == "prepare":
        return prepare()
    if args.cmd == "diag":
        print("YOLO-WORLD PROMPT DIAG:",
              json.dumps(diagnose(args.gpu, args.model), indent=1))
        return 0
    prompts = [x for x in args.prompts.split(",") if x]
    result = evaluate(args.gpu, args.model, args.conf, prompts)
    print("YOLO-WORLD ZERO-SHOT vs human GT:", json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
