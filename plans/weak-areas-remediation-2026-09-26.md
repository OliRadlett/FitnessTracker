# Weak-Area Remediation Plan (2026-09-26)

> **Status**: Planning — no code changed yet. Produced from a read-only survey of the
> codebase, re-verification of the `docs/audits/*` findings against current source, and an
> inspection of the in-flight uncommitted work.
>
> **Caveat**: the working tree is being actively edited by concurrent sessions. Line numbers
> below may drift; re-confirm before editing. Several tracked files are modified and are
> owned by other sessions — do not rewrite them in place without coordinating (AGENTS rules
> #11/#12).
>
> **Docs reconciliation (same change)**: stale facts in `AGENTS.md`, `docs/BUGS.md`,
> `docs/algorithms.md`, `docs/RUNNING.md` and the CODEMAPs (migration head `061`→`079`,
> 42→45 tables, 32→43 charts, decoupling definition, missing Celery/video/spc/encryption rows)
> were fixed on branch `docs/reconcile-2026-09-26`. That branch also fixed a **duplicate
> Alembic revision** on `main` (see Track 1). Track 3's "Docs" row still has the
> `docs/BUGS.md` BUG-071 proximity note outstanding.

## Executive summary

The product is feature-rich. The weak areas are concentrated in **closing loops, verification,
and hardening**, plus a set of **silent-failure bugs**. The single most immediate blocker is
that the local branch is behind `origin/main` and its uncommitted migrations collide with
already-merged ones.

Six remediation tracks, sequenced so Track 1 unblocks the rest. Each is an independent branch
+ PR into `main`.

| Track | Theme | Blast radius | Priority |
|-------|-------|--------------|----------|
| 1 | Unblock branch & migrations | High (git + Alembic) | P0 |
| 2 | Security quick wins | Medium | P0/P1 |
| 3 | Silent correctness bugs | Medium | P1 |
| 4 | In-flight work correctness | Medium | P1 |
| 5 | Frontend reliability sweep | Low–Medium | P2 |
| 6 | New feature (Jev decision layer / training-aid loops) | Medium | P2/P3 |

---

## Verification basis

- `docs/audits/SYNTHESIS-2026-09-20.md` + 7 per-area audit files re-read and spot-checked
  against current source. Findings whose defect is no longer present in code are marked
  **FIXED** and omitted from the fix lists.
- Confirmed still-open (spot-checked this session):
  - `route_intelligence.py:182` reads `elevation_profile.get("elevation", [])` while
    `komoot.py:267` writes `{"elevations": [...]}` → Komoot terrain permanently `unknown`.
  - `auth.py:225-226` logs token-exchange status + full headers + `token_resp.text[:500]`.
  - `api/videos.py:91` only checks `r2_key` is non-empty; no `lift_videos/{user_id}/` prefix
    validation, and `lifting_session_id`/`personal_record_id` are trusted unchecked.
- Confirmed already **FIXED** (do not redo): RMI-05 (`range(len(a))` at
  `route_intelligence.py:148`), plus SEC-01/02/07, RMI-01/02/09, DATA-01, SYNC-01–05, AI-01/03,
  SCI-04, UX-01/02/10.

---

## Track 1 — Unblock branch & migrations (P0) — mostly resolved

**Update 2026-09-26 (later):** the previously-uncommitted in-flight work merged to
`origin/main` while this audit ran — `#84` (Wahoo planned-workout push) and `#101`
(route-merging overhaul). Those sessions renumbered their migrations to `078_add_wahoo_push.py`
and `078_route_merging_overhaul.py`, but **both kept `revision = "078"` with
`down_revision = "077"`** → `main` had two heads with the same revision id and
`alembic upgrade head` fails ("revision 078 is present more than once").

**Fixed on branch `docs/reconcile-2026-09-26`:** `078_route_merging_overhaul.py` →
`079_route_merging_overhaul.py` (`revision = "079"`, `down_revision = "078"`); chain is now
`…077 → 078_add_wahoo_push → 079_route_merging_overhaul` (single head `079`). Doc head
references updated to `079`.

**Still open**
- Local `main` checkout (`63ef8d8`) is ~19 commits behind `origin/main` — fast-forward it
  before any feature work.
- The 3 local commits (`63ef8d8`, `e4d7556`, `dbcbfb1`, T3 bar-detector dataset/trainer) are
  superseded by `origin/main`'s merged T3 work (`#99`) — verify and drop/rebase.
- Repo-root artifacts (`src/`, `bike_model/`, `bike_model_stock/`, `.vite/`) still untracked —
  verify then delete/gitignore.
- Confirm `alembic heads` returns exactly one head after the `079` renumber, then
  `alembic upgrade head` on a fresh DB.

**Risk**: medium now (the collision is fixed; remaining items are branch hygiene).

---

## Track 2 — Security quick wins (P0/P1)

| # | Change | File(s) |
|---|--------|---------|
| S1 | Stop logging token headers/body; log status + provider only | `backend/app/services/auth.py:225-235` |
| S2 | Validate `r2_key` starts with `lift_videos/{user_id}/` on create | `backend/app/api/videos.py:91`, `backend/app/integrations/r2.py` |
| S3 | Ownership-check `lifting_session_id`/`personal_record_id` on video create | `backend/app/api/videos.py:131-134` |
| S4 | Register `SlowAPIMiddleware` (or drop slowapi) and key auth limit on trusted `X-Forwarded-For` | `backend/app/main.py:75,119` |
| S5 | Validate `state` in Google/GitHub OAuth callback | `backend/app/api/auth.py:444-457` |
| S6 | Enforce presigned-PUT `ContentLength` cap | `backend/app/integrations/r2.py:77-85` |
| S7 | Validate the Strava webhook verify token instead of a static default | `backend/app/config.py:66`, `backend/app/api/webhooks.py:52` |

**Tests**: reject foreign R2 prefix (S2); bad/missing OAuth state → 400 (S5); first
integration test for the R2 video endpoints (upload-url/create/stream-url/delete).

---

## Track 3 — Silent correctness bugs (P1)

| ID | Fix | File(s) |
|----|-----|---------|
| RMI-04 | Accept both `elevations` and `elevation`; re-select routes with `terrain_classification = unknown` | `backend/app/integrations/route_intelligence.py:182`, `backend/app/tasks/scheduler.py:1053` |
| RMI-03 | Only persist/mark "personalized" when a real fit exists; else report `default` | `backend/app/tasks/scheduler.py:1385`, `backend/app/api/cycling/power.py:901` |
| RMI-06 | Remove or wire the dead `predicted_effort` path | `backend/app/tasks/scheduler.py:1073` |
| RMI-07 | Stop passing `None` weather features; source real humidity/pressure/wind direction | `backend/app/tasks/scheduler.py:1498` |
| RMI-08 | Upsert cross-domain insights per `(user, insight_type)`; fix `data_quality` scoping | `backend/app/tasks/scheduler.py:2093-2129` |
| RMI-12 | Bound `w_prime` (e.g. 5–40 kJ) | `backend/app/integrations/power_models.py:225-237` |
| SCI-01 | Suppress `intensity_raise` when active health alerts | `backend/app/services/adaptive.py:579-626` |
| SCI-02 | Make taper idempotent for repeated `event_id` | `backend/app/services/training_plan.py:513-528` |
| SCI-03 | Don't re-apply today's planned TSS in TSB projection | `backend/app/services/projections.py:179-182,749` |
| SCI-05 | Align conformity focus scoring with focus-group linking | `backend/app/services/conformity.py:472-475` |
| SCI-06 | Sport-match before picking first same-date activity | `backend/app/services/conformity.py:656-666` |
| SCI-07 | Share one ACSM constant/helper | `backend/app/services/cycling/vo2max.py:33`, `backend/app/integrations/power_models.py:326` |
| SYNC-11 | Increment `merged_count` in Wahoo route sync | `backend/app/services/wahoo.py:324,445` |
| SYNC-12 | Date Whoop weigh-ins by local time | `backend/app/services/whoop.py:1283` |
| DATA-11 | Export `GoalCheckIn` from `models/__init__.py` | `backend/app/models/__init__.py` |
| DATA-03/04/05/09 | Add FK `index=True` + idempotency uniques to ORM `__table_args__` | `models/activity.py`, `training_plan.py`, `health_alert.py`, `lifting.py`, `rpe_calibration.py`, `lift_video_analysis.py` |
| DATA-02/06/07/08 | Remove N+1s (route-quality, activity-context, training-plan matching, segment efforts) | `route_quality_service.py`, `activity_context.py`, `training_plan.py`, `segments.py` |
| SYNC-06/07/08 | Remove sync N+1s / delete-in-loop | `strava/linking.py`, `strava/sync.py`, `strava/webhook_queue.py` |
| Robust | Narrow `except Exception: pass` on streams; raise `400` on malformed GPX; sanitise `Content-Disposition` | `strava/webhooks.py:141`, `strava/sync.py:370`, `api/routes.py:783,1047`, `api/export.py:213` |
| AI-02/07/12 | Surface AI errors; stop leaking provider errors; add `enabled: !!token` | `components/cycling/LlmAnalysisCard.tsx`, `services/llm_base.py:291`, `app/(app)/dashboard/page.tsx:158` |
| Docs | Fix `docs/algorithms.md` decoupling wording + `docs/BUGS.md` BUG-071 proximity note | `docs/algorithms.md:37`, `docs/BUGS.md:474` |

Each item gets a targeted unit/integration test where feasible.

---

## Track 4 — In-flight work correctness (P1, after Track 1)

- [ ] `backend/app/services/route_matching.py:254` — size the longitude cell by `cos(lat)`
      (or widen the neighbourhood) so high-latitude matches are not missed; add a ~55°N test.
- [ ] `backend/app/tasks/scheduler.py:1285` — pre-filter route pairs with `cheap_candidate`
      before O(n²) Fréchet; chunk or cap for large route sets.
- [ ] `backend/app/services/wahoo_push.py:139-274` — make push idempotent across partial
      failure (orphaned Wahoo routes); normalise dict-wrapped create responses (pitfall #6);
      add orchestration tests (scope-403, 404 remove, re-push vs create).
- [ ] `frontend/src/components/activities/Replay3D.tsx` — fix `raceMarkers` index misalignment.
- [ ] `frontend/src/lib/raceRides.ts` + `replay.ts` — share the projection centroid or correct
      the "distance-aligned" comment.
- [ ] `frontend/src/components/activities/Replay3D.tsx` — wind HUD reads refs during render; use state.
- [ ] `frontend/src/lib/lifting/useLiveSession.ts:360` — treat any 4xx on finish as terminal
      (extends BUG-098).
- [ ] Remove dead code: `score_route_breakdown()`, `find_plan_by_external_id`, `delete_route`,
      `WAHOO_FAMILY_BIKING`.
- [ ] Docs: add `route_matching.py` + `recompute_route_similarity` to CODEMAP/AGENTS;
      reconcile `plans/route-merging-overhaul.md` weights/gate (0.45/0.40/0.15, gate 0.55,
      N=120) with the implementation (0.60/0.25/0.15, gate 0.45, N=200).

---

## Track 5 — Frontend reliability sweep (P2)

- [ ] Add `enabled: !!token` to the ~18 JWT queries missing it (calendar, goals, lifting ×7,
      training ×3, routes/duplicates, weather widgets ×3, link-activity, workout-planner,
      add-exercise).
- [ ] Surface mutation errors with `onError` + inline UI (route delete/favorite/rename,
      health dismiss, settings export); add `isError` to the calendar fetch.
- [ ] Route duplicated week math through `lib/training/week.ts` (drifted `getTotalWeeks` in
      `PlanBuilder.tsx:116` vs `WeeklyView.tsx:113`).
- [ ] Replace `toLocale*(undefined/[])` with `getActiveLocale()` at the ~19 sites.
- [ ] Consolidate duplicated formatters (`formatStat`, `formatDistance`, `formatElevation`,
      `formatDuration`, `formatTime`, `StatBadge`) into `lib/utils.ts`.
- [ ] A11y: bump `DashboardRefresh` to a 44px target; portal the `lifting/live` finish sheet
      and `MobileRouteDetailSheet` via `Modal`/`createPortal` (pitfall #32).
- [ ] Dead-code: remove unused `StatsView`, `ErrorState`, `Field`, `PageHeader`,
      `SectionLabel`, `Stat`; wire or delete `types/generated.ts` and guard it with a CI
      drift check.
- [ ] Tests for `lib/training/week.ts` and `lib/routeUtils.ts`.

Verify: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`.

---

## Track 6 — New feature: Jev decision layer (P2/P3)

Highest-leverage new capability; design already written in `plans/jev-decision-layer.md`.

- [ ] Config flags (`typesafe_api_key`, `jev_enabled`, `jev_model`) + optional-integration diagnostic.
- [ ] `backend/app/integrations/jev_client.py` — single entry point, no-op when unset (keep
      stdlib-only at module scope, pitfall #33).
- [ ] Use case 3 — free-text tagging: classify `LiftingSession.notes` / `Activity.name` /
      `Event.notes` / `Goal.notes` into a closed label set; feed `analyze_injury_risk` +
      `deficiency`.
- [ ] Use case 4 — match arbitration: confidence-scored tie-break inside the existing numeric
      gates (activity/route/session merge).
- [ ] Tests: no-op when unset; deterministic fallback unchanged; tag/match fixtures.

**Alternative / additional**: close the remaining training-aid open loops — #22 use fitted
taus in `compute_training_load`, #25 pass CTL/ATL/TSB to the weekly LLM prompt, #27 fix the
weather-card result shape.

---

## Suggested PR sequence

1. `chore/unblock-migrations` — Track 1
2. `security/hardening-quickwins` — Track 2
3. `fix/silent-correctness` — Track 3
4. `fix/inflight-correctness` — Track 4
5. `fix/frontend-reliability` — Track 5
6. `feat/jev-decision-layer` — Track 6

Each: branch → tests + `ruff check` / `tsc --noEmit` → PR into `main` → merge `main` → `prod`
to ship (per AGENTS Git & Deployment Strategy).

## Deferred / separately tracked (not in this plan)

- Garmin / TrainingPeaks / Zwift / Apple Health integrations (need OAuth app registration).
- Cross-route climb clustering + exact distance-aligned segments (`§3.13` future work).
- `openapi-typescript` codegen as the type source of truth (Track 5 only guards/removes the
  stale artifact).
- Monitoring stack live verification (B-33 built), make Playwright E2E blocking in CI.
- BUG-045 secret rotation (manual ops).
