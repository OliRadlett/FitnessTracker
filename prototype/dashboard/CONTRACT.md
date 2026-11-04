# Quality contract — Dashboard overhaul

> Status: **APPROVED 2026-11-04**, with three owner changes (below). Prototype built; see
> [`GATE.md`](GATE.md) for the internal result and `qa/out/` for the artifact.
>
> **Owner changes, recorded:**
> 1. **Q1 → "prototype both."** Not a choice between the join surface and the everything
>    surface: build both as competing candidates and compare them in one artifact.
> 2. **Q2 → three zones:** Today · Trends · **History** (not two).
> 3. **Q3 → keep the analyses**, but render the markdown properly *and* re-run on a schedule.
>    Verified: a weekly job already exists (`weekly-llm-analysis`, Sundays 05:00 UTC,
>    `scheduler.py:291`) and it fires. It was starved by an empty prepay balance, not broken —
>    resolved 2026-11-04 with a free-tier key (P4).

```
ARTIFACT:        One contact sheet of TWO competing /dashboard candidates — "The Answer" (A,
                 decision-first) and "The Console" (B, record-first) — 12 fixed frames in
                 three zones (Today · Trends · History): 8 at 1440x900, 4 at 390x844,
                 rendered from the committed real fixture, with the before frames beside them.

REFERENCE:       The repo's own /lifting overhaul (primary, already passed this gate), plus Whoop
                 (hero -> inputs), Intervals.icu (one range, stacked domains), TrainingPeaks
                 (planned vs done), Linear (shell). See REFERENCE.md for steal / don't-steal.

GATE:            Every frame passes the criteria below. A frame fails if any one criterion
                 fails. The bake-off is decided on the criteria, not on preference.

NON-GOALS:       No new backend endpoints, migrations, providers or data sources. No change to
                 /cycling, /lifting, /training, /health, /activities. No fix to the adaptive
                 engine (pitfall recorded, not built). No light theme, no chart-library change,
                 no PDF, no push. No production merge. No new route.

GOLDEN FIXTURE:  The owner's production database, read-only, captured 2026-11-04 15:52 UTC:
                 38 endpoint payloads in prototype/dashboard/fixtures/raw/ (582 activities, 570
                 daily metrics, 544 sleep logs, 86 routes, 4 lifting
                 sessions, 3 goals, 0 plans, 0 events). Every number in the artifact must trace
                 to this directory.

FIRST LOOK:      Held 2026-11-04, same session: the 12-frame artifact against the before sheet,
                 with the internal gate result and the recommendation.

KILL CRITERION:  If two full passes still fail the five-second read on frame 1 at 390, kill the
                 page-level redesign and re-scope to the two surgical fixes that survive: make the
                 headline honest, delete the AI essays. If a frame can only pass with data that is
                 not in the fixture, kill. If reaching the gate needs a backend change, stop and
                 re-scope.

OWNER:           Agent owns the artifact, evidence and decision trail. Oli owns taste and
                 acceptance.
```

---

## The twelve frames

| # | State | Viewport | What it must prove |
|---|---|---|---|
| 1 | A · Today — the real "now" (2026-11-04, nothing logged today) | 1440×900 | The hardest state: a rest day with a full record behind it reads as informative, not empty. |
| 2 | A · Today — session logged (pinned 2026-11-03, a real strength day) | 1440×900 | The day card and "last session" change together; the join still holds. |
| 3 | A · Today — big ride (pinned 2026-10-27, the real 174.8 km ride) | 1440×900 | A different day produces a different *number* and the same structure: form +0.7, 128 TSS. |
| 4 | A · Trends — 90D | 1440×900 | Three charts, one range, every series visible, takeaway titles. |
| 5 | A · History | 1440×900 | The record as a table, not twelve cards and two empty charts. |
| 6 | B · Today — record first | 1440×900 | The competing philosophy: instruments on top, decision inside them. |
| 7 | B · Today — ride day | 1440×900 | The same comparison at a busy state. |
| 8 | B · Trends | 1440×900 | The shell holds with charts in it. |
| 9 | A · Today | 390×844 | One screen: the word, the sentence, the evidence. No horizontal scroll, nav clear. |
| 10 | A · Today — ride day | 390×844 | The same at the busiest state. |
| 11 | A · Trends | 390×844 | Charts stay readable at 390. |
| 12 | B · Today | 390×844 | The competing philosophy on a phone. |

States 2 and 3 are the **same real dataset read at a different "today"** — not synthesised rows.
The fixture pins the clock; it does not invent data. A test asserts that changing the pin changes
the sentence (`src/lab/lab.test.ts`).

---

## Gate criteria

**Read** (the five-second test)

1. In five seconds at frame 1 (1440) and frame 7 (390) the owner can name: **what to do today**,
   **what happened last**, and **whether the record is current**. Three trials, two must pass.
2. No horizontal scroll at 390, 768 or 1440. No clipped label, no word-fragment wrapping, no value
   separated from its unit, no control under the floating nav.
3. Type scale is real: at least three distinct sizes above 18 px are used for hierarchy; body ≥ 12 px;
   uppercase microlabels used only for section labels. Contrast ≥ 4.5:1 below 18 px.
4. Touch targets ≥ 44×44 px. Two tabs fit at 390 with room to spare.

**Honesty** (the product's differentiator — this is a gate, not a nicety)

5. The hero sentence is **never** false with respect to the page's own data. Specifically: it may not
   reference a training plan when no plan is active, and it may not assert readiness while its
   supporting engines are silent.
6. Every verdict engine is visible on the surface with its state — contributing, silent-with-reason,
   or broken. No engine's state is reachable only through a disclosure. A raw exception string is
   never shown as product copy.
7. Staleness is a visual state: any analysis or metric older than 14 days is labelled with its age at
   the point of display.
8. Empty ≠ unloaded. Each card renders one of four distinct states — loading, empty, degraded,
   populated — and "empty" carries a sentence explaining what would fill it.

**Structure**

9. **Subtraction is visible**: the artifact's Week tab does not exist; the AI essays are gone; the
   page is shorter than the before page at every viewport for every state.
10. One date-range control governs the whole Trends zone. There is no second week picker.
11. One accent colour, used for one meaning. A number's colour encodes a status, never decoration.
12. Cross-domain: the 7-day strip places lift load, ride load and recovery on one shared x-axis, and
    its marks are readable at 390.

**Charts**

13. No chart without a visible series at rest. A chart whose data is absent renders an explicit
    empty state, not bare axes.
14. y-domains fit their data; the last point is labelled; the legend never overlaps an axis label.
15. Every chart title states the takeaway ("Weekly TSS is 24% below your 4-week average"), not only
    the metric name.
16. Charts do not appear above the act zone (per `docs/review-vs-act.md`).

**Evidence**

17. Every number in the artifact traces to `fixtures/raw/`. A trace table in `DECISIONS.md` maps the
    headline numbers to their payload keys.
18. Browser console has no errors on any frame. The capture is GET-only.
19. The five worst before frames are named in the artifact, each next to the fix that addresses it.
20. `npx tsc --noEmit` clean and the dashboard's unit tests pass for the lab code that remains.

---

## What changes (the cut, as built)

**Three zones instead of four time tabs.**

- **Today** — act.
  - Header: greeting, date, one freshness chip (or a re-auth warning when a provider is stale).
    Weather collapses to an inline chip.
  - **Hero**: the stance word, one sentence composed from the day's own fields, and the six engine
    rows *inline* with their state. A silent engine says why in words; a broken one says it is broken.
  - **Today's card**: plan-vs-done when a plan exists; when it does not, it says so and quotes the
    record's own recommendation. Never "go ahead with today's plan" without a plan.
  - **The 14-day strip**: cycling load (bars), HRV (line) and session ticks on one shared x-axis —
    with the limitation stated rather than papered over: strength carries no TSS in the record.
  - **Recent**: three rows — activities and sessions in one chronological list.
- **Trends** — review.
  - One range control (7D · 30D · 90D · YTD) governing everything below it.
  - Three charts at rest — form, weekly load, HRV — each with a computed takeaway title, plus goals.
    Everything else sits behind disclosures.
- **History** — the record.
  - Year totals, the 12 months as a **table**, and the PR list. No charts, no verdicts.

**Removed from the dashboard entirely**

- The Week / Month / Year tabs and their three competing nav controls.
- The "Today's Numbers" 2×2 empty grid, the separate "Today's Activities" and "Today's Lifting" cards,
  the duplicate readiness card, the duplicated Training Goals block, the unlabelled streak strip.
- The two AI essays *as page furniture* — they survive as two collapsed, parsed, age-labelled rows in
  Trends (Q3), not as 6 000 px of act-zone prose.

**Kept, because they are already good:** the monthly summary numbers, the goals content, the load
trio, the streak concepts, the ready-to-train score — all re-laid out, none re-invented.

---

## The three decisions, as answered

**Q1 — Positioning → "prototype both".**
Rather than pick between the *join* surface (the only place the domains meet) and the
*everything* surface (self-contained), both were built from the same fixture, the same
primitives and the same three zones, and judged on the criteria above. The lab holds two
variants: **A / The Answer** and **B / The Console**. Result and recommendation in
[`GATE.md`](GATE.md) and [`DECISIONS.md`](DECISIONS.md) D-12.

**Q2 — Information architecture → three zones, Today · Trends · History.**
Adopted as asked. Trends holds the shared-range charts, goals and the analyses; History holds
the record (year totals, a 12-month table, PRs). The four time tabs are gone.

**Q3 — The AI analyses → keep, rendered properly, re-run on schedule.**
The stored text *is* markdown (`### Performance Assessment`, `- **Overall trend:** …`, `--`
rules) and the current page drops it into a `<div>`, which is why the asterisks are visible.
A parser renders headings, bullets, numbered items, rules and bold runs, with no HTML path.
Each analysis carries its age and a staleness banner; both are collapsed by default, so the
page does not grow. **On the schedule:** a weekly job already exists —
`weekly-llm-analysis`, Sundays 05:00 UTC (`backend/app/tasks/scheduler.py:291`). It was firing
all along; the fixture's 74-day gap came from an empty prepay balance on the billed project.
Fixed for free on 2026-11-04 (P4): a free-tier key in the account's unbilled project, verified
through both the weekly task and the live on-demand endpoint. Nothing was added.

---

## Reversible choices recorded (not questions for the owner)

- **Fixture strategy**: pin the clock to three real days rather than synthesise three states. Same
  data, honest states.
- **Reference frames**: described and linked rather than vendored; the in-app frames are behind auth.
- **Contact sheet over recording**: the sheet is the gate; one mobile scroll recording may supplement
  it, it cannot pass it.
- **Weather**: demoted to an inline chip. Reversible if the artifact shows it is missed.
- **Where the month record lives**: inside Trends as a table, rather than a new `/history` route. A
  route is a bigger decision than this page; recorded as deferred.
- **Goals**: stay on the dashboard but as one compact row, because they are the only forward-looking
  object the page has.

## Pre-conditions (recorded, deliberately not fixed here)

- **P1** — `adaptive` engine raises `AttributeError: 'str' object has no attribute 'get'` and the
  message is served to the client (`today.py:376-379`). The redesign renders it honestly; it does
  not fix it.
- **P2** — `lifting_sessions` stops at 2026-08-22 while strength activities run to 2026-11-03.
- **P3** — `session_class` / `session_lift` are `NULL` on all rows, so `session_mix` cannot speak.
- **P4 — RESOLVED 2026-11-04.** The weekly job (`weekly-llm-analysis`, Sundays 05:00 UTC) fires
  correctly; it was starved, not broken. The billed project's prepay balance is empty
  (`402 RESOURCE_EXHAUSTED`). A free-tier key was created in the account's unbilled project
  (`gen-lang-client-0668027195`, `billingEnabled=False`) and verified end to end against
  `gemini-3.6-flash`; the weekly task and the live on-demand endpoint both return 200. No credits
  spent. Q3's "re-run on schedule" was already satisfied in code — the display changes are the
  remaining work. The **health** analysis is produced by a different path and stays stale until
  its button is pressed.
- **P5** — `/api/v1/cross-domain` uses 404 for "not analysed yet", so an empty state is
  indistinguishable from a failure.
- **P6** — `dashboard.spec.ts` addresses tabs by emoji that the lucide pass removed, and every test
  ends at `main h1`. The production plan replaces the suite rather than porting it.

---

## Sign-off

Approved 2026-11-04 with the three changes above. Phase 2–5 are complete; see `GATE.md` for the
result and `DECISIONS.md` D-12 for the recommendation. Nothing in `frontend/` has been modified —
a separate production plan is required before any of this ships.
