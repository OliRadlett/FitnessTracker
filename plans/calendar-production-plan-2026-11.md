# Calendar overhaul — production plan

> **Status:** Phase 1 (endpoint) and Phase 2 (frontend port) landed 2026-11-05;
> the production gate + PR are next.
> **Source artifact:** `prototype/calendar/qa/out/contact-sheet.png` — the lab lives in a
> separate prototype worktree and is deliberately **not** merged into this branch.
> **Decisions / references:** `prototype/calendar/DECISIONS.md`, `prototype/calendar/REFERENCE.md`
> (same prototype worktree).
> **Rule:** port the decisions, not the prototype code. The lab is not merged.

---

## 0. Phase 1 status — 2026-11-05

**Backend endpoint landed on `feature/calendar-overhaul-2026-11`.**

| File | Change |
|---|---|
| `backend/app/api/calendar.py` | `GET /api/v1/calendar?start=&end=&plan_id=` |
| `backend/app/services/calendar.py` | Range assembly, weekly rollups, coverage, per-section degradation |
| `backend/app/schemas/calendar.py` | Response models |
| `backend/app/main.py` | Router registered |
| `backend/app/services/lifting.py` | `list_sessions(start_date=, end_date=)` for the calendar (no all-time fetch) |
| `backend/app/api/lifting.py` | `GET /lifting/sessions` exposes the same optional range |
| `backend/tests/integration/test_calendar_api.py` | 11 tests: dense days, plan/actual/lift/metric/sleep, standalone lift visibility, missing strength target, range cap, explicit/unknown plan, events/goals, cross-user exclusion, Wahoo exclusion, paired strength dedupe, lifting range |

**Verified**

- `11 passed` for the new calendar endpoint tests.
- `62 passed` for the existing lifting + activities integration suites (the
  `list_sessions` signature change is additive).
- A read-only run against the real local DB (583-activity account) returned a
  populated 62-day range with correct weekly TSS and current CTL/ATL/TSB. The
  local DB has **no training plan** and only 4 lifting sessions, so plan/lifting
  composition is covered by the integration tests, not that read.
- The goals/events raw queries did not raise; `unavailable` stayed empty. The
  prod `/goals` 500 is therefore an enrichment/serialization failure, not a
  reason to omit goal targets from the calendar.

**Constraint discovered:** the range cap is 62 days, so the lab’s 10-week
fixture is **not** one API request. The production page requests the visible
month grid plus a week (≤42 days), which is inside the cap. The fixture remains
a lab artifact; it is not the endpoint contract.

**Phase 2 complete:** see 0b. The lab remains the visual artifact and is not
merged.

---

## 0b. Phase 2 status — 2026-11-05

**Frontend port landed on `feature/calendar-overhaul-2026-11`.**

| File | Change |
|---|---|
| `frontend/src/app/(app)/calendar/page.tsx` | Replaced; React Query + URL state (`?month=&view=&day=`) + `Modal` day sheet |
| `frontend/src/components/calendar/` | `MonthGrid`, `DayCell`, `DayInspector`, `Agenda`, `SummaryStrip`, `calendarUi` |
| `frontend/src/lib/calendar.ts`, `calendarFormat.ts` | Pure status/load/grid helpers + formatting |
| `frontend/src/lib/api/calendar.ts`, `types/calendar.ts` | Typed `getCalendar()` client and response types |
| `frontend/src/components/calendar/CalendarAgendaView.tsx`, `DayDetailPanel.tsx` | **Deleted** (old all-time lifting fetch / notes editor) |
| `frontend/src/__tests__/calendar.test.ts` | 7 unit tests (grid, status, off-date, dedupe, coverage, insight) |
| `frontend/e2e/calendar.spec.ts` | 14 production-surface tests: URL state, month nav, inspector, empty/error/loading, mobile sheet, no overflow, visual capture |
| `frontend/e2e/fixtures/calendar-mock.ts` + `authenticated-test.ts` | New endpoint mock |
| `frontend/playwright.calendar.config.ts` | Calendar-only harness on port 3100 (avoids another checkout's 3000) |

**Verified**

- `tsc --noEmit` clean.
- 7/7 helper unit tests pass.
- 14/14 calendar e2e tests pass against the app shell with mocked API.
- Production build succeeds; `/calendar` is 27.3 kB / 146 kB first load.
- Dark, light, mobile agenda, and mobile sheet captured in
  `frontend/e2e/screenshots/` (gitignored).
- Light tokens verified by `data-theme="light"`; the Settings toggle uses the
  same attribute via `ThemeProvider`.

**Production constraint discovered:** at 1440 with the sidebar, the content width
is ~1136 px. A 300 px inspector + 44 px week gutter leaves ~103 px day cells
(short chips `Push 60m` / `96 TSS` fit; the old `Push · 60m` did not). The side
inspector is therefore only shown at `min-[1440px]`; below 1440 the grid gets the
full width and the inspector sits below at max 760 px. This is a deliberate
adaptation of the “persistent inspector at ≥1280” draft to the real shell; the
calendar stays legible at 1280–1439.

**Next:** run the production gate against the real API/prod-shaped data (auth,
a 200+ activity month, slow network, PWA, axe), then open the PR. The prototype
lab remains the visual artifact and is not merged.

---

## 1. Scope

Replace `/calendar` with a **read-first unified training calendar**:

- Desktop: month grid + persistent day inspector.
- Mobile: month-scoped agenda + day sheet.
- Planned sessions, completed activities/lifts, recovery/sleep, events, goal
  target dates, weekly planned-vs-actual load.
- Actions deep-link to `/training`, `/activities?activity=`, `/lifting?session=`,
  `/lifting/live`.
- No inline edit/reschedule/drag in v1.

Out of scope: ICS/Google/Outlook, notifications, coach/multi-athlete/timezones,
AI generation, year heatmap, new sport types, schema changes for planning
targets (separate work).

---

## 2. Data contract

### Endpoint

`GET /api/v1/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD[&plan_id=UUID]`

- Auth: `get_current_user`; all rows user-scoped.
- Range: max **62 days** (a month grid plus one week either side). Reject larger
  with 422, or clamp and return `truncated: true`.
- Default plan: the active plan (`status = 'active'`); if more than one, the
  most recently started; `plan_id` overrides. If none, return the calendar
  without plan days (not an error).
- Timezone: dates are the user’s stored dates. Activities are bucketed by
  `cast(start_date as date)` as the current endpoint does; document that this is
  the server’s date interpretation, not a new timezone feature.

### Response (shape)

```jsonc
{
  "range": { "start": "2026-08-31", "end": "2026-11-08" },
  "today": "2026-11-04",                 // server date, used only for status
  "plan": { "id": "...", "name": "...", "start_date": "...", "end_date": "...", "status": "active" } | null,
  "coverage": {
    "planned_sessions": 46,
    "target_sessions": 4,
    "planned_tss": 594,
    "strength_targets_missing": 42
  },
  "days": [
    {
      "date": "2026-09-19",
      "plan": [ { "id": "...", "sport": "strength", "planned_type": "easy",
                  "planned_focus": "pull", "planned_tss": null,
                  "planned_duration_min": 60, "completed": true,
                  "actual_lifting_session_id": "..." } ],
      "activities": [ { "id": "...", "sport_type": "cycling", "name": "Cycling",
                        "duration_seconds": 7514, "distance_meters": 43100,
                        "tss": 69.2, "normalized_power": 140,
                        "average_heartrate": 148, "elevation_gain_meters": 261,
                        "ride_context": { "intensity_factor": 0.7 } } ],
      "lifts": [ { "id": "...", "focus": "Pull", "total_volume_kg": 6432,
                   "estimated_tss": 60.8, "set_count": 18,
                   "sets": [ { "exercise_name": "Bicep Curl", "set_number": 1,
                               "weight_kg": 20, "reps": 15, "is_warmup": false } ] } ],
      "metric": { "recovery_score": 61, "hrv_ms": 54.5, "resting_hr": 56,
                  "strain": 16.8, "sleep_duration_minutes": 363 },
      "sleep": { "total_sleep_seconds": 21780, "sleep_efficiency": 91 }
    }
  ],
  "weeks": [
    { "week_start": "2026-09-14", "week_end": "2026-09-20", "iso_week": 38,
      "planned_sessions": 6, "completed_sessions": 6, "target_sessions": 1,
      "planned_tss": 96, "actual_tss": 496, "unplanned_actuals": 1 }
  ],
  "events": [ { "id": "...", "date": "2026-09-27", "name": "Autumn TT",
                "event_type": "race", "target_tss": 180 } ],
  "goals": [ { "id": "...", "metric": "ftp_watts", "target_value": 280,
               "target_date": "2026-09-27" } ],
  "current": { "ctl": 21.1, "atl": 19.0, "tsb": 2.0, "recovery": 85,
               "sleep_hours": 7.3 },
  "unavailable": { "goals": "endpoint 500", "events": null }
}
```

### Rules

- **Never fake load.** A strength plan day has `planned_tss: null` unless the
  plan actually stores one. `coverage` reports how many sessions carry a target;
  the UI shows it. Do not estimate from duration.
- **Never infer a missed day from a missing actual alone.** A plan day is
  `missed` only when past, not completed, and no linked actual.
- **Off-date links are data.** If a plan day’s linked activity/lift has a
  different date, return both `linked_date` and `off_date: true`; UI labels it
  `Unconfirmed`, not `Missed`.
- **Dedupe the strength activity.** A strength `Activity` and a `LiftingSession`
  on the same date are one session; the lift carries the sets. Count it once in
  load and “logged”.
- **Degrade per section.** If `goals` or `events` fails, return `unavailable`
  and the rest of the payload; never 500 the whole calendar.
- **Cap the work.** One query per domain; no N+1; no streams; no GPS; no
  all-time lifting fetch. Lifting sessions must be filtered by date range.
- **No schema change for v1.** Derive weekly totals and coverage. A later
  strength-target change belongs to the plan generator, not this endpoint.

### Backend files

| File | Purpose |
|---|---|
| `backend/app/api/calendar.py` | Router, validation, auth, response model |
| `backend/app/services/calendar.py` | Range queries + assembly, weekly rollups |
| `backend/app/schemas/calendar.py` | Pydantic v2 response models |
| `backend/app/services/lifting.py` | Add a date-range filter to `list_sessions` (the current endpoint only filters one date) |
| `backend/app/main.py` | Register the router |

### Queries (one each)

1. `TrainingPlan` active + `TrainingPlanDay` in range (join plan).
2. `Activity` in range, selected columns + `ride_context` (no streams/GPS).
3. `LiftingSession` in range with `selectinload(sets)` (date range!).
4. `DailyMetric` in range, deduped by date preferring `whoop` (same rule as the
   current endpoint).
5. `SleepLog` in range.
6. `Event` in range.
7. `Goal` target dates in range (best-effort; 500 today → `unavailable`).
8. Current CTL/ATL/TSB/recovery from the existing training-load/readiness
   service (or a small snapshot query).

### Tests

- Unit: status rules (done/partial/missed/mismatch/done-unlogged/rest),
  off-date link, dedupe, weekly rollups, coverage, date ranges, DST boundaries
  (`addDays`, not `+86400000`).
- Integration: a real month fixture (the lab’s `data/month.json` shape) through
  the endpoint; an empty account; a plan with no days; goals/events failure
  degradation; >200 activities (pagination/cap); a standalone-lift-only day.
- Contract: response snapshot (golden JSON) diffed in CI.

---

## 3. Frontend

### Files

```
frontend/src/app/(app)/calendar/page.tsx        # data + URL state + layout
frontend/src/components/calendar/
  CalendarHeader.tsx
  SummaryStrip.tsx
  MonthGrid.tsx
  DayCell.tsx
  Agenda.tsx
  DayInspector.tsx
  DaySheet.tsx                                  # Modal-based mobile sheet
frontend/src/lib/calendar.ts                    # pure status/load/date logic
frontend/src/lib/api/calendar.ts                # typed client
frontend/src/lib/api/types/calendar.ts          # response types
```

### Patterns

- `'use client'`, `useAuthFetch`, React Query
  `['calendar', start, end, planId]`, `enabled: !!token`.
- URL state: `?month=YYYY-MM&view=month|agenda&day=YYYY-MM-DD`; `writeParams`
  with `replaceState`; preserve `?activity=`/`?session=` when landing from a
  deep link. No local-only month/day state.
- Reuse `Card`, `PageHeader`, `ErrorState`, `EmptyState`, `Skeleton`,
  `SegmentedControl`, `Modal`/`MobileRouteDetailSheet` pattern, `useToast` for
  the rare action.
- `DaySheet` must use the app’s `Modal` (portals to `document.body`, sets
  `<main inert>`); do not build a custom focus trap.
- Dark **and light** theme: use the CSS tokens (`bg-surface`, `text-muted`,
  `border-surface-light`), never hard-coded hex. The lab is dark-only; the
  production gate must include light.
- Unit tests for `lib/calendar.ts`; e2e for the 11 frames, keyboard, sheet,
  empty/error, mobile overflow.

### Component rules

- `DayCell`: shape-first status (dashed planned, solid completed, hatch missed,
  dotted+circle unplanned); 3 chips max; `aria-label` carries date + counts +
  status; keyboard operable.
- `DayInspector`: planned, actual, health, events/goals, deep links. Read-only;
  no mutation hooks (see `docs/review-vs-act.md`).
- `SummaryStrip`: desktop four cards + coverage line; mobile compact single
  strip (the first-screen gate).
- `Agenda`: month-scoped; compact rest rows; quiet-day runs; quiet-week collapse;
  fixture/range boundary is a note, never invented “no sessions”.
- No sport filter (cut); no three recovery thresholds; no future dimming.

### Page layout

- ≥1280: month grid + 360 px sticky inspector.
- 1024–1279: month grid full width, inspector below in a two-column band or a
  drawer; test at 1280 exactly.
- <1024: agenda + day sheet; compact summary.
- Light theme + `prefers-reduced-motion`; no animation required.

---

## 4. Performance

- Range cap 62 days; one request; target p95 < 300 ms server-side on prod data.
- No streams/GPS in the payload; activity rows are summary-sized.
- Lifting sets only for the range; cap sets per session if a session is huge
  (the inspector shows the first 3 exercises + “+N”).
- Cache: `staleTime: 60_000`; invalidate on activity/lift/plan mutations if the
  page is open (or rely on refetch on focus).
- Query size: a dense month could be ~100 activities + ~40 lifts; select only
  rendered columns. If a month exceeds 500 activities, return a `truncated` flag
  and a count rather than silently dropping rows.

## 5. Migration and cleanup

1. Add the endpoint + types + tests; keep `/activities/calendar` until the new
   page is verified.
2. Port the lab components into `frontend/src/components/calendar/`; replace the
   page; delete the old `CalendarAgendaView` and `DayDetailPanel` in the same
   change.
3. Remove the old local state, `sportFilter`, the three recovery thresholds, and
   the `+86400000` date math.
4. Update `frontend/src/CODEMAP.md`, `AGENTS.md` (calendar bullet), and
   `plans/` with the shipped status.
5. No DB migration. Do not “fix” the prod goals/export 500s inside this change;
   they are separate bugs.
6. Keep `/activities/calendar` only if another consumer exists; otherwise delete
   it and its schemas (`ActivityCalendarEntry`, `CalendarDayData`) after the
   switch.

## 6. Quality gate (production surface)

Re-run the lab’s G1–G8 on the real page with real auth, plus:

- **Light theme** at 1440 and 390; contrast of muted/secondary text.
- **375 / 390 / 412 px** widths; no horizontal scroll; 44 px targets.
- **200+ activity month** (seeded/test account) and a month with no plan.
- **Slow/3G**: skeleton, no layout shift; error + retry; offline.
- **DST boundary** (Europe/London 25 Oct 2026) — day navigation and “next day”.
- **Deep links**: `/calendar?day=…` lands with the day selected; activity/session
  links return correctly.
- **PWA/service worker**: calendar API calls are network-only; no stale month.
- **A11y**: keyboard grid navigation, focus visible, dialog focus trap, screen
  reader labels; `axe` smoke test.
- **Real prod fixture** again: one month with a missed day, an off-date link, a
  standalone lift, and an unplanned ride.
- **Performance**: p95 < 300 ms; no all-time lifting query.

## 7. Risks

| Risk | Mitigation |
|---|---|
| `GET /goals` 500 | Ship without goal markers; `unavailable.goals`; fix separately |
| `GET /export/json` 500 | Separate data-portability bug; not a calendar dependency |
| No strength `planned_tss` | Coverage line; do not estimate; plan-generator work later |
| Off-date plan links | `off_date`/`linked_date`; label `Unconfirmed`; fix the editor later |
| Plan has no days after 6 Nov | Calendar reveals the gap; plan builder needs a warning |
| Light theme contrast | Tokens + screenshots; gate |
| Large months | Range cap + `truncated`; selected columns |
| Duplicate strength activity/lift | Dedupe by date + lift presence; test |
| Mode ambiguity (PLAN vs REVIEW) | Decide before shipping: if read-only, move to REVIEW; if plan-forward, keep PLAN with explicit actions |

## 8. Definition of done

- The production page renders the 11 states with real auth and real data.
- G1–G8 pass on the production surface, dark and light, 375–1440.
- The endpoint contract test + unit tests pass; no N+1; p95 < 300 ms.
- Old calendar components are deleted; CODEMAP/AGENTS/plans updated.
- No prototype code is merged; the lab stays as evidence or is deleted.
- The next step is explicit: deploy via `main` → `prod` PR, or stop if the
  quality gate fails.
