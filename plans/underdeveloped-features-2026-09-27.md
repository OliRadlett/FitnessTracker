# Underdeveloped Features Audit (2026-09-27)

> **Status**: Findings + prioritised remediation plan. No code yet.
>
> **Method**: read-only audit of `origin/main` (`bbef92d`). The local working checkout was
> **stale** (`63ef8d8`) and produced two false positives (Wahoo push, SimilarRoutes) — every
> claim below was re-verified with `git grep origin/main`. Plan checkboxes in `plans/*.md` are
> frequently stale (several "open" items shipped in backlog Phase 4); statuses here are
> code-verified, not checkbox-derived.

## Summary

Most headline features are built and mature. The "underdeveloped" surface is concentrated in
**dead code**, **backend/frontend half-builds**, and a handful of **deferred features**. The
quick wins (A) are low-risk and remove the most visible smell; B–C are larger.

| Group | Theme | Effort | Priority |
|-------|-------|--------|----------|
| A | Concrete gaps / dead code | S | P1 |
| B | Half-built features | M | P1–P2 |
| C | Deferred / not built | L | P2–P3 |
| D | Ops / hygiene | S–M | P3 |

---

## A. Concrete gaps / dead code (small, high-confidence)

| # | Item | Evidence | Action |
|---|------|----------|--------|
| A1 | **`StatsView` is dead code** — monthly distance bars, sport pie, weekly TSS; never imported (activities page uses List/Week/Timeline/Patterns) | `frontend/src/components/activities/StatsView.tsx:18`; flagged in `frontend/src/CODEMAP.md:190` | Wire as an Activities "Stats" tab **or delete** |
| A2 | **5 unused UI primitives** (0 imports each): `Field`, `PageHeader`, `SectionLabel`, `Stat`, `ErrorState`; `OnboardingWizard` duplicates `Field` locally | `frontend/src/components/ui/{Field,PageHeader,SectionLabel,Stat,ErrorState}.tsx` | Adopt or delete |
| A3 | ~~**Exercise variation computed then discarded**~~ — **DONE** (migration `082`): `LiftVideo.exercise_variation` persisted, returned by `process-status` + `LiftVideoRead`, shown as a chip on the videos list | `backend/app/integrations/pose_analysis.py:1873` | ✅ Closed |
| A4 | ~~**Notification API is thin**~~ — **DONE**: `GET /` now takes `offset`, `read`, `type`; new `GET /summary` returns whole-history total/unread/per-type counts. Page + bell filter server-side and label from the summary instead of the loaded 200-row slice | `backend/app/api/notifications.py` (`list_notifications`) | ✅ Closed |
| A5 | ~~**JSON export drops newer tables**~~ — **DONE**: export grew 24 → 30 collections (`lift_videos`, `lift_video_analyses`, `rpe_calibrations`, `cross_domain_insights`, `athlete_insights`, `segments` + nested `efforts`) | `backend/app/services/data_export.py` (import list) | ✅ Closed. Note: `WarmupTemplate` was *already* in the export — the audit row was wrong there. |


## B. Half-built features (one side missing)

| # | Item | Evidence | Missing |
|---|------|----------|---------|
| B1 | **Form-based weakness detection** | Frontend ready: `frontend/src/lib/api/types/deficiency.ts` (`form_quality`), `DeficiencyCard` renders generically | Backend producer (Modal form analysis); `plans/modal-inference-expansion.md` item |
| B2 | ~~**Lifting TSS ignores the work done**~~ — **DONE**: `estimate_lifting_tss` is now Foster session load, `(tonnage / bodyweight) × (session_RPE / 10) × 1.4` | `backend/app/services/lifting.py` | ✅ Closed. The audit framed this as "video-derived lifting TSS", but the real defect was simpler and needed no video: the formula was `duration_min × avg_RPE / 7`, so a 3×3 at 200 kg and a 3×3 at 40 kg scored **identically** — it never looked at weight or reps. Bodyweight-normalising the tonnage makes the metric scale-free across lifters. `LIFT_TSS_PER_VOLUME_LOAD = 1.4` is a display-scale constant pinned to the old ~60 TSS/hour-at-RPE-7 anchor so the shared `combined_training_load` chart stays comparable. Bodyweight = latest `WeightLog`; without a weigh-in it falls back to the old estimate rather than losing the number. The weekly aggregation now passes `force=True` (a standing recompute — sets and bodyweight both change after the fact). 17 new unit + 6 integration tests; negative-checked, 12 fail against the old formula and the ordering test reports 1.0× where it should be 5.0× |
| B3 | **Learned bar detector (T3)** | `backend/app/integrations/bar_detection.py` = Hough heuristic seeded by pose proxy; **off by default** (`config.py` `video_bar_detection_enabled=False`) | Real learned detector; bar-path truth is pose-proxy in prod |
| B4 | ~~**Segment distance alignment**~~ — **DONE**: `distance` stream now requested and preferred; the timebase is derived from the `time` stream instead of a hardcoded 1 s/sample | `backend/app/services/segments.py` | ✅ Closed. The audit understated this: `ActivityStream.resolution` is `NULL` for *every* Strava stream (Strava sends `"high"`/`"low"`), so "velocity×resolution" was really "velocity×1s" applied to GPS-rate streams — a 10x-style error in every `elapsed_seconds` / `avg_speed_mps` / `effort_vam` / `started_at` ever written. Existing rows are stale; `recompute_ride_segments` (weekly Sun 3:15AM) will fix them |
| B5 | ~~**`_mean()` drops zeros from power/HR averages**~~ — **DONE**: `_mean` takes an explicit `zero_is_dropout` flag — power keeps `0 W` (coasting is a real reading), HR drops non-positive (a `0` is a dropped strap) | `backend/app/services/segments.py` (`_mean`) | ✅ Closed. The blanket `v not in (0, None)` filter was accidental: the altitude slice in the same function already used a different, correct filter. It also made a genuine all-coasting window store `None` (truthiness check) instead of `0.0`. Magnitude on a realistic ride: `best_avg_power_watts` read 300 W where the true window average was 97 W. `avg_power_watts` / `best_avg_power_watts` values **change**; `recompute_ride_segments` (weekly Sun 3:15AM) rewrites the stale rows |

## C. Deferred / not built

| # | Item | Evidence | Notes |
|---|------|----------|-------|
| C1 | **Warmup-effectiveness analysis** | Only `WarmupTemplate` CRUD exists; no adherence→working-set linkage | Explicitly deferred (`plans/backlog-2026-09-20.md`) |
| C2 | **Cross-route climb clustering + leaderboard** | `integrations/segment_intelligence.py` clusters by gradient signature only; no geometry key (start/end snap + bearing) | **Split.** ✅ **C2a — leaderboard: DONE.** New `/segments` page makes the all-routes view reachable (`GET /segments` with no `route_id` and `getSegmentDetail` were both built and tested but had no UI — segments only ever appeared inside a route detail panel). Grouped by route, route/category/ridden filters, `Stat` summary row. Shared `SegmentRow` extracted so the route-scoped card and the page can't drift. ❌ **C2b — geometry-key clustering: still open.** The page groups by route; it does not yet recognise that the same climb on two different routes is one climb. Needs a start/end snap + bearing key before a cross-route PR is meaningful |
| C3 | **Synced 3D route compare** | `CompareRoutesModal` = two independent `Route3D`; activities compare already has a shared master clock | Parity gap with `CompareActivitiesModal` |
| C4 | **New integrations** — Garmin Connect, TrainingPeaks, Zwift, Apple Health | `AGENTS.md` Planned | Needs OAuth app registration |
| C5 | **Live-Lift supersets / reordering** | `plans/live-lift-reliability-audit-2026-09-20.md` deferred | Needs a grouping data model |
| C6 | **`/today` morning brief** | `frontend/src/app/(app)/today/page.tsx:3,135` — explicit POC ("Experimental — tell us if it earns the bookmark") | Product go/no-go + cross-page coherence, else delete |

## D. Ops / hygiene
- **Secret rotation** (BUG-045): Komoot/Gemini/`SECRET_KEY`/NextAuth.
- **`prod` compose GHCR names** hardcoded + case-sensitive (`docker-compose.prod.yml`) — parameterise/source from env.
- **`/health` + `/metrics` intentionally unauthenticated** — document as design.
- **E2E depth**: specs are render-heavy; add mutation flows (live-lift create/log/finish, goal check-in, route tag + collection, GPX round-trip, deep links, notifications).

---

## F. Found while remediating (not in the original audit)

| # | Item | Evidence | Action |
|---|------|----------|--------|
| F2 | **`types/generated.ts` is ~1000 lines stale** — a full `npm run codegen` against a live backend produced +1005/−21, i.e. many endpoints added by other sessions never had their types regenerated. Not fixed here (a full regen is its own change and would collide with in-flight work). | verified by regenerating against a container running `origin/main` + this branch | Do a **dedicated regen-only PR**. Hand-added blocks in this PR were diffed byte-for-byte against real codegen output. |
| F1 | **Migration 076 could not run on a migration-built database.** It dropped `uq_route_source_provider`, but `005` created that constraint unnamed, so Postgres named it `route_sources_provider_provider_route_id_key` — a name only `create_all()` databases ever had. `alembic upgrade head` failed with `UndefinedObjectError` on a **fresh** DB, so any new environment / DR restore / CI migrate-from-base was broken. (Production was unaffected only because its schema came from `create_all()`.) | `alembic/versions/005_add_routes.py:56`, `076_scope_route_sources_to_user.py:51` | ✅ **Fixed** — 076 now reads the real `pg_constraint` rows and drops whichever global unique constraint exists, under whatever name. Verified `upgrade head` → `downgrade 075` → `upgrade head` on a scratch DB. |

---

## Non-issues (verified done — do not chase)
- **Wahoo planned-workout push** — fully wired (`api/training_plans.py:189,219`; trigger `WeeklyView.tsx:674`).
- **Similar routes** — wired (`RouteDetailPanel.tsx:298`).
- Video trend charts, RPE calibration, `aggregate_video_analyses` task, video injury→`HealthAlert`, notifications page (rich UI), unified weight panel, light theme, F2 velocity graph + per-rep chapters — all shipped.

---

## Recommended sequencing

1. **`chore/cleanup-and-quick-wins`** (P1, S): A1, A2, A3, A5, A4.
   - Dead-code removal (StatsView + 5 primitives), surface exercise variation, complete the export, extend notification filters.
2. **`feat/form-deficiency`** (P1, M): B1 (backend producer → existing UI).
3. **`feat/video-derived-tss`** (P2, M): B2.
4. **`feat/cross-route-segments`** (P2, L): C2 (geometry key + global page/leaderboard).
5. **`feat/warmup-effectiveness`** (P3, L): C1.
6. **`fix/route-3d-compare-sync`** (P3, S): C3.
7. Product decision on **`/today`** (C6); ops items (D) as a separate hygiene pass.

Each: isolated worktree → tests (`pytest` backend, `tsc`/`vitest` frontend) → PR into `main` →
release via `main → prod`. Update `AGENTS.md` / CODEMAPs in the same PR.

## Open decisions
- **`StatsView`**: wire a Stats tab, or delete? (Recommend delete unless the tab is wanted.)
- **`/today`**: promote, iterate, or retire?
- **Bar detector T3**: is a learned detector in scope, or keep the heuristic?
