# Metric 3D bar tracking

> Design + verified foundation, 2026-09-27. Parent: [lift-video-tracking-v2.md](lift-video-tracking-v2.md)
> (T3/F1); builds on [bar-tracking-three-quarter.md](bar-tracking-three-quarter.md).

## Why

In a ¾ view (≈71% of clips) image-x mixes the true lateral motion with depth, so
the horizontal F1 metrics are only shipped as perspective-approximate (`~`). No
better **2-D** shape fixes that — OBB or keypoints give a tighter bar and a
cleaner angle, but the depth confound is representation-independent. The fix is
to stop working in image space: track the bar in **metric 3D**.

## Verified foundation (2026-09-27, real clip `49403afc`, 8-rep squat, 314 frames)

**1. The pose is a usable camera.** MediaPipe returns 2D image landmarks *and*
world landmarks (metres, hip-centred). Fitting world→image over the body:

| quantity | value |
|---|---|
| scale x (normalised per m) | 0.586 |
| scale y (normalised per m) | 0.345 |
| ratio x/y | **1.70 ≈ 1920/1080** → one **isotropic** pixel scale (~650 px/m) |
| corr(2D x, world x) | **0.970** |
| corr(2D y, world y) | **0.996** |

So the mapping is a **weak-perspective camera** (single scale + translation); the
world axes are camera-aligned with **no rotation to estimate**. Lifting a 2D
point gives metric world x,y; the bar's height came out at **−1.37 m relative to
the foot** — i.e. the bar ~1.4 m above the floor at the top of the squat ✓.

**2. The bar's depth is recoverable from the plates.** A loaded barbell is
symmetric, so the two end plates are the same physical size; their apparent-size
ratio gives the depth ratio:

| quantity | median | p10–p90 |
|---|---|---|
| plate width ratio (near/far) | **1.47** | 1.21–1.64 |

That is consistent with a barbell at a ¾ yaw ~3 m from the camera (bar ~1.3 m
plate-to-plate → depth spread ~0.9 m → z_far/z_near ≈ 1.36). So the plate pair
gives the bar's **yaw/depth**, which the 2D lift cannot.

**3. The known limitation.** Lifting the bar at the *body's* depth (the naive
lift) leaves the **lateral/front-back** component unreliable — that is exactly
the current ¾ confound. Depth must come from the plates (2), not an assumption.

## Design

**Step 1 — per-clip camera.** Fit the weak-perspective `(s, cx, cy)` once per clip
from the pose correspondence (the camera doesn't move). Robust to per-frame pose
noise; also gives a pose-quality signal (scale outliers ⇒ bad frames).

**Step 2 — per-frame 3D bar.**
- x, y: lift the 2D bar (the detector's **plate-pair midpoint**, which is
  near-exact — see [bar-tracking-three-quarter.md](bar-tracking-three-quarter.md)).
- z (depth): the two plates' image positions + their width ratio → each plate's
  3D position; the bar's midpoint depth is anchored to the body (the lifter holds
  it). The plate ratio supplies the bar's **yaw**; the pose supplies the anchor.

**Step 3 — the lifter's frame.** The world landmarks give a metric body frame:
the shoulder/hip line (medio-lateral) and the foot **heel→toe** vector (sagittal).
Project `bar_3D − midfoot_3D` onto those axes:

- **bar-over-midfoot** → millimetres, front-back, **view-independent**;
- **net lateral** → millimetres, medio-lateral.

This replaces the image-x approximations with metric, view-agnostic numbers.

**Step 4 — persist + UI.** Store the 3D bar track alongside the pose track
(`pose_track.py`, new field) and extend `Pose3D` to draw the bar. Keep the 2D
track for the 2D overlay.

## Risks / open questions

- **Depth from plate size** assumes a symmetric load and that the two detected
  plates are the same type; mixed/uneven loads (rare) break it. Detect and flag.
- **MediaPipe world z** is the weakest landmark axis; the step-2 anchor inherits
  that. The plate ratio mitigates it for the bar.
- **No 3D ground truth.** Validation is qualitative (does a squat's trace look
  right?) plus cross-checks (the bar must stay near the midfoot; the vertical
  must match the 2D lift). A proper eval needs a measured rig or two-camera
  footage — out of scope for now.
- Occlusion / <2 plates visible ⇒ no depth ⇒ fall back to the 2D metric (flagged
  approximate), as today.

## Next step

Prototype **Step 1 + 2** on one clip and eyeball the 3D trace against the 2D
track (the vertical must agree; the front-back must be smooth and small in a
squat). Then Step 3's metric and a UI pass.
