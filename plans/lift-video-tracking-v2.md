# Lift Video Tracking v2 — Tracking Accuracy & Feature Plan

> **Status**: PHASES 1–4 SUBSTANTIVELY DONE (2026-09-23). Baseline =
> `plans/video-analysis-rewrite.md`.
> **Shipped**: T0 (records/alignment); T1 (lifter vs spotter, validated);
> T2 (fps-robust, GPU benchmarked — not adopted; GPU knob + fps config);
> T3 v1 (plate detection wired behind `VIDEO_BAR_DETECTION_ENABLED`, off);
> T5 (persisted pose track, validated); T6 (rest + set grouping);
> F1 (bar-path metrics), F2 (`PoseCanvas`/`Pose3D`/`PoseTimeline`/
> `VelocitySparkline` + ghost overlay), F3 (sticking point + joint angle),
> F4 (autoregulation), F5 (SPC control charts), F9 (joint moments + hip share),
> F11 (VBT 1RM vs PR). Owner's four workflow notes done (set link, process
> polling, quick menu, edit counts). Deep-dive fixes: view threshold, bench
> bar-height rep signal, lifter-coverage quality gate, squat/deadlift classifier.
> **Blocked / deferred**: T3 learned detector (needs training data); T4 trained
> classifier; T2 gravity alignment + anthropometric scale (needs a stature
> input) + vidstab; F6 grounded coaching (Gemini quota); F10 multi-view 3D
> (needs two camera angles).
> **Owner decision**: Hybrid architecture continues — deterministic 3D
> measurement produces all numbers; a VLM/LLM produces grounded qualitative
> coaching only, on demand.
> **Scope**: `backend/app/integrations/{pose_analysis,video_analysis,modal_client}.py`,
> `backend/app/tasks/scheduler.py::process_lift_video`, `backend/app/api/videos.py`,
> `backend/app/models/lifting.py`, `frontend/src/components/lifting/*`,
> `scripts/*`, `backend/tests/test_pose_analysis.py`.

## Why this plan exists

v1 made the numbers *honest* (form scores no longer a function of rep count,
velocity loss no longer −81%, RPE no longer pinned at 9.5). v2 makes the
underlying **tracking trustworthy and much richer**, then builds features on a
persisted track. The current pipeline still has three structural limits:

1. **The metric 3D track is computed and thrown away.** `pose_track` lives only
   inside the Modal container (`modal_client.py:377`) and is never persisted, so
   every frontend feature must bake results into a rendered MP4. No scrubbing,
   no overlays-on-demand, no re-analysis, no comparison.
2. **It tracks *a* person, and a body proxy for the bar — not the lifter and not
   the bar.** On bench the spotter is frequently selected instead of the lifter
   (owner-reported, reproduced in production). The "bar" is the shoulder/wrist
   midpoint; plate diameter/colour and true bar path are unseen.
3. **Capture assumptions don't match reality.** ~75% of real clips are
   rear-quarter; `detect_camera_view` is documented unreliable, so sagittal form
   rules are off for most footage. Scale comes from hardcoded ROM guesses.

## New hard constraints (owner, 2026-09-22)

- **Plates are heterogeneous** — bumper, calibrated, iron; size, colour and
  thickness vary. → No fixed plate diameter for scale. No colour/contrast CV.
- **Spotters are present** (bench especially) and get targeted instead of the
  lifter. → Multi-person tracking + lifter selection is a **Phase 1 priority**,
  not an advanced feature.
- **Never live.** Batch pipeline only; no in-browser real-time tracking.
- **Compute budget is generous relative to cost** (~$30/mo Modal credit, real
  volume < 20 clips). → Spend it on *reliability signals*, not raw FLOPs.

## Locked decisions

| Decision | Choice |
|---|---|
| Compute | Modal **L4** (benchmark vs T4), **flat 30–60 fps** (no adaptive fps), `mediapipe>=0.10.32`, models cached in a Modal Volume |
| GPU delegate | MediaPipe GPU delegate (image already installs `libegl1-mesa`/`libgles2-mesa`; currently forced CPU) |
| Pose/signals | heavy pose **+ person detector/tracker + Hand/Foot landmarkers** |
| Bar tracking | **Learned ONNX detector primary** (plate-agnostic) **+ optical-flow fusion**; pose proxy = search prior + fallback; classical CV only as an auto-labelling assistant |
| Scale | **Anthropometric** (pose segment ratios, optional user height) + stature-normalised dimensionless bar path — **never plate diameter** |
| Lifter selection | **Automatic** (bar coupling + posture prior + temporal continuity) **+ manual override**; quality downgrade when ambiguous |
| Camera view | **Local view/phase/spotter classifier** on Modal GPU (Gemini-independent) |
| Pre-pass | `ffmpeg vidstab` stabilization before pose |
| Biomechanics | As far as **reliability allows**: every metric gated on view + landmark confidence; never a confident-looking guess |
| Versioning | `analysis_version` + auto-reprocess on bump |
| Elevation | Cheap path for clean single-person clips; **auto-escalate** to the rich path when ambiguous |

---

## Architecture (target)

```
Upload → R2 → DB row → Celery process_lift_video
  1. Download / reuse trimmed; ffmpeg vidstab stabilization
  2. Probe duration + scene/set boundaries
  3. Person detection + tracking (full rate)      ← NEW (spotter fix)
  4. Pose per person: 2D + world + presence/conf  ← NEW (multi-person)
  5. Hand + Foot landmarkers (wrist/ankle precision)
  6. Local view/phase/spotter classifier          ← NEW (replaces declared view)
  7. Select lifter (bar coupling + posture + continuity; manual override)
  8. Bar detection (ONNX) + optical-flow fusion   ← NEW (true bar path)
  9. Anthropometric scale calibration
 10. Canonical rep list (robust 1D signal + hysteresis + ROM gates)
 11. Per-rep measurement: 3D joint angles, bar path/velocity (m/s), tempo, ROM, rest
 12. View-aware rule evaluation per lift → per-rep components + confidence
 13. Aggregate honest scores; keep competition_valid (IPF) separate
 14. Persist pose track + bar track (msgpack)     ← NEW (unlocks the UI)
 15. Optional grounded coaching (metrics + overlay; cached; quota-safe)
 16. analysis_quality / analysis_confidence → UI can say "refilm" or "pick the lifter"
```

---

## Part 1 — Perfect the tracking

### T0 · Measurement loop (prerequisite) — ✅ DONE (2026-09-22)

- ✅ **Fixed the latent bug**: `extract_pose_track` now builds per-frame records
  and returns a `world` list aligned 1:1 with `landmarks` (`None`-padded), so
  index `i` refers to the same frame everywhere. `bar_velocity_from_world` is
  `None`-safe (`_world_signal` linearly interpolates missing frames). Consumers
  (`modal_client`, `run_video_local`, `video_eval`) guard on *any* non-`None`
  world frame, not list truthiness.
- ✅ `presence` + `records` returned; `_frame_presence` helper.
- ⏳ `scripts/gen_synthetic_lifts.py` (Blender, mixed plates + spotters) and
  per-metric MAE in the eval harness — still to do.
- ✅ Tests: `test_pose_analysis.py` gained `TestFramePresence`,
  `TestWorldSignal`, `TestWorldVelocityNoneSafe`.

### T1 · Lifter vs spotter (do first — owner-reported bug) — ✅ DONE + VALIDATED

- ✅ **`backend/app/integrations/person_tracking.py`**: pure NumPy IoU
  association (`greedy_match`, `build_person_tracks`) + `select_lifter`
  (coverage + movement + bench posture prior + optional bar coupling) +
  `dense_series`/`track_series`. Fully unit-tested
  (`test_person_tracking.py`, 24 tests).
- ✅ **Multi-person extraction**: `extract_pose_track(num_poses=…)` returns
  `persons`/`tracks`/`lifter`/`frame_times`; `reselect_lifter()` re-picks once
  the exercise is known (bench posture prior).
- ✅ **Wired**: `modal_client` passes `num_poses` (behind
  `VIDEO_MULTI_POSE_ENABLED`, default OFF) and re-selects the lifter using the
  user-declared exercise; `run_video_local`/`video_eval` gained `--num-poses`.
  `person_tracking.py` is mounted into the Modal image.
- ✅ **T1.3 manual override**: `LiftVideo.lifter_selected` +
  `lifter_selection_json` (migration `068`), selection persisted by
  `process_lift_video`, exposed via `GET /{id}/process-status`, overridable via
  `PATCH /videos/{id}` (`lifter_track_id`) and forced on reprocess
  (`select_lifter(forced_track_id=…)`), plus a "who's lifting?" chooser in
  `VideoAnalysisPanel`.
- ✅ **Validated on real footage + Modal (2026-09-22)**: with `num_poses=1`
  MediaPipe tracked the upright **spotter for 375/375 frames (0 horizontal)** on
  the bench clip; `num_poses=2` + posture prior picked the horizontal lifter
  (`horiz=0.89`). Confirmed via the real Modal path (`_process` → container).
  **Bench-only gate** added after validation showed multi-pose fragments the
  track and regresses other lifts (clean 150 kg squat: 100 at num_poses=1 vs 75
  at 2) — `modal_client._process` only uses `num_poses>1` when
  `route_exercise(user_ex)=="Bench Press"`. Flag flipped to default ON.
- ⏳ Learned/MediaPipe person detector (beyond pose-derived boxes) — optional.

### T0/T1 original detail

- **Fix a latent bug**: in `pose_analysis.extract_pose_track` (`:23`) `world` is
  appended only when world landmarks exist while `landmarks` always is — one
  frame with 2D-but-no-world silently shifts every later `world` index (wrong
  velocity for the rest of the clip). Store **per-frame records**
  `{frame_idx, t, landmarks, world, presence, confidence}` instead of parallel
  lists; update `run_pose_analysis`, `bar_velocity_from_world`, and
  `modal_client._process`.
- **`scripts/gen_synthetic_lifts.py`** (Blender): render lifts with **mixed
  bumper/calibrated/iron plates (size, colour, thickness)** and **multi-person
  (spotter) scenes** across camera views/lighting/bodies, emitting exact
  ground-truth joint angles + camera + bar path. Unlimited labelled data is the
  pressure valve for the 12-clip real set.
- **`scripts/video_eval.py`**: add per-metric **MAE** (joint angles, bar
  position, velocity), **person-selection accuracy**, and **per-plate-type**
  slices; `--synthetic` mode; keep the `--baseline` diff.
- **Tests**: `backend/tests/test_pose_selection.py`, `test_bar_tracking.py`;
  extend `test_pose_analysis.py` for per-frame records. Gate a fast fixture
  subset in CI (`test.yml`).

**Acceptance**: eval reports joint-angle MAE, bar-position MAE, velocity MAE,
and person-selection accuracy; baseline recorded.

### T1 · Lifter vs spotter (do first — owner-reported bug)

- **`backend/app/integrations/person_tracking.py`**: ONNX person detector +
  ByteTrack-style association (Hungarian/IoU) → stable per-person ids over the
  clip. Handles spotters and bystanders; also feeds T3.
- **Multi-person pose**: `num_poses=2–4` (or detector-crop → pose per person) in
  `extract_pose_track`; return per-person tracks.
- **`select_lifter()`**: score candidates by
  (a) **bar coupling** — the lifter's wrists stay on the bar; spotter hands only
  touch intermittently (strongest signal; needs T3's bar box — run early);
  (b) **posture prior** — bench lifter torso near-horizontal vs spotter
  near-vertical; squat/deadlift lifter between bar and platform;
  (c) **temporal continuity** — track persists through the whole set; prevents
  identity swaps mid-rep.
- **Manual override** (owner choice: automatic + override): when ≥2 people are
  detected or selection confidence is low, surface a "who's lifting?" chooser in
  `VideoAnalysisPanel`; persist via `PATCH /videos/{id}`. Downgrade
  `analysis_quality` rather than scoring the wrong person.
- **Model/migration**: `LiftVideo.lifter_selection_json` (candidates + chosen +
  confidence) and `lifter_selected` id; next free Alembic revision (068+; latest
  = `067`). Register any new model in `app/models/__init__.py`.

**Acceptance**: spotter-selection error rate **0** on the bench eval set; bench
`form_score` validity rises.

### T2 · Tracking core — 🟡 BENCHMARKED (GPU not adopted)

- ✅ **Configurable fps + GPU**: `VIDEO_POSE_FPS`, `VIDEO_GPU_DELEGATE_ENABLED`
  and `VIDEO_MODAL_GPU` plumbed through `process_video_on_modal` → `_process`
  (`@app.function(gpu=…)`) → `extract_pose_track(gpu_delegate=…)`;
  `--fps`/`--gpu` on the local harnesses.
- ✅ **Benchmarked on the real Modal path** (8-rep squat, 32 s):

  | Config | Wall | Reps (truth 8) | Peak vel | Form |
  |---|---|---|---|---|
  | CPU 10 fps | 92 s | 8 | 0.282 | 93.8 |
  | L4 30 fps | 88–155 s | 8¹ | 0.41 | 90.6 |
  | T4 30 fps | 103–122 s | 8¹ | 0.209 | 96.9 |

  ¹ after the fps-scaling fix below (was 7 before).
- **Decision — do NOT adopt the GPU**: the pipeline is CPU-bound (ffmpeg
  decode + OpenCV overlay render), so GPU wall time is no better than CPU
  (88–155 s vs 92 s), and the GPU delegate produced **non-reproducible numbers**
  across worker types (peak 0.41 on L4 vs 0.209 on T4 for the same clip). Keep
  `VIDEO_MODAL_GPU=""` + `VIDEO_POSE_FPS=10` until the eval shows a real benefit.
- ✅ **fps-robustness fix (latent bug)**: `detect_reps_from_pose` used
  frame-based windows (`window=7`, gap `<3`), so a 30 fps track smoothed ~3× less
  and dropped reps (8→7). Now scaled by `fps` (`_win≈0.7·fps`, `_min_gap≈0.3·fps`);
  10 fps behaviour is byte-identical.
- ✅ **One-euro smoothing evaluated and rejected**: on the real 150 kg squat it
  under-read the rep amplitude (0.244 m/s vs 0.277 for the validated median
  window) — the filter's lag shrinks the peak-to-trough, and raising the cutoff
  only partly recovers it. Median smoothing retained.
- ⏳ Remaining: pin `mediapipe>=0.10.32`, Modal Volume model cache, gravity
  alignment, anthropometric scale, `vidstab` stabilization, and an eval run
  (rep MAE + velocity) before any fps change.
- **Original detail**:
- **GPU delegate**: flip `modal_client._get_modal_image` from the forced CPU
  delegate to GPU; pin `mediapipe>=0.10.32` (0.10.31 had a broken GPU delegate);
  cache `.task` models in a Modal Volume to cut cold starts.
- **Flat 30–60 fps** across the clip (remove adaptive complexity).
- **Smoothing**: one-euro / constant-velocity Kalman per landmark trajectory for
  velocity; keep `_median_filter` for rep boundaries.
- **Use `presence`** + per-joint confidence; outlier rejection; L/R swap guard.
- **Gravity alignment**: estimate world "up" and re-express angles in a
  gravity-aligned frame → **camera-invariant sagittal metrics**, recovering
  analysis on the rear-quarter majority.
- **Anthropometric scale**: derive px→m from pose segment ratios (rigid-segment
  lock) + optional user height; additionally emit a dimensionless,
  stature-normalised bar path for cross-lifter comparison. No plate diameter.
- **Stabilization pre-pass**: `ffmpeg vidstab` for handheld footage.

**Acceptance**: joint-angle MAE < 5°; velocity MAE < 0.03 m/s; view-invariant
depth accuracy ≥ 0.9 on ¾ clips.

### T3 · Bar tracking (true bar path) — 🟡 v1 SPIKE WIRED (gated)

- ✅ **`backend/app/integrations/bar_detection.py`** — pose-seeded Hough-circle
  plate detection (edge support + interior darkness + previous-detection seed +
  jump gate + gap interpolation). Measured: fires only when the plate is seen
  **face-on** (67% on a true side view; 0% on a ¾ squat).
- ✅ **Wired behind `VIDEO_BAR_DETECTION_ENABLED` (default OFF)**: when on,
  `run_pose_analysis` uses the detector track for the bar-path metrics
  (`source="detector"`), falling back to the proxy per clip. Gated because it
  needs side-on footage and is unvalidated on a multi-rep side clip.
- ⏳ **Learned detector remains**: auto-label from this spike → fine-tune a small
  ONNX model (robust to ¾ angles + heterogeneous plates) → fuse with optical flow.
- **Train on Modal**: `scripts/train_bar_detector.py` — small detector
  (barbell + plates + sleeve + person boxes) over synthetic + auto-labelled real
  data (pose proxy seeds candidates; corrections clean labels). Export ONNX.
- **`backend/app/integrations/bar_tracking.py`**: ONNX Runtime inference (no
  torch at inference) **fused with dense/learned optical flow** at high fps for
  sub-frame bar velocity. Body-proxy fallback with an explicit confidence flag;
  never silently mix sources.
- **Metrics**: bar path, **lateral drift from vertical**, **bar tilt** (plate
  centre collinearity), **path consistency** across reps, **bar-over-midfoot**.
  Relative metrics need no absolute scale; absolute velocity uses T2 scale.

**Acceptance**: bar-position MAE < 10 mm calibrated across plate types; path
consistency sane on multi-rep sets.

### T4 · Local view / phase / spotter classifier

- Small trained CNN or an open VLM on Modal GPU → `view` (side/front/¾/rear),
  `phase` (setup/rep/rest), `spotter_present`. Replaces reliance on
  user-declared `camera_view` and the quota-blocked Gemini path
  (`VIDEO_VIEW_VLM_ENABLED`, `classify_view_from_frame`).

**Acceptance**: view accuracy ≥ 0.9; retires the "sagittal rules off for 75% of
clips" limitation without a per-video Gemini call.

### T5 · Persist the track (feature unlock) — ✅ DONE + VALIDATED

- ✅ **`backend/app/integrations/pose_track.py`** — `build_track_payload()`
  serialises the in-memory track to compact JSON
  `{version, fps, exercise, frames:[{t, lm:[[x,y,vis]×33], w:[[x,y,z]×33]|null}],
  reps, bar_path}`; `ANALYSIS_VERSION = 2` (pipeline version for reprocess-on-bump).
- ✅ **Migration `070`**: `LiftVideo.pose_track_r2_key` + `analysis_version`.
- ✅ **Upload from the container** (`_process` step 9d) via a presigned PUT
  (same mechanism as overlay/thumbs); persisted by `process_lift_video`.
- ✅ **`GET /videos/{id}/stream-url?variant=track`** → presigned GET for the
  JSON (added to the existing variant map).
- ✅ **Validated through the real Modal path**: 8-rep squat → 467 KB track,
  315 frames, 33 landmarks + world per frame, 8 reps, bar_path, `analysis_version=2`.
- ⏳ `bar_track_r2_key` (separate bar track) deferred until T3 supplies a real
  bar track. Delete the track with the video (R2 lifecycle / delete handler).
- ⏳ **Auto-reprocess on `analysis_version` bump** task.

**Acceptance**: ✅ a persisted track round-trips and drives the frontend viewer
without re-running MediaPipe.

### T6 · Sessions & robustness — ✅ sets + rest done

- ✅ **Rest-between-reps** (`segment_rest`, populates `rest_periods_json` /
  `avg_rest_seconds` / `rest_cv`) and **set grouping** (`n_sets` /
  `reps_per_set`; a >60 s rep gap starts a new set) — the analysis panel shows
  "N sets detected" for long session videos.
- ⏳ **Auto-segment long videos at upload** (split into per-set clips) and
  pick-up/floor detection via the barbell state; not-a-lift gate beyond the
  quality gate's "unusable".

### T6 original detail

- **Set/rest segmentation** from barbell state (floor/rack vs motion) + motion
  energy + person tracks → populate the currently-dead `rest_periods_json`,
  `avg_rest_seconds`, `rest_cv`; group reps per set; auto-segment long videos.
- **Not-a-lift gate**; per-metric confidence propagated to the UI; suppress
  rather than fabricate.

**Acceptance**: rest within ±5 s; long videos split into sets correctly.

---

## Part 2 — What we can do with it

| # | Feature | Depends | Value | Effort |
|---|---|---|---|---|
| F1 | **Bar-path technique metrics** — ✅ core shipped (`bar_tracking.py`: efficiency, drift ratio, rep-to-rep consistency; `bar_path_json` + UI card) from the pose-proxy track. ⏳ tilt / bar-over-midfoot / J-curve need the real bar (T3) | T3 | Coaching core; nothing else in the app does this | M |
| F2 | **Interactive pose/3D viewer** — ✅ core shipped: `PoseCanvas` (2D skeleton + bar-path trail on the clean video, rAF-synced) via a "Live pose" toggle, **plus `Pose3D`** (three.js 3D skeleton from the metric world landmarks, orbit/zoom, PiP over the video) via a "3D" toggle; `PoseTimeline` adds per-rep chapters + a velocity bar per rep (click to seek) and a Start/Apex(joint angle)/Stop key-moments row; `lib/pose/track.ts` parses the persisted track. ✅ ghost overlay in the compare modal | T5 | Makes the system feel alive; foundation for all compare UI | M |
| F3 | **Sticking-point / weak-point detection** — ✅ core shipped: min-velocity position within the concentric phase (`_sticking_point` → `rep_timing_json` + per-rep "Stick" column). ⏳ joint-angle at the stick + accessory prescription via `services/deficiency.py` | T3 | Novel, high-signal coaching | M |
| F4 | **VBT autoregulation loop** — per-set velocity loss + RPE → readiness / `services/adaptive.py` / Whoop recovery; next-set load; "end the set" cues | T2 | Closes training↔video loop | M |
| F5 | **Longitudinal form analytics + SPC** — ✅ control charts (`services/spc.py`, `GET /charts/control`, Process-control card) flag a real shift vs noise. ⏳ correlate with load/volume blocks; injury-risk fusion with Jev notes + health signals | T3 | Turns scores into a program tool | M |
| F6 | **On-demand grounded coaching** — deterministic summary exists; add cached Gemini narrative grounded in metrics + overlay, behind `llm_base.ai_generation_guard` | T5 | Fixes quota-blocked v1 Phase 3 without per-video calls | S |
| F7 | **Ghost/compare overlay** — phase-align two lifts; overlay skeletons + bar paths across dates/loads; progress deltas | F2 | Direct progress visual | M |
| F9 | **Reliability-gated biomechanics** — ✅ external joint moments (`biomechanics.joint_moments`, gated on visibility) + `hip_share_pct` (quad-vs-hip readout) at the stick, in the rep tooltip (the hip moment doubles as a spinal-load proxy). ⏳ bar COM needs the real bar (T3) | T3 | Sports-science depth; feeds F3/F5 | L |
| F11 | **Program analytics** — ✅ VBT-estimated 1RM contextualised against the stored PR (`pr_1rm_kg` / `vbt_vs_pr_pct`, "vs PR" stat in VbtPanel); velocity-profile progression covered by the trend charts. ⏳ explicit projection into goal pace | F1 | Ties video to PR/projection surfaces | M |
| F10 | **Multi-view true 3D** — two angles → triangulated 3D bar path/joints | T3, calibration | Endgame fidelity | XL |

*(F8/F12 live/on-device tracking are explicitly out of scope — never live.)*

---

## Compute & cost model

Modal rates: T4 `$0.000164/s`, L4 `$0.000222/s`, CPU `$0.0000131/core/s`,
RAM `$0.00000222/GiB/s`. Per 30 s clip (4 cores / 4 GiB):

| Path | Rate | Wall time | Cost/clip | Clips on $30/mo |
|---|---|---|---|---|
| CPU, 10 fps (today) | $0.000061/s | ~150–210 s | ~$0.011 | ~2,500 |
| T4, 30 fps | $0.000225/s | ~90–120 s | ~$0.025 | ~1,200 |
| **L4 rich path** (30–60 fps + detector + hands + flow + segmentation) | ~$0.000282/s | ~120–180 s | **~$0.04–0.09** | ~350–700 |

The credit is not the constraint. Budget buys **reliability signals**
(multi-person tracking, wrist/ankle precision, plate-agnostic detector, local
view classifier), not more passes — TTA/ensembling and super-resolution are
deliberately avoided as low-ROI.

---

## Sequencing

| Phase | Contents | Outcome |
|---|---|---|
| **1 — Trustworthy** | T0 → T1 → T2 → T5 → T6 | Correct person tracked, clean persisted 3D track, calibrated, honest confidence |
| **2 — See the bar** | T3, T4, F1, F2 | True bar path + interactive 3D viewer |
| **3 — Intelligence** | F3, F4, F5, F6 | Sticking points, autoregulation, trends, coaching |
| **4 — Advanced** | F7, F9, F11, F10 | Ghost overlays, biomechanics, program analytics, multi-view |

---

## Success metrics

| Metric | Current | Target |
|---|---|---|
| Spotter-selection error rate | >0 (bench) | **0** |
| Joint-angle MAE vs synthetic GT | n/a | < 5° |
| Bar-position MAE (calibrated) | n/a | < 10 mm |
| Velocity MAE | ~0.21 m/s mean, high spread | < 0.03 m/s |
| Rep-count MAE | 0.30 (10-clip eval) | < 0.25 |
| View-invariant depth accuracy (¾ clips) | not assessed | ≥ 0.9 |
| Rest timing error | columns dead → populated | ±5 s |
| View classification accuracy | **0.90** (10-clip eval, was 0.80) | ≥ 0.9 |

Carry forward the v1 targets that are still met (velocity-loss-in-range,
form-score-zero-rate) so v2 cannot regress them.

---

## Diagnostics — full-labelled-set run (2026-09-23)

Ran `scripts/video_eval.py --num-poses 2 --skip-exercise "log press"
--skip-exercise stone` over the 10 remaining fixtures (Log Press / Atlas Stone
excluded per owner) — the whole pipeline, not one clip. Measured:
declared-rep **exact 1.00**, auto-rep MAE 0.30, form-zero 0.00, velocity-loss
out-of-range 0.00, view accuracy **0.90**, auto exercise accuracy **0.90**
(was 0.50).

**Fixed from the findings**
- **View threshold** `VIEW_SIDE_MAX_RATIO` 0.50 → **0.32**: the true side-on
  squat reads ratio 0.30, ¾ clips 0.35–0.96; 0.50 wrongly called a ¾ squat
  "side" (enabling sagittal rules). Accuracy 0.80 → 0.90.
- **Eval harness parity**: `_run_one` now falls back to the 2D velocity path
  when the world path fails, mirroring `_process`.
- **Bench rep signal**: `detect_reps_from_pose` now segments the **bench press
  from the barbell height (wrist-y)**, normalised to an angle-like 0–180 scale,
  instead of the elbow angle — the horizontal lifter's elbow landmarks are too
  noisy on the fragmented multi-person track. Bench velocity went from
  `failed`/0.0 to a measured 0.524 m/s (its rep window also moved from the
  spurious 2-frame cycle to a full 53–62 window).
- **Lifter-coverage-aware quality**: `run_pose_analysis` now caps the level
  (`good → fair`) when a multi-person clip's selected *lifter* covers <50% of
  frames (a spotter dominated the detector), and reports `lifter_rate` /
  `multi_person`; the UI shows a "spotter present" note. Bench → `fair`.

**Known limitations surfaced (not yet fixed)**
- **Bench lifter coverage is still ~31%** (MediaPipe returns the lifter only
  part of the clip) — the bar-height signal plus the `fair` quality flag make
  this honest, but a better multi-person tracker (T3) is the real fix.
- **Auto exercise classifier** — ✅ fixed: squat vs deadlift now keys on **hand
  height** (`mean_wrist_below_shoulder`: squats ≈0.00, deadlifts ≈0.10–0.12)
  instead of torso lean (which a ¾ view inflates — 5/7 squats read "Deadlift").
  Accuracy 0.50 → 0.90; the last miss is the bench (multi-pose fragmentation).
- **Auto rep detection is looser than declared**: with `expected_reps` (always
  provided in production) reps are exact; without it a 3-rep squat read 1.
- **Bar-path proxy drift is high** (drift_ratio 0.28–0.94): the shoulder/wrist
  midpoint moves horizontally during a lift — expected for a proxy; the real
  bar detector (T3) is what fixes this.
- **"Incomplete lockout" fires on some reps** of otherwise clean 8-rep squats
  (threshold `tan`/top-frame sensitive) — same class of over-eager threshold as
  the squat-lean one; needs label calibration before adjusting.

---

## Risks & constraints

| Risk | Mitigation |
|---|---|
| Learned bar detector needs labels | Synthetic (mixed plates) + pose-proxy auto-labelling + corrections; staged hybrid so v1 CV fallback ships first |
| GPU delegate flakiness | Pin `mediapipe>=0.10.32`; benchmark T4 vs L4; CPU `full` model fallback |
| Multi-person pose cost | Full-rate person tracker + pose per person only in the rich/escalated path |
| MediaPipe still tracks one person per model call | Person-crop → pose per crop, associated by the tracker |
| Reprocessing changes stored data | `analysis_version` + snapshot before bulk reprocess |
| Another session owns `scheduler.py` / `llm_base.py` | Coordinate before editing; prefer new modules (`person_tracking.py`, `bar_tracking.py`) |
| Repo hygiene | Work on `main` (not `prod`); feature branch per phase; update `AGENTS.md`/CODEMAPs with shipped changes |

## How to run (once built)

```powershell
# Synthetic ground truth
C:\Users\oradl\.venvs\fittrack-video\Scripts\python.exe scripts/gen_synthetic_lifts.py

# Eval over labelled + synthetic fixtures, diffed vs baseline
C:\Users\oradl\.venvs\fittrack-video\Scripts\python.exe scripts/video_eval.py `
    --synthetic --baseline reports/video-eval-baseline.json

# Pose unit tests (video venv, no conftest)
$env:PYTHONPATH = (Resolve-Path backend).Path
C:\Users\oradl\.venvs\fittrack-video\Scripts\python.exe -m pytest --noconftest `
    backend/tests/test_pose_analysis.py backend/tests/test_pose_selection.py `
    backend/tests/test_bar_tracking.py -q
```

## Open questions

- Exact L4 vs T4 winner (benchmark in T2).
- Whether SAM2 segmentation (person/plate isolation) earns its place vs the
  detector alone — measure before committing.
- Monocular depth (e.g. Depth Anything) for relative bar depth ordering —
  experimental; only if it proves reliable.
