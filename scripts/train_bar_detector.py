#!/usr/bin/env python3
"""Train the T3 barbell/plate detector (YOLO -> ONNX) on Modal.

Two stages:

  # 1. Prepare the YOLO dataset from the corrected labels (local, free)
  python scripts/train_bar_detector.py prepare

  # 2. Train + export ONNX on Modal (GPU; needs `pip install modal` + tokens)
  python scripts/train_bar_detector.py train --epochs 60

The labels come from `scripts/autolabel_bars.py` corrected with
`scripts/label_tool/index.html` (download the corrected JSONL over the seed).

Inference stays ONNX-only in the app (no torch) — see
`app/integrations/bar_detection.py`.
"""

from __future__ import annotations

import argparse
import random
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from bar_labels import LABELS, load_jsonl, to_yolo_rows

DATA = REPO_ROOT / "labels" / "bars"
DATASET = REPO_ROOT / "labels" / "bar_dataset"


def prepare_dataset(sources: list, out_dir: Path,
                    val_frac: float = 0.2, seed: int = 0) -> Path:
    """Write a YOLO dataset from one or more ``(data_root, labels_path)``.

    Sources are merged (e.g. real seed labels + synthetic renders) and split
    into images|labels/{train,val} + data.yaml.
    """
    items: list[tuple[Path, dict]] = []
    for root, labels_path in sources:
        items.extend((root, rec) for rec in load_jsonl(labels_path))
    if not items:
        raise SystemExit(f"no labels in {[str(p) for _r, p in sources]}")

    random.Random(seed).shuffle(items)
    n_val = max(1, int(len(items) * val_frac))
    splits = {"val": items[:n_val], "train": items[n_val:]}

    for name in ("train", "val"):
        (out_dir / "images" / name).mkdir(parents=True, exist_ok=True)
        (out_dir / "labels" / name).mkdir(parents=True, exist_ok=True)

    for split, recs in splits.items():
        for root, rec in recs:
            src = root / rec["image"]
            stem = src.stem
            shutil.copyfile(src, out_dir / "images" / split / f"{stem}.jpg")
            rows = to_yolo_rows(rec)
            (out_dir / "labels" / split / f"{stem}.txt").write_text(
                "\n".join(rows), encoding="utf-8")

    names = "\n".join(f"  {i}: {label}" for i, label in enumerate(LABELS))
    (out_dir / "data.yaml").write_text(
        f"path: {out_dir.as_posix()}\n"
        "train: images/train\n"
        "val: images/val\n"
        f"names:\n{names}\n",
        encoding="utf-8",
    )
    print(f"dataset: {len(splits['train'])} train / {len(splits['val'])} val "
          f"-> {out_dir}")
    return out_dir


def train_on_modal(epochs: int, gpu: str, imgsz: int) -> None:
    import modal

    app = modal.App("fittrack-bar-detector")
    image = (
        modal.Image.debian_slim()
        # ultralytics imports cv2, which needs these system libs.
        .apt_install("libgl1", "libglib2.0-0")
        .pip_install("ultralytics", "onnx", "onnxruntime")
        .add_local_dir(str(DATASET), "/data", copy=True)
    )

    @app.function(image=image, gpu=gpu, timeout=3600, serialized=True)
    def train() -> bytes:
        import re as _re
        from pathlib import Path as _P

        from ultralytics import YOLO

        # data.yaml carries the local absolute path; repoint it at the mount.
        _yp = _P("/data/data.yaml")
        _yp.write_text(_re.sub(r"^path:.*$", "path: /data", _yp.read_text(),
                               flags=_re.M))

        model = YOLO("yolov8n.pt")
        model.train(data="/data/data.yaml", epochs=epochs, imgsz=imgsz,
                    project="/runs", name="bar", exist_ok=True)
        best = _P("/runs/bar/weights/best.pt")
        # nms=True bakes NMS into the graph so the app parser reads
        # (1, N, 6) [x1,y1,x2,y2,conf,cls] directly (see bar_detection).
        onnx_path = YOLO(str(best)).export(
            format="onnx", opset=12, imgsz=imgsz, nms=True
        )
        return _P(onnx_path).read_bytes()

    with app.run():
        onnx_bytes = train.remote()

    out = REPO_ROOT / "labels" / "bar_detector.onnx"
    out.write_bytes(onnx_bytes)
    print(f"wrote {out} ({len(onnx_bytes) // 1024} KB)")
    print("Next: upload it to R2 at models/bar_detector.onnx and set "
          "VIDEO_BAR_DETECTOR_MODEL=models/bar_detector.onnx")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_prep = sub.add_parser("prepare")
    p_prep.add_argument("--real", type=Path, default=DATA / "labels.jsonl",
                        help="human-corrected real labels")
    p_prep.add_argument("--synthetic", type=Path,
                        default=REPO_ROOT / "labels" / "bars_synthetic" / "labels.jsonl",
                        help="synthetic renders (optional)")
    p_prep.add_argument("--out", type=Path, default=DATASET)
    p_train = sub.add_parser("train")
    p_train.add_argument("--epochs", type=int, default=60)
    p_train.add_argument("--gpu", default="T4")
    p_train.add_argument("--imgsz", type=int, default=640)
    args = ap.parse_args()

    if args.cmd == "prepare":
        sources = [(DATA, args.real)]
        if args.synthetic.exists():
            sources.append((args.synthetic.parent, args.synthetic))
        prepare_dataset(sources, args.out)
    else:
        train_on_modal(args.epochs, args.gpu, args.imgsz)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
