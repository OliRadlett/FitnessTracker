# Dashboard — diagnosis (Phase 0)

> **Historical (2026-11-04):** the dashboard overhaul has since shipped
> (Today · Trends · History); this file records the pre-build diagnosis.

**Feature:** dashboard analysis and overhaul · **Surface:** page (`/dashboard`)
**Owner:** agent (artifact, evidence, decision trail) · Oli (taste, acceptance)
**Fixture:** the owner's production database, read-only, 2026-11-04 15:52 UTC
**Status:** no code written; Phase 1 contract awaits sign-off

---

## 1. What the user is trying to do

Oli trains for powerlifting **and** cycling, and feeds four providers into one record. Two
questions, asked in this order, every day:

1. **What should I do today?** — and it must account for *both* sports and the recovery between them.
2. **Is the record telling the truth?** — am I detraining, is the plan working, what actually
   happened this month.

The dashboard is the only surface where cycling, lifting and recovery appear on the same axis.
That is its reason to exist. Every other page (`/cycling`, `/lifting`, `/training`, `/health`) owns
one domain and can be as detailed as it likes.

## 2. What exists today, with evidence

The page is four tabs — Today · Week · Month · Year — sharing ~900 px of identical chrome, with
every tab's content appended below it. Measured, not estimated, at the owner's real data:

| Measure | Today | Week | Month | Year |
|---|---|---|---|---|
| Page height @1440×900 | 2 759 px (3.1 screens) | **10 408 px (7.2 screens)** | 3 692 px (4.1) | 1 640 px (1.8) |
| Page height @390×844 | 4 821 px (5.7 screens) | **20 336 px (24 screens)** | 7 462 px (8.8) | 3 090 px (3.7) |

A single cold load of the Today tab issues **30 API requests / 88 KB of JSON / 40 `useQuery` call
sites across 9 files**, with a first contentful paint of **1 508 ms locally** and full settle at
**4 319 ms**. Locally — i.e. with no network latency and a warm backend.

The tabs are **nested, not parallel**: Week contains the entire Year-in-Review (monthly grid, PR
highlights, year stats), Month contains the same again. Every tab re-renders the banner, greeting,
weather, verdict, load summary and week picker before its own content starts.

### What is actually on the page, worst first

1. **The headline contradicts the page.** The verdict reads *"Go ahead with today's plan."* while
   the `projection` engine reports `available:false, reason:"no active plan"` and the Today's Plan
   card three inches below reads *"No active training plan"*. The sentence is generated without
   checking whether a plan exists.
2. **4 of 6 verdict engines are silent, and one is broken.** From `/api/v1/dashboard/today`:
   `adaptive` → `AttributeError: 'str' object has no attribute 'get'` (the exception message is
   served to the client and rendered), `cross_domain` → "no analysis yet", `projection` → "no
   active plan", `session_mix` → "no classified sessions yet". The UI compresses this into
   `Why — 2 of 6 signals` behind a `<details>` (`VerdictCard.tsx:74`), so the page's most
   important claim hides its own uncertainty one click deep.
3. **Two stale AI essays are ~6 000 px of raw markdown.** "AI Health Analysis" (`Generated 21 Aug`)
   and "AI Performance Analysis" (`Last updated: 23 Aug`) render literal `**bold**` asterisks, `--`
   rules, and truncate mid-word ("**Stages & Recovery"). They are 11 weeks old, presented at full
   weight, on the Week tab, in the act zone. `LlmAnalysisCard` is a `/cycling` component.
4. **Four empty cards on "today" while the record holds 582 activities.** TSS / Volume / Distance /
   Duration all read "No data yet · Nothing logged yet"; Today's Activities and Today's Lifting are
   two more full cards saying "none". The page cannot say *"yesterday: 1 h 17 m strength"*, which is
   the only true and useful sentence available at 15:52 on a rest day.
5. **Three bar charts render axes with no series.** `Monthly TSS` and `Monthly Lifting Volume`
   (Year) and `Weekly TSS` (Week) draw grid, ticks and a caption — "Average weekly TSS: 206. Good
   base level." — while painting zero marks. `Rest Day Analysis` and `Sleep Consistency` on the same
   pages render fine, so it is not a data problem.
6. **"Recent lifting" is three months stale.** `lifting_sessions` max date is **2026-08-22**;
   strength *activities* exist on 2026-10-19 and 2026-11-03. The rail shows "Last 5" ending in
   August. `session_class` / `session_lift` are `NULL` on all 4 rows, which is why `session_mix`
   can never speak.
7. **`/api/v1/cross-domain` returns 404 to mean "not analysed yet"** (`cross_domain.py:68`), so the
   card cannot distinguish empty from broken — and `CrossDomainInsightsCard` has no `isError` branch.
8. **Numbers that disagree with each other.** Year highlights say `Longest ride 0.17 km`; the
   Year-in-Review block on the Week tab says `174.8 km`. The API returns `174.8 / "km"` — the
   component divides by 1000 again. `Current Streak 1 days`. A stray unlabelled strip of six numbers
   (`22 06 · 19 07 · 23 08 · 22 09 · 10 10 · 1 11`) floats between the streak cards and the goals.
9. **Mobile: the floating nav covers the load card.** At 390 the bottom tab bar sits over the
   CTL/ATL sparklines and hides the `Δ −0.6 TSB/7d` row; the week picker overflows the right edge
   and clips the year select.
10. **Colour carries no meaning.** CTL, ATL, TSB, every goal bar, every "Ready to Train" pill and
    every section heading are the same green. The Form Trend legend assigns green/red/purple to
    CTL/ATL/TSB, and green elsewhere means "good".

## 3. Why the current quality is capped

**Process causes** (these are the ceiling):

1. **The page has never been looked at as an artifact.** The only dashboard screenshot committed to
   the repo (`frontend/e2e/screenshots/02-dashboard.png`, 6.5 KB) is a **loading spinner**. There is
   no before/after sheet, no contact sheet, no visual gate — for the app's home page.
2. **The entire dashboard E2E suite asserts the page's `<h1>`.** All 11 tests in
   `frontend/e2e/dashboard.spec.ts` end in `expect(page.locator('main h1')).toBeVisible()` —
   including `handles API errors gracefully`, `handles empty data gracefully` and
   `shows loading state initially`. Seven of them address tabs by emoji (`📅 Today`), which the
   V2.1 lucide pass removed, so they do not even address the current DOM. Nothing in the suite can
   fail when the composed screen is wrong.
3. **"Complete" was measured at the data layer.** `page.tsx:12-14` describes the V2 rewrite as
   *"Removed: SwipeViews, TimeRangePicker. Tab components are unchanged."* A query-deduplication
   refactor shipped under the word "redesign", and the visual pass was deferred — as the page's own
   docstring says.
4. **Tabs were added, never subtracted.** `91ecee9` added V2; `6f70297` added the Year tab "with
   annual stats and charts". No commit removed a tab or a section. Week ⊃ Month ⊃ Year is the
   predictable result of only ever appending.
5. **The project's own rule was written down and not applied.** `docs/review-vs-act.md:58` names
   `/dashboard Today` as a candidate for the act/review gate. It was never done.
6. **Staleness is not a design state.** "Generated 21 Aug" renders at full visual weight next to
   today's HRV. There is no vocabulary for "this insight is old".

**Technical causes** (fixable, but they are not the ceiling):

7. **No page-level state.** 40 independent `useQuery` calls mean loading, empty, error and stale are
   per-card, so the screen has no single honest state — and "we have not loaded yet" is
   indistinguishable from "you have not trained".
8. **Composite verdict without a consistency check.** `today.py` composes six engines honestly
   (`available:false` on silence — pitfall 42 is correctly implemented) but the headline text is
   written as if every engine agreed, and the one engine whose *output shape* is wrong leaks a raw
   Python exception into the payload.
9. **Derived data is written on some paths only.** Lifting sessions stop at 22 Aug while strength
   activities continue to 3 Nov; Jev labels are `NULL` on all rows.
10. **A 404 is being used as an empty state** (`cross_domain.py:68`).

## 4. What "good" looks like

Full board in [`REFERENCE.md`](REFERENCE.md). In one line: **the reference is this project's own
`/lifting` overhaul** — one hero, one contextual band, rows, one trend, everything else gated, no
empty pane at 1440 or 390. Supporting references: Whoop's hero→inputs relation, Intervals.icu's
single shared date range across stacked charts, TrainingPeaks' planned-vs-done as the primary
object, Linear's restraint.

**Anti-references:** this dashboard today (10 000 px, stale essays, four empty cards, a headline
about a plan that does not exist); and Garmin Connect's wall of equal-weight cards, where every
metric shouts at the same volume and nothing answers "what now".

## 5. The artifact

**One page, two zones, one contact sheet.**

- **Today** — the act zone. One honest sentence, its evidence visible rather than hidden, the day's
  prescription or the truthful "nothing planned, here is what that means", and a 7-day
  cross-domain strip. Must be readable in one fold at 1440 and one screen at 390.
- **Trends** — the review zone. One date-range control governs four charts at most; the year record
  becomes a compact table; the AI analyses leave.

Six desktop states and three mobile states, rendered from the committed fixture, with the before
sheet beside them. Exact states and acceptance criteria are in [`CONTRACT.md`](CONTRACT.md).

## 6. Explicitly out of scope

No new backend endpoints, migrations, providers or data sources. No fix to the `adaptive` engine
(recorded as a pre-condition, not built here). No change to `/cycling`, `/lifting`, `/training`,
`/health` or `/activities`. No light theme, no new chart library, no PDF, no push, no production
merge, no mobile-shell redesign beyond keeping the dashboard clear of the floating nav.

## 7. First look, and what would stop it

First look: **as soon as the contact sheet passes the internal gate**, presented the same session
with the before sheet beside it. If two full passes on the worst frame still fail the five-second
read at 390, the page-level redesign is killed and re-scoped to two surgical fixes: make the
headline honest, and delete the AI essays.

## 8. What was read, what was skipped

**Read:** `AGENTS.md`; `docs/review-vs-act.md`; `plans/quality-charter.md` (referenced);
`docs/review-2026-11-04/AUDIT.md`; `prototype/lifting/{CONTRACT,REFERENCE}.md` + its contact sheet;
`page.tsx`, `useDashboardData.ts`, `VerdictCard.tsx`, `WeeklyTab.tsx` (partially),
`frontend/e2e/dashboard.spec.ts`, `backend/app/services/today.py:340-389`,
`backend/app/api/cross_domain.py`, 38 captured API payloads.

**Skipped:** `MonthlyTab.tsx` and `YearDashboard.tsx` source (judged from rendered frames instead);
the remaining 430 lines of `WeeklyTab.tsx`; the full `today.py`; every other page; a prod capture
(the local database is the owner's production data, current to 2026-11-03).

**Reproduce the evidence:**

```powershell
# from frontend/, with the dev server up on :3000
$env:BACKEND_TOKEN = python ../fittrack.py exec backend python -c "import uuid;from app.services.auth import create_access_token;print(create_access_token(uuid.UUID('<user-id>')))"
$env:SESSION_COOKIE = node ../prototype/dashboard/qa/mint-session.mjs
node ../prototype/dashboard/qa/capture-before.mjs      # screenshots + fixtures/raw/
node ../prototype/dashboard/qa/measure-load.mjs        # request count and timings
python ../prototype/dashboard/qa/sheet.py              # contact sheets
```
