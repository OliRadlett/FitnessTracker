# Training overhaul — production port (2026-11)

> Status: **implemented on `feature/training-page-overhaul`; NOT verified end-to-end
> and NOT ready to merge.** See "Unverified" below before reviewing.
>
> Supersedes the *surface* described in [`training-redesign-plan.md`](training-redesign-plan.md)
> Phases 0–4. That plan's problem statement (§2.3) was right and its editor work is
> kept; what it got wrong was the measuring stick — every phase's acceptance
> criterion was behavioural, never visual, so the page shipped with eleven stacked
> bands and its own subject eighty-one pixels below the fold.

## What changed

| Before | After |
|---|---|
| Plan · Review · Peaks · Plans mode switcher (`?mode=`) | **Week · Plan** (`?view=`). Plans is a modal; events keep a view (`?view=events`). |
| `PlanSpine` printing `47/49 days · 96%` | Coverage sentence: **`8 of 20 weeks written · last session 15 Oct · 12 weeks have no sessions`** |
| Derived `Blocks` histogram over an empty block list | Coverage rail + boundary labelled `written to 15 Oct` |
| 7-cell `WeekMasterBar` of equal cards | **Rows**, one per session, one headline number each |
| `ConformitySummaryCard` + `AdaptiveSuggestionsCard` + `WeekAheadCard` | **One "What should change" panel**, reconciled once |
| Four chart payloads fetched on every mode | Week needs 4 GETs: plan list, plan, week, suggestions (+ review, unplanned) |
| `StrengthSuggestionsCard` gated on `plan_type === 'strength'` | Gated on **has strength days** — the owner's `custom` plan now renders it |

Deleted (nothing imported them): `WeeklyView`, `WeekMasterBar`, `DayCell`,
`PlanSpine`, `ModeSwitch`, `LoadStrip` (training), `ConformitySummaryCard`,
`PlanGoalsStrip`, `MissedDayPopover`, `AdaptiveSuggestionsCard`, `WeekAheadCard`,
`review/ConformityTrendCard`, `plan/LintPanel`, `plan/UnplannedStrip` — 14 files,
~3,600 lines.

New: `lib/training/coverage.ts` (pure derivation, 15 unit tests) and
`components/training/week/*` (spine, rail, rows, empty week, changes panel, plan
coverage, plans modal, events view, add-session picker).

## The load-bearing decision

**Coverage, not completion.** `completed_days / day_count` counts *authored* days,
so a 20-week plan whose written content stopped on 15 Oct — with every authored
day ticked — read as "96%". That single denominator is why the rest of the page
talked about training that did not exist: the adaptive engine said "stick to the
plan", conformity said "87%", and the week under all of it was empty.

`planCoverage()` is asserted against a fixture shaped like the real plan
(2026-08-24 → 2027-01-10, authored days ending mid-week 8): 8/20 weeks, 12 empty,
19 days stale, current week unwritten.

## Deviations from the lab contract

1. **Events keep their own view** (`?view=events`) instead of becoming markers on
   the coverage strip. An event carries a result panel, an AI prep card and a PDF
   export — that is a surface, not a strip. Removing a working one to honour a
   drawing would be the wrong trade.
2. **"Extend the plan" and "Write this week" are not offered.** Both need
   endpoints that do not exist (`POST /{id}/extend`, `POST /{id}/weeks/{n}`). The
   empty week offers **Add a session**, which works today via `POST /{id}/days`.
   A button that cannot keep its promise is worse than no button.
3. **The plan table drops logged TSS and volume.** The week payload carries
   actuals; the plan list does not, and fetching 20 week payloads to fill a table
   is the wrong trade. Columns are Week · Dates · Sessions · Planned · State.
4. **Blocks live behind a button** on the Plan surface ("Blocks & phases"),
   because the derived histogram that used to open the editor is gone.

## Unverified — read before merging

- **The e2e suite runs and the page renders, but 8 of 10 cases fail.** Observed,
  not assumed: `npx next start -p 3010` + `playwright.local.config.ts` (the repo
  config hardcodes `port: 3000` with `reuseExistingServer: true`, so on a machine
  where another checkout already serves :3000 the suite silently tests *that*
  build — it did, on the first attempt).
  - Passing: the two-surface tab bar, and the empty-plan-list state.
  - **Blocking:** the page renders the spine, the Week/Plan tabs and the week nav,
    then shows `Couldn't load plans` — `plansQuery` errors under the e2e fixture,
    so no plan, no coverage, no rows. Everything downstream of that fails.
  - Not yet diagnosed. First place to look: the fixture handler for
    `api/v1/training-plans` (`e2e/fixtures/authenticated-test.ts:348`) returns
    summaries for the collection and a plan for `/{id}`; something in the new
    page's request shape or query set is not matching it.
- **Nothing beyond the error state has been visually reviewed.** The design was
  proven in the lab (`prototype/training/qa/out/contact-sheet.png`, ten frames,
  measured audits); this implementation has only been seen as an error card.
- **Unit tests:** `src/__tests__/training-coverage.test.ts` — 15 passing.
- **Typecheck:** clean, and clean again after deleting the 14 components.
- **Build:** `npm run build` succeeds.

## Docs still to update (do this in the same PR)

- `frontend/src/CODEMAP.md` `/training` row — still describes WeeklyView, the
  mode switch and the load-strip header.
- `AGENTS.md` — the "Training page overhaul" bullet in *Active Planning*.
- `training-redesign-plan.md` §15 — mark Phases 0–4 superseded by this port.

## Backend gaps this port makes visible

1. `POST /training-plans/{id}/extend` — the common state is a plan that ran dry.
2. `POST /training-plans/{id}/weeks/{n}` — writing a week is 7 partial calls today.
3. Coverage on the plan summary (`weeks_written`, `last_session_date`) — it is
   derived client-side from a full plan payload, which is correct only while that
   payload stays small enough to send.
