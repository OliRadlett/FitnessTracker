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
| A3 | **Exercise variation computed then discarded** — `exercise_variation` (high/low-bar squat, sumo/conventional deadlift, push/strict press) set on the result, never persisted/returned/rendered | `backend/app/integrations/pose_analysis.py:1873` (only reference) | Add a column + expose in `process-status`/UI |
| A4 | **Notification API is thin** — only `limit` + `unread_only`; no `type` filter, no general read filter, no pagination offset | `backend/app/api/notifications.py` (`list_notifications`) | Extend the contract (page is already rich) |
| A5 | **JSON export drops newer tables** — omits `LiftVideo`, `LiftVideoAnalysis`, `RpeCalibration`, `Segment`/`SegmentEffort`, `CrossDomainInsight`, `AthleteInsight`, `WarmupTemplate` | `backend/app/services/data_export.py` (import list) | Add them to the export model set |

## B. Half-built features (one side missing)

| # | Item | Evidence | Missing |
|---|------|----------|---------|
| B1 | **Form-based weakness detection** | Frontend ready: `frontend/src/lib/api/types/deficiency.ts` (`form_quality`), `DeficiencyCard` renders generically | Backend producer (Modal form analysis); `plans/modal-inference-expansion.md` item |
| B2 | **Video-derived lifting TSS** | `backend/app/services/lifting.py:65-75` = duration×RPE only; `combined_training_load` chart exists | Velocity-loss/fatigue-based estimate (plan Phase 7) |
| B3 | **Learned bar detector (T3)** | `backend/app/integrations/bar_detection.py` = Hough heuristic seeded by pose proxy; **off by default** (`config.py` `video_bar_detection_enabled=False`) | Real learned detector; bar-path truth is pose-proxy in prod |
| B4 | **Segment distance alignment** | `backend/app/integrations/strava_client.py` never requests the `distance` stream; `services/segments.py` integrates velocity×resolution | Request/use the Strava `distance` stream (§3.13) |

## C. Deferred / not built

| # | Item | Evidence | Notes |
|---|------|----------|-------|
| C1 | **Warmup-effectiveness analysis** | Only `WarmupTemplate` CRUD exists; no adherence→working-set linkage | Explicitly deferred (`plans/backlog-2026-09-20.md`) |
| C2 | **Cross-route climb clustering + leaderboard** | `integrations/segment_intelligence.py` clusters by gradient signature only; no geometry key (start/end snap + bearing). No global Segments page (`SegmentsCard` is route-only; `lib/api/segments.ts` already lists all) | Route-independent segments/PR leaderboard |
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
