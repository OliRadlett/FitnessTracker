# Weak-Area Remediation Plan (2026-09-26)

> **Status**: **Refreshed 2026-09-30** — this is now a *status record + remaining-work
> list*, not a forward plan. The original 2026-09-26 survey is superseded by this
> rewrite (its text remains in git history, and the rationale for every *still-open*
> item is preserved below with current evidence).
>
> **Refresh method**: every item below was re-verified against code on `origin/main`
> (`82a6416`, after PR #213 merged), not against the checkboxes in other `plans/*.md` —
> those are frequently stale. Migration head at refresh time: **`091`**, single head, no
> duplicate `revision` values.
>
> **Headline**: of the 45 tracked rows, **28 are fixed** and **17 remain**. Tracks 1, 2
> and 6 are fully resolved. The remaining work is Track 3 ×7, Track 4 ×9, Track 5 ×1 (the
> deferred codegen decision).
> (S4 closed and Track 5's items 1–3 shipped on 2026-10-01; the same-day re-verification
> found RMI-07 already fixed. Other row statuses are as of 2026-09-30 unless marked.)
>
> **Refreshing again?** Re-check the code, not this file. `git grep` for the item ID or
> bug ID first — fixes carry an ID in a comment.

## Remaining work (the only actionable part)

### Track 3 — silent correctness bugs (7 open)

| ID | Defect | Evidence | Fix |
|----|--------|----------|-----|
| SCI-02 | Re-linking the **same** `event_id` re-applies the taper ramp, compounding the reduction | `services/training_plan.py:513` sets `plan.event_id` and tapers with no repeated-event guard | Early-return when `plan.event_id == event_id` |
| SCI-07 | FRIEND VO2max formula duplicated inline instead of shared | `services/cycling/vo2max.py:28` (`_friend_vo2max`) vs `integrations/power_models.py:464-479` | Import the shared helper in `power_models.py` |
| RMI-08 | Cross-domain insights are appended, never upserted → duplicates accumulate per run | `tasks/scheduler.py:2660-2667` | Unique constraint on `(user, insight_type)` + `on_conflict_do_update` |
| RMI-12 | `w_prime` bound is too loose (1–100 kJ) to be physiologically meaningful | `integrations/power_models.py:328` | Tighten to 5–40 kJ |
| SYNC-11 | Wahoo route sync reports `merged_count` without ever incrementing it | `services/wahoo.py:403/517/526` | Increment when `create_or_merge_route` merges |
| SYNC-12 | Whoop weigh-ins dated with server/UTC `date.today()` | `services/whoop.py:1295` | Convert to the user-local date |
| SYNC-06/07/08 | Sync N+1s and a delete-in-loop | `services/strava/linking.py:271-274` (per-activity N+1); `services/strava/webhook_queue.py:178` (delete in loop). `sync.py:722` already bulk-prefetches — this row is the leftovers | Bulk-fetch linking candidates; one bulk delete in the queue |

### Track 4 — in-flight work correctness (9 open, none touched)

All nine original items remain open; file references re-confirmed at refresh time.

- [ ] `services/route_matching.py:260` — size the longitude cell by `cos(lat)` (currently `tol_m / 110_000` for both axes), so high-latitude matches are not missed; add a ~55°N test.
- [ ] `tasks/scheduler.py:1563-1565` — pre-filter route pairs (bounding box / distance) before the O(n²) Fréchet sent to Modal.
- [ ] `services/wahoo_push.py:174/211/249` — push re-creates on retry; make idempotent across partial failure. `integrations/wahoo_client.py:211/380` returns raw `resp.json()` without unwrapping nested `{plan:{id:…}}`, so IDs are lost.
- [ ] `frontend/src/components/activities/Replay3D.tsx:1139` vs `:1523` — short rides are skipped when building markers but indexed by position at render, so `raceMarkers` misaligns.
- [ ] `frontend/src/lib/raceRides.ts:128` — `buildReplay` is called with no shared `frame`, so `replay.ts:50-51` defaults each ride to its own centroid; the "distance-aligned" comment is wrong.
- [ ] `frontend/src/components/activities/Replay3D.tsx:646-647/953/955` — **re-verified 2026-10-01 after #218**: the refs now live inside the scene-setup effect and feed the rain-drift vector, and `windDirRef` is read once — but `windSpeedRef` is **write-only** and the comment still claims a "wind HUD" that does not exist. Fix: drop the dead ref and the comment, or actually render the HUD from state.
- [ ] `frontend/src/lib/lifting/useLiveSession.ts:364` — only HTTP 404 is treated as a terminal finish; any 4xx should be (extends BUG-098).
- [ ] Dead code: `services/route_service.py:175` `score_route_breakdown`; `integrations/wahoo_client.py:22` `WAHOO_FAMILY_BIKING`, `:191` `find_plan_by_external_id`, `:377` `delete_route`.
- [ ] Docs: **partially fixed** — `services/CODEMAP.md:16` now documents `route_matching.py`, but it is still absent from AGENTS.md, `recompute_route_similarity` remains undocumented, and `route_matching.py:36-41` weights (0.60/0.25/0.15, gate 0.45, N=200) still disagree with `plans/route-merging-overhaul.md:68/77` (0.45/0.40/0.15, gate 0.55, N=120).

### Track 5 — frontend reliability (1 open)

- [x] Locale: `toLocale*()` with no locale now passes `getActiveLocale()` — `ReplayTheater.tsx:101/191`, `Replay3D.tsx:2781/2805`, `routes/duplicates/page.tsx:407`. **Fixed 2026-10-01** (`fix/frontend-locale-formatters-a11y`).
- [x] Shared display helpers: `formatStat` (calendar ×2) and `formatElevation` (×2) moved to `lib/utils.ts`; `StatBadge` (×3) moved to `components/ui/StatBadge.tsx`, with tests in `__tests__/sharedFormat.test.tsx`. **Fixed 2026-10-01.** ⚠️ Two of the original row's "duplicates" were **not** duplicates and were deliberately left local: `RoutePickerModal.formatDistance` (renders `450 m` under 1 km) and `lifting/live`'s stopwatch `formatDuration` (`5m 30s`) — both differ from `lib/utils.ts`, so merging would have changed output.
- [x] A11y / portal: `DashboardRefresh.tsx` refresh button is now a 44 px target (`w-11 h-11`); `FinishSheet` (`lifting/live/page.tsx`) and `MobileRouteDetailSheet.tsx` now `createPortal` into `document.body` behind an SSR `mounted` gate (pitfall #15). **Fixed 2026-10-01.**
- [ ] `lib/api/types/generated.ts` — **deferred (needs a decision)**. It is imported nowhere, but it is *actively regenerated* (last touched 2026-09-28 by #161) and `lib/api/CODEMAP.md:80-88` documents it as the intended type source of truth, with **no CI drift guard**. Deleting it (this row's alternative) would contradict that stated direction, so it needs an explicit call: adopt it and add a drift check, or delete it. (The row's other dead-code names — `StatsView`, `ErrorState`, `Field`, `PageHeader`, `SectionLabel`, `Stat` — have since been **adopted**, see `plans/underdeveloped-features-2026-09-27.md` §A1/A2.)

---

## Fixed (code-verified 2026-09-30)

Grouped by track. Each was confirmed absent from the current code, usually because the
fix carries the item/bug ID in a comment.

**Track 1 — unblock branch & migrations: RESOLVED.** Single Alembic head `091`; no two
files share a `revision`. Both historical collisions were fixed forward: the `078`
duplicate, and the `083` route-merge/camera clash (camera renumbered to `084`). Two
follow-on production incidents were fixed by `087` (which used `sa.JSONB()` — see AGENTS
pitfall #22) and `090` (model/migration drift on `lift_video_analyses`, pitfall #24).
Local branch hygiene (stale checkout, superseded T3 commits, repo-root artifacts) is no
longer relevant — the work merged via PRs.

**Track 2 — security: FULLY RESOLVED.** S1 (token logging), S2 (`r2_key` prefix validation,
`videos.py:111`), S3 (ownership checks on linked session/PR, `videos.py:113-130`), S4 (auth
rate limit keyed on the real client IP via `services/client_ip.py`; the misleading, unenforced
slowapi `Limiter` deleted), S5 (OAuth `state` on the app-auth callback — **#213**), S6
(`ContentLength` cap), S7 (Strava verify token — **#213**).

**Track 3:** RMI-03 (only mark "personalized" on a real fit) · RMI-04 (`elevations`/`elevation`,
`route_intelligence.py`) · RMI-06 (dead `predicted_effort` gone) · RMI-07 (weather features now
sourced from the real humidity/pressure/wind-direction columns — `tasks/scheduler.py:1990-1998`,
commit `e9bfc87f`; re-verified 2026-10-01) · SCI-01 (suppress
`intensity_raise` under active health alerts) · SCI-03 (today's TSS not re-applied in the TSB
projection, `projections.py:732-740`) · SCI-05 (`_focus_groups` set intersection,
`conformity.py:96-111`) · SCI-06 (`_activity_sport_matches_day`, `conformity.py:669`) · Robust
(narrowed `except`, malformed-GPX `400`, `Content-Disposition` sanitised) · AI-02/07/12 (AI
errors surfaced, provider errors no longer leaked, `enabled: !!token`) · Docs (algorithms
decoupling wording, BUG-071 proximity note) · **DATA-11** (`GoalCheckIn` exported — #213,
now guarded by `tests/test_model_registry.py`) · DATA-03/04/05/09 (`UniqueConstraint` +
`index=True` present in `activity.py`, `training_plan.py`, `health_alert.py`, `lifting.py`;
FK indexes in `rpe_calibration.py`, `lift_video_analysis.py`) · DATA-02/06/07/08 (N+1s
removed — `selectinload` on plan days, segment efforts, warmup steps, lifting sets;
`activity_context` bulk-loads via `.in_(ids)`. Per-activity context compute in a loop is
inherent to its cost model, not a relation N+1).

**Track 5:** `enabled: !!token` on the missing JWT queries · mutation errors surfaced
(`onError` + inline UI) and calendar fetch `isError` · duplicated week math routed through
`lib/training/week.ts` · tests for `week.ts` and `routeUtils.ts` · **2026-10-01**: locale-aware
`toLocale*()` at the replay/duplicate call sites · shared `formatStat`/`formatElevation`
(`lib/utils.ts`) and `StatBadge` (`components/ui/StatBadge.tsx`) · 44 px dashboard refresh
target · `FinishSheet` + `MobileRouteDetailSheet` portalled to `document.body`.

**Track 6 — Jev decision layer: SHIPPED (Phases 0–4).** Config flags (`typesafe_api_key`,
`jev_enabled`, `jev_model`, `jev_timeout_s`), `integrations/jev_client.py`,
`services/jev_tagging.py` with `tag_activity`, migration `081` (lifting AI tags), route
arbitration (`route_service._arbitrate_route_pair`), and merge arbitration
(`merge_service._arbitrate_duplicate`). The original row framed this as unbuilt; it is not.
`plans/jev-implementation-plan-2026-09-27.md` still carries a stale "no code yet" header.

---

## Suggested sequencing (revised 2026-10-01)

Track 5's actionable items shipped in `fix/frontend-locale-formatters-a11y` (the codegen
artifact is deferred pending a decision). Remaining work, cheapest first:

1. `fix/inflight-correctness-a` — the four backend Track 4 items (route_matching, scheduler
   pre-filter, wahoo_push idempotency, dead code) + the CODEMAP/gate-reconciliation docs row.
2. `fix/silent-correctness-2` — Track 3's seven items.
3. `fix/inflight-correctness-b` — the four frontend Track 4 items (3D `raceMarkers`,
   `raceRides` centroid, wind HUD, `useLiveSession` 4xx). Note #218 (relive 3D rebuild) has
   merged; the three replay rows were re-verified **still open** against it.

Each: isolated worktree → `pytest` (backend) / `tsc`+`vitest`+`build` (frontend) →
PR into `main` → release via `main → prod` (AGENTS Git & Deployment Strategy).

---

## Outstanding questions

- **Table count drift**: `AGENTS.md` states 45 tables; `Base.metadata` reports **46** at
  refresh time. Confirm which is right and reconcile — not fixed here because `AGENTS.md`
  is under concurrent edit by other sessions (pitfalls #22–#27 were appended today).
- **Track 4's 3D/replay items**: #218 (relive 3D quality rebuild) has now merged, and the
  three replay rows were re-verified **still open** against it on 2026-10-01 — so no need to
  wait, but expect conflicts in `Replay3D.tsx`.
- **`generated.ts`**: adopt-with-drift-check vs delete (see Track 5) — needs a decision.

## Deferred / separately tracked (unchanged)

- Garmin / TrainingPeaks / Zwift / Apple Health integrations (need OAuth app registration).
- Cross-route climb clustering + exact distance-aligned segments (`§3.13`; see also
  `plans/underdeveloped-features-2026-09-27.md` C2b).
- `openapi-typescript` codegen as the type source of truth (Track 5 #7 only guards/removes
  the stale artifact).
- Monitoring stack live verification (B-33 built); make Playwright E2E blocking in CI.
- BUG-045 secret rotation (manual ops).
