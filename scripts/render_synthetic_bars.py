#!/usr/bin/env python3
"""Render synthetic barbell frames with exact labels (T3 dataset).

A tiny pinhole renderer draws a randomised scene — barbell with 1-3 plates per
side (varied size/colour/thickness), a rack, and an occluding person — from a
random camera (azimuth/elevation/distance/FOV), and emits **exact** boxes for
the plates, bar and person. No Blender, no assets; pure numpy + opencv.

    C:\\Users\\oradl\\.venvs\\fittrack-video\\Scripts\\python.exe scripts/render_synthetic_bars.py --n 300

Output: labels/bars_synthetic/{frames/*.jpg, labels.jsonl} (source "auto"),
which merges with the human-corrected real labels before training.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bar_labels import box_from_xyxy, make_record, write_jsonl

W, H = 1280, 720
PLATE_COLOURS = [
    (20, 20, 20), (40, 40, 45), (30, 30, 160), (160, 40, 40),
    (40, 140, 40), (200, 180, 40), (200, 200, 200),
]


def _basis(cam, target):
    f = target - cam
    f = f / np.linalg.norm(f)
    up = np.array([0.0, 1.0, 0.0])
    r = np.cross(f, up)
    r = r / np.linalg.norm(r)
    u = np.cross(r, f)
    return r, u, f


def _project(points, cam, basis, fov):
    r, u, f = basis
    d = np.atleast_2d(points) - cam
    zc = d @ f
    focal = (H / 2) / np.tan(fov / 2)
    zc = np.maximum(zc, 1e-6)
    px = W / 2 + focal * (d @ r) / zc
    py = H / 2 - focal * (d @ u) / zc
    return np.stack([px, py], axis=1), zc


def _bbox_of(pts2d, in_front):
    pts = pts2d[in_front]
    if pts.size == 0:
        return None
    return (pts[:, 0].min(), pts[:, 1].min(), pts[:, 0].max(), pts[:, 1].max())


def _disc_points(center, radius, n=24):
    """Points on a disc whose normal is the world x-axis (the bar)."""
    ang = np.linspace(0, 2 * np.pi, n, endpoint=False)
    yy = center[1] + radius * np.cos(ang)
    zz = center[2] + radius * np.sin(ang)
    xx = np.full_like(yy, center[0])
    return np.stack([xx, yy, zz], axis=1)


def _box_corners(c, half):
    cx, cy, cz = c
    hx, hy, hz = half
    return np.array([
        [cx + sx * hx, cy + sy * hy, cz + sz * hz]
        for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)
    ])


def render_one(rng, idx, out_dir, exercise="Back Squat", view="side"):
    import cv2

    # ── Scene geometry (metres) ────────────────────────────────────────────
    bar_h = rng.uniform(0.9, 1.5)          # bar height (y)
    bar_y = 0.30                            # bar depth (z)
    half_len = rng.uniform(0.35, 0.55)
    n_plates = int(rng.integers(1, 4))      # per side
    plates = []                             # (x, radius, colour, thickness)
    x = half_len
    for _ in range(n_plates):
        r = rng.uniform(0.14, 0.225)
        thick = rng.uniform(0.03, 0.07)
        col = rng.choice(PLATE_COLOURS)
        plates.append((x + thick / 2, r, tuple(int(c) for c in col), thick))
        x += thick
    left = [(-p[0], p[1], p[2], p[3]) for p in plates]  # mirror to -x
    all_plates = plates + left

    # Person (a torso box + head) behind/around the bar — occluder.
    person_h = rng.uniform(1.5, 1.9)
    torso = np.array([0.0, bar_h - 0.05, bar_y - 0.10])
    torso_half = np.array([0.22, person_h * 0.22, 0.14])
    head = np.array([0.0, bar_h + 0.42, bar_y - 0.10])
    head_r = 0.11
    person = rng.random() < 0.8

    # ── Camera ─────────────────────────────────────────────────────────────
    az = np.radians(rng.uniform(-85, 85))   # 0 = side-on, ±90 = front/back
    el = np.radians(rng.uniform(-5, 20))
    dist = rng.uniform(2.6, 5.0)
    target = np.array([0.0, bar_h, bar_y])
    cam = target + dist * np.array([
        np.sin(az) * np.cos(el), np.sin(el), np.cos(az) * np.cos(el)
    ])
    basis = _basis(cam, target)
    fov = np.radians(rng.uniform(35, 65))

    # ── Render ─────────────────────────────────────────────────────────────
    bright = rng.uniform(120, 215)
    img = np.full((H, W, 3), bright, dtype=np.uint8)
    # floor
    fl = bright - rng.uniform(20, 60)
    cv2.rectangle(img, (0, int(H * 0.78)), (W, H), (int(fl),) * 3, -1)

    def pbox(points):
        pts, zc = _project(points, cam, basis, fov)
        return _bbox_of(pts, zc > 0.05)

    boxes = []

    # Rack uprights
    for sx in (-1, 1):
        c = np.array([sx * 0.75, bar_h, bar_y - 0.05])
        bb = pbox(_box_corners(c, np.array([0.05, 0.9, 0.05])))
        if bb:
            x1, y1, x2, y2 = (int(v) for v in bb)
            cv2.rectangle(img, (x1, y1), (x2, y2), (70, 70, 75), -1)

    # Person (drawn before the bar when "behind")
    def draw_person():
        bb = pbox(_box_corners(torso, torso_half))
        if bb:
            x1, y1, x2, y2 = (int(v) for v in bb)
            cv2.rectangle(img, (x1, y1), (x2, y2), (60, 90, 140), -1)
        hb = pbox(_disc_points(head, head_r))
        if hb:
            x1, y1, x2, y2 = (int(v) for v in hb)
            cv2.ellipse(img, ((x1 + x2) // 2, (y1 + y2) // 2),
                        (max(1, (x2 - x1) // 2), max(1, (y2 - y1) // 2)),
                        0, 0, 360, (150, 120, 110), -1)

    if person:
        draw_person()
        pb = pbox(_box_corners(torso, torso_half))
        if pb:
            boxes.append(box_from_xyxy(*pb, "person", W, H, "auto"))

    # Bar (a thin box along x)
    bb_bar = pbox(_box_corners(np.array([0.0, bar_h, bar_y]),
                               np.array([half_len + sum(p[3] for p in plates), 0.02, 0.02])))
    if bb_bar:
        x1, y1, x2, y2 = (int(v) for v in bb_bar)
        cv2.rectangle(img, (x1, y1), (x2, y2), (190, 195, 200), -1)
        boxes.append(box_from_xyxy(*bb_bar, "barbell", W, H, "auto"))

    # Plates (discs with normal = x)
    for (px, pr, col, _thick) in all_plates:
        centre = np.array([px, bar_h, bar_y])
        pts = _disc_points(centre, pr)
        bb = pbox(pts)
        if not bb:
            continue
        x1, y1, x2, y2 = (int(v) for v in bb)
        cv2.ellipse(img, ((x1 + x2) // 2, (y1 + y2) // 2),
                    (max(1, (x2 - x1) // 2), max(1, (y2 - y1) // 2)),
                    0, 0, 360, col, -1)
        cv2.ellipse(img, ((x1 + x2) // 2, (y1 + y2) // 2),
                    (max(1, (x2 - x1) // 2), max(1, (y2 - y1) // 2)),
                    0, 0, 360, (10, 10, 10), 2)
        boxes.append(box_from_xyxy(*bb, "plate", W, H, "auto"))

    # Noise
    noise = rng.normal(0, rng.uniform(2, 9), img.shape)
    img = np.clip(img.astype(np.float32) + noise, 0, 255).astype(np.uint8)

    name = f"syn_{idx:05d}.jpg"
    cv2.imwrite(str(out_dir / "frames" / name), img, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return make_record(f"frames/{name}", W, H, boxes, exercise, view)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--out", type=Path,
                    default=Path(__file__).resolve().parents[1] / "labels" / "bars_synthetic")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    (args.out / "frames").mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(args.seed)
    records = []
    for i in range(args.n):
        view = ["side", "three_quarter", "front"][i % 3]
        records.append(render_one(rng, i, args.out, "Back Squat", view))
    write_jsonl(args.out / "labels.jsonl", records)

    n_plate = sum(1 for r in records for b in r["boxes"] if b["label"] == "plate")
    print(f"rendered {len(records)} frames, {n_plate} plate boxes -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
