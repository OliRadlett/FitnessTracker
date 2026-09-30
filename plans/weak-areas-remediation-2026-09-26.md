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
> **Headline**: of the 45 tracked rows, **23 are fixed** and **22 remain**. Track 1 is
> fully resolved, Track 2 is down to one item, and Track 6 has shipped in full. The
> remaining work is Track 2 ×1, Track 3 ×8, Track 4 ×9, Track 5 ×4.
>
> **Refreshing again?** Re-check the code, not this file. `git grep` for the item ID or
> bug ID first — fixes carry an ID in a comment.

## Remaining work (the only actionable part)

### Track 3 — silent correctness bugs (8 open)

| ID | Defect | Evidence | Fix |
|----|--------|----------|-----|
| SCI-02 | Re-linking the **same** `event_id` re-applies the taper ramp, compounding the reduction | `services/training_plan.py:513` sets `plan.event_id` and tapers with no repeated-event guard | Early-return when `plan.event_id == event_id` |
| SCI-07 | ACSM VO2max formula duplicated inline instead of shared | `services/cycling/vo2max.py:28` (`_acsm_vo2max`) vs `integrations/power_models.py:464-479` | Import the shared helper in `power_models.py` |
| RMI-07 | Weather features passed to Modal as `None` for missing humidity/pressure/wind-direction | `tasks/scheduler.py:1986-1997` | Source the real fields, or drop rows missing them before the call |
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
- [ ] `frontend/src/components/activities/Replay3D.tsx:646-647/953/955` — wind refs are written during render but no wind HUD exists. Render it from state, or delete the refs.
- [ ] `frontend/src/lib/lifting/useLiveSession.ts:364` — only HTTP 404 is treated as a terminal finish; any 4xx should be (extends BUG-098).
- [ ] Dead code: `services/route_service.py:175` `score_route_breakdown`; `integrations/wahoo_client.py:22` `WAHOO_FAMILY_BIKING`, `:191` `find_plan_by_external_id`, `:377` `delete_route`.
- [ ] Docs: `route_matching.py` + `recompute_route_similarity` are absent from AGENTS/CODEMAP, and `route_matching.py:36-41` weights (0.60/0.25/0.15) disagree with `plans/route-merging-overhaul.md:68/77` (0.45/0.40/0.15, gate 0.55, N=120).

### Track 5 — frontend reliability (4 open)

- [ ] Locale: `toLocale*()` called with no locale in `ReplayTheater.tsx:101/191`, `Replay3D.tsx:2886/2910`, `routes/duplicates/page.tsx:407`. Pass `getActiveLocale()`.
- [ ] Duplicated formatters still local to their callers: `formatStat` (`calendar/page.tsx:72`, `CalendarAgendaView.tsx:17`), `formatDuration` (`lifting/live/page.tsx:585`), `formatElevation` (`WorkoutPlanner.tsx:37`, `RoutePickerModal.tsx:24`), `formatDistance` (`RoutePickerModal.tsx:19`), `StatBadge` (`FuelPlanCard.tsx:15`, `RideAnalysisCard.tsx:20`, `LiftingAnalysisCard.tsx:19`). Move to `lib/utils.ts`.
- [ ] A11y / portal: `DashboardRefresh.tsx:82` is 28 px (below the 44 px target); `lifting/live/page.tsx:637` (`FinishSheet`) and `MobileRouteDetailSheet.tsx:81` are inline fixed divs — portal them through `Modal`/`createPortal` (pitfall #15).
- [ ] `lib/api/types/generated.ts` exists but is imported nowhere and has no CI drift guard. Either wire it as the type source of truth or delete it **with** a drift check. (The other dead-code names in the original row — `StatsView`, `ErrorState`, `Field`, `PageHeader`, `SectionLabel`, `Stat` — have since been **adopted**, see `plans/underdeveloped-features-2026-09-27.md` §A1/A2.)

### Track 2 — one item left

| # | Defect | Evidence | Fix |
|---|--------|----------|-----|
| S4 | The auth rate-limit bucket is keyed on the **proxy peer**, not the forwarded client IP, so behind Caddy every client shares one 20 req/min budget — a single abusive caller consumes it for everyone. `slowapi`'s `Limiter` is also instantiated but vestigial (SEC-03). | `main.py:112-129` keys on `get_remote_address(request)` (`:119`); `limiter` built at `main.py:24-25`, `app.state.limiter` set at `:75` | Key on the trusted client IP from `X-Forwarded-For` (only from the known proxy). Then either register `SlowAPIMiddleware` or delete the vestigial `Limiter` |

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

**Track 2 — security:** S1 (token logging), S2 (`r2_key` prefix validation, `videos.py:111`),
S3 (ownership checks on linked session/PR, `videos.py:113-130`), S5 (OAuth `state` on the
app-auth callback — **#213**), S6 (`ContentLength` cap), S7 (Strava verify token — **#213**).

**Track 3:** RMI-03 (only mark "personalized" on a real fit) · RMI-04 (`elevations`/`elevation`,
`route_intelligence.py`) · RMI-06 (dead `predicted_effort` gone) · SCI-01 (suppress
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
`lib/training/week.ts` · tests for `week.ts` and `routeUtils.ts`.

**Track 6 — Jev decision layer: SHIPPED (Phases 0–4).** Config flags (`typesafe_api_key`,
`jev_enabled`, `jev_model`, `jev_timeout_s`), `integrations/jev_client.py`,
`services/jev_tagging.py` with `tag_activity`, migration `081` (lifting AI tags), route
arbitration (`route_service._arbitrate_route_pair`), and merge arbitration
(`merge_service._arbitrate_duplicate`). The original row framed this as unbuilt; it is not.
`plans/jev-implementation-plan-2026-09-27.md` still carries a stale "no code yet" header.

---

## Suggested sequencing (revised 2026-09-30)

Tracks 4 and 5 are the cheapest remaining wins and are already itemised above; Track 3's
eight items are small, independent fixes. Suggested order:

1. `fix/frontend-reliability` — Track 5's four items (all frontend, `tsc` + `vitest` only).
2. `fix/inflight-correctness-a` — the four backend Track 4 items (route_matching, scheduler
   pre-filter, wahoo_push idempotency, dead code) + the CODEMAP/gate-reconciliation docs row.
3. `fix/silent-correctness-2` — Track 3's eight items.
4. `fix/inflight-correctness-b` — the four frontend Track 4 items (3D `raceMarkers`,
   `raceRides` centroid, wind HUD, `useLiveSession` 4xx). **Coordinate**: this area is
   actively edited by the relive/3D sessions.
5. `security/rate-limit-key` — S4.

Each: isolated worktree → `pytest` (backend) / `tsc`+`vitest`+`build` (frontend) →
PR into `main` → release via `main → prod` (AGENTS Git & Deployment Strategy).

---

## Outstanding questions

- **Table count drift**: `AGENTS.md` states 45 tables; `Base.metadata` reports **46** at
  refresh time. Confirm which is right and reconcile — not fixed here because `AGENTS.md`
  is under concurrent edit by other sessions (pitfalls #22–#27 were appended today).
- **Track 4's 3D/replay items** may already be in flight in another worktree
  (`feature/relive-3d-quality`, `feature/relive-broadcast-v2`). Check before starting.

## Deferred / separately tracked (unchanged)

- Garmin / TrainingPeaks / Zwift / Apple Health integrations (need OAuth app registration).
- Cross-route climb clustering + exact distance-aligned segments (`§3.13`; see also
  `plans/underdeveloped-features-2026-09-27.md` C2b).
- `openapi-typescript` codegen as the type source of truth (Track 5 #7 only guards/removes
  the stale artifact).
- Monitoring stack live verification (B-33 built); make Playwright E2E blocking in CI.
- BUG-045 secret rotation (manual ops).
