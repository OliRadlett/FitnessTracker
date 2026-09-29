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

- **No strongman, ever**: Log Press, Atlas Stone and similar implements are
  outliers with non-barbell geometry — training on them pulls the decision
  boundary away from plates/bars and confuses the system. Exclude them from
  train AND val (they are already excluded from the honest eval subset).
  This is a standing rule, not a judgment call per round.
- **Real majority** (invert the current 63%-synthetic mix; target ≤25%
  synthetic): all existing human barbell-lift frames (232 + new labels
  below).
- **Mine the failures**: the 24 frontal barbell misses (`eval_front.py`
  output) + dark-gym + small-plate (<1% of frame, recall 0.03) frames go in
  as hard examples. Small plates need dedicated coverage — they are the
  worst bucket and the most common in wide shots. (Recompression artifacts
  would qualify too, but the only Messenger clips on file are both
  strongman — excluded above. Revisit when barbell Messenger footage
  exists.)
- **Curated 2026-09-29, round 2 (bright gym)**: the two Sunday frontal
  squats ARE valid barbell footage — v2 fires person@0.95 + near plate@0.81
  but systematically misses the far edge-on plate and the thin bar, so no
  pairs and no spans. 27 working-set frames extracted to `frames_hard/`
  (`*_bright_*.jpg`, 10 pre-filled v2 boxes), labeling live on **:8767**
  into `labels_hard2.corrected.jsonl`. These cover the user's actual gym
  (bright, calibrated colored plates) — the distribution the retrain must
  handle first. Round 1 (:8766, dark gym) stays up.
- **Label every visible barbell regardless of angle.** Training value and
  calibration value are different things: an angled barbell box teaches the
  detector the class across views (recall is the crisis — 0-4%), even though
  that same box will never feed the focal estimator (the aspect ≥4 gate
  drops foreshortened bars by design) and shouldn't be trusted as a centre
  (AABB of an angled bar is ~20x worse than the pair midpoint). Tight,
  honest boxes; never skip a visible bar because it looks unhelpful
  downstream — the gates, not the labeler, decide use.
- **Labeling is live**: `scripts/label_server.py` running on port **8766**
  (8765 was taken) with `--labels labels_hard.jsonl --out
  labels_hard.corrected.jsonl` — 20 records, 1 pre-filled model box ≥0.15
  (the frames are hard; the labeler draws nearly everything). Open
  http://localhost:8766, draw plate + barbell boxes (person optional),
  Enter confirms & advances. Edits land straight in
  `labels_hard.corrected.jsonl` — the existing labels files are untouched.
  When all 20 show ✓, the prepare/train chain below is unblocked.
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

**Run status**: v2 trained/deployed/canaried 2026-09-29, then **superseded
the same day**: round-2 bright labels (16/27) → v3 (3827/354) → acceptance
PASSED (plates 1.00, frontal barbell 1.00, pair-centre error 0.002→0.001,
bright working set: barbell 100% @0.93 med conf, pairs 98%, aspect med
14.2) → **deployed** (`models/bar_detector.onnx` = v3, v2 backed up at
`models/bar_detector-v2.onnx`). Canary re-running on the 2 frontal Sunday
clips — pair centres + barbell spans expected this time, i.e. the first
real `metric_3d`. Rollback = re-upload v2 bytes.

## Canary (2026-09-29 — complete, no regression)

3 Sunday uploads picked from R2 (user confirmed 1 side + 2 frontal; DB
`camera_view` agrees): `ae3d3db5` side, `03dd05f1` + `deb347fc` front, all
Back Squat × 8, completed under v1 (form 90.6/98.8/98.8; before-state
`bar_path` saved to temp). Re-enqueued on prod via
`send_task(process_lift_video)` — prod runs pre-#179 pipeline code, so this
canaried the **v2 model through the old pipeline** (F1 centres, form,
velocity).

Result after reprocessing (all completed, ~13 min): **nothing broke.**
Form scores, reps, efficiency, drift, consistency, velocity identical;
per-rep vertical ranges identical to 4 decimals. Diffs confined to:
(a) detection-confidence bookkeeping (0.75→0.68, 0.86→0.70 — not a metric);
(b) one tilt frame lost on a frontal (5.46°→none); (c) absolute
bar-over-midfoot on the side clip shifted ~0.15 foot-lengths with identical
motion — plausibly improved localization from far more detections,
unprovable without GT for these clips.

Watch week ongoing: `reap_stale_videos` rate + F1 distributions.

**v2 availability on these exact clips (measured 2026-09-29, pre-reprocess)**:
singles ~30–50% of frames, pairs ~1%, barbell boxes 0/200 — the bright-gym
red/blue plates fire far less than the dark-gym black bumpers the model
trained on (front-human recall was 1.00). One-sided firing (near plate only)
explains the missing pairs. Consequence: the 3D-validation reprocesses now
running will almost certainly come back 2D-only (no pair centres, no barbell
spans) — correct declining, not a failure.

**Why the estimator still declines (measured 2026-09-29)**: on the
frontal canary's persisted pose track (511 frames), shoulder world-z median
is **0.016 m** — only 13.9% of frames clear the 0.10 m depth floor, below
the 10-frame minimum. The bar sits in the body plane on a frontal squat, so
there is no depth leverage to solve from; the decline is correct, not a
bug. Detector, spans, height, geometry all verified working — the focal is
the sole missing input on typical footage. This promotes the per-user
default focal (below) from fallback to primary source, with the barbell
estimator kept as cross-check/provenance for clips where it fires.

Filming guidance still stands for estimator-friendly clips (bench ¾,
larger Δ): front-ish view, plates >4% of frame height, both unoccluded.

## Full-clip proof with fixed axes (2026-09-29) ✅ partial

Both frontals reprocessed on the deployed axis-hardened code (PR #192):
front-back −802/−740 → **−483/−465** (−40%), lateral 197/202 → **98/108**
(−50%). Vertical stable ±1 cm, form/velocity identical, no regressions.
`focal_source` now reads `clip` (stored probe correctly reused over the
lens nominal — precedence chain working).

The fix removed the predicted ~340 mm y-leak; residual fb (−470 mm) is
still above the plausibility band with unknown mechanism (not the y-leak;
anchor-vs-feet world-z bias or axis x-tilt suspected). Lateral halved but
~100 mm remains borderline (stance asymmetry not ruled out). Next:
per-frame forensics on the persisted track, or accept vertical + calibration
as the shippable core with horizontals flagged approximate.

## Device facts (user-confirmed 2026-09-29)

- **Phone/lens**: OnePlus 11 ultra-wide (IMX581, **14 mm equiv**, 115° FOV),
  front-but-slight-angle. Nominal focal on 1080×1920: diag 2203 px,
  f = 1101.5 / tan(57.5°) ≈ **702 px**.
- **No container tags even here**: the Sunday OnePlus clips carry only
  `creation_time/language/handler_name` — the tag path is dead for this
  phone too, not just old fixtures.
- **Plates are calibrated 450 mm** (red/blue powerlifting discs). Diameter
  is therefore exact, promoting the plate-diameter ruler from "assumed" to
  a viable second source later — box height ≈ 450 mm for any level bar.
- **Bias directions for the estimator**: UW barrel distortion compresses
  edge spans → estimates skew LOW; slight-angle foreshortening (cosθ)
  also skews low by a few %. EIS crop is scale-consistent (no bias — it
  just raises the true f being estimated). Sanity band for a barbell focal
  on this setup: **~550–900 px**; anything far outside means a bad solve,
  not a weird lens.

## Lifter height (the second calibration input)

The 3D path needs TWO absolute inputs, and this plan has so far only chased
one. The focal (above) sets depth; the lifter's height sets scale —
MediaPipe's world landmarks use an average-body prior that read 0.87 m on a
real ~1.5 m lifter, so without a true height every metric number is ~2x out
and `fit_clip_camera` correctly declines. Height error maps ~1:1 into the
metrics (10 cm on 175 cm ≈ 6%).

- **Today**: `preferences.height_cm` (Settings → Lifter height, validated
  50–260 cm), passed by the scheduler into the Modal worker. No prompt
  exists — the field is optional and usually unset, so the 3D path will keep
  declining on height even with a perfect detector.
- **Do NOT estimate height from video**: there is no absolute reference in
  frame, and any estimate would be circular with the scale it calibrates.
  It must be user-supplied, once per user (not per clip).
- **Actions**:
  1. Prompt when missing: video page banner / deep-analysis CTA ("set your
     height to enable 3D bar metrics") when `height_cm` is unset. Small
     frontend addition; the backend already threads the value end to end.
  2. **Per-user default focal (new primary source)**: a `focal_px`
     preference (300–3000 px, so EIS-cropped values fit) used when container
     tags are absent — which is every real clip measured. Pre-fill 702 for
     the OnePlus 11 ultra-wide (14 mm equiv on 1080×1920); the barbell
     estimator cross-checks it whenever it fires (flag >30% disagreement
     in the calibration echo). Plumbing already exists end to end
     (scheduler `focal_px` → modal override → `camera` → fit); missing
     pieces are the preference field + Settings row + scheduler fallback
     read. Accuracy ~10–20% (EIS) → metric errors of the same order:
     useful, flagged as approximate via `focal_source`.
  3. Keep the server-side height bounds (already in `NUMERIC_PREFERENCES`); sanity
     log the resulting `height_scale` in the calibration echo (already
     echoed — a scale far from 1.0 on a real clip means a wrong height).
  3. Acceptance for this half: the canary reprocesses (below) run with a
     real height set, so the reported numbers test the full chain.
- **Out of scope**: auto-detection, per-clip overrides, unit conversion
  (Settings already handles metric/imperial at the edge).

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
