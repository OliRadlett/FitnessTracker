# Bar detector retrain (real-heavy) — work plan

## Why (measured 2026-09-29, see `plans/bar-tracking-3d.md` validation section)

The deployed `bar_detector.onnx` (25/09 retrain, yolov8n, 232 human + 1500
synthetic → 63% synthetic) keys on clean renders and barely sees real plates:

| Set | Plate recall@0.35 | Barbell recall@0.35 |
|---|---|---|
| Synthetic train images | 0.89 | 1.00 (5/5) |
| Real train images | 0.20 | — |
| 248 post-training human frames (fair subset) | 0.26 | 0.09 (0.02 @0.35) |

Threshold tuning is proven futile (flat recall 0.05–0.25 — bimodal scores, no
operating point). The metric-3D path (PRs #179/#182, merged) is exact and
correctly gated but dormant: it needs plate pairs for centres and barbell
boxes for the focal, neither of which fires. Fix the data, not the geometry
or the thresholds.

## Goal

A drop-in `models/bar_detector.onnx` replacement (same arch, same export, no
container-code changes) that fires on real phone footage.

### Acceptance criteria (all measured before upload)

1. **Plates**: recall@0.35 ≥ 0.70 on real frames (pair formation needs two
   simultaneous plates: 0.7² ≈ 0.5 → ~50 pair-frames per 100-frame clip).
2. **Barbell**: frontal recall@0.35 ≥ 0.70 (the focal fallback needs ≥10 valid
   spans per clip after aspect/Δ gates).
3. **No F1 regression**: end-to-end bar-position error on the 29-clip set must
   not regress vs the published 0.063 (median-offset centre accuracy is what
   shipped metrics stand on).
4. **Eval hygiene**: the 248 post-training human frames (`labels/bars/
   labels.barbell.jsonl`) stay HELD OUT — they are the honest test. Keep
   reporting the clip-level holdout protocol (`holdout_bar_detector.py`)
   alongside, but note it scores any-box overlap and over-states production
   behavior; per-class recall is the gate.

## Data recipe

- **Real majority** (invert the current 63%-synthetic mix; target ≤25%
  synthetic): all existing human frames (232 + new labels below).
- **Mine the failures**: the 24 frontal barbell misses (`eval_front.py`
  output) + dark-gym + Messenger-recompressed + small-plate (<1% of frame,
  recall 0.03) frames go in as hard examples. Small plates need dedicated
  coverage — they are the worst bucket and the most common in wide shots.
- **Synthetic as augmentation**, regenerated toward failure modes if cheap:
  dark/exposure/noise/compression, small scales. Clean renders taught the
  current model the wrong lesson; do not repeat a clean-majority mix.
- **Barbell emphasis**: the class is rarer than plates (191 vs 432 boxes in
  the 248) — oversample barbell-containing images (`--real-repeat` machinery
  exists in `train_bar_detector.py prepare`; extend per-class if needed).
- **Augmentation note**: if small-plate recall still lags, consider higher
  `imgsz` — but it directly raises Modal CPU inference latency per frame,
  so benchmark the container cost before adopting.

## Training & export (unchanged path)

Same as the 25/09 run unless the recipe forces otherwise:
`train_bar_detector.py prepare` → `train --epochs 60` (Modal T4) → export
ONNX (opset 12, `nms=True`) → `fetch`. Keep yolov8n — the container's
latency profile is characterized for it, and the failure is data, not
capacity (it memorized training data fine: 0.77 blended).

## Deployment & rollback

1. Validate locally first: per-class recall script + chain test + the
   targeted backend suite (the model file is not in git; the code is
   untouched, so this is a data-only release).
2. Upload to R2 under a **versioned key**, keep the previous artifact;
   repoint `models/bar_detector.onnx` (or `VIDEO_BAR_DETECTOR_MODEL`) to it.
3. Canary: reprocess 1–2 known clips (one frontal squat, one 3/4) — expect
   `bar_path` with detector centres and, on the frontal, a `metric_3d`
   block with `calibration.focal_source: "barbell"`.
4. Watch for a week: `reap_stale_videos` rate, F1 efficiency/drift
   distributions (a shifted centre bias would show up here first).
5. Rollback = repoint R2 at the previous versioned key. No migration, no
   deploy needed either way (model bytes only).

## Out of scope

Geometry (`bar_tracking_3d` stands as-is), the shared 0.35 centre threshold,
the metric-3D UI pass (waits on a firing detector + the focal-source
decision, both unblocked by this), phone-model lookup DB (rejected —
see `plans/bar-tracking-3d.md`).

## Environment needed

`MODAL_TOKEN_ID/SECRET` (train), R2 write credentials (upload),
~a few T4-hours. The 25/09 runbook in `plans/lift-video-tracking-v2.md`
(T3 section) still applies.
