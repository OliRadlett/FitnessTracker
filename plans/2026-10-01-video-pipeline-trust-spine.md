# Video Pipeline Trust Spine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Status:** Approved design (2026-10-01), strict sequential order.
> **Spec:** this document's "Design context" — decisions were made in chat with the human partner; the design lives here to keep it self-contained.
> **Owner branch:** `hotfix/087-jsonb-dialect-type` (do **not** touch route.py / replay/* — another session owns them).
> **Key constraint:** this entire plan ships **zero Alembic migrations**. `analysis_version`, `analysis_status`, `processed_at`, and the existing `pipeline` config already exist. This avoids the migration-number collision class (documented in `plans/bar-tracking-3d.md` and AGENTS.md pitfall #6).

**Goal:** Make the lift-video pipeline's existing measurements trustworthy and verifiably propagated — tests that actually run, a schema-drift guardrail against the second occurrence of the 087/090 class, a reproducible eval baseline, and automatic reprocessing of stale analyses when the pipeline version bumps — so every future video change is measured, not guessed.

**Architecture:** A strict ordering: (1) un-skip the test suite so CI actually exercises video code; (2) remove the ~500 lines of dead Gemini branch + fix the misleading docstrings that made that branch look live; (3) re-run the eval harness against the *current* pipeline and lock a metrics contract that CI asserts; (4) add a migration-fidelity test that runs `alembic upgrade head` against its own DB and diffs the schema against `Base.metadata`, catching both execution-failure and column-drift; (5) wire `analysis_version` to a nightly reprocess sweep + an on-demand UI reprocess + a pipeline-version endpoint. Tracks 2-3 are the prerequisite for Tracks 2 (reach) and 3 (coaching value) of the broader video roadmap.

**Tech Stack:** Python 3.12 / pytest / Alembic / SQLAlchemy; Modal (L4/T4) for the compute worker; FastAPI; React/TypeScript + React Query for the UI. CI = GitHub Actions (`.github/workflows/test.yml`).

## Design context (decisions locked in chat)

1. **Scope:** all four components + dead-code removal. (User: "all of the above".)
2. **Reprocess trigger:** nightly `reap_stale`-style sweep at 03:00 UTC, batch-capped, plus on-demand UI "Reprocess all stale". (User chose "Background sweep + lazy reprocess".) Self-limiting: failed reprocesses stay `failed` and exit the sweep; the UI button includes `failed` rows so outages are one click to recover. No new column.
3. **Eval in CI:** Local-only real clips (33 mp4s are ~1GB, gitignored, won't commit) + a committed metrics contract (`video_metrics_contract.json`) + a CI test asserting the v1 regression metrics over synthetic landmark series. (User chose "Local + CI-enforceable contract".)
4. **Schema-drift guardrail:** additive isolated-DB test (`fittrack_migrate_test`), NOT a swap of `tests/integration/conftest.py`'s `create_all`. Migrate-the-shared-conftest is deferred to its own PR once the chain is known-good. (User: "you decide".)
5. **Dead code:** delete the ~500-line Gemini-Vision branch (`run_full_analysis`, `_call_gemini_form`, `_get_form_prompt`, `_parse_gemini_json`, `_gemini_retry`, `SQUAT_FORM_PROMPT`/`BENCH_FORM_PROMPT`/`DEADLIFT_FORM_PROMPT`, `extract_rep_frames`, `extract_pose_landmarks`, `bar_track_from_frames_onnx`, `_fill_gaps_onnx`). Recoverable from git if F6 materialized. (User chose "Delete it".)
6. **numpy placement:** `numpy>=2.0` and `opencv-python-headless>=4.10` go in `[project.optional-dependencies].dev` only — verified the API/worker path imports none of them (pose_track=stdlib, modal_client=stdlib+config, video_camera=math, video_analytics=stdlib+sqlalchemy). Production image stays lean. CI already does `pip install -e ".[dev]"` so no workflow change needed for the deps.
7. **Contract baselines must be re-measured** before writing the contract file — `video-eval-v5.json` (Sept 23) predates all 3D bar work.

## Global Constraints

- `backend/pyproject.toml` line count of deps unchanged in production (`[dev]` only).
- No migration files created or reordered (avoid colliding with the untracked `088`/`089`/`091` on this checkout — another session's in-flight work).
- CI Postgres 16 service already exists at `test.yml:41-54` with `TEST_DATABASE_URL`/`DATABASE_URL` env.
- Backend hot-reload via `python fittrack.py exec backend` (`docs/RUNNING.md`); tests need `--noconftest` + video venv locally; CI uses `pip install -e ".[dev]" && pytest tests/ -v`.
- Do not commit another session's modified files (`route.py`, `replay/*`, `graph.json`). Only commit this branch's new/edited files.

## Review Focus

Five uncovered classes most likely to bite a user; each pins to the task/test that owns it.

1. **A video test skipped when its dep is missing (recurrence of the silent-skip).** Pinned by Task 1's guard test (`test_no_skipped_video_deps`) + de-skip edits. *Most likely failure: future PR adds `importorskip("something")` of a declared dep and CI goes green while 206 tests sit skipped.*
2. **Re-running `analysis_version` comparison against NULL.** Pre-existing rows have `analysis_version IS NULL`. Pinned by Task 5's selection test using `IS NULL OR ... < ANALYSIS_VERSION`. *Failure mode: old clips never get flagged stale, drift forever.*
3. **`alembic upgrade head` fails on the *current* chain.** The guardrail test will fail if migrations don't apply from base. Pinned by Task 4 being written to surface rather than paper over the chain state. *Failure mode: this PR turns green only after the chain is actually clean.*
4. **`reprocess_stale_videos` re-enqueues a `failed` row forever.** Pinned by Task 5's "failed rows exit the sweep" test. *Failure mode: retry storm against a broken dependency.*
5. **Reprocess button fires for videos with no source object in R2.** A deleted-but-not-reaped LiftVideo would 404 the download. Pinned by Task 5's test that rows with a null/missing `r2_key` are excluded. *Failure mode: nightly sweep throws.*

---

## Task 1: Un-skip the video test suite

**Files:**
- Modify: `backend/pyproject.toml` (add dev deps)
- Modify: `backend/tests/test_pose_analysis.py` (de-skip numpy), `backend/tests/test_bar_tracking.py`, `backend/tests/test_bar_tracking_3d.py`, `backend/tests/test_biomechanics.py`, `backend/tests/test_person_tracking.py`, `backend/tests/test_bar_detection.py`, `backend/tests/test_synthetic_bars.py`, `backend/tests/test_track_bars.py` (de-skip numpy/cv2)
- Create: `backend/tests/test_ci_deps.py`

**Interfaces:**
- Consumes: none
- Produces: green CI for 206 previously-skipped tests; a `test_no_skipped_video_deps` guard.

- [ ] **Step 1: Write failing test** — `test_no_skipped_video_deps` in `test_ci_deps.py`. It scans `backend/tests/*.py` for `importorskip("X")` / `pytest.importorskip("X")` and fails if `X` is in `[project.optional-dependencies.dev]`. Also asserts `numpy` and `cv2` import successfully under the dev extras.

```python
def test_no_importorskip_on_declared_dev_deps():
    skipped = scan_importorskip_targets(Path("backend/tests"))
    dev_deps = parse_dev_extras("backend/pyproject.toml")
    offenders = skipped & dev_deps
    assert not offenders, f"tests importorskip declared deps that skip silently: {offenders}"

def test_video_deps_importable_in_ci():
    import numpy
    import cv2  # noqa: F401
```

- [ ] **Step 2: Run test → FAIL** (`numpy`/`cv2` not in dev extras; guard finds importorskip lines).
- [ ] **Step 3: Add deps** to `backend/pyproject.toml` `[project.optional-dependencies.dev]`: `numpy>=2.0`, `opencv-python-headless>=4.10`.
- [ ] **Step 4: De-skip** the 8 test files: replace `np = pytest.importorskip("numpy")` → `import numpy as np` (and similarly `cv2 = pytest.importorskip("cv2")` → `import cv2 as cv2` / `import cv2`). Leave `test_video_camera.py` as-is (it may importorskip for a different reason — verify).
- [ ] **Step 5: Run tests → PASS** locally with video venv; `ruff check`; commit.

Run: `C:\Users\oradl\.venvs\fittrack-video\Scripts\python.exe -m pytest --noconftest backend/tests/test_pose_analysis.py backend/tests/test_bar_tracking_3d.py backend/tests/test_person_tracking.py backend/tests/test_bar_tracking.py backend/tests/test_bar_detection.py backend/tests/test_biomechanics.py backend/tests/test_synthetic_bars.py backend/tests/test_track_bars.py backend/tests/test_ci_deps.py -q`

## Task 2: Remove dead code + correct misleading docstrings

**Files:**
- Modify: `backend/app/integrations/video_analysis.py` (delete `run_full_analysis`, `_call_gemini_form`, `_get_form_prompt`, `_parse_gemini_json`, `_gemini_retry`, `extract_rep_frames`, + the 3 `*_FORM_PROMPT` constants)
- Modify: `backend/app/integrations/bar_detection.py` (delete `bar_track_from_frames_onnx`, `_fill_gaps_onnx`)
- Modify: `backend/app/integrations/pose_analysis.py` (delete `extract_pose_landmarks`)
- Modify: `backend/app/api/videos.py:559` (fix phantom `/reprocess` docstring → `/process?force=true`)
- Modify: `backend/app/tasks/scheduler.py:4349-4355` (remove the shadowed None rest-write block)
- Modify: `backend/app/config.py` / `backend/app/integrations/modal_client.py` (reconcile the `video_bar_detection_enabled` comment contradiction; rename/clarify `VIDEO_MULTI_POSE_ENABLED` as bench-only)
- Modify: module docstrings `modal_client.py:4-6,20`, `scheduler.py:4124,4126` (drop "classifies via Gemini Vision")

**Interfaces:**
- Consumes: none.
- Produces: ~500 fewer lines, no live caller of any deleted symbol (verified in chat via the audit).

- [ ] **Step 1: Prove the deletions are safe.** grep every candidate symbol across `backend/`, `frontend/`, `scripts/`, `.github/`. Record zero non-test/non-definition references per symbol. (Already done in chat; re-verify and record counts.)
- [ ] **Step 2: Delete** the symbols. `git rm`-style edits (not full-file rewrites — these live in large modules). Keep `video_analysis.py`'s remaining ~1100 lines.
- [ ] **Step 3: Fix the 7 misleading bits.** 2 docstrings, 1 shadowed write block, 1 flag-name/comment mismatch, 3 module docstrings. Each change is a line-level edit with the old→new literal.
- [ ] **Step 4: `ruff check` + `pytest tests/test_modal_workers.py -q`** (ensures the module-mount test still passes — deleted symbols must not be referenced by the mount list). Commit.

## Task 3: Commit baseline + CI metrics contract

**Files:**
- Create: `reports/video-eval-baseline.json` (from `video-eval-v5.json`, the Sept-23 snapshot; 13 KB) — add a `.gitignore` negation `!/reports/video-eval-baseline.json` so the artifact is reproducible for `--baseline` diffs without re-tracking the whole gitignored dir.
- Create: `backend/tests/fixtures/video_metrics_contract.json`
- Create: `backend/tests/test_video_metrics_contract.py` (reads the contract + asserts the regression suite is importable)

**Interfaces:**
- Consumes: 1 + 2 (green CI suite); the v1 regression metrics identified in `plans/video-analysis-rewrite.md` (Table, "Baseline results").
- Produces: a regression net that turns the v2 plan's targets into CI assertions.

- [ ] **Step 1: Re-measure locally.** Run `video_eval.py --baseline reports/video-eval-baseline.json` against the *current* `main` code. The run writes a fresh report to `reports/` (not committed); confirm the Sept-23 numbers still hold (velocity, scoring, RPE) — they should, since the 3D bar work is gated behind height/focal and most metrics are unchanged. Record the delta in the plan's margin. **Purpose:** validate the frozen baseline is still representative before locking it as the CI reference; real clips are not committed (decision 3), so this is a manual ritual, not a CI gate.
- [ ] **Step 2: Write the contract** `backend/tests/fixtures/video_metrics_contract.json` with the exact bands copied from the v2 plan's §4 table (e.g. `rpe_saturation_rate <= 0.1`, `form_score_zero_rate == 0.0`, etc.). These document intent; they are **not** recomputed in CI (that needs the video fixtures).
- [ ] **Step 3: Write the test.** `test_video_metrics_contract.py` asserts: (a) `video_metrics_contract.json` exists, is valid JSON, and its keys ⊆ the known metric names in `plans/video-analysis-rewrite.md` §4 (prevents a typo'd key from silently passing); (b) the v1 regression suite that pins each scenario — `test_pose_analysis.py` (`test_multi_rep_set_averages_per_rep_scores`, `test_negative_velocity_loss_is_clamped_to_zero`, `test_rep_count_preserved_when_unmeasurable`) and `test_video_analysis.py`'s `_velocity_loss_pct` block — is **imported and non-empty** so it can't be accidentally deleted. The aggregate-metric assertions themselves live in that suite (un-skipped by Task 1); Task 3's job is the committed reference + the local `--baseline` ritual. No Modal/R2.
- [ ] **Step 4: `pytest ...` → PASS; commit** baseline + contract + test together.

Run: `pytest backend/tests/test_video_metrics_contract.py backend/tests/test_ci_deps.py -v`

## Task 4: Migration-fidelity guardrail

**Files:**
- Create: `backend/tests/test_migration_fidelity.py`
- Modify: `.github/workflows/test.yml` (add a `createdb fittrack_migrate_test` step before `Run tests`)

**Interfaces:**
- Consumes: the Alembic chain (`backend/alembic/versions/`), the `Base` metadata (`app.database`), CI's Postgres 16 service (already present).
- Produces: a test that fails if any migration fails to apply from base OR if the migrated schema lacks any `Base.metadata` column — the exact 087 and 090 failure classes.

- [ ] **Step 1: Write failing test.** `test_migration_matches_metadata`: create engine against `TEST_DATABASE_URL` with `_migrations` suffix (e.g. `postgresql+asyncpg://...@localhost:5432/fittrack_migrate_test`); run `alembic upgrade head` via `Config`/`Command` programmatically; then for every table/column in `Base.metadata`, assert the column exists in `information_schema.columns`.
- [ ] **Step 2: Run → expect to discover the current chain state.** This step is diagnostic — if the chain is clean from base, the test passes immediately; if not, it reports the specific gap, and the chain must be fixed *before* the test is green. That is the intended behavior.
- [ ] **Step 3: Add CI step** — `createdb fittrack_migrate_test` (or fall back to `createdb` against the running Postgres) — to `test.yml` between install and run, guarded `if: always()` so it doesn't mask a real failure.
- [ ] **Step 4: `pytest backend/tests/test_migration_fidelity.py` + full suite → PASS; commit.**

Run: `pytest backend/tests/test_migration_fidelity.py -v` and `psql -c "CREATE DATABASE fittrack_migrate_test TEMPLATE fittrack_test"` locally to confirm the fixture.

## Task 5: Reprocess-on-version-bump

**Files:**
- Create: `backend/app/tasks/video_reprocess.py` (extract the sweep, to keep scheduler.py from growing further)
- Modify: `backend/app/tasks/scheduler.py` (imports the task + registers the beat entry; does **not** edit `process_lift_video` itself)
- Modify: `backend/app/api/videos.py` (add `GET /pipeline-version`; add stale-flag to the list response)
- Modify: `backend/app/schemas/lifting.py` (add `is_stale: bool` to `LiftVideoRead`; add `stale_count: int` to a small response schema)
- Modify: `frontend/src/components/lifting/VideoProgressTab.tsx` + `frontend/src/lib/api/lifting.ts` + `frontend/src/app/(app)/lifting/videos/page.tsx` (stale banner + "Reprocess all stale" button calling the new endpoint)
- Create: `backend/tests/test_video_reprocess.py`

**Interfaces:**
- Consumes: `ANALYSIS_VERSION` constant from `pose_track.py`; existing `analysis_status`/`analysis_version`/`processed_at` columns; the existing `process_lift_video` Celery task (unchanged).
- Produces: nightly sweep, on-demand reprocess, stale UI.

- [ ] **Step 1: Write failing tests.**
  - `test_select_stale_videos` — calls the (not-yet-written) `select_stale_videos(db, analysis_version=ANALYSIS_VERSION)` and asserts the selection: a `completed`/`version=1` row is selected; a `failed`/`version=1` row **not** (self-limiting); a `completed`/`version=NULL` row **is** (pre-bump rows); a `completed`/`version=2` row is **not**; a `queued`/`processing`/any row is **not**; a `completed` row with a null `r2_key` is **not** (missing source object).
  - `test_pipeline_version_endpoint` (FastAPI test client): `GET /pipeline-version` → `{ analysis_version, stale_count }`; `stale_count` equals `len(select_stale_videos(...))` (so the GET and the sweep share one source of truth).
- [ ] **Step 2: Add the shared selection function.** `select_stale_videos(db, analysis_version: int = ANALYSIS_VERSION) -> Sequence[LiftVideo]` in `video_reprocess.py` — both the GET endpoint and the beat sweep call it, so `stale_count` and the sweep can never disagree. Returns `completed`-status rows where (`analysis_version IS NULL` OR `analysis_version < ANALYSIS_VERSION`) AND `r2_key IS NOT NULL`, ordered by `created_at` asc, capped `limit=10`.
- [ ] **Step 3: Add two routes** in `videos.py`, both registered **before** `/{video_id}` (AGENTS.md pitfall #13 — a `/{param}` route registered first swallows `/pipeline-version` as a video id):
  - `GET /pipeline-version` → returns `{ analysis_version: ANALYSIS_VERSION, stale_count: len(select_stale_videos(...)) }`.
  - `POST /pipeline-version/reprocess` → runs the same selection (with the limit) and calls `process_lift_video.delay(id, force=True)`, returns `{ enqueued: int }`.
  Keep `analysis_version` in `LiftVideoRead` (`schemas/lifting.py:444`); add `is_stale: bool` computed by comparing each row's `analysis_version` to the constant (NULL → stale).
- [ ] **Step 4: Implement the beat sweep.** `reprocess_stale_videos()` in `video_reprocess.py`: the `asyncio.run(_run())` + `task_session()` pattern from `scheduler.py:3553`; call `select_stale_videos` (limit 10) and skip the run if `processing`+`queued` > 3 (rate guard against Modal saturation); `process_lift_video.delay(id, force=True)`.
- [ ] **Step 5: Register beat.** Add `reprocess-stale-videos` at 03:00 UTC alongside `reap-stale-videos` (15 min past the hour), reusing the existing `crontab` import.
- [ ] **Step 6: Wire the UI.** "N analyses out of date" banner on `videos/page.tsx`; **Reprocess all stale** button calls `POST /pipeline-version/reprocess` via `useAuthFetch` + React Query `useMutation`, then invalidates the `['lift-videos']` query. Reuses the existing poll-every-5s pattern on that page.
- [ ] **Step 7: `ruff check` + full test run → PASS; commit.**

Run: `pytest backend/tests/test_video_reprocess.py -v`

## Sequencing checkpoint

After Task 5 lands green, the measurement spine is closed. Tracks 2–3 of the broader video roadmap (#2 coverage, #3 coaching value) become safe to attempt — and their next steps will cite the contract + guardrail as their regression net.
