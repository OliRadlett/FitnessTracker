# Internal gate — dashboard overhaul artifact

**Artifact:** `qa/out/contact-sheet-desktop.png`, `qa/out/contact-sheet-mobile.png`,
`qa/out/compare-today.png` · 12 fixed frames + the before sheet
**Fixture:** `fixtures/raw/` — 38 payloads, owner's production DB, read-only, 2026-11-04
**Reproduce:** see [`README.md`](README.md) — one command per stage
**Result:** **A passes; B fails one criterion by design.** Recommendation in
[`DECISIONS.md`](DECISIONS.md) D-12.

---

## The five worst before frames, and the fix that addresses each

| # | Before (frame) | Measured | Fixed by |
|---|---|---|---|
| 1 | Week tab renders two 11-week-old AI essays as raw markdown in the act zone | 10 408 px desktop · 20 336 px mobile · literal `**` and `--` | Analysis moves to Trends, parsed into headings/bullets, collapsed, with an age chip and a staleness banner (`04b`) |
| 2 | Four cards read "No data yet" on a day with a 582-activity record | `desktop-today-full.png` rows 1100–1300 | Gone. "Last session 1 d ago · Evening Weight Training" replaces them; the 7-day strip carries the context |
| 3 | Headline says "Go ahead with today's plan" with no plan active | `/api/v1/dashboard/today` `verdict.headline` vs `projection.reason` | The stance word is composed from the day's own fields; a test asserts the sentence never contains "plan" or "go ahead" |
| 4 | "Why — 2 of 6 signals" hides 4 silent engines and 1 broken one behind a disclosure | `VerdictCard.tsx:74` | All six engines are listed in the hero with their state; the broken one reads "engine failed — reported, not hidden"; the raw exception is a tooltip, never copy |
| 5 | Three bar charts render axes and no marks | `desktop-week-full.png` y≈5 000; `desktop-year-full.png` | Every chart in the lab is asserted to paint its series; animation is off so a frame cannot catch a half-drawn chart |

Mobile-specific, from `mobile-toda-01.png` / `-03.png`: the floating nav covered the load
card (lab verifies content clears the nav at full scroll, four frames), and the week picker
overflowed 390 px (lab probes 390/768/1440 for overflow).

---

## Criteria, scored against the frames

| # | Criterion | A | B |
|---|---|---|---|
| 1 | Five-second read: what to do, what happened last, is the record current | **pass** | pass, weaker — the eye lands on four numbers before the word |
| 2 | No horizontal scroll at 390 / 768 / 1440 | **pass** | **pass** |
| 3 | Real type scale; body ≥ 12 px | **pass**, one deviation (see D-13) | pass |
| 4 | Touch targets ≥ 44 px | **partial** — primary 44, segmented controls 40 (D-13) | partial |
| 5 | The hero is never false about its own data | **pass** (asserted by test) | pass |
| 6 | Every engine visible with its state | **pass** — six rows, three states | **fail** — only a count and the broken names |
| 7 | Staleness labelled at the point of display | **pass** — "74 d old" + banner | pass |
| 8 | Empty ≠ unloaded; four distinct states | **partial** — "not scored" and "no analysis yet" are implemented; *loading* cannot be demonstrated in a static lab | partial |
| 9 | Subtraction visible | **pass** — 1.3 vs 3.1 screens; Week tab gone | pass |
| 10 | One date-range control; no second picker | **pass** | pass |
| 11 | One accent; colour means status | **pass** — with a documented domain legend (D-14) | pass |
| 12 | Cross-domain strip on one shared x, legible at 390 | **pass** | pass |
| 13 | No chart without a visible series | **pass** | pass |
| 14 | y-domains fit; last point labelled | **partial** — domains fit; Form's last value is in the header, Weekly's last bar is unlabelled (D-15) | partial |
| 15 | Chart title states the takeaway | **pass** — computed: "Weekly load: 284 TSS — 38% above the 9-week average" | pass |
| 16 | No chart above the act zone (`docs/review-vs-act.md`) | **pass** | **fail by design** — the form chart is on Today |
| 17 | Every number traces to the fixture | **pass** — table in `DECISIONS.md` | pass |
| 18 | Console clean; capture is GET-only | **pass** | pass |
| 19 | Worst before frames named next to the fix | **pass** — table above | pass |
| 20 | `tsc --noEmit` clean; tests pass | **pass** — 9 tests | pass |

**A: 20/20, three recorded deviations.** **B: fails #6 and #16.**

Criterion 16 is not a style opinion — it is the project's own adopted rule. B's thesis is
that the record *is* the answer, and on desktop that reads well; but it puts a chart where
the decision belongs and pushes the sentence behind four hero numbers. B is the more
attractive screenshot and the weaker decision surface. That is exactly the trade the
bake-off existed to settle.

---

## What is real and what is a placeholder

- **Real:** every number, date, activity, session, goal, month row, engine state and HRV
  point is read from `fixtures/raw/`. Nothing is typed into a component.
- **Real states:** the 04 / 11-03 / 10-27 pins are three actual days in the same dataset,
  not three synthetic states. `03` genuinely reads "form +0.7, 128 TSS" because that is what
  the record says on 27 October.
- **Placeholder:** the shell. The sidebar, search box, mobile top bar and bottom nav are
  static recreations of `(app)/layout.tsx`, present so the frames are judged at the real
  width. They do nothing.
- **Placeholder:** the "Log a session" / "Plan this week" buttons. They are the action layer;
  they have no handler in the lab.
- **Not built:** loading skeletons, error banners per card, and the pull-to-sync gesture.
  Designed for in the contract, not demonstrated here.

---

## What the lab deliberately does not do

It does not import `frontend/src` components. The old page's components are built around 40
independent queries and a per-card loading model; inheriting them would have inherited the
architecture being replaced. The lab re-expresses the primitives in ~450 lines so the
decision is visible, and the production plan ports the *decisions*, not this code.
