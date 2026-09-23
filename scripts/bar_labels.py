#!/usr/bin/env python3
"""Bar-detection dataset labels (T3).

A tiny shared schema for training a barbell/plate detector. One JSON object per
image, JSONL:

    {"image": "frames/clipA_0012.jpg", "w": 1920, "h": 1080,
     "exercise": "Back Squat", "view": "side",
     "boxes": [
       {"label": "plate",  "x": 0.51, "y": 0.22, "w": 0.16, "h": 0.28, "source": "auto"},
       {"label": "person", "x": 0.42, "y": 0.55, "w": 0.30, "h": 0.80, "source": "human"}
     ]}

Boxes are **normalised** (0-1), centre + size, so they are resolution- and
letterbox-independent (plate size/colour/label varies wildly — the detector
learns structure, not appearance).

Pure stdlib — no numpy/opencv — so it is usable from both the video venv and CI.
"""

from __future__ import annotations

import json
from pathlib import Path

LABELS = ("barbell", "plate", "person")
SOURCES = ("auto", "human")


def make_box(cx, cy, w, h, label: str, source: str = "auto") -> dict:
    if label not in LABELS:
        raise ValueError(f"unknown label {label!r}; expected one of {LABELS}")
    return {
        "label": label,
        "x": round(float(cx), 4),
        "y": round(float(cy), 4),
        "w": round(float(w), 4),
        "h": round(float(h), 4),
        "source": source if source in SOURCES else "auto",
    }


def box_from_xyxy(x1, y1, x2, y2, label: str, width: int, height: int,
                  source: str = "auto") -> dict:
    """Pixel corners -> normalised centre/size box."""
    if width <= 0 or height <= 0:
        raise ValueError("width/height must be positive")
    return make_box(
        (x1 + x2) / 2 / width,
        (y1 + y2) / 2 / height,
        abs(x2 - x1) / width,
        abs(y2 - y1) / height,
        label,
        source,
    )


def box_to_xyxy_norm(box: dict) -> tuple[float, float, float, float]:
    return (
        box["x"] - box["w"] / 2,
        box["y"] - box["h"] / 2,
        box["x"] + box["w"] / 2,
        box["y"] + box["h"] / 2,
    )


def clamp_box(box: dict) -> dict:
    """Keep a normalised box inside the frame."""
    x1, y1, x2, y2 = box_to_xyxy_norm(box)
    x1, y1 = max(0.0, x1), max(0.0, y1)
    x2, y2 = min(1.0, x2), min(1.0, y2)
    x1, y1 = min(x1, x2), min(y1, y2)
    return make_box((x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1,
                    box["label"], box.get("source", "auto"))


def make_record(image: str, width: int, height: int, boxes: list,
                exercise: str | None = None, view: str | None = None) -> dict:
    return {
        "image": image,
        "w": int(width),
        "h": int(height),
        "exercise": exercise,
        "view": view,
        "boxes": boxes,
    }


def load_jsonl(path) -> list[dict]:
    records: list[dict] = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            records.append(json.loads(line))
    return records


def write_jsonl(path, records: list[dict]) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with Path(path).open("w", encoding="utf-8") as fh:
        fh.writelines(json.dumps(rec, separators=(",", ":")) + "\n" for rec in records)


def to_yolo_rows(record: dict) -> list[str]:
    """``label_class cx cy w h`` rows for a YOLO ``.txt`` label file."""
    names = {label: i for i, label in enumerate(LABELS)}
    return [
        f"{names[b['label']]} {b['x']:.4f} {b['y']:.4f} {b['w']:.4f} {b['h']:.4f}"
        for b in record["boxes"]
    ]


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description="Inspect / convert bar-detection labels")
    ap.add_argument("jsonl", type=Path)
    ap.add_argument("--yolo-dir", type=Path, default=None,
                    help="write per-image YOLO .txt labels here")
    args = ap.parse_args()

    records = load_jsonl(args.jsonl)
    by_label: dict[str, int] = {}
    for rec in records:
        for b in rec["boxes"]:
            by_label[b["label"]] = by_label.get(b["label"], 0) + 1
    print(f"{len(records)} images; boxes: {by_label}")

    if args.yolo_dir:
        args.yolo_dir.mkdir(parents=True, exist_ok=True)
        for rec in records:
            stem = Path(rec["image"]).stem
            (args.yolo_dir / f"{stem}.txt").write_text(
                "\n".join(to_yolo_rows(rec)), encoding="utf-8")
        print(f"wrote YOLO labels to {args.yolo_dir}")


if __name__ == "__main__":
    main()
