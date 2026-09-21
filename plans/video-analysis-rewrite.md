# Lift Video Analysis — Rewrite Plan

> **Status**: Phases 0–2 COMPLETE, Phase 4 features shipped (camera view,
> overlay, VBT). Phase 3 (VLM coaching) is quota-blocked by design. Branch
> `feat/video-analysis-rewrite`. Baseline + per-increment reports in `reports/`
> (gitignored).
> **Owner decision**: Hybrid architecture (deterministic 3D metrics + grounded VLM coaching)
> **Scope**: `backend/app/integrations/{modal_client,pose_analysis,video_analysis}.py`,
> `backend/app/tasks/scheduler.py::process_lift_video`, `backend/app/api/videos.py`,
> `frontend/src/components/lifting/VideoAnalysisPanel.tsx`, `scripts/run_video_local.py`

## Why

The video analysis processor produces results that are unusable in practice. A review of
all 12 production `lift_videos` rows (pulled 2026-09-21) shows the numbers are frequently
not just wrong but self-contradictory, and several advertised features never ran at all.
The prior implementation accumulated 15+ per-video hotfix commits
(`fix(video): prominence pairing…`, `fix(video): top-to-top pairing…`, …), which is the
signature of tuning against single anecdotes rather than a measurement loop.

## Evidence (12 production videos, 2026-09-21)

All 12 had `analysis_status = 'completed'`; none failed. Yet:

| Symptom | Observed | Root cause |
|---|---|---|
| **Form score is a function of rep count, not form** | Every 8-rep set scored **0/100**; every 1-rep set 75–100; 3-rep set 0 | `score_squat/bench/deadlift_form` sum per-rep deductions with no normalization or floor (`pose_analysis.py:753-857`). With 8 reps any deviation clamps the score to 0. |
| **"Excessive forward lean" on every squat rep** | Every squat rep flagged; measured lean 11–85° against a 10° threshold | `_torso_angle` uses 2D normalized coords; the top-frame selection (`_best_extremum`) lands on the wrong frame; 10° is far below real squat lean (20–40°). `pose_analysis.py:201,559,787` |
| **Bar velocity under-reads ~5×** | Single-rep squats 0.087–0.098 m/s (real ≈0.2–0.5); velocity loss **−81%** and **−47%** | `pixels_per_meter = whole-trim excursion / hardcoded ROM`. The trim includes walkout/rerack; ROM defaults are guesses (0.50 m squat) ignoring lifter/camera. `pose_analysis.py:1127-1130` |
| **Form reps and velocity reps disagree** | `77ca64a0`: 3 reps scored, 1 in `rep_timing_json`; `3a1e9822`: 3 vs 1 | `bar_velocity_from_pose` silently drops unmeasurable slices and re-derives its own list. `pose_analysis.py:1134-1162` |
| **RPE is effectively constant** | 11 of 12 videos read 9.5–10.0 | Single rep → no velocity loss → absolute-velocity bins, but velocity is bogus and `weight_kg` is always NULL, so it always reports "max effort". `video_analysis.py:1145-1231` |
| **Whole features never populated** | `rep_consistency_score`, `tempo_consistency_cv`, `avg_rest_seconds`, `rest_cv`, `exercise_auto`, `weight_kg` NULL on all 12 rows | The pose path (`run_pose_analysis`) never computes consistency/rest; only the **dead** Gemini `run_full_analysis` did. `scheduler.py:3684-3708` writes fields nothing produces. |
| **Setup analysis is noise** | Setup durations 0.1 s, 0.4 s, 37.6 s for the same nominal lift; bracing flips randomly | "First hip movement > 0.03" fires on jitter or never and defaults to the whole segment. `pose_analysis.py:886-896` |
| **Auto-classification is wrong** | Squat → "Deadlift 0.95", Bench → "Overhead Press 0.95" | No camera-view awareness; bench is geometrically unclassifiable from 2D pose. Only survives because the user declaration wins (`route_exercise`). `pose_analysis.py:955-989` |

### Root causes, ranked

1. **MediaPipe's metric 3D `pose_world_landmarks` are discarded.** The code uses only 2D
   normalized `x,y` and then *guesses* scale from a hardcoded ROM. This single omission
   breaks velocity, depth and joint angles. Verified: `pose_world_landmarks` appears
   nowhere in the repo.
2. **No camera-view model.** Every form rule silently assumes a perfect side-on,
   perpendicular, full-body view. Phone footage is often front-on, ¾ or vertical. The
   rules then fire nonsense instead of degrading gracefully.
3. **No confidence gating.** The pipeline always emits a confident-looking score (0 or 100)
   even with degraded pose, bad view, or almost no tracked frames. There is no
   "can't analyze — refilm" state.
4. **No evaluation loop, no tests.** Zero backend tests cover pose/video. `run_video_local.py`
   exists but nothing compares its output to ground truth.
5. **Dead code / broken contracts.** ~600 lines of Gemini prompts and `run_full_analysis` /
   `_call_gemini_form` are never called (the Modal container image has no `google-genai`).
   `scripts/queue_videos.py` calls a task name that no longer exists.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Analysis approach | **Hybrid** — deterministic 3D measurement produces all numbers; Gemini produces grounded qualitative coaching only. |
| Capture requirements | **Guide + warn, never hard-block.** Detect view/coverage, show guidance or downgrade confidence. |
| Inputs | **Auto-link video → session set by time overlap** for load/reps; prompt only when unknown. |
| Sequencing | Build the foundation (Phases 0–2) first, measure, then prioritise Phases 3–4. |

## Architecture (target)

```
Upload → R2 → DB row → Celery process_lift_video
  1. Download (or reuse trimmed) video
  2. Probe duration + scene/set boundaries            [trim]
  3. Capture preflight: view (side/front/¾), coverage, framing quality
  4. Extract pose: 2D landmarks + metric 3D world landmarks + per-frame confidence
  5. Calibrate scale (world landmarks; else user height/bodyweight; else relative-only)
  6. Detect canonical rep list (robust 1D signal + hysteresis + amplitude/duration gates)
  7. Per-rep measurement: joint angles (3D), bar path/velocity (m/s), tempo, ROM, rest
  8. View-aware rule evaluation per lift → per-rep components + confidence
  9. Aggregate to honest 0–100 score; keep competition_valid (IPF) separate
 10. Optional grounded VLM coaching (frames + metrics + overlay, JSON, no numbers)
 11. Persist; surface analysis_quality so the UI can say "refilm" instead of faking a score
```

## Baseline results (2026-09-21)

`scripts/video_eval.py` over all 12 production videos (pre-rewrite):

| Metric | Baseline | Target (Phase 2) |
|---|---|---|
| Auto rep-count MAE | **1.33** | < 0.5 |
| Rep count exact (auto) | — | ≥ 0.8 |
| Reps exact when declared | 1.00 (circular: expected_reps forced) | ≥ 0.9 |
| Exercise classification accuracy | **0.58** | ≥ 0.9 |
| Form reps ≠ velocity reps rate | **0.33** | 0.0 |
| Form score == 0 rate (multi-rep) | **0.44** | 0.0 |
| Mean bar velocity | 0.211 m/s | in plausible band |
| Velocity loss out of range rate | **0.67** | < 0.1 |
| RPE saturation rate (≥ 9.5) | **0.92** | < 0.3 |

Top deviation tags: `Excessive forward lean` ×31, `Soft lockout` ×23,
`Incomplete lockout` ×7, `Depth not achieved` ×3, `Hitching detected` ×2.

These are the numbers the rewrite must move.

## Phases

### Phase 0 — Eval harness & tests (prerequisite) ✅ COMPLETE

- `backend/tests/test_pose_analysis.py` — 39 unit tests for pure functions on synthetic
  landmark series with known answers (`calculate_angle`, `_median_filter`,
  `detect_reps_from_pose`, `classify_exercise`, `route_exercise`, squat scoring, depth,
  torso angle). Two `xfail` tests document the multi-rep-zero and RPE-saturation bugs.
  Requires numpy → `importorskip` (run with the video venv).
- `backend/tests/test_video_analysis.py` — stdlib-only tests for `_velocity_loss_pct`,
  `_get_vbt_zone`, `_get_rom`, `_parse_gemini_json`, `estimate_rpe_heuristic`; runs in the
  normal backend suite anywhere.
- `scripts/video_eval.py` — runs the pipeline over a folder of local videos and compares
  against `backend/tests/fixtures/video_labels.json`, emitting rep-count MAE,
  classification accuracy, velocity sanity, form-flag false-positive rate and a
  run-over-run diff (`--baseline`).
- `scripts/fetch_prod_videos.py` — SSHes to the Droplet, mints presigned R2 GETs inside
  the backend container, downloads the videos into a gitignored fixture folder, and seeds
  the labels file from the user-declared `exercise_name` + `expected_reps`.
- `backend/tests/fixtures/video_labels.json` — committed ground truth (exercise, camera
  view, reps, set type) for the 12 production videos. `camera_view` still needs a human
  pass; `velocity_band` is intentionally unset.
- **Acceptance met:** every future video-code change is measured against the labeled set
  before merge; a baseline report exists (`reports/video-eval-baseline.json`).

### Phase 1 — Measurement core (in progress)

- ✅ Extract both 2D and `pose_world_landmarks` (`extract_pose_track`); the old
  `extract_pose_landmarks` is a back-compat wrapper.
- ⚠️ **View detection from pose geometry is unreliable** — verified on the 12 videos:
  2D shoulder/torso ratio and the metric-3D world shoulder-line both fail to separate
  side from rear (e.g. a true rear view scored more "side-like" than a true side view).
  Front vs rear is unidentifiable from monocular 2D pose. **Do not gate on a geometric
  classifier.** Reliable view classification needs a VLM (one frame) or a user
  declaration — moved to Phase 3. `detect_camera_view` is retained as a diagnostic only.
- ✅ View-gated the sagittal-only rules (torso lean, hip-vs-knee depth, heel lift,
  knee valgus, deadlift back rounding, setup lean) behind an explicit `view` argument
  that defaults to `unknown` = *not assessed*. Effect: **`Excessive forward lean`
  flags 31 → 0** and `form_score_zero_rate` **0.44 → 0.22** on the production set.
- ✅ Metric bar velocity from world landmarks (`bar_velocity_from_world`).
  **Important finding:** MediaPipe world landmarks are *hip-centred* — the hip
  sits at the origin (measured world hip-y range 0.003 m across a deep squat),
  so global body translation is removed and shoulder y cannot measure bar
  travel. The fix: for squat/deadlift the hip's vertical travel equals the
  change in **hip→ankle distance** (leg extension against the planted foot),
  which *is* measurable (ankle-y range 0.49 m); presses/bench/stone track wrist
  y (bar moves relative to the torso). Velocity now uses the joint-angle
  detector's bottom/top frames rather than re-finding extrema on the noisy
  world signal. Effect: `velocity_loss_out_of_range_rate` **0.67 → 0.0**,
  `rep_count_mismatch_rate` **0.33 → 0.0**; 150 kg max squat reads 0.28 m/s,
  105 kg RPE7 sets 0.18–0.23 m/s with 19–31% loss.
- ✅ **RPE reworked** to be honest: estimated from velocity loss across a
  multi-rep set only (recalibrated bands, ~30% loss ≈ 8.0), and returns
  `None` for single reps / no measurable loss instead of a fabricated
  9.5–10. Effect: `rpe_saturation_rate` **0.92 → 0.0**. Still approximate —
  velocity loss is noisy (RPE-7 sets measured 35–88% with the production
  trim), so a load/1RM reference plus better rep segmentation is needed for
  absolute accuracy.
- 📷 **Camera views (owner-confirmed):** 9 of 12 clips are rear-quarter
  (back-left/right), only 2 are true side, 1 front. Sagittal-plane rules are
  therefore invalid for ~75% of real footage — the view gate must default to
  "not assessed" and view guidance is a high-value feature.
- ✅ One canonical rep list: `bar_velocity_from_world` emits one `rep_timings` entry
  per pose rep (velocity may be `None`) so form and velocity counts always agree.
- ✅ **Production wiring:** `modal_client._process` now extracts one
  `extract_pose_track` (2D + world), reuses it for form analysis (`track=`) and
  prefers `bar_velocity_from_world` (2D fallback). `scripts/run_video_local.py`
  matches. Previously all these improvements existed only in the eval harness.
- ✅ **Rep segmentation:** the auto path now drops partial cycles (unrack/rack/
  setup) below 75% of the set's max ROM — prominence alone doesn't catch them
  because it measures against the surrounding tops. Applied to the AUTO path
  only: the user-declared path already picks top-N and the filter dropped a
  real rep on 77ca64a0. Effect: `auto_rep_mae` **1.33 → 0.25** with
  `declared_rep_exact_rate` back to 1.0. Two clips still read 2 vs 1 (a bench
  and a deadlift whose partial is ≥75% of max ROM).
- ✅ **Lockout is view-gated:** the hip-extension test is sagittal and false-
  flagged low-bar squats. Verified: low-bar singles 140/130 kg read top_hip
  147-148° while genuinely standing (falsely "soft lockout"), high-bar 150 kg
  reads 170°. On non-side views lockout now uses the knee only (reliable from
  any angle); hip extension is only assessed on a side view. Effect:
  `Soft lockout` flags **24 → 0**; low-bar singles + the 8-rep set now score
  100. Remaining `Incomplete lockout` (4) are reps with genuinely bent knees.
- ✅ **Trim fallback + deadlift lockout:** with no scene changes the trim now
  keeps the WHOLE video (was middle-80%). The old fallback cut the last 10% —
  exactly where a short single-rep deadlift locks out — so the top frame read
  mid-pull (hip ~110°) and both deadlifts were wrongly flagged "Incomplete
  lockout / would fail". Also: the declared path picks the best **consecutive**
  run of cycles (not globally-largest, which could grab a setup cycle), and
  negative velocity loss is clamped to 0. Effect: `Incomplete lockout` 7 → 4,
  `Hitching` 2 → 1; `auto_rep_mae` 0.25 → 0.33 (one squat), everything else green.
- ⏳ Tracked-point quality for squat (some side/rear squats still read 0.10–0.17 m/s)
  and accessory lifts (atlas stone reads 0.0). Consider bar/plate detection or a
  per-lift tracked-point validation.
- ⏳ Require load before emitting RPE/VBT.

### Phase 2 — Honest scoring, gating, cleanup (in progress)

- ✅ **Per-rep averaging:** deductions are applied per rep and averaged, not
  summed across the set. Effect: `form_score_zero_rate` **0.22 → 0.0**; scores
  now spread sensibly (clean 150 kg max squat = 100, 105 kg RPE7 sets 86–90,
  flagged deadlifts 50).
- ⚠️ **Remaining scoring risk:** deadlift `Incomplete lockout` / `Hitching`
  flags are not view-gated and may be false on ¾ views (both deadlift clips
  scored 50). Review alongside view classification.
- Calibrate thresholds against the labeled set; fix `_check_knee_valgus`,
  `_check_heels_flat`, setup detection.
- Compute consistency + rest in the pose path (or remove the columns/UI).
- Add `analysis_quality` + `analysis_confidence`; UI shows "refilm from the side".
- Auto-link video → session set (time overlap, mirroring
  `whoop.match_whoop_workout_to_lifting_session`).
- Delete dead Gemini prompt code, `run_full_analysis`, `_call_gemini_form`; fix
  `scripts/queue_videos.py`.
- Reprocess the 12 existing rows via `POST /{video_id}/process?force=true`.

### Phase 3 — Grounded VLM coaching

- Gemini receives sampled frames + computed metrics + skeleton overlay; strict JSON,
  coaching language only, never numeric values. Cache by content hash; reuse
  `llm_base.ai_generation_guard`.
- ⚠️ **Quota constraint:** the Gemini free tier is small (~10 req/day per the
  owner). A per-video VLM call is therefore NOT viable — a 12-video batch
  exceeds the daily budget and starves the weekly/on-demand analysis.
- ✅ **User-declared camera view (done, migration 065):** upload-form selector
  (side / behind-left / behind-right / front) → `lift_videos.camera_view` →
  Celery task → Modal → `run_pose_analysis(view=)`. Sagittal rules run only on
  a side view; back_left/back_right → three_quarter (no sagittal rules);
  unknown → off. Measured with `video_eval.py --known-view`: sagittal rules
  fire on only the 2 true side clips (2 lean flags) instead of 31 false flags.
  The VLM classifier (`classify_view_from_frame`) remains built but gated
  behind `VIDEO_VIEW_VLM_ENABLED` (default false) for diagnostics/backfill.
- 📷 **Camera-view finding:** owner-confirmed 9/12 clips are rear-quarter, so
  view-aware gating matters more than any other form feature.

### Phase 4 — Correction loop & features

- User corrections (exercise / reps / view / form tags) stored as ground truth; feeds the
  eval harness and RPE calibration.
- Then, by measured impact: overlay render, capture guidance, per-rep breakdown, VBT
  load–velocity profile, compare mode, multi-person detection, more lifts.

## New features (post-foundation)

1. ✅ **Skeleton + bar-path overlay video** — `render_overlay_video()` draws the
   MediaPipe skeleton + bar-tracking point/trail onto the trimmed clip; Modal
   uploads it to R2 (`overlay_r2_key`, migration 066). `VideoEmbed` has an
   opt-in **Original / Trimmed / Pose** toggle (defaults to the plain video).
   The `stream-url?variant=` param also fixes the previously-broken trimmed
   toggle (it always returned the original).
2. **Capture preflight & guidance** at upload ("film side-on, full body, landscape").
3. **Per-rep breakdown UI** — per-rep thumbnails, depth/lockout/tempo, individual scores,
   override toggles.
4. ✅ **VBT load–velocity profile + estimated 1RM** — `app/services/vbt.py`
   fits `velocity = slope·load + intercept` over the user's analysed sets and
   reads 1RM off the minimal-velocity-threshold crossing (Squat 0.30, Bench/
   Deadlift 0.15, Press 0.20 m/s). Load is now captured on upload
   (`weight_kg`). `GET /videos/vbt/profile?exercise_name=` returns the points +
   fit + confidence; `VbtPanel` renders the scatter + fit line + est. 1RM.
   ⏳ Still to do: velocity-loss autoregulation / readiness advice.
5. **Meaningful form trends + injury flags** (scaffolding exists in `video_analytics.py`)
   feeding `HealthAlert`.
6. **Set auto-segmentation + rest timing** for long session videos.
7. **Compare mode** — current vs previous attempt of the same lift.
8. **Multi-person / not-a-lift detection** with clear messaging.
9. **View-aware analyzers for more lifts** — overhead press, front squat, rows, pull-ups.

## Risks

| Risk | Mitigation |
|---|---|
| World-landmark availability/quality varies by mediapipe version | Pin + assert in the eval harness before relying on them |
| View detection is itself probabilistic | Fail safe to `unusable`, never to a false score |
| Reprocessing 12 rows changes stored data | Snapshot before; one-off `?force=true` per row |
| Another session owns `scheduler.py` / `llm_base.py` | Phase 0 touches only new files; coordinate before Phase 2 |

## How to run the harness

```powershell
# 1. Pull the production videos (needs SSH access to fittrack-prod)
C:\Users\oradl\.venvs\fittrack-video\Scripts\python.exe scripts/fetch_prod_videos.py

# 2. Run the eval over the labeled fixture set
C:\Users\oradl\.venvs\fittrack-video\Scripts\python.exe scripts/video_eval.py

# 3. Diff against the recorded baseline
C:\Users\oradl\.venvs\fittrack-video\Scripts\python.exe scripts/video_eval.py --baseline reports/video-eval-baseline.json
```

Unit tests: `test_video_analysis.py` runs in the normal backend suite anywhere.
`test_pose_analysis.py` needs numpy/mediapipe, so run it with the video venv
(the backend test conftest pulls in SQLAlchemy, hence `--noconftest`):

```powershell
$env:PYTHONPATH = (Resolve-Path backend).Path
C:\Users\oradl\.venvs\fittrack-video\Scripts\python.exe -m pytest --noconftest `
    backend/tests/test_pose_analysis.py backend/tests/test_video_analysis.py -q
```
