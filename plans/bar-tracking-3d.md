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

## Prototype results (`scripts/investigate_3d_bar.py`, same clip)

Ran steps 1-2 end-to-end. It **works but the calibration does not close**, and
the reasons are instructive:

| finding | evidence | consequence |
|---|---|---|
| **MediaPipe's world metric scale is unreliable** | head→heel reads **0.874 m** for a real person (~1.5 m) — ~2x small; the feet also sit at y=0.55, i.e. mid-frame | everything metric is ~2x off until corrected |
| **The user's height is the right correction** | applying `--height 1.80` moves the computed subject distance 1.4 m → 2.9 m (the corrected one is the plausible one, given the subject is small/far in frame) | height is not optional for metric work |
| **The focal is unidentifiable from the body** | fitting `f` from the pose's own depth span returned a 12° "telephoto" | needs a device/lens assumption (`--fov`, default 66°) or EXIF |
| **The principal point must be the image centre** | fitting it (weak-perspective) gave `cx=299px` on a 1080 frame | a ~0.5 m lateral bias |
| **Anchoring the bar's depth at the shoulders beats the hips** | plausible lateral (60-140 mm) on clean frames once fixed | use the joint the bar is actually at |
| **The plate diameter did not help** | `--plate-diameter 0.45` made every axis worse | the detected "plate" is a **stack**, not one plate; needs the load context |
| outliers | a few frames give ±1 m lateral | plate detections need gating (the ONNX path has none today) |

**Net:** the geometry is sound but the **absolute scale needs two things the pose
cannot supply** — a trustworthy metric anchor (the user's height) and the
**focal length** (the phone lens / EXIF, or a one-off calibration against a known
distance). Until both are pinned the axis values drift by ~2x and are not usable.

## Next step

1. **Calibration**: get the focal from the video/phone (or calibrate once against
   a measured distance), and take the lifter's height as a per-clip input. Then
   re-run — the vertical should land at ~1.3-1.5 m above the foot and the lateral
   under ~100 mm.
2. **Gate the plate detections** (reject a plate far from the pose proxy).
3. Only then step 3 (the body-frame metric) + a UI pass.

## Inputs

| input | where it lives | status |
|---|---|---|
| **height** | `User.preferences.height_cm` (`services/preferences.py`) | ✅ added (Settings → "Lifter height") |
| **focal** | **per clip**, from the container metadata (`services/video_camera.py`) | ✅ helper added; needs wiring + per-video storage |
| plate diameter | — | ❌ the detected "plate" is a stack; would need the load (`load_kg`) |
| bar length | — | ❌ plate spacing depends on the load |

**Why the focal is per clip, not a setting:** videos come from **different
lenses** (main / ultra-wide / tele), so one number per user is wrong. Phone
containers carry the lens focal as a 35 mm equivalent
(OnePlus: `com.oplus.lens.focal_length = 14.01`), which converts to pixels via
`f_px = (diag_px / 2) / tan(FOV_diag / 2)`, `FOV_diag = 2·atan(43.266 / (2·f_eq))`
→ **714 px** for the test clip (74° horizontal FOV, a plausible phone lens).

**The pose cannot supply the focal.** Fitting a camera to MediaPipe's world
landmarks returns a *confident but bogus* ~18° FOV (its world `z` is a learned
body estimate, not a perspective measurement) — verified 2026-09-27.
