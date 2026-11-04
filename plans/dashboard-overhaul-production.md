# Dashboard overhaul — production plan

> **Source artifact:** `prototype/dashboard/` — 12 fixed frames, both candidates, gate result in
> [`GATE.md`](../prototype/dashboard/GATE.md), decisions in
> [`DECISIONS.md`](../prototype/dashboard/DECISIONS.md), diagnosis in
> [`DIAGNOSIS.md`](../prototype/dashboard/DIAGNOSIS.md).
> This plan ports the **decisions**, not the lab code. Nothing from `prototype/` is imported.
>
> **Status:** draft for implementation. No production code has been changed.
> **Owner:** Oli + agent. **Branch:** `feature/dashboard-overhaul` from `main` (never `prod`).
> **Recommendation it implements:** *produce* — candidate A, plus B's sparkline graft.

---

## 1. What ships

`/dashboard` becomes **three zones on one page**, with one URL-state contract:

```
Today     stance + six engines + the day + the 14-day join + three recent rows
Trends    one range control -> form, weekly load, HRV, goals, analyses (collapsed)
History   year totals, 12-month table, PR list
```

`?view=today|trends|history` · `?range=7d|30d|90d|ytd` · legacy `?tab=` redirects.

Gone from the page entirely: the Week/Month/Year tabs, `WeekNav`, `TimeRangePicker`,
`PeriodNav`, `PeriodSummaries`, `YearDashboard`'s chart pair, the "Today's Numbers" 2×2 empty
grid, the standalone Today's Activities / Today's Lifting cards, the duplicated readiness card,
the duplicated Training Goals block, and the unlabelled streak strip.

### Non-goals

- **No new endpoints, tables, migrations or providers.** One existing response changes (§4.1).
- No change to `/cycling`, `/lifting`, `/training`, `/health`, `/activities`, `/routes`.
- No fix to the `adaptive` engine (`today.py:363-379`). It stays broken and is *reported*
  honestly; fixing it is its own PR (P1 in the contract).
- No light-theme work, no chart-library change, no PDF, no push.
- No new route. History lives inside `/dashboard` (D-07).
- No prototype imports, fixture data, or lab shell in `frontend/`.

### Invariants

1. **Every write path that exists today still works**: the LLM "Re-analyse" mutation, the health
   "Analyze Now" mutation, pull-to-sync, and the report downloads that the current page owns.
   If any of them has no home in the new layout, it is *moved*, not dropped silently — the
   plan below says where each goes.
2. **Deep links survive**: `?tab=today|weekly|monthly|yearly` → the equivalent zone + range,
   via a one-line redirect in the page. Bookmarks are the only thing users have.
3. **The page is client-rendered** with React Query + `useAuthFetch`; no server components.
4. **Mobile keeps the app's fixed bottom nav** and `tabbar-clear` spacing. Verified by
   measurement, not by eye (§7).
5. **One page-level state**, not 40 card-level ones (§5.1).

---

## 2. Architecture

### 2.1 Files

| Action | Path | Notes |
|---|---|---|
| **Rewrite** | `frontend/src/app/(app)/dashboard/page.tsx` | 423 → ~220 lines: shell, URL state, zone switch, redirects |
| **New** | `frontend/src/lib/dashboard/useDashboardPage.ts` | the one page-state hook (§5) |
| **New** | `frontend/src/lib/dashboard/stance.ts` | the stance composer — port of `readStance` + `contextFor`, typed against `TodayVerdict` |
| **New** | `frontend/src/lib/dashboard/engines.ts` | engine → label/state/human sentence mapping |
| **New** | `frontend/src/components/dashboard/today/` | `StanceHero`, `DayCard`, `DomainStrip`, `RecentRows` |
| **New** | `frontend/src/components/dashboard/trends/` | `RangeControl`, `FormCard`, `WeeklyLoadCard`, `HrvCard`, `GoalsRow` |
| **New** | `frontend/src/components/dashboard/history/` | `YearTotals`, `MonthTable`, `PrList` |
| **New** | `frontend/src/components/analysis/AnalysisProse.tsx` | the markdown renderer (§4.2) |
| **Keep, shrink** | `components/dashboard/LoadSummary.tsx` | folded into `StanceHero`'s basis chips; file deleted |
| **Keep** | `components/dashboard/DashboardRefresh.tsx`, `WeatherWidget.tsx` | unchanged, relocated to the header |
| **Delete** | `TodayTab.tsx` (603), `WeeklyTab.tsx` (689), `MonthlyTab.tsx` (146), `YearDashboard.tsx` (209), `PeriodSummaries.tsx` (359), `PeriodNav.tsx` (144), `WeekNav.tsx` (94), `TimeRangePicker.tsx` (93), `GoalsSection.tsx` (57), `RestDayBanner.tsx` (229), `TodayAdaptiveAction.tsx` (174), `helpers.tsx` (76) | ~2 900 lines out. Content that survives is re-homed per §1; nothing is deleted until its replacement is on screen |
| **Delete** | `lib/dashboard/useDashboardData.ts` (492) | replaced by `useDashboardPage` |
| **Keep** | `lib/athlete/selectors.ts`, `lib/time-range.tsx` | selectors still used by `/cycling` and `/today`; `time-range` kept for other pages, no longer used by the dashboard |

Net: roughly **−2 900 / +1 400** lines in `frontend/src`.

### 2.2 Reuse, don't rebuild

The lab re-expressed primitives because it could not import them. Production must **not** do
that — these already exist and are already themed:

`Card` · `SectionLabel` · `Stat` · `Sparkline` · `SegmentedControl` (has arrow-key nav and a
tablist role) · `EmptyState` · `ErrorState` · `Skeleton` · `PageHeader` · `Badge` · `Button` ·
`DeficiencyCard` · `TrendArrow` · `PageLoadingBar`.

The only genuinely new UI atoms are `DomainStrip` (an aligned multi-row SVG) and
`AnalysisProse`. Everything else is composition.

### 2.3 Charts

Keep **Recharts** and the existing viz theme (`components/charts/`). The lab used Recharts
deliberately so the fix transfers. Three rules carried over verbatim, because they are what
the current page gets wrong:

1. `isAnimationActive={false}` on every series. A screenshot, a slow phone, and a
   `prefers-reduced-motion` user all see the same frame.
2. An explicit `domain` on every y-axis — never the library default, never `[0, max]` for a
   signed series.
3. **A chart never renders without a series.** If the data array is empty, render
   `EmptyState`, not axes. This is the bug in three current bar charts.

---

## 3. Data contracts

Everything the new UI needs already arrives today. The contract is about *what the page
requires* and *what it does when a field is missing*.

| Field | Source | If absent |
|---|---|---|
| `verdict.consensus[]` | `/api/v1/dashboard/today` | Hero falls back to "no verdict" + the basis chips; never a confident sentence |
| `current_ctl/atl/tsb` | `today` or `cycling/training-load` | Stance is `unknown`; the hero says so rather than guessing |
| daily TSS/CTL/ATL/TSB series | `cycling/training-load?days=90` | Strip renders load row as empty with a sentence |
| HRV series | `charts/hrv-trend-detailed?days=90` | Strip renders the HRV row as gaps; no line |
| `metrics-readiness` | `/api/v1/metrics/readiness` | "not scored today" — *not* `0%` |
| `sleep-debt?days=7` | `/metrics/sleep-debt` | Sleep fact hidden, not zeroed |
| activities (5) / sessions (5) | `/activities?limit=5`, `/lifting/sessions?limit=5` | Recent shows the other list and says so |
| `connections/` | `/api/v1/connections/` | Freshness chip reads "sync unknown" |
| `deficiency?weeks=8` | `/api/v1/deficiency` | Day card falls back to the verdict's deficiency note |
| `cyling/llm-analysis/latest` + `metrics/health-ai-analysis` | Trends only | "No analysis has been generated yet. The weekly job runs Sundays at 05:00 UTC." |

**Rule:** a missing metric renders a sentence, never a zero. `0` and "unknown" are different
claims and the current page conflates them.

---

## 4. The two small non-UI changes

### 4.1 The headline must stop lying (`backend/app/services/today.py:277-301`)

```python
if not should_rest:
    return "Go ahead with today's plan."
```

That sentence is emitted whenever no rest signal fires — including when **no plan exists**, which
is the owner's real state (`projection` → `available:false, reason:"no active plan"`, and the
fixture has `training-plans = []`). The page then tells the user to follow a plan it also says
does not exist.

**Change:** pass the projection engine's availability into `_headline` and branch:

| Condition | Headline |
|---|---|
| rest signal fired | unchanged |
| plan active, no rest signal | `"Go ahead with today's plan."` |
| **no plan active**, no rest signal | `"Train — nothing is planned, so this is load and recovery only."` |

Ten lines, one test (`test_today_headline_never_mentions_a_plan_that_does_not_exist`), no
schema change. The frontend composes its own sentence from fields either way (the lab proved
that works), so the API string is the *fallback* and the bellwether.

**Not changed:** the `adaptive` engine's `AttributeError`. The redesign renders it as a broken
engine with a human sentence; the exception string never reaches the screen. Fixing the engine
is a separate PR.

### 4.2 Analysis rendering (`components/analysis/AnalysisProse.tsx`)

The stored `analysis_text` **is** markdown (`### Heading`, `- **Lead:** …`, `* …`, `--`). The
current page puts it in a `<div>`, which is why readers see asterisks.

Port `parseAnalysis` from the lab (≈80 lines, 3 tests): headings, bullets, ordered items,
horizontal rules, and inline `**bold**` only. **No HTML path, no link syntax, no images** — the
allow-list grammar is the security boundary, and it is the reason this is not
`dangerouslySetInnerHTML` and not a general markdown library.

Lives at `components/analysis/` because `/cycling` uses the same payload and should adopt it
(separate PR, same component).

---

## 5. The loading model — the point of the rewrite

### 5.1 One page state, four values

`useDashboardPage(view, range)` returns:

```ts
type PageStatus = 'loading' | 'partial' | 'ready' | 'error';
{
  status: PageStatus,
  sections: Record<'verdict'|'load'|'recovery'|'day'|'recent'|'trends', SectionState>,
  ...
}
```

`SectionState = { state: 'loading' | 'ready' | 'empty' | 'error', reason?: string }`.

Rules:
- `status = 'error'` only when **the verdict** fails — that is the one call the page cannot do
  without. Everything else degrades per section.
- A section in `error` renders `ErrorState` **inside that card**, not a global banner. One
  contradiction on the page today is a red banner over a page that otherwise looks fine.
- A section in `empty` renders a sentence saying what would fill it.
- `partial` means at least one section is not ready; the page is still usable and says nothing
  about it — no spinner over content that has arrived.

### 5.2 The request budget

Today zone, cold: **9 requests** (from 30).

| # | Endpoint | Feeds |
|---|---|---|
| 1 | `GET /api/v1/dashboard/today` | stance, engines, load trio |
| 2 | `GET /api/v1/cycling/training-load?days=90` | CTL/ATL/TSB series + daily TSS (strip) |
| 3 | `GET /api/v1/charts/hrv-trend-detailed?days=90` | HRV row |
| 4 | `GET /api/v1/metrics/readiness` | recovery |
| 5 | `GET /api/v1/metrics/sleep-debt?days=7` | sleep fact |
| 6 | `GET /api/v1/activities?limit=5` | recent |
| 7 | `GET /api/v1/lifting/sessions?limit=5` | recent |
| 8 | `GET /api/v1/connections/` | freshness / stale provider |
| 9 | `GET /api/v1/deficiency?weeks=8` | day-card recommendation |

Dropped from this load because nothing on Today shows them: `cycling/profile`, `goals`,
`training-plans`, `plan-week`, `conformity`, `dashboard/summary`, `whoop-weekly`,
`monthly-summary`, `streaks`, `yearly-summary`, `events`, `llm-analysis`, `respiratory-rate`,
`optimal-bedtime`, `sleep-consistency`, `weight`. Several of those *are* still used by other
pages — they are dropped from this page's load, not from the app.

Trends adds: `weekly-tss`, `goals`, `monthly-summary`, `llm-analysis`, `health-ai-analysis`.
History adds: `monthly-summary`, `yearly-summary`. **Zones fetch on first visit**, so the cold
Today load never pays for them.

Cache keys stay exactly as they are (`['dashboard','today']`, `['training-load',90]`, …) so
navigating to `/cycling` still hits a warm cache. No key renames — that would silently double
the app's traffic.

### 5.3 What this buys

Measured on the lab fixture: page height 3.1 → **1.3 screens** desktop, 5.7 → **2.0** mobile;
requests 30 → **9**; first paint of real content no longer waits for the slowest of eleven
queries. On prod latency, a 9-request page is roughly three round-trip waves instead of nine.

---

## 6. Mobile & accessibility

| Requirement | Implementation |
|---|---|
| Content clears the fixed bottom nav | `pb-tabbar-clear` on `<main>`; **measured** in CI by comparing the last content element's rect to the nav's top at full scroll (the lab harness does this and it caught nothing — the current page fails it) |
| No horizontal scroll at 390/768/1440 | Probe at all three widths; the current `WeekNav` overflows 390 |
| Touch targets | Primary actions 44×44; `SegmentedControl` and the range switch at 40 with `aria` intact — recorded deviation (D-13), revisited if the audit disagrees |
| Type scale | Body ≥ 12px; 10px reserved for axis ticks; uppercase only for `SectionLabel`. Three distinct sizes above 18px for hierarchy: 22 / 26 / 46 |
| Colour meaning | accent = actionable/positive; red = fatigue/failure; blue = cycling & HRV; purple = lifting. One legend, printed on the strip. Never colour as decoration |
| Screen readers | The stance is a heading + a paragraph, not an image of a word. Every engine row is a `<li>` with its state in text. `DomainStrip` is `role="img"` with an `aria-label` summarising the window plus `<title>` per mark |
| Reduced motion | All chart animation off; no transitions that carry meaning |
| Keyboard | `SegmentedControl` already implements roving tabindex + arrow keys; reuse it for both switches rather than hand-rolling buttons (the current tab bar is a hand-rolled button row) |

---

## 7. Migration, cleanup and rollout

### 7.1 Order (each step ends somewhere verifiable)

1. ~~**Verify the analysis job (P4).**~~ **Done 2026-11-04 — resolved, and not what we assumed.**
   The job exists (`scheduler.py:291`, Sundays 05:00 UTC) and fires fine. Running it once by hand
   returns `402 RESOURCE_EXHAUSTED: "Your prepayment credits are depleted"` from Gemini, three
   retries, no row written (`llm_analyses` stays at 7 rows, newest 2026-08-24).
   **The analyses are 74 days stale because the API key has no credit, not because the schedule
   is broken.** Consequences for this plan:
   - Do **not** add a second job, a retry loop, or a "run now" that will fail the same way.
     Q3's "re-run on schedule" is satisfied by code that already exists.
   - The age badge and the staleness banner are not a nicety — with no credit they are the only
     honest thing the page can say. They ship.
   - Surface the failure in the UI: when `run_llm_analysis` raises, the analysis card shows
     *"the last run failed — credits exhausted"* rather than a silent old date. That is a
     frontend change (§4.2), not a new backend one.
   - **A billing decision, not an engineering one:** top up the key, or accept the analyses are
     archival. Ask before spending.
2. **`_headline` fix** (§4.1) + its test. Independent, ships first, no UI dependency.
3. **`AnalysisProse` + tests.** Independent of the page.
4. **`stance.ts` + `engines.ts` + tests.** Pure functions, no JSX.
5. **`useDashboardPage`** (§5) + a test that it issues exactly the 9 requests for `view=today`
   and that a single failed section does not flip `status` to `error`.
6. **Zones, in order: Today → Trends → History.** Today first because it is the fold.
7. **Delete the old files.** Only after each replacement is on screen. `git rm` per file, never
   a bulk script (repo rule 10).
8. **Rewrite `dashboard.spec.ts`** (§8.2).
9. **Re-run the gate on the real page** (§8.1).

### 7.2 Rollout

Single-user personal app, no flag infrastructure, and the old and new pages cannot coexist
without keeping ~2 900 lines alive. So: **one PR into `main`**, no flag, no dual path.
Rollback is `git revert` of the merge commit on `main` before the next `prod` merge. `prod` is
only updated by a deliberate release, per repo policy.

### 7.3 Cleanup that must not be forgotten

- `useDashboardData.ts` deleted → grep for `['dashboard-summary']` and `['plan-week'……` to
  confirm no other page depended on a key the dashboard *wrote*. (It only read, so this is
  safe — but check, don't assume.)
- `docs/review-vs-act.md` line 58 calls `/dashboard Today` a *candidate*; update it to `done`
  with the tab split named.
- `AGENTS.md` "Active Planning" gets one line for this plan.
- `frontend/src/CODEMAP.md`: replace the dashboard component list.
- `docs/BUGS.md` if the `_headline` fix closes a logged bug.

---

## 8. The quality gate, re-run on the production surface

### 8.1 The artifact gate

Reuse the lab's method against the real app, not the lab:

```powershell
# from frontend/, dev server up on :3000
$env:BACKEND_TOKEN = python ../fittrack.py exec backend python -c "import uuid;from app.services.auth import create_access_token;print(create_access_token(uuid.UUID('<user-id>')))"
$env:SESSION_COOKIE = node ../prototype/dashboard/qa/mint-session.mjs
node ../prototype/dashboard/qa/capture-before.mjs
```

`capture-before.mjs` writes `prototype/dashboard/qa/before/` — after this work those frames are
the **after** sheet. Compare them to the archived before sheet at
`prototype/dashboard/qa/before/`. Every criterion in `GATE.md` §"Criteria" is re-scored against
the production page. **A criterion that passed in the lab and fails in production blocks the
merge.**

Two criteria need new checks in production because the lab could not have them:

- **Criterion 8 (loading ≠ empty).** Throttle one endpoint (`page.route` delaying
  `dashboard/today` by 3 s) and assert the page shows a skeleton, not "No data". Then fail the
  same endpoint and assert `ErrorState` in the verdict card only.
- **Criterion 4 (touch targets).** Measure every `button, [role=button], a` inside `<main>` at
  390 and assert `min(width, height) >= 40`.

### 8.2 `dashboard.spec.ts` — replaced, not ported

The current suite has 11 tests and every one ends `expect(page.locator('main h1')).toBeVisible()`,
including `handles API errors gracefully`. Seven address tabs by emoji that a later refactor
deleted. It cannot fail when the page is wrong, so it certifies nothing.

Replacement asserts what the user observes:

| Test | Asserts |
|---|---|
| stance is visible and specific | the stance word is one of TRAIN/EASY/REST and the sentence contains a number |
| the stance changes with the day | with `now` pinned to two fixture days, the sentence differs (the class of bug the lab found in itself) |
| no plan, no lie | with `training-plans = []`, no visible text matches `/today's plan\|go ahead/i` |
| every engine accounted for | 6 rows rendered; the count in the sentence matches the contributing rows |
| one range governs Trends | switching 30D → 90D changes the x-domain of every chart card |
| a chart never renders empty | every `.recharts-surface` has ≥1 mark, or its card shows `EmptyState` |
| adding a day | through `addInitScript` + fixture, a day with no session renders "No data" *with* a sentence naming what would fill it |
| the analysis is parsed | no visible text matches `\*\*` |
| mobile clears the nav | last content element's bottom ≤ nav top at full scroll |
| no horizontal scroll | at 390/768/1440 |
| deep link | `?tab=weekly` lands on Trends with a 90D range |

### 8.3 Unit tests to port from the lab

`stance` (changes with the pin; never claims a recovery score for a day it was not computed
for), `engines` (a raw exception string becomes a human sentence, never copy), `parseAnalysis`
(headings/bullets/rules/bold; no empty blocks), `clean` (mojibake repair). Nine tests, ~40 ms.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| **Deleting 2 900 lines removes a working feature nobody listed.** | Before each `git rm`, grep the file for `useMutation`/`onClick` and confirm the action has a home (invariant 1). `RestDayBanner` and `TodayAdaptiveAction` are the two most likely to carry behaviour — read them fully before deleting |
| **The 9-request budget is wrong because a component lazily fetches.** | The `useDashboardPage` test asserts the request set, not just the count |
| **`isAnimationActive={false}` regresses the feel of the charts.** | It does; that is the trade. Recharts' animation is what makes a screenshot catch a half-drawn series, and it is what a reduced-motion user must not get |
| **The cross-domain 404 stays a 404.** | Client treats `404` from `cross-domain` as `empty` with the API's own reason text. No backend change; recorded in DECISIONS |
| **The analyses stay stale.** | Root cause found: the Gemini key is out of prepayment credit (`402 RESOURCE_EXHAUSTED`), so the weekly job cannot write regardless of schedule. Ship the age badge + the failed-run message; the refresh is a billing action (P4), not code |
| **Porting the lab's `font` assumptions.** | The lab used Inter via a CDN link; production uses `next/font/inter` and `--font-inter`. The 46 px stance word and the tabular numerals must be checked against the real font stack — tabular figures are what keep the numbers from shifting |

---

## 10. What is deliberately not ported from the lab

- The lab's hand-rolled primitives (`Card`, `Stat`, `Chip`, `Dot`, `SectionLabel`) — production
  has all of them, themed and tested.
- The lab's fixture loader and `import.meta.glob` — production fetches.
- The lab's shell (sidebar, mobile top bar, bottom nav) — production has `(app)/layout.tsx`.
- The lab's two-candidate switch. **A ships**, with B's sparkline beside each load number
  (D-12). B's instrument band is not ported: it puts a chart in the act zone.
- The `?now=` clock pin, except as a test seam — production reads the real clock. Tests pin it.

---

## 11. Definition of done

1. The three zones ship on `main`, old tabs and their 2 900 lines deleted.
2. `_headline` no longer mentions a plan that is not running, with a test.
3. Today issues 9 requests, asserted.
4. The gate in `GATE.md` re-scored against the production page: no criterion that passed in the
   lab fails in production.
5. `dashboard.spec.ts` asserts behaviour, and fails if the stance is false, a chart is empty, or
   the mobile nav covers content.
6. `tsc --noEmit`, ruff, and the full suites green.
7. `docs/review-vs-act.md`, `AGENTS.md` and `CODEMAP.md` updated.
8. `prototype/dashboard/` deleted in one commit (`git rm -r`), with the artifact files preserved
   where the plan references them — or the whole lab archived, if the before/after sheet is
   worth keeping. **Decision at the merge:** keep `qa/out/compare-today.png` and the three docs
   in `docs/`, delete the rest.
