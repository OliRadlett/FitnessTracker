#!/usr/bin/env python3
"""Can CoTracker3 fill the frames YOLO-World misses?

YOLO-World zero-shot finds the barbell in ~41% of frames (accurately). This
test seeds CoTracker3 with those detections and propagates the bar through the
whole clip, then scores the fused track against the human plate labels.

  python scripts/eval_cotracker.py prepare --clip 0df141e8-VID_20251213144529
  python scripts/eval_cotracker.py eval    --clip 0df141e8-VID_20251213144529

Frames are extracted with the *same* ffmpeg trim + 10 fps as the labelling
pipeline (`autolabel_bars.py`), so GT frame index k maps to 10 fps index 5*k.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from bar_labels import box_to_xyxy_norm  # noqa: E402

DATA = Path(os.environ.get("TRACKING_DATA",
                           r"C:\Users\oradl\FitnessTracker\labels\bars"))
VIDEOS = Path(os.environ.get("TRACKING_VIDEOS",
                             r"C:\Users\oradl\FitnessTracker\backend\tests\fixtures\videos"))
STAGE = REPO_ROOT / "labels" / "ct_eval"
FPS = 10.0
PROMPTS = ["barbell", "weight plate", "dumbbell"]


def all_clips() -> list[str]:
    clips = set()
    for line in (DATA / "labels.human.jsonl").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if any(b.get("source") == "human" and b["label"] == "plate"
               for b in rec["boxes"]):
            clips.add(Path(rec["image"]).stem.rsplit("_", 1)[0])
    return sorted(clips)


def _gt_for_clip(clip: str) -> dict[int, list[float]]:
    gt: dict[int, list[float]] = {}
    for line in (DATA / "labels.human.jsonl").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        stem = Path(rec["image"]).stem
        if not stem.startswith(clip):
            continue
        idx = int(stem.rsplit("_", 1)[1])
        plates = [b for b in rec["boxes"]
                  if b.get("source") == "human" and b["label"] == "plate"]
        if plates:
            b = max(plates, key=lambda x: x["w"] * x["h"])
            gt[int(round(idx * FPS / 2.0))] = list(box_to_xyxy_norm(b))
    return gt


def prepare(clip: str, exercise: str, proxy_fps: float = 2.0) -> int:
    import run_video_local as rvl

    sys.path.insert(0, str(REPO_ROOT / "backend"))

    video = next((p for p in sorted(VIDEOS.glob(f"{clip}.*"))
                  if p.suffix.lower() in {".mp4", ".mov", ".m4v", ".avi", ".mkv"}), None)
    if video is None:
        print(f"no video for {clip} in {VIDEOS}")
        return 1
    out = STAGE / clip
    frames_dir = out / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    for old in frames_dir.glob("*.jpg"):
        old.unlink()

    duration = rvl.probe_duration(video)
    trim_start, trim_end = rvl.trim_points(rvl.detect_scenes(video, duration), duration)
    subprocess.run(
        ["ffmpeg", "-y", "-ss", str(trim_start), "-to", str(trim_end),
         "-i", str(video), "-vf", f"fps={FPS}", "-q:v", "2",
         "-start_number", "0", str(frames_dir / "frame_%04d.jpg")],
        capture_output=True, timeout=300, check=True,
    )
    n = len(list(frames_dir.glob("*.jpg")))
    gt = _gt_for_clip(clip)

    # Pose proxy per frame (MediaPipe hands) — the coarse bar estimate the
    # production pipeline already has; used to disambiguate the detector.
    import tempfile

    from app.integrations.bar_tracking import _proxy_point
    from app.integrations.pose_analysis import extract_pose_track

    tmp = Path(tempfile.mkdtemp(prefix="proxy_"))
    tr = extract_pose_track(video, str(tmp), trim_start, trim_end,
                            fps=proxy_fps, num_poses=1)
    step = max(1, int(round(FPS / proxy_fps)))
    proxy: list = [None] * n
    for rec in tr.get("records", []):
        lm = rec.get("landmarks")
        if lm is None:
            continue
        p = _proxy_point(lm, exercise)
        if p:
            fi = int(rec["frame_idx"]) * step
            if 0 <= fi < n:
                proxy[fi] = [round(float(p[0]), 4), round(float(p[1]), 4)]
    import shutil as _sh
    _sh.rmtree(tmp, ignore_errors=True)
    (out / "proxy.json").write_text(json.dumps(proxy), encoding="utf-8")

    # Alignment check: GT 2 fps frame k should equal 10 fps frame 5k.
    import cv2
    import numpy as np

    diffs = []
    for k, _ in sorted(gt.items()):
        src = DATA / "frames" / f"{clip}_{k // 5:04d}.jpg"
        dst = frames_dir / f"frame_{k:04d}.jpg"
        if src.exists() and dst.exists():
            a = cv2.imread(str(src))
            b = cv2.imread(str(dst))
            if a is not None and b is not None:
                b = cv2.resize(b, (a.shape[1], a.shape[0]))
                diffs.append(float(np.mean(np.abs(a.astype(int) - b.astype(int)))))
    (out / "meta.json").write_text(json.dumps({
        "clip": clip, "video": str(video), "trim_start": trim_start,
        "trim_end": trim_end, "fps": FPS, "frames": n,
        "gt": {str(k): v for k, v in gt.items()},
    }), encoding="utf-8")
    n_proxy = sum(1 for p in proxy if p)
    print(f"{clip}: {n} frames, {len(gt)} GT points, proxy={n_proxy}/{n}, "
          f"align mean|diff|={sum(diffs) / len(diffs):.1f} (n={len(diffs)})")
    return 0


def evaluate(clip: str, gpu: str, conf: float, model: str,
             seed_mode: str) -> int:
    import modal

    app = modal.App("fittrack-cotracker-eval")
    image = (
        modal.Image.debian_slim()
        .apt_install("git", "libgl1", "libglib2.0-0")
        .pip_install("ultralytics",
                     "git+https://github.com/ultralytics/CLIP.git",
                     "git+https://github.com/facebookresearch/co-tracker.git")
        .add_local_dir(str(STAGE / clip), "/data", copy=True)
    )

    @app.function(image=image, gpu=gpu, timeout=3600, serialized=True)
    def run() -> dict:
        import os as _os

        _os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

        import glob

        import cv2
        import numpy as np
        import torch
        from ultralytics import YOLO

        paths = sorted(glob.glob("/data/frames/*.jpg"))
        H, W = 360, 640
        video_np = np.stack([cv2.resize(cv2.imread(p)[:, :, ::-1], (W, H))
                             for p in paths])

        proxy = json.loads(open("/data/proxy.json").read())
        proxy_seeds = [[i] + proxy[i] for i in range(len(proxy)) if proxy[i]]

        box_frames = tot_boxes = 0
        max_conf = 0.0
        seed_conf: list = []
        if seed_mode == "proxy":
            seed_norm = [[i, x, y] for i, x, y in proxy_seeds if i % 5 == 0]
        else:
            det = YOLO(model)
            det.set_classes(PROMPTS)
            seed_norm = []
            for i, p in enumerate(paths):
                r = det.predict(p, conf=conf, verbose=False, imgsz=640)[0]
                if r.boxes is None or not len(r.boxes):
                    continue
                box_frames += 1
                tot_boxes += len(r.boxes)
                confs = r.boxes.conf.tolist()
                max_conf = max(max_conf, max(confs))
                xy = r.boxes.xyxyn.tolist()
                cx = [(b[0] + b[2]) / 2 for b in xy]
                cy = [(b[1] + b[3]) / 2 for b in xy]
                if i < len(proxy) and proxy[i]:
                    px, py = proxy[i]
                    dist = [((a - px) ** 2 + (b - py) ** 2) ** 0.5
                            for a, b in zip(cx, cy)]
                    k = int(np.argmin(dist))
                    if dist[k] > 0.20:
                        continue
                else:
                    k = int(np.argmax(confs))
                seed_norm.append([i, cx[k], cy[k]])
                seed_conf.append(confs[k])
            del det
            torch.cuda.empty_cache()

        queries = [[i, x * W, y * H] for i, x, y in seed_norm]
        gold = {
            "seeds": len(queries), "frames": len(paths),
            "box_frames": box_frames, "tot_boxes": tot_boxes,
            "max_conf": round(max_conf, 3), "proxy_n": len(proxy_seeds),
            "seed_norm": seed_norm, "mode": seed_mode,
            "seed_conf_mean": round(float(np.mean(seed_conf)), 3) if seed_conf else 0,
        }
        if not queries:
            gold["track"] = []
            gold["note"] = "no seeds"
            return gold

        cotracker = torch.hub.load("facebookresearch/co-tracker",
                                   "cotracker3_offline").eval().cuda()
        vid = (torch.from_numpy(video_np).permute(0, 3, 1, 2)[None]
               .float().cuda() / 255.0)
        q = torch.tensor(queries, dtype=torch.float32)[None].cuda()
        with torch.no_grad():
            tracks, vis = cotracker(vid, queries=q)
        tracks = tracks[0].cpu().numpy()
        vis = vis[0].cpu().numpy()

        bar = []
        for t in range(tracks.shape[0]):
            m = vis[t] > 0.5
            bar.append(None if m.sum() == 0 else
                       [float(np.median(tracks[t, m, 0]) / W),
                        float(np.median(tracks[t, m, 1]) / H)])
        gold["track"] = bar
        gold["proxy"] = proxy_seeds
        return gold

    with app.run():
        return run.remote()


def evaluate_all(gpu: str, conf: float, model: str, seed_mode: str) -> int:
    import modal

    app = modal.App("fittrack-cotracker-all")
    image = (
        modal.Image.debian_slim()
        .apt_install("git", "libgl1", "libglib2.0-0")
        .pip_install("ultralytics",
                     "git+https://github.com/ultralytics/CLIP.git",
                     "git+https://github.com/facebookresearch/co-tracker.git")
        .add_local_dir(str(STAGE), "/data", copy=True)
    )

    @app.function(image=image, gpu=gpu, timeout=7200, serialized=True)
    def run() -> dict:
        import os as _os

        _os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

        import glob

        import cv2
        import numpy as np
        import torch
        from ultralytics import YOLO

        out: dict = {}
        cotracker = None
        det = YOLO(model) if seed_mode != "proxy" else None
        if det is not None:
            det.set_classes(PROMPTS)
        for d in sorted(glob.glob("/data/*/")):
            clip = d.rstrip("/").split("/")[-1]
            paths = sorted(glob.glob(d + "frames/*.jpg"))
            if not paths:
                continue
            H, W = 360, 640
            video_np = np.stack([cv2.resize(cv2.imread(p)[:, :, ::-1], (W, H))
                                 for p in paths])
            proxy = json.loads(open(d + "proxy.json").read())
            proxy_pts = [[i, v[0], v[1]] for i, v in enumerate(proxy) if v]
            if seed_mode == "proxy":
                seed_norm = [p for p in proxy_pts if p[0] % 5 == 0]
            else:
                seed_norm = []
                for i, p in enumerate(paths):
                    r = det.predict(p, conf=conf, verbose=False, imgsz=640)[0]
                    if r.boxes is None or not len(r.boxes):
                        continue
                    xy = r.boxes.xyxyn.tolist()
                    cx = [(b[0] + b[2]) / 2 for b in xy]
                    cy = [(b[1] + b[3]) / 2 for b in xy]
                    if i < len(proxy) and proxy[i]:
                        px, py = proxy[i]
                        dist = [((a - px) ** 2 + (b - py) ** 2) ** 0.5
                                for a, b in zip(cx, cy)]
                        k = int(np.argmin(dist))
                        if dist[k] > 0.20:
                            continue
                    else:
                        k = int(np.argmax(r.boxes.conf.tolist()))
                    seed_norm.append([i, cx[k], cy[k]])
            if not seed_norm:
                out[clip] = {"track": [], "proxy": proxy_pts}
                continue
            if cotracker is None:
                cotracker = torch.hub.load("facebookresearch/co-tracker",
                                           "cotracker3_offline").eval().cuda()
            del video_np
            torch.cuda.empty_cache()
            bar = [None] * len(paths)
            win, ov = 150, 20
            start = 0
            while start < len(paths):
                end = min(start + win, len(paths))
                sub = np.stack([cv2.resize(cv2.imread(p)[:, :, ::-1], (W, H))
                                for p in paths[start:end]])
                wseed = [s for s in seed_norm if start <= s[0] < end]
                if wseed:
                    q = torch.tensor([[s[0] - start, s[1] * W, s[2] * H]
                                      for s in wseed],
                                     dtype=torch.float32)[None].cuda()
                    vid = (torch.from_numpy(sub).permute(0, 3, 1, 2)[None]
                           .float().cuda() / 255.0)
                    with torch.no_grad():
                        tr_w, vis_w = cotracker(vid, queries=q)
                    tr_w = tr_w[0].cpu().numpy()
                    vis_w = vis_w[0].cpu().numpy()
                    for t in range(tr_w.shape[0]):
                        m = vis_w[t] > 0.5
                        if m.sum():
                            bar[start + t] = [
                                float(np.median(tr_w[t, m, 0]) / W),
                                float(np.median(tr_w[t, m, 1]) / H)]
                    del vid, q, sub, tr_w, vis_w
                else:
                    del sub
                torch.cuda.empty_cache()
                if end == len(paths):
                    break
                start = end - ov
            out[clip] = {"track": bar, "proxy": proxy_pts,
                         "seeds": len(seed_norm)}
        return out

    with app.run():
        result = run.remote()

    import statistics

    rows, all_t, all_p = [], [], []
    for clip in sorted(result):
        r = result[clip]
        gt = _gt_for_clip(clip)
        track = r.get("track") or []
        prox = {int(p[0]): (p[1], p[2]) for p in r.get("proxy", [])}
        te, pe = [], []
        for k, g in sorted(gt.items()):
            gx, gy = (g[0] + g[2]) / 2, (g[1] + g[3]) / 2
            if k < len(track) and track[k]:
                t = track[k]
                te.append(((t[0] - gx) ** 2 + (t[1] - gy) ** 2) ** 0.5)
            pr = prox.get(k)
            if pr:
                pe.append(((pr[0] - gx) ** 2 + (pr[1] - gy) ** 2) ** 0.5)
        all_t += te
        all_p += pe
        rows.append((clip, len(te),
                     statistics.mean(te) if te else None,
                     statistics.mean(pe) if pe else None))

    print(f"{'clip':<38} {'n':>3} {'track':>7} {'proxy':>7}  win")
    for clip, n, t, p in rows:
        win = "" if (t is None or p is None) else ("YOLO" if t < p else "proxy")
        print(f"{clip[:37]:<38} {n:>3} "
              f"{'--' if t is None else f'{t:.3f}':>7} "
              f"{'--' if p is None else f'{p:.3f}':>7}  {win}")
    if all_t:
        print(f"\nOVERALL ({len(all_t)} GT pts across {len(rows)} clips): "
              f"CoTracker={statistics.mean(all_t):.3f}  proxy={statistics.mean(all_p):.3f}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for cmd in ("prepare", "eval", "eval-all"):
        p = sub.add_parser(cmd)
        if cmd == "prepare":
            p.add_argument("--clip")
            p.add_argument("--all", action="store_true")
            p.add_argument("--exercise", default="Back Squat")
            p.add_argument("--proxy-fps", type=float, default=2.0)
        else:
            if cmd == "eval":
                p.add_argument("--clip", required=True)
            p.add_argument("--gpu", default="T4")
            p.add_argument("--conf", type=float, default=0.05)
            p.add_argument("--model", default="yolov8x-worldv2.pt")
            p.add_argument("--seed", dest="seed_mode", default="det",
                           choices=["det", "proxy"])
    args = ap.parse_args()

    if args.cmd == "prepare":
        clips = all_clips() if args.all else [args.clip]
        if not clips or clips == [None]:
            print("no clip given")
            return 1
        for c in clips:
            prepare(c, args.exercise, args.proxy_fps)
        return 0
    if args.cmd == "eval-all":
        return evaluate_all(args.gpu, args.conf, args.model, args.seed_mode)
    result = evaluate(args.clip, args.gpu, args.conf, args.model, args.seed_mode)

    meta = json.loads((STAGE / args.clip / "meta.json").read_text())
    gt = {int(k): v for k, v in meta["gt"].items()}
    track = result.get("track")
    print(f"seeds={result['seeds']}/{result['frames']} "
          f"box_frames={result.get('box_frames')} tot_boxes={result.get('tot_boxes')} "
          f"max_conf={result.get('max_conf')} proxy_n={result.get('proxy_n')} "
          f"tracked={sum(1 for t in (track or []) if t)}/{result.get('frames')}")
    if result.get("seed_norm"):
        print("first seeds [frame, x, y]:",
              [[s[0], round(s[1], 3), round(s[2], 3)]
               for s in result["seed_norm"][:6]])
    if track:
        prox = {int(p[0]): (p[1], p[2]) for p in result.get("proxy", [])}
        for k, g in sorted(gt.items()):
            gx, gy = (g[0] + g[2]) / 2, (g[1] + g[3]) / 2
            t = track[k] if k < len(track) else None
            pr = prox.get(k)
            print(f"  k={k:<4} gt=({gx:.3f},{gy:.3f}) "
                  f"track={'None' if not t else f'({t[0]:.3f},{t[1]:.3f})'} "
                  f"proxy={'None' if not pr else f'({pr[0]:.3f},{pr[1]:.3f})'}")
    if track:
        errs = []
        for k, g in sorted(gt.items()):
            if k < len(track) and track[k]:
                t = track[k]
                errs.append(((t[0] - (g[0] + g[2]) / 2) ** 2
                             + (t[1] - (g[1] + g[3]) / 2) ** 2) ** 0.5)
        perrs = []
        for k, g in sorted(gt.items()):
            pr = prox.get(k)
            if pr:
                perrs.append(((pr[0] - (g[0] + g[2]) / 2) ** 2
                              + (pr[1] - (g[1] + g[3]) / 2) ** 2) ** 0.5)
        if perrs:
            print(f"raw proxy baseline: GT-n={len(perrs)} "
                  f"mean_err={sum(perrs) / len(perrs):.3f}")
        if errs:
            print(f"CoTracker track: GT-n={len(errs)} mean_err={sum(errs) / len(errs):.3f} "
                  f"median_err={sorted(errs)[len(errs) // 2]:.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
