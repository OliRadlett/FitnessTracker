# Reference board — what "good" means for `/dashboard`

Explored 2026-11-04. Five kept, two rejected. The target is not a feature list; it is a screen that
passes a five-second read at 1440 and at 390.

> **How these were reviewed.** Reference 1 is inspectable in this repo and was looked at directly.
> References 2–5 are in-app frames behind auth; their public surfaces are not the frame being
> stolen, so each entry names the *specific* element stolen and what it must do on our screen. No
> vendor screenshots are committed. This is a recorded choice, not an omission — see
> `DECISIONS.md` D-01.

---

## 1. This project's `/lifting` overhaul — the bar we already cleared

- **Frame:** [`prototype/lifting/qa/out/contact-sheet.png`](../lifting/qa/out/contact-sheet.png)
- **Link:** in-repo · approved 2026-11-03 · same design system, same house rules
- **Steal:** the whole shape. One hero (`Squat day` + its four numbers clustered, one `Continue`
  button). A `Jump to` action row. Recent sessions as **rows**, not cards. One trend with a
  takeaway title. Eight frames, none longer than 1.5 folds at 1440. Mobile is its own layout —
  four equal tabs, one-line stats, 64 px rows — not a reflow.
- **Why it is the primary reference:** it proves the craft level is reachable *here*, in
  `bg-background` / `surface` / `accent`, with the same `Card`/`SectionLabel`/`SegmentedControl`
  primitives. A reference the house has already hit is worth more than one it has not.
- **Don't steal:** the session-centric vocabulary. Lifting's hero is a session; the dashboard's hero
  is a decision that spans two sports.

## 2. Whoop — hero → inputs

- **Link:** https://www.whoop.com/ (Today / Recovery)
- **Steal:** **one number, then the three inputs that produced it, in that order, above the fold.**
  The relation is legible without a legend: big thing, small causes. Whoop never shows a chart
  before it shows today's answer.
- **On our screen:** `Go ahead with today's plan.` is the big thing; the six engine rows are the
  inputs — and unlike Whoop we must show the *silent* ones too, because this product's differentiator
  is that it does not pretend to know.
- **Don't steal:** the ring, the readiness-score-first framing, or a wearable's vocabulary. Our hero
  is an instruction, not a score.

## 3. Intervals.icu — one range, stacked domains

- **Link:** https://intervals.icu/ (Fitness / Activities)
- **Steal:** a **single shared date range** that governs every chart on the page, and **stacked
  charts aligned to the same x-axis** so lift load, ride load and HRV can be read *down a column*
  rather than across three unrelated cards. Also: dense is fine when every panel shares the axis.
- **On our screen:** this is the mechanism for the 7-day cross-domain strip. One row per domain,
  one column per day, shared x. The current page already claims "Shared range · 90D" in a label and
  does not honour it.
- **Don't steal:** the sheer panel count, or the table-first activity list. We are answering a
  question, not auditing a season.

## 4. TrainingPeaks — planned vs done

- **Link:** https://www.trainingpeaks.com/ (Dashboard)
- **Steal:** the **planned-vs-completed comparison as the primary object**, with the week as a
  strip of days rather than a list of sessions. The eye goes: did I do what was planned?
- **On our screen:** when a plan exists, today's card compares plan to completion. When it does
  not, the card must say so and offer the next-best true thing — never a sentence that assumes a
  plan.
- **Don't steal:** the calendar grid, the dated visual language, or the TSS-everywhere framing.

## 5. Linear — the shell

- **Link:** https://linear.app/
- **Steal:** one restrained accent colour, a real type scale (not five sizes of 14 px), quiet empty
  states that read as design rather than failure, and tabs that fit at 390 without a hidden
  scroller. The shell disappears; the content carries the hierarchy.
- **On our screen:** the current page uses the same green for CTL, ATL, TSB, every goal bar and
  every pill. Colour must mean *one* thing. Uppercase micro-labels only for true section labels,
  never mixed with Title Case and sentence case in the same band.
- **Don't steal:** the product-management content, gradients, or the marketing hero.

## Rejected candidates

| Candidate | Why rejected |
|---|---|
| **Apple Health "Summary"** | The card rhythm (big number + sparkline + caption) is right and I steal the caption discipline, but the pinned-cards model has no notion of a *decision*. Our page must commit to an answer. |
| **Strava "Fitness & Freshness"** | One chart people understand — but it is a single-domain view, and the dashboard's whole reason to exist is the join. Steals nothing that Intervals.icu does not do better. |

## Anti-references

**A. This dashboard today.** 10 408 px on the Week tab; two 11-week-old AI essays rendered as raw
markdown in the act zone; four cards reading "No data yet" while the record holds 582 activities;
a headline that says "Go ahead with today's plan" on a page that says "No active training plan".
Concretely: *anything that grows the page or defers subtraction is reproducing this.*

**B. Garmin Connect's home.** A wall of equal-weight cards — steps, floors, intensity minutes, body
battery, stress, sleep score — where every metric shouts at the same volume and the screen never
answers "what should I do now". Concretely: *if two different numbers on the screen are the same
size, weight and colour, one of them is noise.*
