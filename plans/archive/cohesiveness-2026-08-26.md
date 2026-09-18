# Frontend Cohesiveness — Cross-Linking, Deep-Links, Consistency, Cleanup

> **Date**: 2026-08-26 · **Scope**: Frontend only (`frontend/src`) — no backend/model/migration changes
> **Goal**: Ensure every page complements the others and works well together — navigation between related features, deep-links to specific records, consistent patterns (query keys, tokens, loading/empty states), and cleanup of orphans + stale docs.

## Status (2026-08-26)

- **Phases 1–3: COMPLETE.** Cross-linking, deep-linking URL params, query-key fixes, and the design-token sweep are all implemented and verified (`tsc` clean, 30/30 vitest pass).
- **Phase 4 (cleanup): DEFERRED** — orphaned components (`SuggestedCycleCard`, `TabGroup`, `SkeletonCard`/`SkeletonChart`) and ~70 dead API-client functions remain. CODEMAP already documents `SuggestedCycleCard` as orphaned. Recommend a follow-up task, done per-file with the Edit tool.
- **Incident note**: The Phase 3 token sweep was originally scripted via PowerShell; a nested-array flattening bug silently ran a global `t`→`e` replace across 55 files. The sync session (sync-hardening) restored the tree; the sweep was then redone safely with per-file Edit-tool `replaceAll`. AGENTS.md gained rules 10–14 to prevent recurrence (no bulk scripted rewrites, file ownership checks, rollback safety, no shell in-place edits, verify before destructive writes).

## Findings (audit)

### Navigation cohesion gaps
- **Dashboard** references events, CTL/ATL/TSB & FTP, Whoop prompts, weather location — none link out to the owning pages
- **Training** has zero outbound links; `WorkoutPlanner` says "Set your FTP in the Cycling page" but FTP editing moved to Settings (stale)
- **Activities** "View route →" goes to the routes *list*, not the specific route; linked lifting session isn't clickable
- **Goals** 1RM/lifting goals get no link (only cycling goals do)
- **Live Lift** "Back to Lifting" only on the interrupted-finish screen
- **Routes** ride-history rows, **Calendar** day details, **Lifting** linked-activity card, and the whole **Wiki** have no links

### Consistency
- Query keys: `['prs']` vs `['personal-records']`; `['chart','periodization']` vs `['chart-*']`; settings invalidates `['weather']` (no-op vs `['weather-current']`/`['weather-forecast']`)
- Raw "Loading..." text + hand-rolled pulse loaders where `Skeleton*` primitives exist; hand-rolled empty states vs shared `EmptyState`
- Hardcoded `text-green-400`/`text-red-400`/`text-slate-300` where tokens `positive`/`warning`/`muted` exist

### Cleanup
- Orphans: `SuggestedCycleCard` + `getSuggestedCycle`, `TabGroup`, `SkeletonCard`, `SkeletonChart`
- ~70 dead API-client functions in `lib/api/*` (pages use inline `authFetch`); CODEMAP names don't match actual exports

## Phase 1 — Cross-Linking

| # | From | Change | Location |
|---|------|--------|----------|
| 1 | Dashboard | Event cards → `<Link href="/training">` (events managed there) | `TodayTab.tsx` events block (~:135-167), `WeeklyTab.tsx` (~:133-167) |
| 2 | Dashboard | CTL/ATL/TSB metric cards → `/cycling` | `TodayTab.tsx:291-341` |
| 3 | Dashboard | "Set your home location in Settings" → `/settings` | `WeatherWidget.tsx:33` |
| 4 | Dashboard | "Connect Whoop" prompt → `/settings` | `WeeklyTab.tsx:~293` |
| 5 | Training | Fix stale FTP note + link → `/settings` | `WorkoutPlanner.tsx:322` |
| 6 | Training | Add "View all routes →" to `/routes` | `WeeklyView.tsx:~892` |
| 7 | Cycling | "Log weight in settings…" → `/settings` | `PowerCurveSection.tsx:200` |
| 8 | Lifting | Empty-state CTA → `/lifting/live` | `lifting/page.tsx:~526` |
| 9 | Live Lift | "← Back to Lifting" in pre-start + active headers | `lifting/live/page.tsx` |
| 10 | Goals | Lifting link for 1RM/lifting goals (new `isLiftingMetric()`) | `ui/GoalCard.tsx:34-39` |
| 11 | Wiki | Convert "see page X" text refs into hyperlinks | `wiki/page.tsx` |
| 12 | Settings | Already links `/routes` ✓ | — |

## Phase 2 — Deep-Linking URL Params

Add `?activity=` / `?route=` / `?session=` params so cross-links select a specific record on load.

- **`activities/page.tsx`** — init `selectedActivityId` from `useSearchParams()`; sync param on select (`router.replace`, loop-guarded)
- **`routes/page.tsx`** — same for `selectedRouteId` via `?route=`
- **`lifting/page.tsx`** — same for `selectedSessionId` via `?session=`

Wire deep links:
- Activities → specific route `/routes?route=<id>`; linked lifting → `/lifting?session=<id>` (`ActivityCard.tsx:106,:150-164`)
- Routes ride-history rows → `/activities?activity=<id>` (`RouteHistorySection`)
- Calendar `DayDetailPanel` activity rows → `/activities?activity=<id>`, lifting → `/lifting?session=<id>`
- Dashboard recent activity/session rows (`helpers.tsx`) → same deep links
- Lifting `LinkedActivityCard` → `/activities?activity=<id>`

## Phase 3 — Consistency Sweep

1. **Query keys**: `['prs']`→`['personal-records']` (live page:36); `['chart','periodization']`→`['chart-periodization']` (training:113); settings `['weather']` invalidation → invalidate both `['weather-current']` + `['weather-forecast']` (settings:151 — real no-op bug); align goals keys naming
2. **Color tokens**: `text-green-400`→`text-positive`, `text-red-400`→`text-warning`, `text-slate-300/400`→`text-muted` across ~25 sites (TodayTab, WeeklyTab, FtpSection, SummaryStatsBar, lifting, cycling, PRCelebration, routes, ExerciseManager, WorkoutPlanner, settings, training, layout, analysisRenderer, Chart, CompareActivitiesModal). Leave yellow/amber/purple + SVG hex literals (no tokens exist)
3. **Loading states**: replace raw "Loading..." (activities:856, training:223, ExerciseManager:139, live:115) + hand-rolled pulse loaders (5 AI cards, cycling, calendar, agenda, goals, GoalDetailModal, DayDetailPanel, `loading.tsx`) with `Skeleton*`
4. **Empty states**: convert goals page + training "No plans yet" to shared `EmptyState`; leave PlanBuilder local one (different API)

## Phase 4 — Cleanup

1. **Orphans**: delete `SuggestedCycleCard.tsx` + `getSuggestedCycle`; wire accessible `TabGroup` into goals page tab bar; use/delete `SkeletonCard`/`SkeletonChart`
2. **Dead API clients**: grep-verify unused → delete confirmed-dead functions + unused types; reconcile `CODEMAP.md` with actual exports
3. **Docs**: update `frontend/src/CODEMAP.md` (new links, URL params, removals)

## Verification

- After each phase: `npx tsc --noEmit` + `npm run lint` in `frontend/`
- `npm run test` (vitest) at end
- Manual: dashboard→cycling/settings/training links; live-lift back link; `/activities?activity=<id>`, `/routes?route=<id>` deep links
- Backend untouched — no migration, no restart (frontend hot-reloads)

## Risks

- Phase 2 URL-sync render loops → guard with `useEffect` that writes only when selection ≠ URL param
- Phase 4 deletion risk → grep-verified, `tsc` + `lint` as the gate, do last
- Commit discipline: feature branch, stage only session-touched files