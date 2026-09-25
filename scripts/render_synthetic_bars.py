#!/usr/bin/env python3
"""Render synthetic barbell frames with exact labels (T3 dataset).

A small pinhole renderer draws a randomised scene — barbell with 1-3 plates per
side (structured: rim, rings, hub, bolt holes; varied size/colour), a rack, and
an occluding person (torso + head + legs) — from a random camera
(azimuth/elevation/distance/FOV **+ roll**) and emits **exact** boxes for the
plates, bar and person. Adds motion blur (a moving lift is blurry) and a
lighting gradient so the synthetic domain is closer to real ¾ footage.

No Blender, no assets; pure numpy + opencv.

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
    (22, 22, 24), (40, 40, 46), (150, 40, 40), (38, 90, 165),
    (40, 130, 60), (190, 170, 40), (205, 205, 205), (90, 90, 95),
]


def _basis(cam, target, roll):
    f = target - cam
    f = f / np.linalg.norm(f)
    up = np.array([0.0, 1.0, 0.0])
    r = np.cross(f, up)
    r = r / np.linalg.norm(r)
    u = np.cross(r, f)
    cr, sr = np.cos(roll), np.sin(roll)
    r2 = cr * r + sr * u
    u2 = -sr * r + cr * u
    return r2, u2, f


def _project(points, cam, basis, fov):
    r, u, f = basis
    d = np.atleast_2d(points) - cam
    zc = np.maximum(d @ f, 1e-6)
    focal = (H / 2) / np.tan(fov / 2)
    px = W / 2 + focal * (d @ r) / zc
    py = H / 2 - focal * (d @ u) / zc
    return np.stack([px, py], axis=1), zc


def _disc_poly(centre, radius, cam, basis, fov, n=28):
    """Exact projected outline of a disc whose normal is the world x-axis."""
    ang = np.linspace(0, 2 * np.pi, n, endpoint=False)
    pts = np.stack([
        centre + radius * (np.cos(a) * np.array([0.0, 1.0, 0.0])
                           + np.sin(a) * np.array([0.0, 0.0, 1.0]))
        for a in ang
    ])
    p2d, zc = _project(pts, cam, basis, fov)
    return p2d, zc


def _poly_bbox(p2d, zc):
    if np.any(zc <= 0.05):
        return None
    return (p2d[:, 0].min(), p2d[:, 1].min(), p2d[:, 0].max(), p2d[:, 1].max())


def _box_corners(c, half):
    cx, cy, cz = c
    hx, hy, hz = half
    return np.array([
        [cx + sx * hx, cy + sy * hy, cz + sz * hz]
        for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)
    ])


def _motion_kernel(cv2, length, angle):
    k = np.zeros((length, length), np.float32)
    c = length // 2
    dx, dy = int(np.cos(angle) * c), int(np.sin(angle) * c)
    cv2.line(k, (c - dx, c - dy), (c + dx, c + dy), 1.0, 1)
    s = float(k.sum())
    return k / s if s > 0 else k


def render_one(rng, idx, out_dir, exercise="Back Squat", view="side"):
    import cv2

    # ── Scene geometry (metres) ────────────────────────────────────────────
    scene = "bench" if rng.random() < 0.4 else "squat"
    bar_h = (rng.uniform(0.36, 0.62) if scene == "bench"
             else rng.uniform(0.9, 1.5))
    bar_y = rng.uniform(0.22, 0.38)
    half_len = rng.uniform(0.33, 0.55)
    n_plates = int(rng.integers(1, 4))  # per side
    plates = []
    x = half_len
    for _ in range(n_plates):
        r = rng.uniform(0.13, 0.225)
        thick = rng.uniform(0.03, 0.07)
        col = tuple(int(v) for v in rng.choice(PLATE_COLOURS))
        plates.append((x + thick / 2, r, col, thick))
        x += thick
    all_plates = plates + [(-p[0], p[1], p[2], p[3]) for p in plates]

    # ── Camera (+ roll) ────────────────────────────────────────────────────
    az = np.radians(rng.uniform(-88, 88))
    el = np.radians(rng.uniform(-8, 22))
    dist = rng.uniform(1.8, 3.8)
    # View follows the camera: az~0 is in front of the lifter (plates edge-on),
    # az~90 is to the side (plates face-on) — matching real clip conventions.
    a_deg = abs(np.degrees(az))
    view = "side" if a_deg > 60 else ("three_quarter" if a_deg > 30 else "front")
    roll = rng.uniform(-0.22, 0.22)
    target = np.array([0.0, bar_h, bar_y])
    cam = target + dist * np.array([
        np.sin(az) * np.cos(el), np.sin(el), np.cos(az) * np.cos(el)
    ])
    basis = _basis(cam, target, roll)
    fov = np.radians(rng.uniform(35, 65))

    bright = rng.uniform(115, 210)
    img = np.full((H, W, 3), bright, dtype=np.uint8)
    cv2.rectangle(img, (0, int(H * 0.78)), (W, H),
                  (int(bright - rng.uniform(20, 60)),) * 3, -1)

    def pbox(points):
        p2d, zc = _project(points, cam, basis, fov)
        return _poly_bbox(p2d, zc)

    boxes = []

    # Rack uprights
    for sx in (-1, 1):
        bb = pbox(_box_corners(np.array([sx * 0.75, bar_h, bar_y - 0.05]),
                               np.array([0.05, 0.9, 0.05])))
        if bb:
            x1, y1, x2, y2 = (int(v) for v in bb)
            cv2.rectangle(img, (x1, y1), (x2, y2), (68, 68, 74), -1)

    # Background clutter (gym machinery/pipes) — real footage is cluttered.
    for _ in range(int(rng.integers(2, 6))):
        c3 = np.array([rng.uniform(-1.3, 1.3), rng.uniform(0.2, 1.7),
                       rng.uniform(-0.3, 1.3)])
        h3 = np.array([rng.uniform(0.08, 0.35), rng.uniform(0.1, 0.6),
                       rng.uniform(0.08, 0.35)])
        bb = pbox(_box_corners(c3, h3))
        if bb:
            x1, y1, x2, y2 = (int(v) for v in bb)
            g = int(rng.uniform(60, 155))
            cv2.rectangle(img, (x1, y1), (x2, y2), (g, g, int(g * 1.02)), -1)

    # Bench (for a lying scene)
    if scene == "bench":
        bb = pbox(_box_corners(np.array([0.0, bar_h - 0.30, bar_y + 0.15]),
                               np.array([0.22, 0.05, 0.55])))
        if bb:
            x1, y1, x2, y2 = (int(v) for v in bb)
            cv2.rectangle(img, (x1, y1), (x2, y2), (38, 38, 44), -1)

    # Person: torso + head + two legs (occlude the bar realistically)
    person = rng.random() < 0.85
    part_boxes = []
    if scene == "bench":
        # Lying supine: torso along z at chest height, legs away, arms to the bar.
        part_boxes.append(_box_corners(np.array([0.0, bar_h - 0.16, bar_y + 0.12]),
                                       np.array([0.20, 0.13, 0.34])))
        for sx in (-1, 1):
            part_boxes.append(_box_corners(
                np.array([sx * 0.11, bar_h - 0.34, bar_y + 0.46]),
                np.array([0.08, 0.12, 0.32])))
        for sx in (-1, 1):
            part_boxes.append(_box_corners(
                np.array([sx * 0.13, bar_h - 0.02, bar_y + 0.05]),
                np.array([0.06, 0.10, 0.10])))
    else:
        leg_off = rng.uniform(0.10, 0.18)
        for sx in (-1, 1):
            part_boxes.append(_box_corners(
                np.array([sx * leg_off, bar_h - 0.75, bar_y - 0.05]),
                np.array([0.09, 0.45, 0.11])))
        part_boxes.append(_box_corners(np.array([0.0, bar_h - 0.05, bar_y - 0.10]),
                                       np.array([0.21, 0.33, 0.14])))
        # Arms (shoulder -> hands): part of the person box (whole-body convention).
        for sx in (-1, 1):
            part_boxes.append(_box_corners(
                np.array([sx * (leg_off + 0.06), bar_h - 0.22, bar_y + 0.02]),
                np.array([0.07, 0.30, 0.08])))
    if person:
        for corners in part_boxes:
            bb = pbox(corners)
            if bb:
                x1, y1, x2, y2 = (int(v) for v in bb)
                cv2.rectangle(img, (x1, y1), (x2, y2), (58, 88, 138), -1)
        hb = pbox(_box_corners(np.array([0.0, bar_h + 0.42, bar_y - 0.10]),
                               np.array([0.10, 0.11, 0.10])))
        if hb:
            x1, y1, x2, y2 = (int(v) for v in hb)
            cv2.ellipse(img, ((x1 + x2) // 2, (y1 + y2) // 2),
                        (max(1, (x2 - x1) // 2), max(1, (y2 - y1) // 2)),
                        0, 0, 360, (150, 120, 110), -1)
        allc = np.vstack(part_boxes)
        bb = pbox(allc)
        if bb:
            boxes.append(box_from_xyxy(*bb, "person", W, H, "auto"))

    # Bar (thin box along x)
    bb_bar = pbox(_box_corners(
        np.array([0.0, bar_h, bar_y]),
        np.array([half_len + sum(p[3] for p in plates), 0.02, 0.02])))
    if bb_bar:
        x1, y1, x2, y2 = (int(v) for v in bb_bar)
        cv2.rectangle(img, (x1, y1), (x2, y2), (188, 192, 198), -1)
        boxes.append(box_from_xyxy(*bb_bar, "barbell", W, H, "auto"))

    # Plates — structured discs (rim + rings + hub + bolt holes)
    for (px, pr, col, thick) in all_plates:
        centre = np.array([px, bar_h, bar_y])
        p2d, zc = _disc_poly(centre, pr, cam, basis, fov)
        bb = _poly_bbox(p2d, zc)
        if not bb:
            continue
        poly = np.round(p2d).astype(np.int32)
        cv2.fillPoly(img, [poly], col)
        # rim
        cv2.polylines(img, [poly], True, (12, 12, 12), 3)
        # inner rings
        for frac, t in ((0.8, 2), (0.55, 2)):
            r2d, _ = _disc_poly(centre, pr * frac, cam, basis, fov)
            cv2.polylines(img, [np.round(r2d).astype(np.int32)], True,
                          tuple(int(c * 0.35) for c in col), t)
        # hub
        hub, _ = _disc_poly(centre, pr * 0.2, cam, basis, fov)
        cv2.fillPoly(img, [np.round(hub).astype(np.int32)],
                     tuple(min(255, int(c * 1.5) + 40) for c in col))
        # bolt holes
        ring_col = tuple(max(0, int(c * 0.5)) for c in col)
        for a in np.linspace(0, 2 * np.pi, 6, endpoint=False):
            hc = centre + pr * 0.55 * (np.cos(a) * np.array([0.0, 1.0, 0.0])
                                       + np.sin(a) * np.array([0.0, 0.0, 1.0]))
            hp, hz = _disc_poly(hc, pr * 0.06, cam, basis, fov)
            if np.all(hz > 0.05):
                cv2.fillPoly(img, [np.round(hp).astype(np.int32)], ring_col)
        # Calibrated-plate style: large cut-outs (the disc reads as a ring).
        if rng.random() < 0.5:
            bg = (int(bright), int(bright), int(bright))
            for a in np.linspace(0, 2 * np.pi, 3, endpoint=False):
                hc = centre + pr * 0.55 * (
                    np.cos(a) * np.array([0.0, 1.0, 0.0])
                    + np.sin(a) * np.array([0.0, 0.0, 1.0]))
                hp, hz = _disc_poly(hc, pr * 0.19, cam, basis, fov)
                if np.all(hz > 0.05):
                    cv2.fillPoly(img, [np.round(hp).astype(np.int32)], bg)
        boxes.append(box_from_xyxy(*bb, "plate", W, H, "auto"))

    # Lighting gradient (top-lit), motion blur, sensor noise
    grad = np.linspace(1.06, 0.88, H, dtype=np.float32).reshape(-1, 1, 1)
    img = np.clip(img.astype(np.float32) * grad, 0, 255)
    if rng.random() < 0.6:
        klen = int(rng.integers(3, 11))
        ang = rng.uniform(0, np.pi)
        img = cv2.filter2D(img, -1, _motion_kernel(cv2, klen, ang))
    img = np.clip(img + rng.normal(0, rng.uniform(2, 8), img.shape), 0, 255).astype(np.uint8)

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
        records.append(render_one(rng, i, args.out, "Back Squat"))
    write_jsonl(args.out / "labels.jsonl", records)

    n_plate = sum(1 for r in records for b in r["boxes"] if b["label"] == "plate")
    print(f"rendered {len(records)} frames, {n_plate} plate boxes -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
