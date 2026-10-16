# Training Page Redesign Plan

> **Status**: v4 — implementation-ready spec; **no open questions**. Collaboratively evolved with the user (2026-10-12).
> **Supersedes**: [`v3-planning-2026-10-12.md`](v3-planning-2026-10-12.md) (widget-level pass on an unchanged page).
> **Goal**: Turn `/training` into a **plan-first workspace**: the plan is the persistent spine; one editor edits any day of it instantly; evidence and peaks are their own surfaces; and the two-editor split that made editing confusing is **removed**.
> **Backend is in scope** for this plan (user, 2026-10-12). The editor primitives it needs are small and additive; the training *loops* are sequenced later (§11) but no longer deferred because of a frontend-only constraint.
> **Read next**: [`docs/review-vs-act.md`](../docs/review-vs-act.md) · [`training-aid-review.md`](training-aid-review.md) (the audit this closes the frontend half of) · [`lifting-redesign-plan.md`](lifting-redesign-plan.md) (sibling page, same pattern) · [`training-strength-programming.md`](training-strength-programming.md) (**companion** — the Plan-mode programming capability: per-week targets + weight suggestions) · [`training-plan-mode-spec.md`](training-plan-mode-spec.md) (**Phase 1** implementation spec — the one-editor Plan mode).

---

## 0. Decisions of record (2026-10-12)

| Question | Decision |
|---|---|
| Ambition | Structural overhaul now; training loops sequenced later (§11). |
| Backend | **In scope throughout** — the editor endpoints are build-blocking, not "later". |
| **Editor model** | **One editor.** Field edits are **instant targeted PATCHes**; structural changes are **discrete atomic operations**. No draft, no Save footer, no destructive full-array save from the UI. |
| Shell | **A now → C later** — plan spine + modes, evolving into a macrocycle canvas once blocks exist. |
| Modes | **Plan · Review · Peaks** (+ a Plans surface). Build and Week are **merged into Plan**. |
| Events | Promoted to a **peaks strip** in the spine **and** their own mode. |
| Plans management | **Switcher + Plans surface** (`?mode=plans`). |
| Consolidations | Merge `WorkoutPlanner` (RM1) · Events → peaks timeline · fold periodization + analytics into Review. |
| Mobile | **Parallel mobile design**. |
| "Own today's session" | Not taken — `/today`, dashboard, `/lifting` keep their today surfaces. |
| Open questions | **All five resolved** (2026-10-12) — see §13 / §14. |

---

## 1. Vision

The training page is the athlete's **plan control room**: the active plan is always on screen with its shape, peaks and progress; you edit any day of it **in place** and the change sticks immediately; and you switch once — between *the plan*, *the evidence* and *the peaks* — never between two half-editors.

### Core principles

| Principle | What it means for training |
|---|---|
| **The plan is the spine** | A persistent plan context bar (switcher, progress, peaks strip, actions) frames every mode. |
| **One editor, one save model** | Any day, any week, same editor, edits commit instantly. Removes the two-editor/two-save-model class of bugs outright. |
| **Atomic operations, not array rewrites** | Move / swap / add / delete a day are discrete server operations. The UI never sends a full `days` array. |
| **Action → Data → Insight** | Plan edits → conformity/actuals on the cards → Review teaches → back to Plan. |
| **Reuse, don't rebuild** | The backend already exposes move/substitute/refresh/suggestions/conformity/strength/preview/Wahoo/copy/unplanned and a rich week payload. Wire it. |
| **Gated data** | Periodization/analytics are welcome but live in **Review**, never on the editing surface. |
| **Mobile is designed, not collapsed** | A phone pass, not a shrink of the desktop shell. |

---

## 2. Current state assessment

### 2.1 The page today

`frontend/src/app/(app)/training/page.tsx` (571 lines): `PageHeader` → `LoadSummary` → error banner → `WeatherForecast` → a `lg:grid-cols-3` grid (left: **My Plans** list + **Events** card; right: **Plan Builder \| This Week** toggle → `PlanBuilder` | `WeeklyView`) → full-width `WorkoutPlanner` → trailing periodization `Chart`.

### 2.2 Component inventory (measured)

| Component | Lines | Role | Fate |
|---|---:|---|---|
| `PlanBuilder.tsx` | 1765 | Macrocycle authoring (`EmptyState` + `PlanEditor` + `DayEditor`), **draft + destructive full-array save** | **Absorbed** into `plan/DayEditor` + `plan/AllWeeksGrid` + `plan/CreatePlanPanel`; file deleted |
| `WeeklyView.tsx` | 950 | One-week execution + conformity + `ExpandedPanel`, **targeted PATCH** | **Absorbed** into Plan mode; file deleted |
| `WorkoutPlanner.tsx` | 651 | Standalone prescription engine + route matching | **Deleted** → `plan/PrescriptionPanel` |
| `DayCell.tsx` | 294 | Day card (status, badges, planned/actual, weather, goals) | Keep — the Plan-mode card |
| `WeekMasterBar.tsx` | 97 | Responsive 7-day strip | Keep → Plan mode |
| `ConformitySummaryCard.tsx` | 105 | Conformity strip | Keep → Plan + Review |
| `ConformityBadge.tsx` | 69 | Tiny status badge | Keep |
| `DayConformityPanel.tsx` | 249 | Per-day plan-vs-actual | Keep → Plan day editor |
| `MissedDayPopover.tsx` | 87 | Missed-day quick actions | Keep → rewire to real move/substitute |
| `PlanGoalsStrip.tsx` | 71 | Active-goals strip | Keep → Plan + Review |
| `AdaptiveSuggestionsCard.tsx` | 125 | Weekly adaptive advice | Keep → Review (primary), Plan (hint) |
| `StrengthSuggestionsCard.tsx` | 136 | Weight updates from conformity | Keep → Review (+ Plan day editor) |
| `RoutePickerModal.tsx` | 139 | Assign route | Keep |
| `WahooPushModal.tsx` | 167 | Push cycle day to Wahoo | Keep |
| `EventResultPanel.tsx` | 312 | Race result + retrospective | Keep → Peaks |
| `EventAiAnalysisCard.tsx` | 36 | Race-prep AI | Keep → Peaks |
| `WeatherForecast.tsx` | 132 | 7-day forecast (has emoji) | Move → Plan, de-emoji |
| `NextSessionCard.tsx` | 106 | Verdict suggestion | Out of scope (`/today`) |
| `dayCellShared.ts` | 96 | Sport icons / status / formatters | Keep + extend |

### 2.3 The problem: the Build/Week split welds three axes

The split isn't "planning vs doing" — it fuses three independent axes, so **adjacent tasks live in different modes**:

| Axis | Build | Week |
|---|---|---|
| **Time scope** | whole macrocycle | one week |
| **Capability** | edits everything | edits almost nothing (cycle duration/TSS/notes, route, `completed`) |
| **Save model** | draft + **destructive** full-array save | instant targeted PATCH |

Consequences (all confirmed by reading the code):
- "Change today's exercises" forces you into Build — where today's **actuals, weather and conformity don't exist**.
- Toggle `completed` in Week, then let an open Build draft save → **the toggle is silently reverted** (the draft's array is authoritative and deletes dates).
- Controls behave differently in the two screens (swap vs move, add vs duplicate).

### 2.4 Why the split exists (the technical constraint)

| Operation | Mechanism today | One targeted call? |
|---|---|---|
| Edit a day's fields | `PATCH /{id}/days/{day_id}` | ✅ |
| Move a day | `POST /{id}/days/{id}/reschedule` (`training_plan.py:1897`) | ✅ but **uncompleted only**, onto a free slot (409 if occupied), in range |
| **Swap two days** | only the full-array `PATCH /{id}` | ❌ Two reschedules fail — the target is occupied at step one |
| **Add / delete a day** | only the full-array `PATCH /{id}` | ❌ No endpoint |
| Full-array `PATCH /{id}` `days` | `save_plan_days` (`training_plan.py:789`) upserts by date and **deletes dates missing** | destructive |

So exactly **three missing primitives** (add day, delete day, swap days) keep the UI pinned to the destructive array write — and that array write is what forces a draft, which is what forces a mode. Close those three and the split dissolves.

### 2.5 Backend is richer than the page exposes

Verified in `api/training_plans.py` / `schemas/training_plan.py`; all exist:

`GET /{id}/week/{n}` (readiness + weather + bad-weather + actuals + route matches + `day_status` + `targets_stale`) · `PATCH /{id}/days/{id}` · `POST /{id}/days/{id}/reschedule` (+409) · `POST /{id}/days/{id}/substitute` (+422) · `GET /{id}/unplanned` · `POST /{id}/refresh-targets` (FL1+FL3) · `GET /{id}/suggestions` · `GET /{id}/conformity?weeks=` · `GET /{id}/days/{id}/conformity` · `GET /{id}/strength-suggestions` · `POST /{id}/link-activities` · `POST /preview-workout` · `POST /workout-planner/{plan,match-routes,zones}` · `POST/DELETE /{id}/days/{id}/push-to-wahoo` · `POST /{id}/days/{id}/copy-from-session/{sid}` · `POST /{id}/days/{sid}/copy-to-date/{date}` · charts `periodization` / `volume_intensity_periodization` / `combined_training_load` / `weekly_volume` · event result/retro/AI/PDF.

**Missing frontend client fns**: `rescheduleDay`, `substituteDay`, `getUnplannedActuals`, plus the three new ones below.

---

## 3. Editor model — one editor, instant edits, atomic operations

This is the heart of the redesign.

### 3.1 Rules

1. **Any day is editable from the same component** (`plan/DayEditor`), wherever it appears.
2. **Field edits commit instantly** via `PATCH /{id}/days/{day_id}` (targeted; only provided fields change; server recomputes `planned_volume_kg` from `planned_exercises`).
3. **Structural changes are discrete atomic operations**, never a full-array rewrite:
   - **Move** a day → `POST /{id}/days/{id}/reschedule` (exists).
   - **Swap** two days → `POST /{id}/days/{id}/swap` (**new**).
   - **Add** a session on an empty slot → `POST /{id}/days` (**new**).
   - **Delete** a session → `DELETE /{id}/days/{day_id}` (**new**).
   - Generate / activate / duplicate plan → spine + Plans surface.
4. **The UI never sends `days` on `PATCH /{id}`.** That path (`save_plan_days`, destructive) remains for API callers but is off the editing path.
5. **No draft, no sticky Save footer, no Discard.** Because edits are small and instant, there is nothing to lose.

### 3.2 Instant-edit mechanics

- `useInstantDayEdit(planId)` wraps `useMutation` with **optimistic updates**: `onMutate` cancels in-flight queries, snapshots the day in `['plan-week', planId, week]` and `['training-plan', planId]`, and patches the cache; `onError` rolls back + toast; `onSettled` invalidates the affected keys (§6.3).
- **Text fields** (`workout_description`, `notes`) debounce ~600 ms then commit, and **flush on blur/unmount/navigation**; **selects/numbers/toggles** commit on change.
- **Completed toggle** commits immediately (single-field PATCH).
- **Concurrency**: targeted PATCHes on different fields don't clobber each other (server applies only provided fields) — strictly safer than the array write.
- **Safety net for destructive ops**: `Delete`, `Swap`, `Move` and `Substitute` require a `ConfirmDialog` (they can lose or relocate planned content). Per-edit undo for field edits is deliberately *not* built here — see §11 C6, scoped to the structural ops only.

### 3.3 New backend endpoints

| Endpoint | Body | Semantics | Errors |
|---|---|---|---|
| `POST /{plan_id}/days` | `TrainingPlanDayCreate` | Create one day at `day_date` | **409** if a day already exists at that date; **400** if date outside plan range |
| `DELETE /{plan_id}/days/{day_id}` | — | Delete one day | **204**; **400** if completed (preserve history); **404** if not found |
| `POST /{plan_id}/days/{day_id}/swap` | `{target_day_id: UUID}` | Atomically exchange `day_date` between two days | **400** if either day is completed (same rule as delete/reschedule); **404** unknown |

Notes:
- `TrainingPlanDay` has **no `(plan_id, day_date)` unique constraint**, so a swap is two attribute writes flushed together — no constraint fight, no temp-row dance. Add a regression test anyway.
- Swap validates same-plan membership and rejects completed days (same rule as `reschedule`).
- `POST /{id}/days` must reuse `_validate_days`-style validation and must **not** delete anything.
- Add a schema note deprecating `TrainingPlanUpdate.days` (footgun: destructive).
- **Fix the doc bug**: `CODEMAP.md:20` calls the array PATCH a "non-destructive upsert"; `training_plan.py:789` labels it the same while its body deletes. Correct both to say **destructive by omission**.

---

## 4. The shell

```
Training                                     [+ New plan ▾]  [⌄ My Plans]
LoadSummary (CTL/ATL/TSB + 7d TSS + FTP + SyncBadge)   ← cross-page pattern, unchanged
┌─ PLAN SPINE — always visible ────────────────────────────────────────┐
│  Race Plan            active      12 Jul → 20 Sep     21/42 days ▓▓▓░ │
│  [Generate ▾]   [Refresh targets ⚠2]   [Activate]   [⋯]              │
│  Load ▁▂▃▅▆▇▅▆▇▅▄▃   ▲Race (64d)   ▒ taper   ▏ today                  │
└──────────────────────────────────────────────────────────────────────┘
   [ Plan ]   [ Review ]   [ Peaks ]                       ⌄ week nav
   <mode content — the plan never leaves the screen>
```

- **Plan spine**: inline-renameable name; status badge; date range; progress + `targets_stale` pip; actions (`Generate ▾` — **confirm when an active plan already exists** · `Refresh targets (⚠N)` · `Activate` · `⋯` duplicate/archive/delete/export); the derived **load strip** (see §5.4); the **plan switcher**.
- **Modes**: **Plan** (the editor) · **Review** (evidence) · **Peaks** (events). Plans surface via `?mode=plans`.
- **Build-then-rehost**: Phase 0 renders the spine + modes with the existing components rehosted, so each mode is migrated with parity tests rather than a big-bang rewrite.

---

## 5. Mode specs

### 5.1 Plan mode — the one editor

```
[ ‹ ]  Week 3 of 6 · 12–18 Aug  [ › ]  [Today]   [ All weeks ]
  Readiness · TSB projection · ConformitySummary · Goals · adaptive hint
  ┌─ WeekMasterBar: 7 × DayCell ─────────────────────────────────────┐
  │ Mon   Tue    Wed     Thu     Fri     Sat    Sun                  │
  │ rest  done   Z2      str     ⚠missed cycle  today                │
  └──────────────────────────────────────────────────────────────────┘
  click a day → DayEditor (instant edits + plan-vs-actual + actions)
  drag card → swap (occupied) / move (empty);  ⇄ picker on touch
  [unplanned sessions: 1 →]
```

- **Week scope** (default): `['plan-week', planId, week]` for the visible week → cards carry actuals, conformity (`ConformityBadge`), weather, goal hints, today/missed rings. Readiness / TSB projection / conformity / goals / adaptive-hint strips sit above.
- **All-weeks scope**: the per-week summary cards (ΣTSS, rides/strength/rest) for macro structural work; click a week to zoom in.
- **Program scope** (`?view=program`): the **Program matrix** (exercises × weeks) — the **primary** surface for multi-week strength targets, weight suggestions and block tools. See [`training-strength-programming.md`](training-strength-programming.md).
- **The day card is the entry point to the editor.** Clicking any card opens `DayEditor` **in place** (desktop: inline under the strip; mobile: bottom sheet via `Modal`).
- **Drag-and-drop is a structural op resolver**: drop on a day record that is uncompleted → **swap**; drop on an empty slot → **move** (`reschedule`); drop on a completed day → blocked with an explanation. Touch uses the ⇄ swap/date picker (no HTML5 drag).
- **Missed-day actions are real**: `MissedDayPopover` → **Move** (`reschedule`, handle 409 → offer next free day) · **Substitute** (`/substitute`, pick an alternate; 422 guard) · Mark rest · Dismiss.
- **Unplanned strip**: `GET /{id}/unplanned?days=14` → extra activities/sessions with "Assign to a day" / "Ignore".
- **Weather**: the de-emoji'd 7-day forecast folds in here as a collapsible header (per-day weather already rides on `DayCell`).

#### `plan/DayEditor` (the single editing surface)

| Section | Controls | Commit |
|---|---|---|
| Sport / type / duration | selects + number | instant |
| Cycle | zone/power/IF/TSS via `preview-workout`; route (picker); Wahoo push/remove; **`PrescriptionPanel`** (zones reference + readiness + "Find matching routes" with `FitBar`/`RouteMap`) | instant |
| Strength | focus, RPE, warm-up template, exercise list (`ExerciseAutocomplete`), computed volume, **`%1RM` suggest** (`suggestLoad`, stores `pct_1rm`) | instant |
| Text | workout description, notes | 600 ms debounce + flush on blur |
| Actual | actual activity/lifting summary; **`DayConformityPanel`** (plan-vs-actual) | read-only |
| Actions | **Move to date** · **Swap with date** · Duplicate to date (`copy-to-date`) · **Delete session** · Copy from session · push to Wahoo | atomic ops (confirm on move/swap/delete) |
| Completion | `completed` toggle | instant |

### 5.2 Review mode — the evidence

```
┌ Conformity trend (weeks) ─────────┬ Adaptive: what changes next week ─┐
│ overall % · trend ↑/↓/→ ·         │ stance chips · suggestions ·       │
│ per-sport · patterns             │ one-tap apply (AdaptiveSuggestions)│
├───────────────────────────────────┼───────────────────────────────────┤
│ Periodization — planned vs actual │ Volume × intensity periodization  │
├───────────────────────────────────┴───────────────────────────────────┤
│ Combined training load · Strength suggestions · block completion      │
└───────────────────────────────────────────────────────────────────────┘
```
`ChartService` (`periodization`, `volume_intensity_periodization`, `combined_training_load`, `weekly_volume`) via `Chart`; new `ConformityTrendCard` (`getPlanConformity(planId, weeks)`); `AdaptiveSuggestionsCard` (primary home); `StrengthSuggestionsCard`; `PlanGoalsStrip`. The trailing periodization card leaves the editing surface.

### 5.3 Peaks mode — events / races / lifts

`EventResultPanel` (+ its `Retrospective`), `EventAiAnalysisCard`, prep-PDF, taper fields (`target_tss`, `taper_days`, `is_in_taper`), event↔plan link/unlink, and a new `EventForm` that can set **`target_tss` and `notes`** (the current inline form cannot — §12.5).

### 5.4 Load strip (derived) — `LoadStrip.tsx`

The spine strip derives what it can client-side from `['training-plan', planId].days` + `['events']`, and shows **only data that is real** — plus, since C1, the plan's **stored blocks**:
- **Weekly planned-load bars** — Σ`planned_tss` per week (bar height), colour by the week's dominant `sport`.
- **Event markers** — ▲ at `event_date`, coloured by `event_type`.
- **Taper window tint** — from the linked event's real `taper_days`.
- **Today marker**.

It deliberately **invents no phase names**. Since C1 it draws the plan's **stored blocks**
(`training_plan_blocks`) — the user's own names — and a plan with no blocks shows no bands. A
**Blocks** editor on the strip creates and edits them; containment and non-overlap are enforced
server-side, so an overlap comes back as a 409 rather than a client-side guess at the same rule.

### 5.5 Plans surface — `?mode=plans`

List every plan (`['training-plans']`) with progress; **Activate / Archive / Duplicate / Delete / Open**; **Create** (scratch / from-history / template + event taper) sharing `plan/CreatePlanPanel` with the spine's `Generate ▾`.

---

## 6. Data, URL and query contract

### 6.1 URL

| Param | Meaning | Default |
|---|---|---|
| `?mode=` | `plan` \| `review` \| `peaks` \| `plans` | `plan` |
| `?plan=` | Selected plan id | most recently updated active plan |
| `?day=` | `YYYY-MM-DD` → Plan mode, jump week, open day editor, scroll `#plan-day-<date>` | — |
| `?week=` | Week number within the plan | current week |
| `?view=` | Plan-mode scope: `week` \| `all` \| `program` | `week` |

`/training?plan=&day=` (from `GoalPlanDaysLink` on the goals page) must land in **Plan** mode with the day open — regression-tested.

### 6.2 Query keys (freeze)

`['training-plans']`, `['training-plan', id]`, `['plan-week', id, week]`, `['plan-conformity', id]`, `['day-conformity', dayId]`, `['adaptive-suggestions', id]`, `['strength-suggestions', id]`, `['tsb-projection', id]`, `['events']`, `['events','upcoming']`, `['goals','active']`, `['chart-periodization', weeks]`, `['live-plan-today']`, `['warmup-templates']`, `['lifting-sessions']`.

Shared with `/lifting` (`useTodaysStrengthDay` → `['live-plan-today']` + `getPlanWeek`), `/goals` (`useGoalPlanSchedule` → `['training-plans']`/`['training-plan', id]`) and the dashboard. Assert the list in a test.

### 6.3 Invalidation map

| Write | Invalidate |
|---|---|
| Day PATCH (field edit) | `['plan-week', id]`, `['day-conformity']`, `['plan-conformity', id]`, `['training-plan', id]`, `['training-plans']` |
| Add / Delete / Swap / Move / Substitute day | as Day PATCH + `['plan-unplanned', id]` |
| Plan field PATCH (name/status/event — **no `days`**) | `['training-plans']`, `['training-plan', id]` |
| Refresh targets | `['plan-week', id, week]`, `['plan-conformity', id]`, `['adaptive-suggestions', id]` |
| Adaptive apply | `['plan-week', id]`, `['plan-conformity', id]`, `['adaptive-suggestions', id]`, `['training-plan', id]`, `['training-plans']` |
| Strength suggestions apply | `['plan-week', id]`, `['strength-suggestions', id]`, `['training-plan', id]` |
| Wahoo push/remove | `['plan-week', id]` |
| Event create/update/delete/result | `['events']`, `['events','upcoming']`, `['notifications']` |

---

## 7. Responsive / mobile (parallel)

- **Sticky compact spine** (name + progress + today's session); tap to expand.
- **Mode switch** as a bottom segmented control (44px, `MobileBottomNav` conventions).
- **Default landing = Plan mode, current week.**
- The **day editor opens as a bottom sheet** (`Modal` already bottom-sheets `<sm`); the full field set is available there — no mode change needed.
- **No HTML5 drag on touch** — ⇄ swap/date picker only.
- **Peaks / Plans** open as full-screen sheets.
- 44px targets, focus rings, `Modal` → `document.body`, `<main inert>` invariants preserved.

---

## 8. Cross-cutting

### 8.1 State ownership

Shell owns `mode`, `selectedPlanId`, `?day=` highlight, plans list, plan detail, events. Plan mode owns the visible `week` and the open day id. `useInstantDayEdit` owns optimistic cache patching. Review/Peaks/Plans own only local form state. **No draft state anywhere.**

### 8.2 States matrix

Loading (`SkeletonRow`/`SkeletonLine`) / empty (`EmptyState`) / error (`ErrorState`) per surface. Specifics: no plans → create-first-plan; plan with no days → empty week grid; Review with no scored days → "not enough logged sessions to advise"; Peaks empty → add; **move/swap 409** → inline "that slot is taken — next free one?" with a one-tap retry.

### 8.3 review-vs-act

Review charts and the load strip are read-only viz; action controls live in Plan/Peaks action zones. Encode in component boundaries so a future audit can verify.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Optimistic rollback complexity** | One `useInstantDayEdit` hook; snapshot both cache keys; toast on rollback. Test the rollback path. |
| **409 races** (someone else's edit took the slot) | Invalidate + refetch on 409; offer next-free-slot / "swap instead". |
| **Swap under a hidden constraint** | Confirmed no `(plan_id, day_date)` unique constraint; add a regression test; validate same-plan + uncompleted in the service. |
| **Losing the draft's "discard all"** | The destructive ops (delete/swap/move/substitute) get `ConfirmDialog`s; per-edit undo follows in §11 C6. |
| **Which mode owns week-nav** | Plan mode owns it (removes the earlier two-nav-row question). |
| **Cache-key drift** breaking `/lifting`/`/goals`/dashboard | Freeze §6.2; assert in a test. |
| **Big-bang rewrite regression** | Phase 0 rehosts existing components; parity tests per mode. |
| **`PATCH /{id}` `days` still a footgun** | Deprecate in the schema; the UI never sends it; note in CODEMAP. |

No DB migration required for the three endpoints (columns already exist).

---

## 10. Roadmap

> Each phase ends green: `tsc --noEmit` clean, `vitest run` green, backend tests green.

### Phase 0 — Shell + editor primitives
- [ ] Backend: `POST /{id}/days`, `DELETE /{id}/days/{id}`, `POST /{id}/days/{id}/swap` (+ tests, incl. swap-with-no-unique-constraint).
- [ ] Frontend: `rescheduleDay`, `substituteDay`, `getUnplannedActuals`, `addDay`, `deleteDay`, `swapDays` clients; types.
- [ ] `useTrainingShell` (selection, `?mode=`, invalidations); `useInstantDayEdit` (optimistic).
- [ ] `PlanSpine` + `ModeSwitch` + `PlanSwitcher`; `PlansSurface` (`?mode=plans`).
- [ ] Fix `CODEMAP.md:20` + `training_plan.py:789` docstrings; deprecate `TrainingPlanUpdate.days`.
- **Acceptance**: `/training?plan=&day=` lands in Plan mode with the day open; add/delete/swap/move each work from one call; the UI never sends a full `days` array.

### Phase 1 — Plan mode (the unified editor) — ✅ **shipped** (PR #262)
> Spec: [`training-plan-mode-spec.md`](training-plan-mode-spec.md). **Prep first**: land the `/training` Playwright guard, and keep the editor + day grid **session-scoped** (a date → list of sessions) so [`multi-sport days`](training-multi-sport-days.md) stays purely additive.
>
> **Deviations as shipped**: `WeeklyView.tsx` was kept as the week view (extended with All-weeks + drag) rather than renamed to `plan/PlanMode.tsx` — cosmetic; a rename is optional. `WorkoutPlanner`/`PlanBuilder` are deleted; the destructive full-array save is gone from the UI. The zones reference needed no move (`/cycling` already renders `PowerZonesDisplay`). The unplanned strip shipped with a small backend addition (`activity_id`/`lifting_session_id` on the day PATCH, ownership-validated). **Not E2E-guarded**: the drag→swap/move gesture (HTML5 DnD is flaky in Playwright) — needs a manual check.
- [ ] `plan/DayEditor` (from `PlanBuilder.DayEditor` + `WeeklyView.ExpandedPanel`), instant commits + debounce; actuals + `DayConformityPanel`.
- [ ] `plan/PrescriptionPanel` absorbing `WorkoutPlanner`; delete `WorkoutPlanner.tsx`.
- [ ] `WeekMasterBar`/`DayCell` as the editable cards; drag→swap/move resolver; ⇄ picker; move/swap/duplicate/delete/copy-session actions **with `ConfirmDialog`s on the destructive ones**.
- [ ] All-weeks overview; `plan/UnplannedStrip`; rewire `MissedDayPopover` to real move/substitute; fold in de-emoji'd weather.
- [ ] Delete `PlanBuilder.tsx`, `WeeklyView.tsx`.
- **Acceptance**: any day editable and savable instantly in place; drag swaps/moves correctly; 409 handled; actuals/conformity visible while editing; delete/swap/move confirm first.

### Phase 2 — Review mode
- [ ] Chart grid (periodization, volume×intensity, combined load) + `ConformityTrendCard` + adaptive/strength/goals.
- [ ] Remove the trailing chart from the editing surface.
- **Acceptance**: charts from cached keys; adaptive apply invalidates correctly; review-vs-act holds.

### Phase 3 — Peaks mode + strip
- [ ] `PeaksMode` + `EventForm` (target_tss/notes) + result/retro/AI/PDF; event↔plan link.
- [ ] `LoadStrip` + `useDerivedPeaks`.
- **Acceptance**: link/unlink plan; taper shown; strip markers align.

### Phase 4 — Mobile pass
- [ ] Sticky compact spine; bottom mode control; day editor sheet; sheets for Peaks/Plans; 44px audit.
- **Acceptance**: 390px pass, no overflow; primary action ≤1 scroll from top.

### Tests to add
Mode routing + `?plan=`/`?day=`/`?mode=` round-trip · query-key freeze · `useInstantDayEdit` optimistic + rollback · add/delete/swap backend happy + error paths · swap with no unique constraint · `reschedule` 409 → next-free-slot · `DayCell` parity · deep-link regression.

---

## 11. Follow-on phases (backend permitted; sequenced after the IA)

| # | Item | Effort | Backend |
|---|---|---|---|
| C1 | **Block/phase model** → interactive load strip / macrocycle canvas (Shell C) | L | Migration + service |
| C2 | **Generation inputs** — FTP/1RM/bodyweight/CTL-TSB/recovery/goals into `/generate` | M | Service |
| C3 | **Scheduled weekly review** — `weekly_plan_review` snapshot + proposed changes | M | Celery + table |
| C4 | **Autoregulation** — RPE/recovery feed the next strength prescription (see [`training-strength-programming.md`](training-strength-programming.md) §4–5) | M | Service |
| C5 | **Propagation timing** — auto-flag stale on FTP/1RM/weight change | M | Service |
| C6 | **Per-edit undo — structural ops only** (delete/swap/move/substitute) via `services/undo.py` (needs an HTTP surface; AGENTS.md). Deliberately *not* every field edit — that would flood the log with keystrokes. | M | API + service |

**All six shipped** (2026-10-16): C1 `#282`, C2 `#271`, C3 `#275`, C4 `#273`, C5 `#272`, C6 `#277`.
C1 is the one that changed the surface (the strip now draws stored blocks, §5.4); C6 is the one
that gave `UndoLog` its first HTTP surface. **C6 wired only the delete op** — swap/move/substitute
would each need their own registered kind, and the surface plus the pattern are now in place for
them.

---

## 12. Observations found while planning (not yet fixed)

1. **`StrengthSuggestionsCard.handleApplyAll` is destructive** (`StrengthSuggestionsCard.tsx:44-70`): it PATCHes `planned_exercises: [singleExercise]` once per exercise, so each call **overwrites the day's whole list** — last exercise wins. Merging into the existing list is the fix (Phase 2).
2. **V3 "Move to next day" doesn't move** (`WeeklyView.tsx`): swapped planned content between two dates because "PATCH can't change day_date" — but `/reschedule` exists. **Fixed** (Phase 1): the missed-day popover now calls the real `/reschedule` (409 surfaced as a toast) and gains a **Substitute** action backed by `/substitute`.
3. **`CODEMAP.md:20` is wrong**: the array PATCH is **destructive by omission**, not "non-destructive upsert" (confirmed `training_plan.py:789-829`). Fix in Phase 0.
4. **Residual emoji** in `WeatherForecast.tsx` (`🌦️`/`💨`/`💧`) — fixed when the strip folds into Plan mode.
5. **Inline event form is lossy** (`page.tsx:116-121,443`): can't send `target_tss`/`notes`. `EventForm` fixes it (Phase 3).
6. **`DayEditor` preview-target effect** (`PlanBuilder.tsx:1150-1159`) patches the parent from an effect keyed on `previewTargets` with `onPatch` omitted from deps — re-express as an explicit "apply targets" action.
7. **`WeeklyView` white-screens on a malformed conformity payload** — `sportChips` reads `conformity.weeks.length` and `ConformitySummaryCard` reads `patterns.length`, both unguarded. The new `/training` E2E guard surfaced this: with an unmocked `/{id}/conformity` (the fixture's general handler returned a *plan object*) the page hit its error boundary with `Cannot read properties of undefined (reading 'length')`. The real API always returns the right shape and Phase 1 deletes this code, so it is **noted, not fixed** — but a one-character optional chain would prevent a whole-page failure.
8. **The `?day=` deep link could fail to expand the day** — `WeeklyView` latched `highlightDone.current` *before* checking whether the week payload contained the day, so if the effect first ran before the week query resolved it marked itself done and never retried: the day card appeared but never expanded (goal-card deep links landing "on the week" instead of "on the day"). **Fixed** by latching only after the day is found. Caught by the E2E guard's editor assertion — a weaker "the cell exists" check passed straight through it.

---

## 13. Open questions

**None outstanding.** All five were resolved on 2026-10-12 (recorded in §14):

1. **Load strip fidelity** → derived, **load/event/taper only**; no invented phase names (§5.4).
2. **Review naming** → **"Review"** (§14).
3. **`Generate ▾` placement** → spine, **confirmed when an active plan exists** (§4).
4. **Debounce** → **600 ms + flush on blur** (§5.1).
5. **Per-edit undo** → **not in this pass**; follow-on **C6 scoped to structural ops**, with `ConfirmDialog`s as the Phase-1 safety net (§3.2, §11).

---

## 14. Decisions log

| Question | Decision | Rationale |
|---|---|---|
| **Load strip fidelity** | Derived, showing **only real data** (weekly planned load, event markers, taper window, today). No "Base/Build/Peak" labels. | Cheap (client-side from loaded data), immediately useful, and honest about the missing block model — it seeds Shell C without claiming structure we don't store. |
| **Review naming** | **"Review"** | Avoids collision with the existing `/analytics` page (Feature 3/B-15, a different surface) and matches the `review-vs-act` language. |
| **`Generate ▾`** | Spine, **confirm when an active plan already exists** | `POST /generate` creates a *new* plan (never overwrites), so the confirm guards against accidental duplicate plans, not data loss. |
| **Debounce** | **600 ms idle + flush on blur** (and on unmount/mode switch) | Blur is the natural "done editing" signal; the debounce backstop prevents losing a value if the user navigates without blurring. |
| **Per-edit undo** | **Not in this pass.** Phase-1 `ConfirmDialog`s cover destructive ops; §11 C6 adds undo for structural ops only. | Field edits are trivially re-edited and would flood `UndoLog` with keystrokes; the acute risk is losing *content* via delete/swap/move, which the confirms already guard. `UndoLog` also has no HTTP surface yet, so it's its own feature. |
| Ambition | Structural overhaul now; loops later | The page fails structurally; backend loops are separable. |
| Backend | **In scope throughout** | Editor primitives are build-blocking (user). |
| **Build/Week split** | **Removed** — one Plan mode, one save model | All five annoyances trace to welding capability + save model to time scope. |
| Editor | Instant field edits + atomic structural ops | No draft, no destructive array write, no mode switch to edit a day. |
| Shell | A now → C later | Plan-first without waiting on blocks. |
| Events | Load strip + own mode | Most important thing becomes most visible. |
| Plans management | Switcher + Plans surface | Scales past 2 plans; frees editor width. |
| Mobile | Parallel design | Training is a phone task. |
| "Own today's session" | Not taken | `/today`, dashboard, `/lifting` keep their surfaces. |

---

## 15. Remaining & deferred items (register)

The single place listing what is **not yet built** across the training workstream. Phases 0–4, companion S1–S4 and follow-ons C1–C6 have all shipped; what follows records what they deliberately left open.

### In-scope build (these are the order)
- **This plan** Phases 0–4 (§10) — shell + editor primitives, Plan mode (unified editor), Review, Peaks, mobile.
- **Companion** `training-strength-programming.md` Phases S1–S4 — progression engine (**+ the one migration**), Program matrix, block tools, coaching aids.
- **Phase 1 backend addition** (from `training-plan-mode-spec.md` §8/§14): `activity_id` / `lifting_session_id` on `TrainingPlanDayUpdate`, so the unplanned strip can attach an actual to a chosen day (`link-activities` is automatic/date-based and can't target a day).

### Follow-on phases (backend permitted — §11)
| # | Item |
|---|---|
| C1 | **Block/phase model** → interactive load strip / macrocycle canvas (Shell C) |
| C2 | **Generation inputs** (FTP/1RM/bodyweight/CTL-TSB/recovery/goals) |
| C3 | **Scheduled weekly review** (`weekly_plan_review` snapshot) |
| C4 | **Autoregulation** (RPE/recovery → next prescription) |
| C5 | **Propagation timing** (auto-flag stale on FTP/1RM/weight change) |
| C6 | **Per-edit undo** (structural ops only) |

### Deferred / excluded (companion §12)
- Wahoo bulk push (week) — cheap follow-up.
- Plan PDF export — pattern exists (`export/event-report`).
- **Cycle block progression** — week-by-week authoring for rides is accepted for now (`duplicate week → range` covers the bulk case); noted, not scheduled.

### Additional phases / workstreams (2026-10-13 decisions)
- **Multi-sport days** — a date may hold more than one session. Own phase **after Phase 1**; design in [`training-multi-sport-days.md`](training-multi-sport-days.md). Phase 1 must stay **session-scoped** so this is purely additive.
- **`/training` E2E guard** — a Playwright spec (mode switching, `?mode=` reload, `?plan=&day=`, Plans surface) lands **before** Phase 1.
- **Zones reference → `/cycling`** — the `WorkoutPlanner` zone table moves to the cycling page rather than being dropped.
- **Create consolidation** — Plan mode's "no plan" state links to the Plans surface; the create forms live only there.
- **Reconcile `.dsh/` into `main`** — dedicated chore PR (the bundle is `prod`-only today, so the branches are permanently non-identical; tooling-only, harmless).

### Known defects to fix during the build (this plan §12 + companion §4.3)
1. `StrengthSuggestionsCard.handleApplyAll` overwrites the day's exercise list with a single entry (last wins) → Phase 2.
2. V3 missed-day "Move to next day" swaps content instead of moving the day → Phase 1 (wire `/reschedule`).
3. `CODEMAP.md:20` documents the array PATCH as a "non-destructive upsert"; it **deletes dates missing** from the payload → Phase 0.
4. Residual emoji in `WeatherForecast.tsx` (`🌦️`/`💨`/`💧`) → Phase 1/2.
5. Inline event form cannot send `target_tss`/`notes` → Phase 3.
6. `DayEditor` preview-target effect patches the parent from an effect with a missing dep → Phase 1.
7. `resolve_exercise_e1rm` uses the all-time best set (staleness) → companion S1 (`within_days` + `basis_date`).
8. Two RPE fields (`rpe` vs the unused `target_rpe`) → companion S1.

### Carried over from V3 (`v3-planning-2026-10-12.md`)
- V3 components shipped to `main` (`33a86e9`, `520edff`, `cf18415`) but the **prod deploy is still open**.
- V3's *surface* scope is superseded by this plan; its components are reused, not discarded.

### Pointers
- Companion decisions register: `training-strength-programming.md` §13.
- This plan's decisions: §0 / §14.
