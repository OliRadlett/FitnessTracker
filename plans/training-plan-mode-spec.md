# Plan Mode — Phase 1 Implementation Spec

> **Status**: v1 — design for review. Implements **Phase 1** of [`training-redesign-plan.md`](training-redesign-plan.md) (§5.1 + §3, the "one editor" model).
> **Depends on**: Phase 0 (shipped on `feature/training-editor-primitives`: the shell, `useInstantDayEdit`, `usePlanDayOps`, the three day endpoints, `planDayCache`).
> **Goal**: Replace the temporary **Build | Week** toggle and the standalone `WorkoutPlanner` with **one Plan mode**: the week is the primary surface, any day opens the same `DayEditor`, field edits commit instantly, and structural changes are discrete atomic operations.

---

## 1. Delta from Phase 0

| Phase 0 (now) | Phase 1 |
|---|---|
| Plan mode hosts a `PlanBuilder \| WeeklyView` toggle | One `PlanMode`; the toggle is deleted |
| `PlanBuilder.tsx` (1765 lines) + `WeeklyView.tsx` (950) | Split into `PlanMode` + `DayEditor` + `AllWeeksGrid` + `CreatePlanPanel`; both files deleted |
| `WorkoutPlanner.tsx` standalone section | `PrescriptionPanel` inside the day editor; file deleted |
| `useInstantDayEdit` / `usePlanDayOps` built but unused | Wired: field edits instant; move/swap/add/delete/substitute atomic |
| V3 "Move to next day" swaps content | Real `reschedule` (+409) / `substitute` (+422) |
| WeatherForecast still has emoji | De-emoji'd; relocated into Plan mode |
| No unplanned surface | `UnplannedStrip` (`GET /{id}/unplanned`) |

**Out of Phase 1**: Review-mode charts (§2 of the redesign plan), Peaks mode + load strip (Phase 3), the mobile sheet pass (Phase 4), progression/rules (companion `S1`).

---

## 2. Plan mode layout

```
[ ‹ ]  Week 3 of 6 · 12–18 Aug  [ › ]  [Today]      [ Week | All weeks ]
  Readiness · TSB projection · ConformitySummary · PlanGoalsStrip · adaptive hint
  ┌─ WeekMasterBar: 7 × DayCell ──────────────────────────────────────┐
  │ Mon   Tue    Wed     Thu     Fri     Sat    Sun                   │
  │ rest  done   Z2      str     ⚠missed cycle  today                 │
  └───────────────────────────────────────────────────────────────────┘
  click a day → DayEditor (inline, below the strip)
  drag card → swap (occupied) / move (empty);  ⇄ Move/Swap in the editor (touch)
  [ unplanned sessions: 1 → ]
  [ All weeks ] → per-week summary cards (ΣTSS, rides/strength/rest); click a week to zoom in
```

- **Week scope is the default**; `?week=` selects the week (existing `getCurrentWeek` maths). The **spine** owns plan-level nav; Plan mode owns the week stepper (resolves the redesign's open question in favour of the spine owning plan-level nav only).
- **All-weeks** is a zoom (`?view=all`), not a second editor: it shows the `weekSummaries` cards (ΣTSS, ride/strength/rest counts) and clicking one sets `?week=` + `?view=week`.

---

## 3. `DayEditor` — the single editing surface

Rendered **inline below the week strip** (desktop and mobile, as `WeeklyView`'s `ExpandedPanel` does today). A bottom sheet is the **Phase 4** mobile refinement — keeping it inline now avoids a breakpoint-dependent render path.

Takes a `TrainingWeekDay` (week payload gives actuals/conformity/weather/route matches), the `planId`, and the visible `week`.

| Section | Controls | Commit |
|---|---|---|
| Header | sport/type badges, date, close | — |
| Sport / type / duration | selects + number | instant (`useInstantDayEdit`) |
| **Cycle** | zone/power/IF/TSS (from `preview-workout`), route (picker + **Find matching routes**), Wahoo push/remove | instant / modal |
| **Strength** | focus, target RPE, warm-up template, exercise list (`ExerciseAutocomplete`), computed volume, `%1RM` suggest | instant |
| Text | workout description, notes | **600 ms debounce + flush on blur** |
| Actual | `actual_activity` / `actual_lifting_session`, **`DayConformityPanel`** | read-only |
| Actions | **Move to date** · **Swap with date** · Duplicate to date · **Delete session** · Copy from session · Push to Wahoo | atomic ops (confirm) |
| Completion | `completed` toggle | instant |

**Removed from today's `DayEditor`/`ExpandedPanel`:** the sticky unsaved-changes footer (nothing to lose — edits are instant) and the "Save the plan first to use Copy/Duplicate" draft gating (there is no draft).

---

## 4. Drag → operation resolver

Drag is fine-pointer only (desktop). Touch uses the editor's Move/Swap actions.

| Drop target | Action |
|---|---|
| A day record, **uncompleted** | **Swap** (`swapDays`) — confirm |
| An **empty slot** (no day record) | **Move** (`rescheduleDay`) — confirm |
| A day record, **completed** | **Blocked** — toast "Completed days can't be moved" |
| The dragged card itself / outside any slot | No-op |

The source card is `draggable`; each slot is a drop target with an accent ring while dragging (as `PlanBuilder` does today). Because a swap needs no free slot, it never hits the `reschedule` 409.

---

## 5. Instant-edit wiring

- Field edits → `useInstantDayEdit(planId, week).mutate({ dayId, payload })`. Optimistic patch of `['plan-week', planId, week]` + `['training-plan', planId]`, rollback on error, derived caches invalidated on settle.
- **Text** (`workout_description`, `notes`): local state → 600 ms debounce → commit; flush on blur/unmount and on day close.
- **Errors**: toast with the server message. **409** (from a structural op) → inline "that slot is taken — next free one?" with a one-tap retry against the next empty date.
- **409 / 400 on structural ops** handled per §6.
- A day edit must also invalidate `['live-plan-today']` (shared with `/lifting`) — already in the hook.

---

## 6. Structural-operation UX

| Op | Flow | Errors |
|---|---|---|
| **Move** | Date picker (or drag to empty) → `ConfirmDialog` → `rescheduleDay` | 409 → offer next free slot; 400 completed/out-of-range → toast |
| **Swap** | Drag (or ⇄ picker) → `ConfirmDialog` naming both days → `swapDays` | 400 completed/self → toast |
| **Delete** | `ConfirmDialog` (danger) → `deleteDay` | 400 completed → toast |
| **Duplicate** | Date picker → `copyPlanDayToDate` (exists) | 400 out-of-range → toast |
| **Substitute** | `MissedDayPopover` (Move / Substitute / Mark rest / Dismiss) → `substituteDay` | 422 bad vocab → validation message |
| **Add** | Click an empty slot → `addDay` (rest default) → open the editor | 409 date taken → toast |

`MissedDayPopover` gains a **Substitute** action (pick an alternate: e.g. missed `hard` → `easy`/Z2 spin) and its Move now calls the real endpoint (Phase 0 wired the clients; Phase 1 wires the UI).

---

## 7. `PrescriptionPanel` — absorbing `WorkoutPlanner`

| `WorkoutPlanner` piece | Fate |
|---|---|
| Zone reference table (`/workout-planner/zones`) | **Move to the cycling page** — it belongs with the power/zone reference, not in the day editor. |
| Readiness banner | **Drop** — the week strip owns readiness. |
| Zone + duration selectors, "Plan Workout" | **Drop** — the day editor's type/duration already drives `preview-workout`. |
| Workout Targets card (power/IF/HR/TSS) | **Already present** via `preview-workout` in the day editor. |
| **Find matching routes** (`/workout-planner/match-routes`) + `FitBar` + `RouteMap` | **Move** into the day editor's cycle section, beside the route picker. |
| RM1 write-back day `<select>` | **Drop** — the editor *is* the target day. |

So absorption is small: port `ExpandableRouteMatch`/`FitBar` into `plan/PrescriptionPanel`, wire it to the day's zone + duration, and delete the 651-line standalone component.

---

## 8. Unplanned strip

`UnplannedStrip` — `GET /{id}/unplanned?days=14` (`getUnplannedActuals`, key `['plan-unplanned', planId]`). Lists extra activities/sessions with **Assign to a day** (opens a day picker → `updatePlanDay { activity_id }`… see open Q6) and **Ignore** (session-local dismissal). Renders nothing when empty.

---

## 9. Weather + strips

- `WeatherForecast`: de-emoji (`🌦️`/`💨`/`💧` → lucide `CloudSun`/`Wind`/`Droplets`) and keep it at the top of Plan mode as a **collapsible** strip (per-day weather already rides on `DayCell`).
- Readiness, TSB projection, conformity summary, goals strip, adaptive hint, strength suggestions: unchanged, moved verbatim into `PlanMode`'s header stack.

---

## 10. Component plan

**New**
| Path | Purpose |
|---|---|
| `components/training/plan/PlanMode.tsx` | Week/all-weeks scope, nav, strip stack, master bar, editor host, unplanned strip. |
| `components/training/plan/DayEditor.tsx` | The single editing surface (§3). |
| `components/training/plan/AllWeeksGrid.tsx` | Per-week summary cards (from `PlanBuilder`'s All tab). |
| `components/training/plan/PrescriptionPanel.tsx` | Matching-routes + `FitBar`/`RouteMap` (from `WorkoutPlanner`). |
| `components/training/plan/CreatePlanPanel.tsx` | scratch / template / strength-generation forms (from `PlanBuilder`'s `EmptyState`). |
| `components/training/plan/UnplannedStrip.tsx` | §8. |

**Extracted / modified**
- `DayCell` — gains `onDragStart`/`onDragOver`/`onDrop` props (Build-mode drag) while keeping its Week read behaviour.
- `MissedDayPopover` — add Substitute.
- `WeatherForecast` — de-emoji.
- `training/page.tsx` — Plan mode renders `PlanMode`; the Build|Week toggle and `WorkoutPlanner` are removed.

**Deleted**
- `PlanBuilder.tsx`, `WeeklyView.tsx`, `WorkoutPlanner.tsx`.

**Extraction safety**: before deleting, port in this order — (1) `CreatePlanPanel` from `EmptyState`, (2) `DayEditor` from `PlanBuilder.DayEditor` + `WeeklyView.ExpandedPanel`, (3) `AllWeeksGrid` from the All tab, (4) the strip stack + modals verbatim, (5) `PrescriptionPanel`. Keep `computedVolumeKg`, `planningFields`, `REST_FIELDS` helpers (move to `lib/training/planDayHelpers.ts`).

---

## 11. State ownership & queries

- **Shell** (Phase 0): mode, plan, `?day=`. **PlanMode**: `week`, `view` (week|all), open day id, modals. **DayEditor**: local text state only.
- Keys unchanged: `['plan-week', planId, week]`, `['training-plan', planId]`, `['plan-conformity', planId]`, `['day-conformity', dayId]`, `['adaptive-suggestions', planId]`, `['strength-suggestions', planId]`, `['tsb-projection', planId]`, `['plan-unplanned', planId]`, `['goals','active']`, `['warmup-templates']`, `['lifting-sessions']`, `['live-plan-today']`.
- Invalidation: field edit via `useInstantDayEdit`; structural ops via `usePlanDayOps` (both already implemented).

---

## 12. Edge cases

- **Completed day**: field edits allowed (notes/targets), but Move/Swap/Delete are refused (server 400) — surface the reason, don't hide the day.
- **Empty slot**: shows "Add session"; `addDay` defaults to `rest`.
- **Out-of-range date**: Move/Duplicate target picker clamps to `plan.start_date…end_date`.
- **Exercise alias**: `normaliseExerciseKey` for matching copy/prefill.
- **Per-arm weights**: respect `PER_ARM_EXERCISES` / `weight_convention()` (pitfall 19).
- **No FTP**: cycle `preview-workout` returns null targets → show "Set FTP on Cycling" link (as today).
- **Plan with no days**: empty grid + "Add session" on any slot.
- **`?day=` deep link**: opens the week, expands the day, scrolls (Phase 0 behaviour preserved).

---

## 13. Tests & acceptance

**Unit (vitest)**: `planDayHelpers` (volume, planningFields, REST_FIELDS); the drag resolver as a pure function (`resolveDrop(source, target) → 'swap' | 'move' | 'blocked' | 'none'`).
**Component (vitest)**: `DayEditor` renders + commits a field edit (mock `useAuthFetch`); `UnplannedStrip` empty/loaded.
**Acceptance**
- Any day editable in place; a field edit persists and survives a reload.
- Drag onto an occupied slot swaps; onto an empty slot moves; onto a completed day is blocked.
- Move onto an occupied slot surfaces the 409 + next-free-slot retry.
- `WorkoutPlanner` is gone; "Find matching routes" works from the day editor.
- `?plan=&day=` still lands in the week with the day open.
- `tsc` clean; `vitest` green; `next build` OK.

---

## 14. Decisions of record

| Question | Decision | Rationale |
|---|---|---|
| **Day editor surface** | **Inline below the week strip** (desktop and mobile). | Matches `WeeklyView`'s `ExpandedPanel` today and avoids a breakpoint-dependent render path; the bottom-sheet refinement is the Phase 4 mobile pass. |
| **All-weeks view** | **Keep as a `?view=all` zoom.** | Cheap (reuses `weekSummaries`) and the macrocycle overview is genuinely useful for block authoring. |
| **Zone reference table** | **Move to the cycling page.** | It belongs with the power/zone reference there, not in the day editor. |
| **Completed-day editing** | **Allow field edits; block structural ops.** | Correcting notes/targets after the fact is legitimate; move/swap/delete are already refused server-side (400), so surface the reason rather than hiding the day. |
| **Weather strip** | **Keep, collapsible, de-emoji'd.** | The 7-day view helps shuffle sessions around bad weather; per-day weather on `DayCell` is a different granularity, not a duplicate. |
| **Unplanned "Assign to a day"** | **Add `activity_id` / `lifting_session_id` to `TrainingPlanDayUpdate`** (small backend addition) so an unplanned actual can be attached to a chosen day; "Ignore" is a client-side dismissal. | `link-activities` is automatic and date-based, so it cannot target a specific day — which is the entire point of the strip. |

| **Multi-sport day** | **In scope — its own phase** (a date may hold more than one session). | Confirmed a real (if rare) need; the one-`sport`-per-day model must not be painted into a corner. Design lives in [`training-multi-sport-days.md`](training-multi-sport-days.md). |
| **Cycle block progression** | **Deferred, noted.** | Week-by-week authoring for rides is acceptable for now; `duplicate week → range` covers the bulk case. |
| **Phase order** | **E2E guard → Phase 1 → Review → Peaks → mobile.** | Phase 1 is the core value and unblocks the Program matrix; the E2E guard de-risks it. |
| **Strength `S1`** | **Run in parallel with Phase 1** (backend-only, independent). | No shared surface. |
| **E2E guard** | **Add a `/training` Playwright spec first.** | CI has Playwright; there is no browser in the build loop, so the rewrite needs a guard. |
| **`.dsh/` drift** | **Reconcile into `main`** (dedicated chore PR). | The repo's rule is `main`/`prod` content-identity; the bundle is tooling-only. |
| **Create duplication** | **Consolidate** — Plan mode's "no plan" state links to the Plans surface; the create forms live only there. | One create surface. |

**Still open**: none. Anything discovered during implementation goes to the register in [`training-redesign-plan.md`](training-redesign-plan.md) §15.
