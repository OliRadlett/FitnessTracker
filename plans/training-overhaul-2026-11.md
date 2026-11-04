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
2. **"Extend the plan" and "Write this week" are now backed by a real endpoint.**
   `POST /{id}/extend` copies the last written week's weekday pattern into empty
   dates up to `until`. The empty week offers **Write this week** (until that
   week's Sunday) and **Extend to ⟨plan end⟩**, both one call, plus a per-day
   chooser for one-offs. Nothing is offered that cannot keep its promise.
3. **The plan table drops logged TSS and volume.** The week payload carries
   actuals; the plan list does not, and fetching 20 week payloads to fill a table
   is the wrong trade. Columns are Week · Dates · Sessions · Planned · State.
4. **Blocks live behind a button** on the Plan surface ("Blocks & phases"),
   because the derived histogram that used to open the editor is gone.

## Verified

- **`tsc --noEmit` clean**; `npm run build` succeeds.
- **Unit tests:** `src/__tests__/training-coverage.test.ts` — 15 passing.
- **e2e:** `e2e/training.spec.ts` — **12/12 passing** against a locally started
  build (`npx next start -p 3010`, `playwright.local.config.ts`), including both
  empty-week actions and their POST bodies.
- **Backend:** `tests/test_plan_extend.py` — 8 passing; `tests/integration/test_extend_plan.py`
  — 4 passing against Postgres; `test_multi_sport_days.py` and `test_plan_review.py` still
  green (35 total). `ruff` clean.
- **Rendered and reviewed** at 1440×900 and 390×844, both surfaces. Screenshots:
  `frontend/e2e/out/*.png` (gitignored), captured by `e2e/capture-training.spec.ts`.
- **Type floor closed:** the smallest computed font on all five captured frames is
  **12 px** and horizontal overflow is **0**. `components/training` had 116
  occurrences of 9–11 px text before this work; it has none. The last one was the
  shell's `⌘K` hint, which is why the audit read 11 px until it was bumped.

### Two harness bugs found by doing this — both worth fixing repo-wide

1. **`playwright.config.ts` hardcodes `port: 3000` with `reuseExistingServer: true`.**
   On a machine where another checkout is already serving :3000, the suite
   silently tests *that* build. It did, on the first run here: eight failures
   against the old page. `playwright.local.config.ts` exists to make the target
   explicit.
2. **The PWA service worker escapes `page.route()`.** In a production build the
   SW re-issues `/api/v1/*` fetches from its own context, so the plan-detail and
   week requests bypassed the mocks and hit the real backend (`401 Invalid
   token`). It presented as an application bug. `serviceWorkers: 'block'` in the
   Playwright config is the fix, and it likely explains other flakiness in this
   suite.

### Six defects the first render exposed (all fixed)
1. **A wall of alarm-red.** The plan grid and table derived "missed" from
   `completed: false`, which the plan payload carries but `day_status` does not —
   four historical weeks painted red while the week view (which has `day_status`)
   said "Done". Now: done / no-completion-recorded / rest / not-written, and
   "missed" is only ever claimed where the server said so.
2. **"0 of 7 weeks have no sessions"** rendered as a caution banner. Suppressed;
   the callout now states the positive case in neutral type.
3. **Header range disagreed with the rows** ("27 Jul – 9 Aug" over rows 3–9 Aug),
   because the header used plan math while the rows had moved to the payload's
   `week_start`.
4. **Rest days showed "0 TSS"** — a measurement where there is none.
5. **The mobile spine clipped its plan switcher** to "Base Buildin…" and pushed
   the overflow menu off the row.
6. **The mobile status pill sat above the row title**, reading as two lines for
   one session.

## Still owed

- `frontend/src/CODEMAP.md` `/training` row — **done**.
- `AGENTS.md` "Training page overhaul" bullet — **done**.
- `training-redesign-plan.md` §15 — **marked superseded**.
- **Backend gaps** (§"Backend gaps" above) are the only substantive work left before this can be
  considered finished rather than merely shipped.

## Docs still to update (do this in the same PR)

- `frontend/src/CODEMAP.md` `/training` row — still describes WeeklyView, the
  mode switch and the load-strip header.
- `AGENTS.md` — the "Training page overhaul" bullet in *Active Planning*.
- `training-redesign-plan.md` §15 — mark Phases 0–4 superseded by this port.

## Backend gaps

**Closed (2026-11-04):** `POST /training-plans/{id}/extend` — the common state is a
plan whose written content stops weeks before its `end_date`, and nothing could
write the rest except authoring every day by hand. One primitive now serves both
empty-week actions: copy the last written week's weekday pattern into every empty
date up to `until`. Fill-only-empty, so it is idempotent and cannot overwrite
authored work; it also raises `end_date` when asked to go past it. Service in
`services/training_plan.extend_plan`, endpoint + schemas, 8 unit tests in
`tests/test_plan_extend.py` and **4 integration tests against real Postgres** in
`tests/integration/test_extend_plan.py`. The plan-level `completed` column is never
copied, and neither are the actual links or the Wahoo ids.

The integration suite earned its place immediately: against a stub the endpoint
looked idempotent, and against Postgres a retry re-created two days it had just
written. `extend_plan` had derived the pattern, the last written date and the
occupied dates from `plan.days` — an identity-mapped relationship, so a session
that had already loaded the plan kept serving the pre-write collection. It now
reads the days with an explicit query, and the guarantee no longer depends on
identity-map behaviour.

**Still open:** coverage as a first-class field on the plan summary
(`weeks_written`, `last_session_date`). It is derived client-side from the full
plan payload, which is correct only while that payload stays small enough to send.
`POST /{id}/weeks/{n}` turned out not to be needed — `extend` with `until` = the
week's Sunday is the same operation, with one code path instead of two.
