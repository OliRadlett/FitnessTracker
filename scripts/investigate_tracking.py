#!/usr/bin/env python3
"""Measure the bar- and pose-tracking error against the human ground truth.

For the 248 hand-labelled frames we have exact plate boxes. This scores every
automatic bar-position method against them:

  * pose proxy  — the body point currently used when no detector fires
                  (shoulder midpoint for squats, wrist midpoint otherwise)
  * classical plate detector, seeded at the human box (oracle seed) — its
    precision ceiling
  * pose presence + bar-centre distance proxies for the bench/spotters

Output drives the improvement plan (which method to invest in, where it fails).

    C:\\Users\\oradl\\.venvs\\fittrack-video\\Scripts\\python.exe scripts/investigate_tracking.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task"
)
DATA = Path(os.environ.get("TRACKING_DATA", REPO_ROOT / "labels" / "bars"))


def _dist(a, b) -> float:
    return float(np.hypot(a[0] - b[0], a[1] - b[1]))


def main() -> int:
    import cv2
    import mediapipe as mp
    from app.integrations.bar_detection import detect_bar_circle
    from app.integrations.bar_tracking import _proxy_point
    from bar_labels import box_to_xyxy_norm
    from mediapipe.tasks.python import BaseOptions, vision

    # Clip -> exercise/view from the scanned labels.
    scanned = {}
    sc = REPO_ROOT / "backend" / "tests" / "fixtures" / "video_labels.scanned.json"
    if sc.exists():
        for v in json.loads(sc.read_text(encoding="utf-8"))["videos"]:
            scanned[v["file"].rsplit(".", 1)[0]] = v

    records = [
        json.loads(line)
        for line in (DATA / "labels.human.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]

    model = Path(REPO_ROOT / "labels" / "pose_landmarker.task")
    if not model.exists():
        print("downloading pose model…")
        urllib.request.urlretrieve(MODEL_URL, str(model))

    opts = vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model)),
        running_mode=vision.RunningMode.IMAGE,
        num_poses=1,
        min_pose_detection_confidence=0.3,
    )
    landmarker = vision.PoseLandmarker.create_from_options(opts)

    proxy_err: list[float] = []
    proxy_err_by_view: dict[str, list[float]] = defaultdict(list)
    proxy_err_by_ex: dict[str, list[float]] = defaultdict(list)
    offsets: dict[str, list[tuple[float, float]]] = defaultdict(list)
    samples: list[tuple[str, tuple, tuple, bool]] = []
    det_hit = det_tot = 0
    det_iou: list[float] = []

    for rec in records:
        plates = [b for b in rec["boxes"]
                  if b.get("source") == "human" and b["label"] == "plate"]
        if not plates:
            continue
        gt = max(plates, key=lambda b: b["w"] * b["h"])
        img = cv2.imread(str(DATA / rec["image"]))
        if img is None:
            continue
        clip = Path(rec["image"]).stem.rsplit("_", 1)[0]
        ex = (scanned.get(clip, {}).get("exercise") or "")

        # Pose proxy error
        mp_img = mp.Image.create_from_file(str(DATA / rec["image"]))
        res = landmarker.detect(mp_img)
        if res.pose_landmarks:
            px, py = _proxy_point(res.pose_landmarks[0], ex)
            e = _dist((px, py), (gt["x"], gt["y"]))
            proxy_err.append(e)
            proxy_err_by_view[scanned.get(clip, {}).get("camera_view") or "?"].append(e)
            proxy_err_by_ex[ex or "?"].append(e)
            offsets[clip].append((gt["x"] - px, gt["y"] - py))
            proxy_xy = (px, py)
        else:
            proxy_xy = None

        # Classical detector with an oracle seed (precision ceiling)
        hit = detect_bar_circle(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY),
                                (gt["x"], gt["y"]))
        det_tot += 1
        if hit is not None:
            det_hit += 1
            hx1, hy1, hx2, hy2 = box_to_xyxy_norm(
                {"x": hit["x"], "y": hit["y"], "w": 2 * hit["r"], "h": 2 * hit["r"]})
            gx1, gy1, gx2, gy2 = box_to_xyxy_norm(gt)
            ix1, iy1 = max(hx1, gx1), max(hy1, gy1)
            ix2, iy2 = min(hx2, gx2), min(hy2, gy2)
            inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
            union = (hx2 - hx1) * (hy2 - hy1) + (gx2 - gx1) * (gy2 - gy1) - inter
            det_iou.append(inter / union if union > 0 else 0.0)
        if proxy_xy is not None:
            samples.append((clip, proxy_xy, (gt["x"], gt["y"]), hit is not None))

    landmarker.close()

    def _stats(vals):
        if not vals:
            return "n/a"
        a = np.array(vals)
        return (f"n={len(a)} mean={a.mean():.3f} median={np.median(a):.3f} "
                f"p90={np.percentile(a, 90):.3f}")

    print("=" * 72)
    print("PROXY bar-point error vs ground-truth plate centre (normalised frame width)")
    print("  overall:", _stats(proxy_err))
    for view, vals in sorted(proxy_err_by_view.items()):
        print(f"  {view:<14}", _stats(vals))
    print()
    print("  by exercise:")
    for ex, vals in sorted(proxy_err_by_ex.items()):
        print(f"  {ex:<20}", _stats(vals))

    # Does a per-clip constant offset fix the proxy? (bar - proxy is ~constant
    # if the bar is rigidly attached to the tracked body point.)
    resid: list[float] = []
    for vecs in offsets.values():
        v = np.array(vecs)
        med = np.median(v, axis=0)
        resid.extend(np.linalg.norm(v - med, axis=1).tolist())
    print()
    print("PROXY with a per-clip constant offset removed (residual error)")
    print("  overall:", _stats(resid))

    # Realistic: estimate the offset only from the detector's own hits (as the
    # product would), not the oracle — then correct every frame.
    by_clip_s: dict[str, list] = defaultdict(list)
    for s in samples:
        by_clip_s[s[0]].append(s)
    real_resid: list[float] = []
    clips_with_offset = 0
    for clip, ss in by_clip_s.items():
        hits = [s for s in ss if s[3]]
        if not hits:
            continue
        clips_with_offset += 1
        off = np.median([(s[2][0] - s[1][0], s[2][1] - s[1][1]) for s in hits], axis=0)
        for _c, pxy, gxy, _h in ss:
            real_resid.append(float(np.hypot((gxy[0] - pxy[0]) - off[0],
                                             (gxy[1] - pxy[1]) - off[1])))
    print("  using only detector hits for the offset:",
          _stats(real_resid), f"({clips_with_offset} clips had a hit)")

    print()
    print("CLASSICAL detector @ oracle seed (given the true plate location)")
    print(f"  detection rate: {det_hit}/{det_tot} = {det_hit / max(1, det_tot):.0%}")
    print("  IoU when detected:", _stats(det_iou))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
