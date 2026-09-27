# Bar tracking in 3/4 views (F1 horizontal metrics)

> Scoping doc, 2026-09-27. Parent: [lift-video-tracking-v2.md](lift-video-tracking-v2.md) (F1/T3).
>
> **Status: option A implemented (2026-09-27).** `_detections_per_frame` now
> prefers the whole-bar box, else the **two-plate midpoint** (bar centre), else a
> single plate, and carries `bar_basis` + `tilt_deg` onto the offset-corrected
> track. `analyze_bar_path` enables the horizontal metrics for a 3/4 view when
> most frames resolved the bar centre (pair-rate ≥ 0.5), flags them
> `lateral_basis = "three_quarter"` (shown with a trailing `~` in the UI) and
> explains them in the note. Validated on a real ¾ clip: **89% of resolved frames
> gave `plate_pair`**, and `bar_over_midfoot` came out **0.75** (vs the bogus
> 4.7 on a single plate).
>
> **Bar tilt stays frontal-only** (revised after seeing real data): the first cut
> allowed it in ¾, but a real squat read **20°**, which no barbell does — the two
> plates sit at different depths in a ¾ view, so the image line between them is
> perspective, not tilt.
>
> Residual perspective bias in the midfoot/lateral numbers is still unquantified
> (see the validation gap) — hence the approximate flag.

## Why this matters

**~71% of clips are filmed three-quarter** (22/31 scanned clips; the human-labelled
set is similar). F1's horizontal metrics — **bar-over-midfoot**, **net lateral
(J-curve)**, **bar tilt** — are currently view-gated off for every non-sagittal
view (see PR #126), so the majority of footage gets no lateral analysis. That is
the largest remaining gap in F1.

Two things made 3/4 hard:

1. **Perspective.** In a 3/4 view the bar's sagittal (front-back) travel projects
   onto image-x at an angle, mixing true lateral motion with depth.
2. **Wrong reference point.** The track used a single **`plate`** box — a plate is
   at the bar's *end*, not its centre, so its x is offset from the bar centre over
   the midfoot.

## What we measured

232 human-labelled frames, 29 clips, `bar_detector.onnx` at conf 0.25:

| view | frames | whole-bar (`barbell`) | ≥2 plates |
|---|---|---|---|
| front | 24 | **100%** | 100% |
| side | 32 | 19% | 44% |
| **three_quarter** | **176** | 32% | **86%** |

- `plate` fires on essentially every frame, but the pipeline keeps only **one**
  box. In ¾ views **86% of frames have both plates detected** → we can recover the
  **bar centre** (midpoint) and the **tilt** (line between them) without any new
  model.
  - **Verified distinct, not duplicates**: across the 152 ¾ frames with two plate
    boxes, the centre separation is median **0.44** (min 0.14, max 0.65) of image
    width; **100% are ≥0.10 apart, 0% below 0.03**. These are the two plates at
    the bar's ends, not one plate detected twice.
- The whole-bar `barbell` class is only reliable from the **front**. Reason: it is
  heavily **under-labelled on real data** — every one of the 1,500 synthetic
  frames carries a `barbell` box, but only **88 of the 248 real labelled frames**
  do (the rest are plate/person only), so the class never learned real whole-bar
  appearance beyond those 88. Completing the real labels is option B's first step
  (`scripts/prefill_barbell.py` seeds it: 88 kept, 103 suggested, 57 to draw).
- Side views see one plate (they overlap) → 44% "2+ plates" is mostly one plate
  split/duplicated, not a true pair.

## Options

**A. Two-plate bar centre — recommended first step.**
Track *both* plate boxes; bar centre = their midpoint; tilt = the angle of the
line through them. This is cheap: the detector already returns both boxes and the
pipeline currently discards the second. Unlocks ¾ tilt + a bar-centre x for ~86%
of ¾ frames. Residual: the image midpoint is perspective-biased (the near plate
reads larger/lower); correctable via the plate **size ratio** if it proves material.

**B. Whole-bar labels + retrain.**
Complete the real whole-bar labels (88 of 248 frames already done) and retrain →
the `barbell` class becomes reliable on real footage, and its box centre is the
bar centre in **any** view. `scripts/prefill_barbell.py` seeds the pass (keeps the
88 human boxes, adds 103 detector suggestions, leaves 57 to draw) and the
correction runs in `scripts/label_server.py` (`--data <data>/frames --labels
<data>/labels.barbell.jsonl`, Barbell = **B**). Then retrain.

**C. Body-frame / metric 3D (deepest).**
MediaPipe **world landmarks** already give a metric 3D body frame (used by
`bar_velocity_from_world`). The bar's front-back motion could be taken from the
world wrist/shoulder track, with camera yaw estimated from the pose. Most
principled, most work, and **no 3D ground truth to validate against**.

## Validation gap (blocks a clean "done")

The human labels are **2D plate boxes**, so a bar-centre or 3D metric cannot be
scored directly. To validate we would need one of:
1. whole-bar (and a few bar-centre) labels on real frames;
2. a qualitative review of the trace shape (does the front-back trace look like a
   squat's bar path?);
3. explicit "indicative only" labelling in the UI.

## Recommendation

Ship **A** first — it is cheap, uses data we already have, and unlocks ~86% of ¾
frames. Then measure the residual perspective bias on the ¾ clips; only if it is
material, invest in **B**. Keep **C** parked (it is the "true" solution but has no
validation path yet).

## First implementation step (A)

1. `_detections_per_frame` returns **all** plate boxes (not just the best), plus
   the existing whole-bar box when present.
2. Bar track entry gains: `x` = midpoint of the two plates (fallback: single box
   centre / proxy), plus `tilt_deg` and a `plate_pair` flag.
3. `analyze_bar_path`: allow **tilt** in ¾ (two plates present), and bar-centre
   based **midfoot** — but keep them flagged as ¾-derived (perspective caveat) so
   the UI can label them separately from front/side ground truth.
