#!/usr/bin/env python3
"""Metric 3D bar-tracking prototype (steps 1-2 of plans/bar-tracking-3d.md).

Calibration, and what each known measurement buys us:

| input | how it is used | why it helps |
|---|---|---|
| pose (world landmarks) | `s_body` = px-per-metre *at the body* (least squares over all landmarks vs the hip midpoint) | well-conditioned; a single ratio needs no focal |
| `--fov` (or `--focal`) | focal `f = (W/2) / tan(fov/2)`; `Z_body = f / s_body` | the focal is **unidentifiable from a single body** (its depth span is small) — a plausible camera FOV fixes it |
| `--height` | rescales the world landmarks so head->heel = real height | MediaPipe's metric scale uses an *average-body prior*; corrects `s_body` (and therefore `Z_body`) |
| `--plate-diameter` | `Z_plate = f*D / w_px` per plate | the bar's **depth**, which no 2-D lift can give (0.45 m for bumper/competition plates) |

Everything is then put in **camera coordinates** and the bar's offset from the
midfoot is projected onto the world-landmark body axes -> view-independent mm.

    python scripts/investigate_3d_bar.py --height 1.80 --plate-diameter 0.45
"""

from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.integrations.bar_detection import detect_bars_onnx
from app.integrations.pose_analysis import extract_pose_track

VIDEOS = Path(r"C:\Users\oradl\FitnessTracker\backend\tests\fixtures\videos")
MODEL = REPO_ROOT / "labels" / "bar_detector.onnx"
HEEL, FOOT = (29, 30), (31, 32)
WRIST, SHOULDER = (15, 16), (11, 12)
HIP = (23, 24)


def _px_per_m(uv: np.ndarray, xyz: np.ndarray, origin: int) -> float:
    """Least-squares px-per-metre of the image vs metric body landmarks."""
    d_img = np.linalg.norm(uv - uv[origin], axis=1)
    d_world = np.linalg.norm(xyz - xyz[origin], axis=1)
    denom = float(d_world @ d_world)
    return float((d_img @ d_world) / denom) if denom > 1e-9 else 0.0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--clip", default="49403afc-VID_20260920_172630")
    ap.add_argument("--video", type=Path, default=None)
    ap.add_argument("--exercise", default="Back Squat")
    ap.add_argument("--fov", type=float, default=66.0,
                    help="horizontal FOV in degrees (typical phone ~66)")
    ap.add_argument("--focal", type=float, default=None,
                    help="focal in px (overrides --fov)")
    ap.add_argument("--height", type=float, default=None,
                    help="lifter height (m) — corrects MediaPipe's body prior")
    ap.add_argument("--plate-diameter", type=float, default=None,
                    help="plate diameter (m), 0.45 for bumpers/calibration")
    ap.add_argument("--model", type=Path, default=MODEL)
    ap.add_argument("--fps", type=float, default=10.0)
    args = ap.parse_args()

    video = args.video or next(iter(VIDEOS.glob(f"{args.clip}.*")))
    cap = cv2.VideoCapture(str(video))
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    dur = cap.get(cv2.CAP_PROP_FRAME_COUNT) / max(cap.get(cv2.CAP_PROP_FPS), 1)
    cap.release()
    f = args.focal or (W / 2) / np.tan(np.radians(args.fov) / 2)
    print(f"{video.name}  {W}x{H}  {dur:.1f}s  focal={f:.0f}px")

    tmp = Path(tempfile.mkdtemp(prefix="bar3d_"))
    tr = extract_pose_track(video, str(tmp), 0.0, dur, fps=args.fps, num_poses=1)
    lms, world = tr["landmarks"], tr["world"]
    frames = sorted(tmp.glob("pose_*.jpg"))

    # One robust height scale per clip (a per-frame scale is wrecked by a single
    # bad pose frame). MediaPipe's world scale uses an average-body prior;
    # head-to-heel is the standing-height proxy.
    hscale = 1.0
    if args.height:
        ests = []
        for wl in world:
            if wl is None:
                continue
            head = np.array([wl[0].x, wl[0].y, wl[0].z])
            heel = (np.array([wl[29].x, wl[29].y, wl[29].z])
                    + np.array([wl[30].x, wl[30].y, wl[30].z])) / 2
            e = float(np.linalg.norm(head - heel))
            if 0.5 < e < 1.9:
                ests.append(e)
        if ests:
            hscale = args.height / float(np.median(ests))
            print(f"height scale {hscale:.3f} "
                  f"(median head->heel {np.median(ests):.3f} m)")

    z_body, vert, fb_mm, lat_mm, span_px = [], [], [], [], []
    dbg_n = 0
    for i, fp in enumerate(frames):
        lm = lms[i] if i < len(lms) else None
        wl = world[i] if i < len(world) else None
        if lm is None or wl is None:
            continue
        img = cv2.imread(str(fp))
        if img is None:
            continue

        uv = np.array([[p.x * W, p.y * H] for p in lm], dtype=float)
        xyz = np.array([[p.x, p.y, p.z] for p in wl], dtype=float)
        if hscale != 1.0:  # correct MediaPipe's average-body prior
            xyz = xyz * hscale

        s = _px_per_m(uv, xyz, (HIP[0] + HIP[1]) // 2)
        if s <= 1.0:
            continue
        zb = f / s                      # body distance from the camera (m)
        # Principal point ~ the image centre (phone cameras). Fitting it from
        # the pose with a weak-perspective model biases it badly (~300px on a
        # 1080 frame) and that bias lands straight in the lateral metric.
        cx, cy = W / 2, H / 2

        def cam(u: float, v: float, Z: float, cx: float = cx,
                cy: float = cy, f: float = f) -> np.ndarray:
            return np.array([(u - cx) * Z / f, (v - cy) * Z / f, Z])

        # The bar sits at the shoulders (squat) / the hands (press): use the
        # world z of the *relevant* joints, not the hips, so a forward lean is
        # accounted for. This is the depth the naive hip-depth lift gets wrong.
        ref = SHOULDER if "squat" in args.exercise.lower() else WRIST
        z_bar = zb + float(np.mean([xyz[k][2] for k in ref]))

        dets = detect_bars_onnx(img, str(args.model), conf=0.25)
        plates = sorted((d for d in dets if d["label"] == "plate"),
                        key=lambda d: d["confidence"], reverse=True)[:2]
        if len(plates) < 2:
            continue

        # --- bar: each plate at its own depth --------------------------------
        pts = []
        for p in plates:
            upx, vpx, wpx = p["x"] * W, p["y"] * H, p["w"] * W
            Z = (f * args.plate_diameter / wpx) if (
                args.plate_diameter and wpx > 1) else z_bar
            pts.append(cam(upx, vpx, Z))
        bar = (pts[0] + pts[1]) / 2

        # --- midfoot in camera coords (world landmarks are hip-centred) ------
        hip = (xyz[HIP[0]] + xyz[HIP[1]]) / 2
        heel = (xyz[HEEL[0]] + xyz[HEEL[1]]) / 2
        toe = (xyz[FOOT[0]] + xyz[FOOT[1]]) / 2
        # world landmarks are hip-centred but camera-axis-aligned, so the
        # midfoot relative to the hips adds straight onto the hip's camera pos.
        hip_cam = cam((uv[HIP[0], 0] + uv[HIP[1], 0]) / 2,
                      (uv[HIP[0], 1] + uv[HIP[1], 1]) / 2, zb)
        midfoot_cam = hip_cam + ((heel + toe) / 2 - hip)

        fwd = toe - heel
        fwd = fwd / (np.linalg.norm(fwd) + 1e-9)
        lat = np.array([1.0, 0.0, 0.0])
        lat = lat - fwd * float(lat @ fwd)
        lat = lat / (np.linalg.norm(lat) + 1e-9)

        off = bar - midfoot_cam
        if dbg_n < 12 and i % 30 == 0:
            dbg_n += 1
            ub = (plates[0]["x"] + plates[1]["x"]) / 2 * W
            print(f"  frame {i}: u_hip={uv[HIP[0], 0]:.0f}px u_bar={ub:.0f}px "
                  f"cx={cx:.0f} s={s:.0f}px/m zb={zb:.2f}m z_bar={z_bar:.2f}m "
                  f"hip=(uv[HIP[0],0]-cx)*zb/f={(uv[HIP[0], 0] - cx) * zb / f:+.3f} "
                  f"bar.x={bar[0]:+.3f} midfoot.x={midfoot_cam[0]:+.3f} "
                  f"off=({off[0]:+.3f},{off[1]:+.3f},{off[2]:+.3f})")
        z_body.append(zb)
        vert.append(1000 * float(off[1]))
        fb_mm.append(1000 * float(off @ fwd))
        lat_mm.append(1000 * float(off @ lat))
        span_px.append(float(np.hypot(plates[0]["x"] - plates[1]["x"],
                                      plates[0]["y"] - plates[1]["y"])) * W)

    def stats(name, vals, unit="mm"):
        a = np.array(vals)
        if not a.size:
            print(f"{name:<20} n=0")
            return
        print(f"{name:<20} n={a.size:>3} median={np.median(a):>7.1f}{unit} "
              f"p10={np.percentile(a,10):>7.1f} p90={np.percentile(a,90):>7.1f}")

    print(f"\nusable frames: {len(vert)}")
    stats("subject distance", z_body, unit="m")
    stats("bar height vs foot", vert)
    stats("front-back", fb_mm)
    stats("lateral", lat_mm)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
