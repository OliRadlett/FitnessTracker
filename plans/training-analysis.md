# Training Page Analysis & Change Log

> **Purpose**: Track analysis of the training page (`/training`) and related components during active development.

## Current State

### Architecture
- **Page**: `frontend/src/app/(app)/training/page.tsx` (528 lines)
- **Views**: PlanBuilder (full-week editor) + WeeklyView (current week)
- **Tabs**: "Plan Builder" | "This Week"
- **Key components**: PlanBuilder, WeeklyView, WorkoutPlanner, WeatherForecast, EventResultPanel, AdaptiveSuggestionsCard, ConformityBadge, DayConformityPanel, RoutePickerModal

### Save Models
- **PlanBuilder (5A)**: PATCHes full `days` array to `/api/v1/training-plans/{id}` → backend upserts by `day_date`, deletes missing dates
- **WeeklyView (5B)**: PATCHes single day via `PATCH /training-plans/{id}/days/{dayId}` with `UpdateTrainingPlanDayPayload`

### Backend Services
- **conformity.py** (1035 lines): Plan-vs-actual scoring with weighted components
- **training_plan.py** (1200 lines): Plan CRUD, generation, weekly view, day updates
- **adaptive.py** (609 lines): Adaptive weekly advice with one-tap apply actions
- **projections.py** (727 lines): TSB/goal projections (pure functions + DB-backed)

### API Endpoints
- `GET/POST/PATCH/DELETE /api/v1/training-plans` — plan CRUD
- `GET /api/v1/training-plans/{id}/week/{n}` — weekly view with weather/actuals
- `PATCH /api/v1/training-plans/{id}/days/{dayId}` — single-day update
- `GET /api/v1/training-plans/{id}/conformity` — plan-level conformity
- `GET /api/v1/training-plans/{id}/days/{dayId}/conformity` — day-level conformity
- `GET /api/v1/training-plans/{id}/suggestions` — adaptive suggestions
- `POST /api/v1/training-plans/{id}/link-activities` — auto-link activities
- `POST /api/v1/training-plans/{id}/generate` — template generation
- `GET /api/v1/projections/tsb/{planId}` — TSB projection (event-linked plans)
- `GET/POST/PATCH/DELETE /api/v1/events` — event CRUD
- `PUT/DELETE /api/v1/events/{id}/result` — result logging

---

## Analysis Log

### Phase 5A — PlanBuilder

| # | Issue / Enhancement | Severity | Status |
|---|---------------------|----------|--------|
| 5A-1 | **No undo after drag-and-drop date swap** — The `swapDates()` function in PlanBuilder immediately commits the swap to local state with no undo capability. If a user drags a day to a wrong slot, there's no way to revert without a full page refresh or discarding all changes. | Medium | Open |
| 5A-2 | **PlanBuilder doesn't display conformity scores** — There's no conformity badge or score visible in the PlanBuilder view (unlike WeeklyView which has ConformityBadge on day cards). PlanBuilder only shows planned fields but no actual vs. planned comparison. | Medium | Open |
| 5A-3 | **No "link activities" button in PlanBuilder** — The WeeklyView has a "Link activities" button, but PlanBuilder lacks this functionality. Users editing in PlanBuilder can't easily backfill missing activity links. | Low | Open |
| 5A-4 | **Week navigation tabs limited to "All" view only** — The "All" overview shows week summary cards but no conformity data. The week tabs show day cards but there's no quick way to see conformity at a glance from the week summary. | Low | Open |
| 5A-5 | **Drag-and-drop doesn't work on touch devices** — The DayCard in PlanBuilder uses native HTML5 drag-and-drop which doesn't work on mobile. A touch-friendly "⇄ Swap date" alternative exists in the expanded DayEditor but not on the collapsed day cards themselves. | Medium | Open |
| 5A-6 | **Unsaved changes warning on plan switch** — When switching between plans via the plans list, there's no `beforeunload` or `beforeNavigate` prompt if there are unsaved local changes in PlanBuilder. Users could lose work. | High | Open |

### Phase 5B — WeeklyView

| # | Issue / Enhancement | Severity | Status |
|---|---------------------|----------|--------|
| 5B-1 | **Missing `getTsbProjection` API client function** — `WeeklyView.tsx:227` uses `apiFetch` directly for the TSB projection call (`/api/v1/projections/tsb/${plan.id}?days=14`). There's no dedicated `getTsbProjection()` function in `frontend/src/lib/api/projections.ts` — it should follow the same pattern as `getGoalProjection`. | Low | Open |
| 5B-2 | **`tsbColor()` returns `text-warning` for deep fatigue** — In `WeeklyView.tsx:134`, `tsbColor()` returns `text-warning` for TSB <= -20, but the `tsbColor()` in the TSB projection strip (line 480) also has this issue. The fallback for TSB < -20 should be `text-warning` which is correct for "fatigued" but the color could be more distinct (red). | Low | Open |
| 5B-3 | **TSB projection strip doesn't show the projection curve** — The TSB projection strip shows race-day TSB and freshness assessment but doesn't render the actual projection curve (CTL/ATL/TSB over time). The data is available (`tsb.projection`) but not visualized. | Medium | Open |
| 5B-4 | **No auto-advance to current week when viewing a past week** — If a user navigates to week 3 but today is in week 5, the "Current" button (line 347) is shown but requires manual click. The UI could auto-prompt or auto-advance after some time. | Low | Open |
| 5B-5 | **Route assignment in expanded panel doesn't preserve other fields** — When `assignRoute` PATCHes `planned_route_id`, the `quickEdit` mutation only sends duration/TSS/notes. The route picker is called via `onOpenRoutePicker` which triggers the mutation separately, but there's a potential race condition if both mutations are in-flight. | Low | Open |
| 5B-6 | **No conformity score shown on collapsed day cards** — The `ConformityBadge` on day cards (line 718) only shows the status dot without the percentage score. The score is only visible when expanding the day panel and viewing `DayConformityPanel`. | Medium | Open |

### Phase 5C — Conformity

| # | Issue / Enhancement | Severity | Status |
|---|---------------------|----------|--------|
| 5C-1 | **ConformityBadge doesn't show `pct` for done/partial statuses in WeeklyView** — The badge is rendered with `status={badgeStatus}` and `title={STATUS_LABEL[status]}` but `pct` is not passed. The percentage is only computed at the expanded panel level. | Medium | Open |
| 5C-2 | **DayConformityPanel uses `open` prop but it's always `true`** — The `DayConformityPanel` component has an `open` prop (line 115) that defaults to `true`, and it's always called from `ExpandedPanel` without explicitly passing `open`. The lazy query is already enabled by the panel being mounted, but the prop is misleading. | Low | Open |
| 5C-3 | **No conformity component for `activity_id`/`lifting_session_id`** — The conformity scoring doesn't include whether the planned activity/session was actually linked. It only scores planned vs actual metrics, not the linking itself. | Low | Open |
| 5C-4 | **Conformity percentage not shown on week summary cards in PlanBuilder** — The "All" overview in PlanBuilder (line 731) shows week summaries with TSS count but no conformity percentage. Users can't see plan adherence from the overview. | Medium | Open |

### Events

| # | Issue / Enhancement | Severity | Status |
|---|---------------------|----------|--------|
| EVT-1 | **No `EventAiAnalysisCard` rendered in the Events list** — The `EventAiAnalysisCard` component exists (`frontend/src/components/training/EventAiAnalysisCard.tsx`) but is never imported or used in `page.tsx`. The training page shows event result buttons and PDF export but no AI race prep analysis. | Medium | Open |
| EVT-2 | **Events list only shows upcoming events** — The `useQuery` for events uses `?upcoming_only=true` (line 129). Past events with results (like race retrospectives) are not visible. There's no way to see past event history from this page. | Medium | Open |
| EVT-3 | **Event form doesn't include `target_tss` field** — The `CreateEventPayload` type includes `target_tss` but the event form in `page.tsx` (lines 90-95) doesn't allow setting it. Users can't specify a target TSS for their event. | Low | Open |
| EVT-4 | **No edit button for events** — The events list shows a delete button (line 428) but no edit button. Users cannot modify an event's date, type, or taper days after creation. | Medium | Open |
| EVT-5 | **Event result form has no validation** — The `EventResultPanel` allows saving an empty result (no finishing time, position, etc.). The save button is always enabled (line 200) — there's no minimum required field check. | Low | Open |
| EVT-6 | **No success/error feedback after event result save** — When saving an event result, there's no success confirmation shown to the user. The form just closes. Errors are shown (line 195) but success is silent. | Low | Open |

### Workout Planner

| # | Issue / Enhancement | Severity | Status |
|---|---------------------|----------|--------|
| WP-1 | **WorkoutPlanner is static — no plan assignment** — The WorkoutPlanner allows planning a workout and finding matching routes, but there's no way to assign the planned workout to a specific day in the active plan. It's disconnected from the planning flow. | High | Open |
| WP-2 | **No "Assign to plan day" action for route matches** — When routes are matched (line 556), the user can see route details and stats but cannot assign the route to a specific plan day directly from the WorkoutPlanner. | Medium | Open |
| WP-3 | **Stale FTP note not addressed** — The cohesiveness doc mentions a stale FTP note in WorkoutPlanner that was fixed, but the component still has no refresh mechanism for zones data (line 251 uses a 5-minute staleTime). If FTP changes during a session, the user must refresh the page. | Low | Open |

### Weather Forecast

| # | Issue / Enhancement | Severity | Status |
|---|---------------------|----------|--------|
| WF-1 | **WeatherForecast shows 7-day forecast but day cards show inline weather too** — The 7-day forecast at the top duplicates weather info that's also shown on cycle day cards in WeeklyView. This is fine for context but could be condensed. | Low | Open |
| WF-2 | **Weather data only refreshes every 30 minutes** — The `staleTime` is 30 minutes (line 74). During active planning, users may want fresher weather data, especially when deciding whether to swap a ride day. | Low | Open |

### General / Cross-cutting

| # | Issue / Enhancement | Severity | Status |
|---|---------------------|----------|--------|
| GEN-1 | **No "View all routes" link in WorkoutPlanner** — The cohesiveness doc mentions adding a "View all routes →" link. The RoutePickerModal shows routes but there's no shortcut to the full routes page from the training page. | Low | Open |
| GEN-2 | **Periodization chart is not interactive** — The chart at the bottom (line 518) shows planned vs actual but has no click/hover interactions to drill into specific weeks. | Low | Open |
| GEN-3 | **No keyboard shortcuts** — Power users have no keyboard shortcuts for common actions like switching between views, saving, or navigating weeks. | Low | Open |
| GEN-4 | **No responsive layout issue on very small screens** — The grid layout (`lg:grid-cols-3 gap-6` on line 281) may be cramped on small screens. The day cards grid (7 columns) collapses to 1 column on mobile but could show 2-3 columns on small tablets. | Low | Open |
| GEN-5 | **`toDayPayload` in page.tsx doesn't include `lifting_session_id` properly for strength days** — The payload function (line 58) conditionally includes `lifting_session_id` only when `d.lifting_session_id` is truthy (line 76). But `TrainingPlanDayBase` schema allows `lifting_session_id` — the `CreateTrainingPlanDayPayload` type includes it (line 221 of types). However, the `TrainingPlanUpdate` schema's `days` field is `list[TrainingPlanDayCreate]` which inherits from `TrainingPlanDayBase`. Since PlanBuilder sends the full array with link fields, this should work. | Low | Verified OK |
| GEN-6 | **WeekView ExpandedPanel quick-edit doesn't include `planned_power_watts`** — The quick-edit in ExpandedPanel (line 881-887) only sends `planned_duration_min`, `planned_tss`, and `notes`. Users can't quick-edit power or zone from the WeeklyView expanded panel. | Low | Open |
| GEN-7 | **WeeklyView doesn't default to current week** — The `currentWeek` state is initialized with `getCurrentRealWeek(plan)` in `useState`, but the component may not update when navigating between tabs or when the plan changes. | High | Open |
| GEN-8 | **Rest days don't auto-complete** — Past rest days remain uncompleted unless manually toggled. They should auto-complete since "doing nothing" on a rest day is correct behavior. | Medium | Open |

---

## API Client Gaps

| Missing Function | Component Using Workaround | Proposed Location | Status |
|------------------|---------------------------|-------------------|--------|
| `getTsbProjection` | FIXED — was using `apiFetch` directly | `frontend/src/lib/api/projections.ts` | ✅ Done |
| `updateEvent(authFetch, eventId, payload)` | No update functionality exists | `frontend/src/lib/api/events.ts` | Needed |
| `getEventAiAnalysis(authFetch, eventId)` | AI analysis card exists but not wired up | `frontend/src/lib/api/events.ts` | Needed |

---

## Type Alignment Notes

1. **Frontend types** (`types/training.ts`): `TrainingPlanDay` has `lifting_session_id?: string | null` and `planned_route_id?: string | null` — these are included in `CreateTrainingPlanDayPayload`.
2. **Backend schema** (`TrainingPlanDayUpdate`): Does NOT include `lifting_session_id` — strength sessions can only be linked via the copy-from-session endpoint, not via the single-day PATCH.
3. **Backend schema** (`TrainingPlanDayBase`): Includes `lifting_session_id: uuid.UUID | None` — so the full-array save works but the single-day PATCH doesn't support it.
4. **Frontend `UpdateTrainingPlanDayPayload`**: Does NOT include `lifting_session_id` — type alignment is correct with backend.

---

## Change Log

| Date | Change | Files Modified |
|------|--------|----------------|
| 2026-09-29 | Added `getTsbProjection` API client function | `frontend/src/lib/api/projections.ts` |
| 2026-09-29 | Updated `WeeklyView.tsx` to use `getTsbProjection` instead of raw `apiFetch` | `frontend/src/components/training/WeeklyView.tsx` |
| 2026-09-29 | Added `"strength"` to `VALID_PLAN_TYPES` | `backend/app/services/training_plan.py:59` |
| 2026-09-29 | Added `StrengthWeekTemplate` schema + strength fields to `GeneratePlanRequest` | `backend/app/schemas/training_plan.py` |
| 2026-09-29 | Added `_strength_plan_days()` function with 5/3/1-style progressive overload | `backend/app/services/training_plan.py` |
| 2026-09-29 | Updated `generate_plan()` to handle `"strength"` template type | `backend/app/services/training_plan.py` |
| 2026-09-29 | Added `StrengthWeekTemplate` type + strength fields to `GeneratePlanPayload` | `frontend/src/lib/api/types/training.ts` |
| 2026-09-29 | Added "Strength" option to `TEMPLATE_OPTIONS` in EmptyState | `frontend/src/components/training/PlanBuilder.tsx:75` |
| 2026-09-29 | Added strength plan options UI (RPE/sets/reps/weight) in template form | `frontend/src/components/training/PlanBuilder.tsx` |
| 2026-09-29 | Added `EventAiAnalysisCard` import and rendering for upcoming race events | `frontend/src/app/(app)/training/page.tsx` |
| 2026-09-29 | Added `useEffect` to sync `currentWeek` with `realCurrentWeek` on plan change | `frontend/src/components/training/WeeklyView.tsx` |
| 2026-09-29 | Added auto-completion for past rest days in `link_activities_to_plan_days` | `backend/app/services/conformity.py:656` |
| 2026-09-29 | Added `StrengthPlanSuggestionsResponse` schemas | `backend/app/schemas/training_plan.py` |
| 2026-09-29 | Rewrote `suggest_strength_updates()` — RPE-based weight suggestions focused on big 3 (squat/bench/deadlift) | `backend/app/services/training_plan.py` |
| 2026-09-29 | Weight suggestion logic: ±0.5 RPE = +2.5kg, RPE below target = +5kg, RPE above target = maintain weight | `backend/app/services/training_plan.py` |
| 2026-09-29 | Added `GET /{plan_id}/strength-suggestions` endpoint | `backend/app/api/training_plans.py` |
| 2026-09-29 | Added `getStrengthSuggestions` API client | `frontend/src/lib/api/trainingPlans.ts` |
| 2026-09-29 | Added strength suggestion types | `frontend/src/lib/api/types/training.ts` |
| 2026-09-29 | Added `'strength'` to `TrainingPlan.plan_type` union | `frontend/src/lib/api/types/training.ts:137` |
| 2026-09-29 | Added `StrengthSuggestionsCard` component with "Apply All" button | `frontend/src/components/training/StrengthSuggestionsCard.tsx` |
| 2026-09-29 | Wired up strength suggestions query + card rendering in WeeklyView | `frontend/src/components/training/WeeklyView.tsx` |