# Lifting page overhaul — production plan

> **Source artifact:** `prototype/lifting/` — eight-state contact sheet, gate result in
> `prototype/lifting/GATE.md`. This plan ports the **decisions**, not the lab code.
> **Status:** P1 (Overview) and the Big-3 backend fix are implemented on
> `feature/lifting-overhaul`; P2–P7 remain. This plan is the source of truth for the port.
> **Owner:** Oli + agent. **Branch:** `feature/lifting-overhaul` from `main` (not `prod`).

---

## 1. What ships

The `/lifting` page becomes four tabs with a single visual system:

```
Overview   today's plan + week numbers + recent sessions + volume trend + plan progress
Sessions   350px month-grouped rail + always-populated detail + set ladder + session read
Analytics  weekly volume, Big-3 PRs, combined load; four analyses behind "More analysis"
PRs        Big-3 cards + standards progress + one PR history table
```

`Templates` leaves the tab bar and opens as a modal from **Log session**. The Live Lift remains
the way to log a session, reachable from **Start live** in the header, not a body card.

### Non-goals

- No new analytics features, endpoints, DB tables or migrations.
- No changes to auth, sync, Whoop, Jev or the live-session engine.
- No PDF/share/meet-prep/competition features.
- No light theme.
- No prototype imports, fixture data, or lab shell in `frontend/`.

### Invariants

1. Every existing write path still works: create/edit/delete session, add/edit/delete set,
   repeat session, link Strava, AI analysis, manual PR, warm-up templates.
2. Deep links survive: `?session=`, `?pr=`, `?tab=` (legacy `?tab=templates` redirects to a modal
   or sessions).
3. The page remains client-rendered with React Query and `useAuthFetch`; no server components.
4. Mobile keeps the app's fixed bottom nav and `tabbar-clear` spacing.
5. Production code is ported by decision, not copied from `prototype/`.

---

## 2. Architecture

### Route and state

Keep one route: `frontend/src/app/(app)/lifting/page.tsx`.

| Param | Behaviour |
|---|---|
| `?tab=overview` | default; Overview |
| `?tab=sessions` | rail + detail (desktop); rail (mobile) |
| `?tab=sessions&session=<id>` | select session; on mobile opens pushed detail |
| `?tab=analytics` | Analytics |
| `?tab=prs` | PRs |
| `?pr=<id>` | PRs tab, scroll/highlight the record (existing behaviour) |

- Tab changes use `router.replace(..., { scroll: false })` so the page does not jump.
- Selecting a session uses `router.push` on mobile (back button returns to list) and
  `router.replace` on desktop (no history noise). Decide viewport with `useMediaQuery('(min-width: 1024px)')`
  or CSS + one `matchMedia` read.
- Mobile back calls `router.back()` when there is history, else pushes the sessions tab.

### File map

```
frontend/src/app/(app)/lifting/page.tsx          thin shell: queries, tab switch, modals
frontend/src/components/lifting/
  LiftingTabs.tsx                                tablist with roving tabindex
  OverviewTab.tsx                                today / week / recent / trend / plan
  TodayLiftCard.tsx
  WeekSummaryCard.tsx
  RecentSessionsCard.tsx
  VolumeTrendCard.tsx
  PlanProgressCard.tsx
  SessionRail.tsx                                search, focus chips, month groups, pagination
  SessionRow.tsx                                 compact row (55/64px)
  SessionDetailPanel.tsx                         header, summary, ladder, read, split
  SetLadder.tsx                                  grouped sets; warm-ups; delta-to-last
  SessionReadCard.tsx                            one sentence + chips
  AnalyticsTab.tsx                               three heroes + More analysis
  PrTab.tsx                                      Big-3 cards, standards, history
  PrCard.tsx
  TemplatesModal.tsx                             wraps existing WarmupTemplateManager
  LogSessionModal.tsx                            wraps NewSessionForm / ManualPRForm / Live entry
frontend/src/components/charts/
  HeroBarChart.tsx / HeroLineChart.tsx / StackedLoadChart.tsx
frontend/src/lib/lifting/
  sessionSelectors.ts                            week stats, volume delta, top set, set deltas
  strengthStandards.ts                           re-export/lift from lib/lifting/standards.ts
  useLiftingOverview.ts                          overview queries (recent 5, week, PRs, trend, plan)
```

Existing components to reuse rather than rewrite:

| Component | Use |
|---|---|
| `QuickAddSetBar` | sticky add-set in detail (unchanged) |
| `ExerciseGroup` | raw edit table under the ladder, collapsed by default |
| `LiftingAnalysisCard` | keep below the read card, collapsed |
| `SessionAiAnalysisCard` | collapsed under analysis |
| `RepeatSessionButton`, `LinkActivityModal`, `ManualPRForm` | unchanged, mounted from new headers/modals |
| `WarmupTemplateManager` | inside `TemplatesModal` |
| `LiveWorkout` | route `/lifting/live` unchanged |
| `VideoGalleryModal`, `LiftVideoForm` | unchanged |
| `AutoregulationCard` | inside `LogSessionModal` / Overview "Suggested" disclosure |

Components to retire after parity: `SessionBrowser`, `SessionCardMini`, `SetsVisualizer`,
`BestByRepRangeStrip`, `DotsProgressionCard` (if PRs no longer shows it), `SessionFocusChips`
(rail replaces it), and any duplicate volume/1RM chart builders in the page.

### Data flow

```
page.tsx
  useLiftingSessions({ limit, offset, filters })     -> rail (X-Total-Count)
  useLiftingSession(selectedId)                      -> detail (+ analysis)
  useLiftingPrs()                                    -> PRs, standards, recent PR badges
  useCyclingProfile()                                -> bodyweight
  useChart('weekly_volume') etc.                     -> Analytics/Overview
  usePlanWeekForOverview()                           -> today's plan day / plan progress
```

- **Overview queries must be light.** Recent sessions `limit=5`; week stats from a `from/to`
  query (or the same 5 rows plus a count endpoint if available); trend from one chart; plan week
  from the active plan. Do not fetch all 33 sessions with sets for the landing.
- **Today's plan selector is broader than `useTodaysStrengthDay`.** That hook only returns an
  uncompleted day with `planned_exercises.length > 0`; the real plan often has focus-only days and
  completed days. Add `usePlanWeekOverview()` in `lib/training/` that returns the current week and
  a `today` day regardless of completion/exercises, plus `nextStrengthDay`. Keep the existing hook
  for Live Lift's "load from plan" path.
- **Session detail** keeps the existing `GET /sessions/{id}` + `/analysis` pair; the analysis card
  remains the source of volume split and progression.
- All mutations keep their current React Query invalidations (`['lifting-sessions']`,
  `['lifting-session', id]`, `['lifting-prs']`, chart keys).

---

## 3. Data contracts

No new endpoints. The page consumes:

| Endpoint | Used by |
|---|---|
| `GET /api/v1/lifting/sessions?limit=20&offset=0` (`X-Total-Count`) | rail, recent |
| `GET /api/v1/lifting/sessions?from_date=&to_date=` | Overview week stats (small extension, §4) |
| `GET /api/v1/lifting/sessions/{id}` | detail |
| `GET /api/v1/lifting/sessions/{id}/analysis` | read card, set ladder percentages |
| `GET /api/v1/lifting/prs` | PRs, PR badges, standards |
| `GET /api/v1/charts/weekly_volume?weeks=16` | Overview trend, Analytics |
| `GET /api/v1/charts/big_3_total` | **fix first** (see §4) |
| `GET /api/v1/charts/combined_training_load?days=90` | Analytics |
| `GET /api/v1/charts/{rep_range_distribution,volume_intensity_periodization,rpe_drift,session_class_mix}` | More analysis |
| `GET /api/v1/cycling/profile` | bodyweight, Dots |
| `GET /api/v1/training-plans?status_filter=active` + `/week/{n}` | Overview, plan progress |

---

## 4. Backend changes

### 4a. Big-3 chart is not the Big-3

`backend/app/services/charts.py:2660` buckets **any** exercise containing “squat” into `Squat`.
Belt Squat 180 therefore beats Back Squat 145.2, and the chart reports 482.5 kg — while the PR table
and Dots card report 447.7 kg and Dots 291.3. This is a correctness bug, not a styling choice.

```python
# today
if "squat" in lowered:
    return "Squat"
```

Fix:

```python
CANONICAL = {
    "back squat": "Squat",
    "bench press": "Bench Press",
    "deadlift": "Deadlift",
}
# Exact names only. Belt/Box/Front/Hack squat are accessories and must not
# change the competition total.
bucket = CANONICAL.get(lowered)
```

- Add `backend/tests/test_big3_chart.py`: seed PRs for Back Squat 145.2, Belt Squat 180,
  Box Squat 168.8, Bench 112.5, Deadlift 190; expect total 447.7, not 482.5; remove Back Squat and
  expect a gap, not a belt-squat substitution.
- No migration. The chart is computed, not stored.
- Ship as its own PR/commit before the frontend depends on the corrected series; the frontend can
  land after it.

### 4b. Sessions range filter (small, additive)

`backend/app/api/lifting.py:68` only supports `session_date` (exact day). The Overview needs a week
without fetching all 33 sessions with sets. Add optional `from_date`/`to_date` (inclusive) to
`GET /api/v1/lifting/sessions`; keep `session_date` for compatibility. Service signature
`list_sessions(..., from_date=None, to_date=None)`; no new endpoint.

- Validate `from_date <= to_date`; return 422 on a malformed date.
- Test: week window returns only 15–18 Oct for the fixture; `session_date` still works.
- If this grows beyond a date filter, stop and use `limit=50` once instead; do not build a query DSL.

---

## 5. Phases

### P0 — branch and guardrails

- Branch `feature/lifting-overhaul` from `main` (worktree if another session owns the checkout).
- Confirm no production edits on `prod`; add `workflow_dispatch` only if a CI rerun is needed.
- Baseline `frontend/e2e/lifting.spec.ts` and `npm run typecheck` green before changing anything.
- Gate: clean baseline; screenshots of the current page for the PR description.

### P1 — shell + Overview (behind the existing route)

- Add `LiftingTabs`, `OverviewTab` and the five sub-cards.
- Add `useLiftingOverview` selectors; extend the plan hook.
- Replace the vertical “Today’s Strength Day / Live / Suggested / warnings” stack with:
  - Today card (plan + logged result + one primary).
  - Week card.
  - Recent 5 + volume trend + plan progress.
- Move Auto-Link, dismissals and Whoop unmatched to an overflow menu / single “Needs attention”
  row; the global sync banner stays in the app shell.
- Gate: Overview at 1440/390, no overflow, five-second read, existing deep links still route.

### P2 — Sessions

- Replace the 3-column card grid with the 350px rail + detail.
- Default selection: today’s session if logged, else latest.
- Build `SetLadder` from session sets + analysis; keep `ExerciseGroup` below as “Edit sets”.
- Keep `QuickAddSetBar`, `RepeatSessionButton`, link/unlink, delete confirm.
- Mobile: pushed detail state, back returns to rail and restores focus.
- Gate: create/edit/delete/add-set/repeat all still work; 390/1440 frames; no horizontal scroll.

### P3 — Analytics

- Three hero cards (SVG charts) + “More analysis” disclosure.
- One range control (10/16/26 weeks) that re-queries volume + combined; Big-3/PRs are all-time.
- Remove the 11-card wall; keep `RepRangeCard`/`RpeDriftCard`/`SessionMix`/`VolumeIntensity` content
  inside the disclosure (compact charts, one at a time).
- Gate: three heroes fit one viewport; no legend/axis collision; Big-3 total matches PRs.

### P4 — PRs

- Big-3 cards with standards progress; total/Dots/bodyweight strip; history table.
- `ManualPRForm` in a modal from “Add PR”; no per-card “Set goal” noise (one goal action in the
  strip).
- Keep `?pr=` scroll/highlight.
- Gate: 31 records render, Dots 291.3, standards match `standards.ts`.

### P5 — mobile, accessibility, performance

- Tabs: roving tabindex, Arrow/Home/End, `aria-controls`, panels with `role=tabpanel`.
- Detail open/close focus management; `aria-current` on the selected row.
- Charts: `role="img"` + aria-label stating the takeaway; a text summary under each hero.
- 44px targets, 12px floor, reduced-motion guard (no chart animation anyway).
- Lazy-load Analytics/PRs with `next/dynamic`; Overview queries limited; memoised selectors.
- Gate: axe or 10-point manual checklist; Lighthouse mobile ≥90 performance on the route (best
  effort); no layout shift from fonts (Inter already loaded by the app).

### P6 — cleanup and docs

- Delete `SessionBrowser`, `SessionCardMini`, `SetsVisualizer`, `SessionFocusChips`, and dead chart
  builders; remove imports.
- Update `frontend/src/CODEMAP.md`, `plans/lifting-redesign-plan.md` (superseded), `AGENTS.md`
  active planning, `docs/review-vs-act.md` if the gate wording changes.
- Remove `?tab=templates`; redirect to `?tab=sessions&templates=1` and open the modal.
- Update `frontend/e2e/lifting.spec.ts` and the prod-shots manifest tab names
  (`Overview/Sessions/Analytics/PRs`).

### P7 — production gate and rollout

- Run the eight-state gate on the production build at 1440/390; attach the sheet to the PR.
- Run `frontend` typecheck, lint, component tests, updated E2E, backend Big-3 test.
- Merge `main` → `prod` via the normal release; run `SHOT_FILTER=08-lifting` prod-shots and compare
  against the contract frames.
- Rollback: revert the release commit; no data migration to undo.

---

## 6. Tests

| Layer | Test |
|---|---|
| Backend | `test_big3_chart.py`: exact lifts only; belt/box/front excluded; gap when Back Squat missing |
| Selectors | week volume/delta, top set, set delta, standards, Dots |
| Components | tabs keyboard, set ladder warm-up/top/delta, session read copy |
| E2E | 8 fixed states at 1440/390; deep links; create/edit/delete/add-set/repeat; keyboard tabs; no overflow; 44px; console clean |
| Prod-shots | 08-lifting desktop/mobile + tab states; compare to contract |

Existing tests to update, not delete: `frontend/e2e/lifting.spec.ts` (tab labels and default tab),
`frontend/e2e/mutations.spec.ts` if it navigates lifting, and `routes.manifest.ts` tab list.

---

## 7. Migration / cleanup

- No DB migrations, no backfills.
- Keep `LiftingSet.order_index` handling; the ladder sorts by `(order_index, created_at, id)`.
- Keep `ai_tags`, `session_split/lift/class`, Whoop fields; the read card uses them.
- Remove the duplicate client-side `buildVolumeChart` and the second 1RM source.
- Keep the `?session=` deep link; old `?tab=templates` redirects.
- Do not port: fixture, lab `Shell`, static no-op handlers, mock "Repeat"/"Log session", lab type
  scale hacks (use the app's tokens), or the `PlanMini` hardcoded week.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Replacing the page loses a write path | P2 checklist exercises every mutation; keep existing forms in modals |
| Overview query count hurts first paint | limit=5 recent, one chart, one plan week; lazy Analytics |
| Big-3 fix changes a visible number (482→448) | Ship with a short note in the release; Dots already shows 291.3 |
| Mobile back behaviour with query state | `router.push` + `router.back()`; test direct load |
| 12px floor makes dense tables wrap | Keep desktop columns fixed; test 390/768/1440 |
| Templates loses discoverability | Modal entry from Log session + a menu item; test |

---

## 9. Open decisions (resolve in P0)

1. **Mobile detail route:** query state (`?session=&detail=1`, recommended for deep links) vs
   `/lifting/[id]`. The lab proves the pushed screen; the port should not invent a second route
   until needed.
2. **Chart renderer:** keep the lab's SVG heroes (recommended: no animation, exact domains) or
   Recharts for consistency with the rest of the app. The port must not ship both.
3. **Templates entry:** modal from Log session plus a “Templates” item in the overflow menu.
4. **Plan selector:** extend `useTodaysStrengthDay` or add a separate `usePlanWeekOverview`. Prefer
   separate; do not change Live Lift's behaviour.
5. **Big-3 PR scope:** backend fix in the same release or a predecessor PR. Prefer predecessor.

---

## 10. Definition of done

- The eight production frames pass the `GATE.md` criteria at 1440/390.
- Every existing lifting write path is exercised by E2E or a component test.
- Backend Big-3 test passes; the Analytics total equals the PR total.
- No console errors, no horizontal scroll, no target <44, no text <12 (axis ticks excepted).
- `CODEMAP`, `AGENTS.md`, the redesign plan and the prod-shots manifest are current.
- The old components are deleted, not left dormant.
- Release notes state the Big-3 correction (482.5 → 447.7) and the new tab IA.

---

## Port status — 2026-11-03 (feature/lifting-overhaul)

| Phase | State |
|---|---|
| P1 Overview + four-section shell + Templates modal | **Landed** (`c54b92f`) |
| P2 Session rail, default detail, set ladder, summary strip | **Landed** (`15fe9ca`) |
| P3 Three Analytics heroes + closed More-analysis drawer | **Landed** (`32de7c4`) |
| P4 PR cards/standards/history table | **Landed** (`f652653`) |
| P5 Mobile check, 44px empty-state fix, tab keyboard test | **Landed** (`bfd4ed3`) |
| Big-3 backend correction | **Landed** (`c00408e`) |
| P6 cleanup | **Landed** (`4d7dfb7`) — legacy PR block and `SessionBrowser`/`SessionCardMini`/`SessionFocusChips`/`SetsVisualizer`/`TodayStrengthDayCard` deleted; unused PR/volume/video queries pruned; manual PR modal restored |
| P7 production gate / deploy | **Gate captured, no deploy** — eight-state Playwright gate at 1440/390 in `frontend/test-results/lifting-gate/`; push/PR/merge still open |

Evidence: `npx tsc --noEmit` clean; `npm run build` clean; `e2e/lifting.spec.ts` 19 passed; touch audit 0 targets under 44 at 390; keyboard tab test passes. Visual captures exist for Overview, Sessions rail/detail, Analytics, PRs and mobile Overview/Sessions under `prototype/lifting/qa/out/port/` in the main checkout.

Caveats: the E2E fixture uses mock PRs/volume data (Back Squat may read “No record”; the Analytics volume hero can be empty), and the production API was not running locally. The branch is PR-ready for review but **not merge-ready until P6 cleanup and a production-data gate**.
