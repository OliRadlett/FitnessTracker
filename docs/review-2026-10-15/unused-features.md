# Unused / dead code audit — 2026-10-15

> **Method & scope**: READ-ONLY static analysis of the FitTrack worktree at
> commit `5f54f40` (detached HEAD), performed 2026-10-16. Findings are
> static-analysis only — dynamic imports, string-built routes, framework
> conventions, and runtime-registered hooks are called out as *unproven* where
> relevant. Every row carries a `path:line` evidence anchor.
>
> **What "dead" means here**:
> - *no importer* — no other file under `frontend/src` (including tests) imports
>   the module (`rg`-equivalent reverse-import graph over all `.ts`/`.tsx`).
> - *declaration-only* — the exported symbol occurs exactly once repo-wide (its
>   own declaration); no call site anywhere, including its own file.
> - *production-dead / test-only* — only referenced from `__tests__` or a dev
>   script, never from app code.
>
> Framework-convention files (`page.tsx`, `layout.tsx`, `loading.tsx`,
> `route.ts`, `manifest.ts`, `public/sw.js`, `*.d.ts`) are **NOT** dead — they are
> entered by Next.js/routing/ambient typing.
>
> Prior audit `plans/underdeveloped-features-2026-09-27.md` was read and its open
> rows re-verified; see section E for the ones that are already wired.

## A. Frontend dead code

| Item | Evidence (path:line) | Why it is dead | Conf. | Action |
|------|----------------------|----------------|-------|--------|
| **Entire `components/mode-shell/` package** — `ModeRail.tsx`, `modeConfig.ts`, `useTodayBadge.ts`, `index.ts` | `frontend/src/components/mode-shell/index.ts:6`; `app/(app)/layout.tsx:93-95` ("ModeRail (4-mode shell) is removed") | `index.ts` (the only entry point) has **zero importers**; the whole subtree is only reachable through it. Superseded by `Sidebar` + inline `resolveTrainTarget` in `components/Sidebar/useTodayPlanTarget.ts:17-18`. Nothing (not even tests) imports any symbol. | high | delete |
| **`components/motion/Reveal.tsx`** | `frontend/src/components/motion/Reveal.tsx:27` | Zero importers. Only mentions are comments in `motion/tokens.ts:8,29`. The "chart reveal" wrapper was never adopted. | high | delete |
| **`lib/training/sportIcons.ts`** (whole file) | `frontend/src/lib/training/sportIcons.ts:10,16` | Zero importers. Its `SPORT_ICON` duplicate lives in `components/training/dayCellShared.ts:17` (the one actually used by `DayCell.tsx:18`, `ConformitySummaryCard.tsx:14`, `WeeklyView.tsx:44`). | high | delete |
| **`lib/api/types/generated.ts`** (~15k lines) | `frontend/src/lib/api/types/generated.ts` | Not re-exported by `types.ts` barrel (only the 18 domain modules) and has zero importers. Separate from the F2 "stale by ~1000 lines" note in the prior audit — it is also entirely unimported, so whole-file regen is moot. | high | delete (or re-adopt via real codegen) |
| `chartTheme.ts :: CHART_FONT_TIMESTAMP` | `frontend/src/components/charts/chartTheme.ts:53` | Declaration-only export (occurs once repo-wide). | high | delete export |
| `chartTheme.ts :: CHART_STALE` | `frontend/src/components/charts/chartTheme.ts:25` | Declaration-only export. | high | delete export |
| `QualityBadge.tsx :: QualityIndicator` | `frontend/src/components/routes/QualityBadge.tsx:72` | Declaration-only export; `QualityBadge.tsx` itself is used, but this second export never is. | high | delete export |
| `Button.tsx :: IconButton` (+ `IconButtonProps`) | `frontend/src/components/ui/Button.tsx:69` | Declaration-only export. CODEMAP lists it as an adopted primitive — it is not. | high | delete export (or wire) |
| `sportUtils.ts :: getSportEmoji` | `frontend/src/lib/sportUtils.ts:54` | Occurrences are the declaration + a comment (`sportUtils.ts:64`); no call sites. | high | delete |
| `sportUtils.ts :: getSportIconName` | `frontend/src/lib/sportUtils.ts:68` | Declaration-only export. | high | delete |
| `utils.ts :: getActiveTimeFormat` | `frontend/src/lib/utils.ts:40` | Declaration-only export. (`getActiveUnitSystem` at same file is test-only, see below.) | high | delete |
| `lib/api/projections.ts :: getTsbProjection` | `frontend/src/lib/api/projections.ts:19` | Declaration-only export. The TSB projection IS wired, but `WeeklyView.tsx:176` calls `apiFetch('/api/v1/projections/tsb/...')` inline instead of via this client fn. | high | wire or delete |
| `lib/api/fetch.ts :: isStaleTokenError` | `frontend/src/lib/api/fetch.ts:157` | Occurrences are the declaration + a doc-comment (`fetch.ts:155`); no component calls it. CODEMAP claims components "render honest-empty states via `isStaleTokenError`" — no component does. | high | wire or delete |
| ~40 `*Props` interfaces + internal helper exports | e.g. `components/training/*Props`, `components/ui/Button.tsx :: ButtonProps` | Exported but only used inside their own file. Not "dead code" (they compile + type internal call sites) but they widen the public surface for no gain. | high | keep / un-export |
| Watch-holder exports (used internally only) | `ui/ProviderBadge.tsx :: PROVIDER_ICONS:17`; `routes/SegmentRow.tsx :: CATEGORY_STYLES:12`, `ClimbDetailPanel:194`; `Sidebar.tsx :: useSidebar:72`; `motion/AnimatedNumber.tsx :: useAnimatedNumber:18`; `lib/api/notifications.ts :: friendlyBodyFor:125` | Exported, referenced only within their own file. Listed to pre-empt "is this dead?" — it is **not**, just over-exported. | high | keep |

## B. Backend dead code

Scans: `backend/app/services`, `backend/app/integrations` — `def` names that occur **exactly once repo-wide** (declaration only), excluding route handlers (FastAPI resolves those via `@router` decorators) and Pydantic hooks.

| Item | Evidence (path:line) | Why it is dead | Conf. | Action |
|------|----------------------|----------------|-------|--------|
| `route_quarantine.py :: quarantine_orphaned_routes` | `backend/app/services/route_quarantine.py:258` | Never called by any API route, Celery task, or script — only a mention in `alembic/versions/089_add_route_quarantine.py:17` and CODEMAP. The only thing that stamps `quarantined_at`. **See C-1**. | high | wire (schedule/CLI) |
| `whoop_client.py :: get_cycles` | `backend/app/integrations/whoop_client.py:89` | Sync uses `get_all_cycles` (`services/whoop.py:386,1377`). | high | delete |
| `whoop_client.py :: get_cycle_detail` | `whoop_client.py:127` | No callers. | high | delete |
| `whoop_client.py :: get_sleep_activities` | `whoop_client.py:280` | Sync uses `get_all_sleep_activities` (`whoop.py:623,1546`). | high | delete |
| `whoop_client.py :: get_workout_activities` | `whoop_client.py:337` | Sync uses `get_all_workout_activities` (`whoop.py:923,1713`). | high | delete |
| `wahoo_client.py :: get_user` | `backend/app/integrations/wahoo_client.py:125` | No callers. | high | delete |
| `wahoo_client.py :: find_plan_by_external_id` | `wahoo_client.py:191` | No callers. | high | delete |
| `wahoo_client.py :: find_route_by_external_id` | `wahoo_client.py:292` | No callers. | high | delete |
| `withings_client.py :: get_user_info` | `backend/app/integrations/withings_client.py:98` | No callers (sync uses `get_measurements`). | high | delete |
| `r2.py :: download_object_bytes` | `backend/app/integrations/r2.py:113` | No callers; streaming uses presigned GET. | high | delete |
| `r2.py :: upload_object_bytes` | `r2.py:121` | No callers; uploads use presigned PUT. | high | delete |
| `bar_detection.py :: bar_track_from_frames_onnx` | `backend/app/integrations/bar_detection.py:345` | No callers (only `plans/*` mention it). | high | delete or rewire |
| `bar_detection.py :: _fill_gaps_onnx` | `bar_detection.py:368` | No callers at all. | high | delete |
| `video_analysis.py :: extract_rep_frames` | `backend/app/integrations/video_analysis.py:534` | No callers (only plans). | high | delete |
| `pose_analysis.py :: extract_pose_landmarks` | `backend/app/integrations/pose_analysis.py:366` | No app callers; only `scripts/run_video_local.py` (dev harness). | med | keep (dev) / delete |
| `segment_intelligence.py :: _gaussian_smooth` | `backend/app/integrations/segment_intelligence.py:39` | No callers. | high | delete |
| `route_service.py :: _proximity_score` | `backend/app/services/route_service.py:46` | No callers **in this module** (same-named functions in `activities.py`/`merge_service.py` are separate). | med | delete |
| `route_service.py :: _name_score` | `route_service.py:127` | No callers. | high | delete |
| `route_service.py :: score_route_breakdown` | `route_service.py:175` | No callers (mentioned in a plan doc). | high | delete |
| `route_service.py :: get_user_routes` | `route_service.py:611` | No callers. | high | delete |
| `route_collection_rules.py :: evaluate_all_smart_collections` | `backend/app/services/route_collection_rules.py:133` | No callers. | high | delete |
| `route_collection_rules.py :: validate_collection_rules` | `route_collection_rules.py:162` | No callers. | high | delete |
| `cache.py :: invalidate_prefix` | `backend/app/services/cache.py:175` | No callers. | high | delete |
| `whoop.py :: validate_and_store_token` | `backend/app/services/whoop.py:193` | No callers. | high | delete |
| `auth.py :: get_current_user_id` | `backend/app/services/auth.py:43` | No callers. | high | delete |
| `komoot_client.py :: _ensure_basic_token` | `backend/app/integrations/komoot_client.py:77` | No callers. | med | delete |
| `komoot_client.py :: _session_login` | `komoot_client.py:95` | No callers. | med | delete |
| `komoot.py :: _extract_polyline_from_komoot_tour` | `backend/app/services/komoot.py:33` | No callers. | med | delete |
| `cycling/vo2max.py :: _acsm_vo2max_legacy` | `backend/app/services/cycling/vo2max.py:43` | Legacy formula, no callers. | high | delete |
| **Test-only (production-dead, test-covered)** | | | | |
| `route_matching.py :: passes_spine_test` / `passes_detour_test` | `backend/app/services/route_matching.py:366,376` | Only referenced by `tests/test_route_detour.py`. `score_route_pair` inlines the gate (`ScoreBreakdown.detour_ok`), so the public helpers are never called in prod. CODEMAP lists them as key functions. | high | wire the scorer through them, or delete + retarget tests |
| `cycling/tss.py :: infer_tss_source` | `backend/app/services/cycling/tss.py:219` | Called only from `tests/integration/test_tss_source.py`; mirrors migration 062 SQL. | med | keep (backfill reference) or mark test-only |
| `exercise_db.py :: looks_like_combined_weight` | `backend/app/services/exercise_db.py:467` | Called only from `tests/test_lifting.py`. | med | keep / mark test-only |
| `undo.py :: list_undoable` | `backend/app/services/undo.py:196` | Called only from `tests/integration/test_undo_log.py`. Consistent with "UndoLog has no HTTP surface" (see C-2). | high | keep (planned UI) |
| `weather_analysis.py :: aanalyze_weather_on_modal` | `backend/app/integrations/weather_analysis.py:666` | Async variant; the scheduler uses the sync `analyze_weather_on_modal` (`tasks/scheduler.py:2026,2189`). The docstring (`:674`) claims the scheduler calls *this* — it does not. Only `tests/test_weather_modal_async.py:50` calls it. | high | wire the task through it, or delete |
| `route_road_graph.py :: _dest_path` | `backend/app/integrations/route_road_graph.py:41` | Only `tests/test_route_road_graph.py` imports it. | med | keep (test) / un-export |
| `bar_detection.py :: _interpolate_gaps`, `track_plate_from_seed` | `bar_detection.py:252,681` | Only `tests/test_bar_detection.py`. | med | keep (test) |
| `person_tracking.py :: track_series` | `backend/app/integrations/person_tracking.py:184` | Only `tests/test_person_tracking.py`. | med | keep (test) |

## C. Half-wired features

| Item | Evidence (path:line) | Why | Conf. | Action |
|------|----------------------|-----|-------|--------|
| **C-1 Orphan-route quarantine has no producer** | producer `services/route_quarantine.py:258`; consumers `api/routes.py:856,879,901,928,945`; UI `components/routes/OrphanReviewSection.tsx` | The `/orphans` review endpoints and the quarantine review UI are fully built, but nothing ever calls `quarantine_orphaned_routes` (no beat entry, no CLI, no API). No route can ever become quarantined, so the queue is permanently empty and the feature is inert. | high | schedule it (a weekly task / CLI subcommand) — or the whole orphan-review surface is decorative |
| **C-2 `UndoLog` has no HTTP surface and no registered production kind** | `backend/app/services/undo.py:36`; `backend/app/api/` has no `undo` router | Mechanism + `prune_expired_undo_logs` task exist; `list_undoable` is test-only. Documented in AGENTS ("no HTTP surface") but still an unshipped feature. | high | wire (or mark explicitly deferred) |
| **C-3 `aanalyze_weather_on_modal` is unwired** | `services/... integrations/weather_analysis.py:666` vs `tasks/scheduler.py:2026,2189` | Docstring says the scheduler offloads to this async wrapper to avoid blocking the event loop; the scheduler actually calls the sync entry directly. One of the two is wrong — either the async path is dead or the loop-blocking fix regressed. | high | reconcile |
| **C-4 Strength-progression client fns vs inline** | `lib/api/projections.ts:19` (`getTsbProjection`) | Client function exists but the page inlines the endpoint. Not user-visible; a "half-wired" client layer. | high | use the client fn |
| **C-5 Warmup-effectiveness analysis** | only `WarmupTemplate` CRUD; no adherence→working-set linkage | Prior audit C1; still open. | high | deferred (product) |
| **C-6 Cross-route climb geometry key** | `services/segments.py` clusters by gradient shape only; `geo_clusters.py` adds geometry but does not feed a cross-route PR | Prior audit C2b; still open. | high | deferred |
| **C-7 `/today` morning brief is an explicit POC** | `app/(app)/today/page.tsx` (banner "Experimental") | Product go/no-go outstanding. | high | keep pending decision |

## D. Stale docs / registries

| Item | Evidence (path:line) | What is stale | Conf. | Action |
|------|----------------------|---------------|-------|--------|
| Frontend CODEMAP `mode-shell/` section presented as live | `frontend/src/CODEMAP.md:97-102` | Describes `ModeRail` as replacing the desktop Sidebar; `app/(app)/layout.tsx:93-95` says it was removed. | high | update CODEMAP |
| Frontend CODEMAP lists `Reveal` as adopted | `frontend/src/CODEMAP.md:125` | "chart reveal" wrapper is unimported (A). | high | update/delete row |
| Frontend CODEMAP lists `IconButton` primitive | `frontend/src/CODEMAP.md:85` | Unused export (A). | high | update |
| Frontend CODEMAP: `isStaleTokenError` used by components | `frontend/src/CODEMAP.md:330` | No component calls it. | high | update |
| Frontend CODEMAP: `SegmentRow` "also exports the shared `CATEGORY_STYLES` ... used by both SegmentsCard and the /segments page" | `frontend/src/CODEMAP.md:206` | `CATEGORY_STYLES` is used only inside `SegmentRow.tsx:105`; neither `SegmentsCard` nor the page imports it. | med | update |
| Backend services CODEMAP lists the dead/test-only fns above | `backend/app/services/CODEMAP.md:16` (`passes_spine_test`/`passes_detour_test`), `:17` (`quarantine_orphaned_routes`), `:27` (`looks_like_combined_weight`), `:33` (`infer_tss_source`), `:36` (`list_undoable`), `:68` (`evaluate_all_smart_collections`/`validate_collection_rules`) | CODEMAP presents these as key functions while (B) shows they are never called from app code. | high | update CODEMAP |
| AGENTS.md "Training page overhaul ... **Nothing built yet**" | `AGENTS.md` (Active Planning) | The redesign is substantially built: `ModeSwitch` plan/review/peaks (`components/training/ModeSwitch.tsx`), `PlanSpine`, `ProgramMatrix` (S2 matrix, S1 suggest/apply), `WeekMasterBar`, `MissedDayPopover`, `CreatePlanPanel`, `PlanSwitcher`, `UnplannedStrip`, `useTrainingShell`, `trainingModes.ts` — all wired from `app/(app)/training/page.tsx:40-52,275,284,326,368,548` and `WeeklyView.tsx`. | med | update AGENTS.md / plan |
| Prior audit `plans/underdeveloped-features-2026-09-27.md` | rows A1–A5, B1–B5, C2a | Remain accurate as "closed" (see E); the *open* rows (C1, C2b) are still open. Audit itself is not stale. | high | keep |

## E. Verified NOT dead (do not re-chase)

| Item | Evidence | Note |
|------|----------|------|
| `StatsView` | `app/(app)/activities/page.tsx:33,1244` | Wired as the Stats view (prior audit A1 correct). |
| `Field`, `PageHeader`, `SectionLabel`, `Stat`, `ErrorState` | imported widely | Prior audit A2 correct; none flagged. |
| `AnimatedNumber`, `usePrefersReducedMotion` | `athlete/VerdictCard.tsx:21`; pages import the hook | Live. |
| `mode-shell` replacement | `components/Sidebar/useTodayPlanTarget.ts:17-18` | Inline `resolveTrainTarget` supersedes it. |
| S1 strength-progression endpoints `suggest`/`apply`/`materialise` | `lib/api/trainingPlans.ts:252,269,281` → `components/training/plan/ProgramMatrix.tsx:79,110,123` | Fully wired. |
| `swap`, `reschedule`, `substitute` day endpoints | `lib/api/trainingPlans.ts:200,213,226` → `lib/training/usePlanDayOps.ts:62,74,83` → `WeeklyView.tsx:310` | Wired. |
| `getSegments` (no route filter) / `getSegmentDetail` | `app/(app)/segments/page.tsx:152`; `components/routes/SegmentRow.tsx:272` | Prior audit C2a correct. |
| `WahooPushModal` | `WeeklyView.tsx:743`; `zoneFlow/ZoneFlowRouteRow.tsx:317` | Wired (prior audit non-issue correct). |
| `SimilarRoutesSection` | `components/routes/RouteDetailPanel.tsx:298` | Wired. |
| `ZoneFlow` | `app/(app)/today/page.tsx:388` | Wired. |
| Chat/registry coverage | all 42 `CHART_REGISTRY` keys in `backend/app/api/charts.py:41` appear in frontend | No stale chart entries. |
| Backend models | every class in `backend/app/models/` is referenced outside `models/` | No orphaned model classes. |
| All beat tasks scheduled | `backend/app/tasks/scheduler.py:123-365` | Every `@celery_app.task` except on-demand `process_lift_video` has a beat entry. |
| Feature flags | `config.py:101,109,116,126,137,179,196,208` | All read somewhere (`modal_client.py`, `scheduler.py`, `sync.py`); no always-off dead flag. |
| `lib/api/*` client modules | barrel `lib/api/index.ts` | Only `getTsbProjection`, `isStaleTokenError` are dead (A); the rest are imported. |
| Framework files | `page.tsx`, `layout.tsx`, `loading.tsx`, `route.ts`, `manifest.ts` | Convention-entered, not dead. |

## Uncertainty / not statically provable

- **Dynamic component loading**: `Replay3D`, `Route3D`, `Pose3D` are loaded via `next/dynamic` string-free imports — still resolved statically, so unaffected.
- **String-built API URLs**: heavy use of template literals (`/api/v1/.../${id}`) makes a *fully automated* "route never called" scan unreliable; the endpoint-level negatives in an early pass were all false. Only two endpoint groups were ever suspect (`strength-progression/*`, `.../swap`) and both were proven wired in (E).
- **`getattr`-style dispatch**: none found for the backend functions in (B); all were verified by whole-repo token search. `_proximity_score`/`_name_score` share names with similarly-named functions in other modules — the route_service copies are the dead ones.
- **AGENTS.md "Nothing built yet"** for the training redesign is asserted from code presence; if the redesign plan is scoped to a *further* rebuild, the doc may be describing that instead. Marked med confidence.
