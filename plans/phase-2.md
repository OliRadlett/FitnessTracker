# Phase 2 — FitTrack Enhancement Plan

> Created: 2026-08-16
> Status: Planning

This plan covers thirteen work items: a service runner improvement, exercise name standardisation, activity page linked sessions, manual PR entry, two PR bug fixes, PR display reordering, PR deduplication, session editing, session deletion confirmation, a Strava sport type fix, and Docker healthchecks.

---

## 1. Custom Service States in `fittrack.py`

**Problem**: The [`_wait_for_healthy()`](../fittrack.py:736) function only shows a generic "Waiting for backend…" spinner. The frontend container runs `npm install && npm run dev` on first start, which can take 30+ seconds. There is no visibility into what each service is doing during startup.

**Goal**: Display per-service contextual status messages during startup (e.g., "Installing node modules", "Running migrations", "Starting uvicorn").

### Approach

1. **Add a `startup_log_probe` config to [`SERVICE_DEFS`](../fittrack.py:103)** — For each service, define a list of `(docker_log_pattern, display_message)` tuples that map log output to human-readable states.

2. **Create a `_probe_startup_states()` function** — Runs `docker compose logs --tail 20 <service>` for each non-healthy service and matches the latest log lines against the configured patterns. Returns a dict of `service_name → current_state_message`.

3. **Integrate into [`_wait_for_healthy()`](../fittrack.py:736)** — Replace the single spinner with a per-service progress display:
   ```
   ⠹ PostgreSQL      ● healthy
   ⠹ Redis           ● healthy
   ⠹ Backend API     ◐ running uvicorn...
   ⠹ Celery Worker   ◐ connecting to redis...
   ⠹ Frontend        ◐ installing node modules... (12s)
   ```

4. **Integrate into [`cmd_monitor()`](../figtrack.py:629)** — Add a "Startup Status" column that shows the probe result when a service is `running` but not yet `healthy`.

### Files to Modify

| File | Change |
|------|--------|
| [`fittrack.py`](../fittrack.py) | Add `startup_log_probe` to `SERVICE_DEFS`, new `_probe_startup_states()`, update `_wait_for_healthy()` and `cmd_monitor()` |

### Log Patterns to Detect

| Service | Pattern | Display Message |
|---------|---------|-----------------|
| `frontend` | `npm install` / `added .* packages` | "Installing node modules" → "Node modules installed" |
| `frontend` | `npm run dev` / `ready - started server` | "Starting Next.js dev server" → "Dev server ready" |
| `backend` | `uvicorn` / `Waiting for application startup` | "Starting uvicorn" |
| `backend` | `Application startup complete` | "Application ready" |
| `worker` | `celery@` / `ready` | "Celery worker ready" |
| `beat` | `beat: Starting...` | "Starting Celery Beat" |
| `db` | `database system is ready` | "PostgreSQL ready" |
| `redis` | `Ready to accept connections` | "Redis ready" |

---

## 2. Exercise Autocomplete with Name Standardisation

**Problem**: Exercise names are free-text. Users can enter "Squat", "squat", "Squats", "Back Squat", "Back squat" — all treated as different exercises. This fragments PR tracking, volume trends, and warmup template matching.

**Goal**: Provide autocomplete suggestions from a built-in exercise database and normalise all names to a canonical form on save.

### Approach

#### Backend

1. **Create [`backend/app/services/exercise_db.py`](../backend/app/services/exercise_db.py)** — A static dictionary of canonical exercise names organised by category:
   ```python
   EXERCISE_DB = {
       "compound": [
           "Back Squat", "Front Squat", "Bench Press", "Incline Bench Press",
           "Deadlift", "Romanian Deadlift", "Overhead Press", "Barbell Row",
           "Pull Up", "Dip",
       ],
       "accessories": [
           "Leg Press", "Leg Curl", "Leg Extension", "Lateral Raise",
           "Face Pull", "Tricep Pushdown", "Bicep Curl", "Cable Row",
           # ...
       ],
   }
   ```

2. **Create a normalisation function** `_normalise_exercise_name(raw: str) -> str` — Strips trailing "s"/"es", title-cases, and matches against known aliases:
   ```python
   ALIASES = {
       "squat": "Back Squat",
       "squats": "Back Squat",
       "back squat": "Back Squat",
       "bench": "Bench Press",
       "bench press": "Bench Press",
       "deadlift": "Deadlift",
       "deadlifts": "Deadlift",
       "ohp": "Overhead Press",
       "overhead press": "Overhead Press",
       # ...
   }
   ```

3. **Create API endpoint [`GET /api/v1/lifting/exercises?q=`](../backend/app/api/lifting.py)** — Returns matching exercises from `EXERCISE_DB` for autocomplete. Also returns the user's previously used exercise names (deduplicated from `LiftingSet`).

4. **Apply normalisation in [`add_set()`](../backend/app/services/lifting.py:253)** — Before saving, run the exercise name through the normaliser. This ensures all new data is canonical.

5. **Create Alembic migration** — Backfill existing `LiftingSet.exercise_name` values through the normaliser. Also update `PersonalRecord.exercise_name` and `WarmupTemplate.exercise_name`.

#### Frontend

6. **Create [`frontend/src/components/ui/ExerciseAutocomplete.tsx`](../frontend/src/components/ui/ExerciseAutocomplete.tsx)** — A text input with a dropdown that:
   - Fetches suggestions from `GET /api/v1/lifting/exercises?q=<typed>` on input change (debounced 200ms)
   - Shows both database matches and user's historical exercises
   - Highlights the canonical name
   - Allows free-text entry (for exercises not in the DB) but still normalises on selection

7. **Replace the exercise name `<input>` in [`AddExerciseForm`](../frontend/src/app/(app)/lifting/page.tsx:447)** with `ExerciseAutocomplete`.

8. **Replace the exercise name `<input>` in [`WarmupTemplateManager`](../frontend/src/app/(app)/lifting/page.tsx:176)** with `ExerciseAutocomplete`.

### Files to Create

| File | Purpose |
|------|---------|
| [`backend/app/services/exercise_db.py`](../backend/app/services/exercise_db.py) | Exercise database, aliases, normaliser |
| [`backend/alembic/versions/003_normalise_exercise_names.py`](../backend/alembic/versions/003_normalise_exercise_names.py) | Backfill migration |
| [`frontend/src/components/ui/ExerciseAutocomplete.tsx`](../frontend/src/components/ui/ExerciseAutocomplete.tsx) | Autocomplete component |

### Files to Modify

| File | Change |
|------|--------|
| [`backend/app/api/lifting.py`](../backend/app/api/lifting.py) | Add `GET /exercises` endpoint |
| [`backend/app/services/lifting.py`](../backend/app/services/lifting.py) | Apply normaliser in `add_set()` |
| [`frontend/src/app/(app)/lifting/page.tsx`](../frontend/src/app/(app)/lifting/page.tsx) | Use `ExerciseAutocomplete` in `AddExerciseForm` and `WarmupTemplateManager` |
| [`frontend/src/lib/api.ts`](../frontend/src/lib/api.ts) | Add `ExerciseSuggestion` type |

---

## 3. Linked Strength Sessions on Activities Page

**Problem**: The [Activities page](../frontend/src/app/(app)/activities/page.tsx) shows Strava activities but has no indication when a strength activity is linked to a lifting session. Users must go to the Lifting page to see this connection.

**Goal**: Show the linked lifting session (sets summary, volume) directly on strength-type activities in the Activities page.

### Approach

#### Backend

1. **Extend [`ActivityRead`](../backend/app/schemas/activity.py)** — Add an optional `linked_lifting_session` field containing a summary (session date, focus, set count, total volume, top sets):
   ```python
   class LinkedLiftingSessionSummary(BaseModel):
       id: uuid.UUID
       session_date: date
       focus: str | None
       set_count: int
       total_volume_kg: float | None
       top_sets: list[TopSetSummary]  # best set per exercise
   ```

2. **Update [`list_activities()`](../backend/app/api/activities.py:19) and [`get_activity()`](../backend/app/api/activities.py:48)** — Eagerly load the reverse relationship from `Activity` → `LiftingSession` and include it in the response for strength-type activities.

3. **Add reverse relationship on [`Activity`](../backend/app/models/activity.py)** — `lifting_session: Mapped["LiftingSession | None"] = relationship(back_populates="linked_activity")` (this likely already exists based on the model).

#### Frontend

4. **Extend the `Activity` TypeScript interface in [`api.ts`](../frontend/src/lib/api.ts:67)** — Add `linked_lifting_session?: LinkedLiftingSessionSummary`.

5. **Update the activity list rendering in [`activities/page.tsx`](../frontend/src/app/(app)/activities/page.tsx:147)** — For strength-type activities that have a linked session, show a collapsible summary card below the activity row with:
   - Exercise groups with top sets
   - Total volume
   - "View on Lifting page" link

### Files to Modify

| File | Change |
|------|--------|
| [`backend/app/schemas/activity.py`](../backend/app/schemas/activity.py) | Add `LinkedLiftingSessionSummary`, update `ActivityRead` |
| [`backend/app/api/activities.py`](../backend/app/api/activities.py) | Eager load lifting session relationship |
| [`frontend/src/lib/api.ts`](../frontend/src/lib/api.ts) | Add `LinkedLiftingSessionSummary` type, extend `Activity` |
| [`frontend/src/app/(app)/activities/page.tsx`](../frontend/src/app/(app)/activities/page.tsx) | Render linked session summary for strength activities |

---

## 4. Manual PR Entry

**Problem**: PRs can only be recorded through the app's lifting session flow. If a user hit a PR at a gym session they didn't log in FitTrack, there's no way to record it.

**Goal**: Allow users to manually create a PR entry with exercise name, weight, reps, date, and optional notes.

### Approach

#### Backend

1. **Create schema [`PersonalRecordCreate`](../backend/app/schemas/lifting.py)**:
   ```python
   class PersonalRecordCreate(BaseModel):
       exercise_name: str
       record_type: str = "1rm"  # 1rm, 3rm, 5rm, volume_pr
       weight_kg: float
       reps: int
       achieved_date: date
       notes: str | None = None
   ```

2. **Create service function [`create_manual_pr()`](../backend/app/services/lifting.py)** — Creates a `PersonalRecord` with `session_id=None` (no linked session). Apply exercise name normalisation (from feature 2). Calculate `estimated_1rm` using the Brzycki formula.

3. **Create API endpoint [`POST /api/v1/lifting/prs`](../backend/app/api/lifting.py)** — Calls `create_manual_pr()`. Returns the created `PersonalRecordRead`.

4. **Add `notes` column to [`PersonalRecord`](../backend/app/models/lifting.py:51)** model — Optional text field for context (e.g., "Hit this at a commercial gym").

5. **Alembic migration** — Add `notes` column to `personal_records` table.

#### Frontend

6. **Create a "Add PR" form/modal** in the lifting page's PR section — Fields: exercise name (with autocomplete), weight, reps, date, notes.

7. **Add mutation** in [`lifting/page.tsx`](../frontend/src/app/(app)/lifting/page.tsx) — `POST /api/v1/lifting/prs`.

8. **Update `PersonalRecord` interface** in [`api.ts`](../frontend/src/lib/api.ts:147) — Add optional `notes` field.

### Files to Modify

| File | Change |
|------|--------|
| [`backend/app/models/lifting.py`](../backend/app/models/lifting.py) | Add `notes` to `PersonalRecord` |
| [`backend/app/schemas/lifting.py`](../backend/app/schemas/lifting.py) | Add `PersonalRecordCreate` schema |
| [`backend/app/services/lifting.py`](../backend/app/services/lifting.py) | Add `create_manual_pr()` |
| [`backend/app/api/lifting.py`](../backend/app/api/lifting.py) | Add `POST /prs` endpoint |
| [`backend/alembic/versions/004_add_pr_notes_manual_prs.py`](../backend/alembic/versions/004_add_pr_notes_manual_prs.py) | Migration for `notes` column |
| [`frontend/src/lib/api.ts`](../frontend/src/lib/api.ts) | Update `PersonalRecord` interface, add `CreatePRPayload` |
| [`frontend/src/app/(app)/lifting/page.tsx`](../frontend/src/app/(app)/lifting/page.tsx) | Add "Add PR" form/modal |

---

## 5. Bug Fix: PR Persists After Set Deletion

**Problem**: When a lifting set is deleted via [`delete_set()`](../backend/app/services/lifting.py:314), the associated [`PersonalRecord`](../backend/app/models/lifting.py:51) is not cleaned up. The `session_id` FK on the PR uses `ON DELETE SET NULL`, so it becomes `NULL` — the PR appears to be "orphaned" but still shows in the PR list.

**Root Cause**: [`delete_set()`](../backend/app/services/lifting.py:314) only updates session volume and deletes the set. It does not check whether the deleted set was the basis for any PR.

### Fix

1. **In [`delete_set()`](../backend/app/services/lifting.py:314)**, after deleting the set, check if any `PersonalRecord` exists for this user/exercise where the `session_id` matches the set's session AND the `weight_kg`/`reps` match the deleted set. If so, either:
   - **Option A (recommended)**: Recalculate the best PR for that exercise from remaining sets. If the deleted set was the PR, find the next best set across all sessions and update the PR. If no sets remain, delete the PR.
   - **Option B (simpler)**: Delete the PR if its `session_id` matches the session and it was derived from the deleted set's data. The user would need to re-log if they later re-add the set.

   **Recommended: Option A** — More robust, handles edge cases.

2. **Add a `_recalculate_pr_after_deletion()` helper** in [`lifting.py`](../backend/app/services/lifting.py):
   ```python
   async def _recalculate_pr_after_deletion(
       db: AsyncSession,
       user_id: uuid.UUID,
       exercise_name: str,
       session_id: uuid.UUID,
   ) -> None:
       """After a set is deleted, recalculate the best PR for the exercise."""
       # Find the deleted set's PR
       # Find the best remaining set across ALL sessions for this exercise
       # If a better set exists, update the PR record
       # If no sets remain, delete the PR
       # If the deleted set wasn't the PR, do nothing
   ```

3. **Call `_recalculate_pr_after_deletion()` from [`delete_set()`](../backend/app/services/lifting.py:314)** after the set is deleted, but only for non-warmup sets.

### Files to Modify

| File | Change |
|------|--------|
| [`backend/app/services/lifting.py`](../backend/app/services/lifting.py) | Add `_recalculate_pr_after_deletion()`, call from `delete_set()` |

---

## 6. PR Display: Big 3 First, Accessories Behind Button

**Problem**: The PR section on the [lifting page](../frontend/src/app/(app)/lifting/page.tsx:1233) displays all PRs in a flat grid sorted by `achieved_date.desc()`. There is no distinction between primary compound lifts and accessory exercises. The "Big 3" (Squat, Bench Press, Deadlift) should be prominent, with accessories collapsed.

**Goal**: Reorder PRs so the Big 3 are always visible at the top. All other exercises are collapsed behind a "Show Accessories" toggle.

### Approach

#### Backend

1. **Add a `category` field to the exercise database** (from feature 2) — `"compound"` vs `"accessory"`. The Big 3 are a subset of compound:
   ```python
   BIG_3 = {"Back Squat", "Bench Press", "Deadlift"}
   ```

2. **Create a new endpoint [`GET /api/v1/lifting/prs/grouped`](../backend/app/api/lifting.py)** — Returns PRs grouped by exercise with category metadata:
   ```python
   class PRGroup(BaseModel):
       exercise_name: str
       category: str  # "big3", "compound", "accessory"
       current_pr: PersonalRecordRead
       history: list[PersonalRecordRead]  # chronological PR history for this exercise
   ```

   Ordering: Big 3 first (Squat → Bench → Deadlift), then other compounds, then accessories.

   **Alternative (simpler)**: Keep the existing `GET /prs` endpoint and add a `category` field to `PersonalRecordRead` derived from the exercise name. Let the frontend handle grouping/sorting.

#### Frontend

3. **Update the PR section in [`lifting/page.tsx`](../frontend/src/app/(app)/lifting/page.tsx:1233)**:
   - Group PRs by exercise name
   - Sort groups: Big 3 first (fixed order: Squat, Bench, Deadlift), then other compounds alphabetically, then accessories alphabetically
   - Render Big 3 and compounds as a prominent card row at the top
   - Render accessories behind a collapsible "Accessories (N)" button
   - Each PR card shows: exercise name, current best (weight × reps @ est. 1RM), date achieved

4. **Add a helper function** `getExerciseCategory(name: string): "big3" | "compound" | "accessory"` that mirrors the backend classification.

### Files to Modify

| File | Change |
|------|--------|
| [`backend/app/services/exercise_db.py`](../backend/app/services/exercise_db.py) | Add `BIG_3` set, `get_category()` function |
| [`backend/app/api/lifting.py`](../backend/app/api/lifting.py) | (Optional) Add `category` to PR response |
| [`frontend/src/app/(app)/lifting/page.tsx`](../frontend/src/app/(app)/lifting/page.tsx) | Reorder PR section with Big 3 first, accessories behind toggle |

---

## 7. Bug Fix: `update_set()` Doesn't Recalculate Session Volume

**Problem**: When a lifting set's weight or reps are updated via [`update_set()`](../backend/app/services/lifting.py:291), the session's `total_volume_kg` is never adjusted. Only [`add_set()`](../backend/app/services/lifting.py:253) and [`delete_set()`](../backend/app/services/lifting.py:314) modify session volume. This means editing a set leaves stale volume data on the session.

**Root Cause**: [`update_set()`](../backend/app/services/lifting.py:291) applies field changes via `setattr()` and flushes, but does not recalculate `session.total_volume_kg`.

### Fix

1. **In [`update_set()`](../backend/app/services/lifting.py:291)**, before applying changes, capture the old volume contribution of the set (`old_weight × old_reps` if not warmup). After applying changes, compute the new contribution and adjust the session volume:
   ```python
   # Before update
   if not lifting_set.is_warmup:
       old_volume = lifting_set.weight_kg * lifting_set.reps
   
   # Apply updates
   for field, value in update_data.items():
       setattr(lifting_set, field, value)
   
   # After update
   if not lifting_set.is_warmup:
       new_volume = lifting_set.weight_kg * lifting_set.reps
       session = await db.get(LiftingSession, lifting_set.session_id)
       if session:
           session.total_volume_kg = max(0.0, (session.total_volume_kg or 0.0) - old_volume + new_volume)
   ```

2. **Also re-run PR check** if weight or reps changed on a non-warmup set, to ensure PRs stay accurate.

### Files to Modify

| File | Change |
|------|--------|
| [`backend/app/services/lifting.py`](../backend/app/services/lifting.py) | Add volume recalculation and PR re-check to `update_set()` |

---

## 8. Bug Fix: Session Deletion Doesn't Clean Up PRs

**Problem**: When a session is deleted via [`delete_session()`](../backend/app/services/lifting.py:141), its sets are cascade-deleted, and any `PersonalRecord` referencing the session has its `session_id` set to `NULL` (via `ON DELETE SET NULL`). However, the PR itself persists — it may now be referencing a weight/reps combination that no longer exists in any session.

**Root Cause**: Same pattern as bug #5. PRs are never recalculated when their source data is removed.

### Fix

1. **In [`delete_session()`](../backend/app/services/lifting.py:141)**, before deleting the session, collect the distinct exercise names from its non-warmup sets:
   ```python
   exercises_affected = {s.exercise_name for s in session.sets if not s.is_warmup}
   ```

2. **After deletion**, for each affected exercise, call `_recalculate_pr_after_deletion()` (the same helper from fix #5). This will:
   - Find the next-best set across all remaining sessions
   - Update the PR to reflect the new best, or delete the PR if no sets remain

3. **This shares the same `_recalculate_pr_after_deletion()` helper** as fix #5 — no new helper needed.

### Files to Modify

| File | Change |
|------|--------|
| [`backend/app/services/lifting.py`](../backend/app/services/lifting.py) | Add PR cleanup to `delete_session()` using `_recalculate_pr_after_deletion()` |

---

## 9. Session Editing UI

**Problem**: The [`PATCH /api/v1/lifting/sessions/{id}`](../backend/app/api/lifting.py) endpoint exists and works, but the frontend has no UI to edit session-level fields (date, focus, program name, notes, duration, RPE). Users must delete and recreate sessions to fix mistakes.

**Goal**: Add an inline edit mode to the session detail view.

### Approach

#### Frontend

1. **Add an "Edit" button to the session detail header** in [`lifting/page.tsx`](../frontend/src/app/(app)/lifting/page.tsx:1156) — Clicking it toggles the session header into an editable form.

2. **Create an `EditSessionForm` component** — Renders editable fields for `session_date`, `focus`, `program_name`, `notes`, `duration_seconds`, and `rpe_session`. On save, calls `PATCH /api/v1/lifting/sessions/{id}`.

3. **Add an `updateSessionMutation`** — Uses `useMutation` with `authFetch` to call the PATCH endpoint. Invalidates `['lifting-sessions']` and `['lifting-session', sessionId]` on success.

4. **Add `LiftingSessionUpdate` payload type** to [`api.ts`](../frontend/src/lib/api.ts).

### Files to Modify

| File | Change |
|------|--------|
| [`frontend/src/app/(app)/lifting/page.tsx`](../frontend/src/app/(app)/lifting/page.tsx) | Add edit button, `EditSessionForm`, `updateSessionMutation` |
| [`frontend/src/lib/api.ts`](../frontend/src/lib/api.ts) | Add `UpdateSessionPayload` type |

---

## 10. Deduplicate PR Entries

**Problem**: [`_check_and_record_pr()`](../backend/app/services/lifting.py:352) creates a new `PersonalRecord` every time a set beats the current best. If a user logs multiple PR-breaking sets in the same session (e.g., 100kg×3 then 105kg×1), both create separate PR records. The older one is now stale but still appears in the PR list.

**Goal**: Keep only the single best PR per exercise. When a new PR supersedes an old one, update the existing record rather than creating a new one.

### Approach

1. **Modify [`_check_and_record_pr()`](../backend/app/services/lifting.py:352)** — Instead of always creating a new `PersonalRecord`, check if one already exists for this user/exercise/record_type. If it does and the new set beats it, **update** the existing record's fields (`weight_kg`, `reps`, `estimated_1rm`, `achieved_date`, `session_id`). If no record exists, create a new one.

   ```python
   if current_pr is None:
       # Create new PR
       pr = PersonalRecord(...)
       db.add(pr)
   elif estimated_1rm > (current_pr.estimated_1rm or 0):
       # Update existing PR
       current_pr.weight_kg = set_data.weight_kg
       current_pr.reps = set_data.reps
       current_pr.estimated_1rm = estimated_1rm
       current_pr.achieved_date = session.session_date
       current_pr.session_id = session.id
   ```

2. **Consider adding a `previous_prs` history table** (optional, future) — For now, the previous best is simply overwritten. A future enhancement could preserve PR history in a separate table.

### Files to Modify

| File | Change |
|------|--------|
| [`backend/app/services/lifting.py`](../backend/app/services/lifting.py) | Update `_check_and_record_pr()` to update rather than duplicate |

---

## 11. Delete Session Confirmation

**Problem**: There is no delete button for sessions in the frontend. The `DELETE /sessions/{id}` endpoint exists but is unused. Users cannot remove sessions they created by mistake.

**Goal**: Add a delete button with a confirmation step to the session detail view.

### Approach

1. **Add a "Delete Session" button** to the session detail header in [`lifting/page.tsx`](../frontend/src/app/(app)/lifting/page.tsx:1156) — Positioned next to the edit button.

2. **Use a two-step confirmation** (same pattern as set deletion and template deletion already in the codebase): first click shows "Confirm Delete" / "Cancel" buttons.

3. **Add a `deleteSessionMutation`** — Calls `DELETE /api/v1/lifting/sessions/{id}`. On success, invalidates queries and clears `selectedSessionId`.

4. **Handle cascade effects in the UI** — After deletion, the session disappears from the list and the detail pane shows the "Select a session" placeholder.

### Files to Modify

| File | Change |
|------|--------|
| [`frontend/src/app/(app)/lifting/page.tsx`](../frontend/src/app/(app)/lifting/page.tsx) | Add delete button with confirmation, `deleteSessionMutation` |

---

## 12. Fix Strava Sport Type Mismatch in Linkable Activities

**Problem**: [`find_linkable_activities()`](../backend/app/services/lifting.py:206) filters by `Activity.sport_type.in_(["strength", "powerlifting"])`, but Strava's API returns sport types like `"WeightTraining"`, `"Workout"`, and `"CrossFit"` for strength activities. This means the link activity modal on the lifting page may not find any matching activities, even when they exist.

**Root Cause**: The filter values don't match what Strava actually stores. The [`sync_activities()`](../backend/app/services/strava.py) service stores the raw Strava sport type string.

### Fix

1. **Update the filter in [`find_linkable_activities()`](../backend/app/services/lifting.py:206)** to include the actual Strava sport types:
   ```python
   Activity.sport_type.in_(["strength", "powerlifting", "WeightTraining", "Workout", "CrossFit"])
   ```

2. **Better approach**: Normalise sport types during Strava sync in [`sync_activities()`](../backend/app/services/strava.py) so that `"WeightTraining"` is stored as `"strength"`. This fixes the issue at the source and benefits all consumers. Apply a mapping:
   ```python
   STRAVA_SPORT_TYPE_MAP = {
       "WeightTraining": "strength",
       "Workout": "strength",
       "CrossFit": "strength",
       "Ride": "cycling",
       "VirtualRide": "cycling",
       "Run": "running",
       # ...
   }
   ```

   **Recommended: Option 2** — Fixes the root cause and ensures consistent data across the app.

3. **Alembic migration** — Backfill existing activities with normalised sport types.

### Files to Modify

| File | Change |
|------|--------|
| [`backend/app/services/strava.py`](../backend/app/services/strava.py) | Add sport type normalisation map in `sync_activities()` |
| [`backend/app/services/lifting.py`](../backend/app/services/lifting.py) | Update filter as fallback until migration runs |
| [`backend/alembic/versions/003_normalise_exercise_names.py`](../backend/alembic/versions/003_normalise_exercise_names.py) | Include sport type backfill alongside exercise name normalisation |

---

## 13. Docker Healthchecks for Worker and Beat

**Problem**: The [`SERVICE_DEFS`](../fittrack.py:103) in `fittrack.py` mark `worker` and `beat` with `"health": "docker"`, meaning they rely on Docker's built-in healthcheck. However, the [`docker-compose.yml`](../docker-compose.yml) defines no healthcheck for these services. As a result, they show as "up" when running but never transition to "healthy" in the monitoring dashboard.

**Goal**: Add proper healthchecks so the service manager can accurately report worker/beat health.

### Approach

1. **Add healthchecks to `worker` and `beat` in [`docker-compose.yml`](../docker-compose.yml)**:
   ```yaml
   worker:
     # ...existing config...
     healthcheck:
       test: ["CMD-SHELL", "celery -A app.tasks.scheduler inspect ping --timeout 5 2>/dev/null | grep -q OK"]
       interval: 30s
       timeout: 10s
       retries: 3
       start_period: 15s
   
   beat:
     # ...existing config...
     healthcheck:
       test: ["CMD-SHELL", "celery -A app.tasks.scheduler inspect ping --timeout 5 2>/dev/null | grep -q OK || true"]
       interval: 30s
       timeout: 10s
       retries: 3
       start_period: 15s
   ```

   **Note**: Beat doesn't run workers itself, so the ping check may not work for it. An alternative is to check that the beat process is running:
   ```yaml
   beat:
     healthcheck:
       test: ["CMD-SHELL", "pgrep -f 'celery.*beat' > /dev/null"]
       interval: 15s
       timeout: 5s
       retries: 3
       start_period: 10s
   ```

2. **Verify in [`_health_label()`](../fittrack.py:384)** — The existing logic already handles Docker healthcheck states correctly, so no changes needed in `fittrack.py` beyond the compose file.

### Files to Modify

| File | Change |
|------|--------|
| [`docker-compose.yml`](../docker-compose.yml) | Add `healthcheck` blocks to `worker` and `beat` services |

---

## Implementation Order

The recommended implementation sequence based on dependencies:

| Order | Feature | Depends On | Effort |
|-------|---------|------------|--------|
| 1 | **#5 — PR deletion bug fix (set)** | None | Small |
| 2 | **#8 — PR deletion bug fix (session)** | #5 (shared helper) | Small |
| 3 | **#7 — update_set() volume bug fix** | None | Small |
| 4 | **#10 — Deduplicate PR entries** | None | Small |
| 5 | **#12 — Strava sport type fix** | None | Small |
| 6 | **#2 — Exercise autocomplete + normalisation** | None | Medium-Large |
| 7 | **#6 — PR display reordering** | #2 (exercise categories) | Small |
| 8 | **#4 — Manual PR entry** | #2 (normalisation), #5 (PR model) | Medium |
| 9 | **#3 — Linked sessions on activities page** | None | Medium |
| 10 | **#9 — Session editing UI** | None | Small |
| 11 | **#11 — Delete session confirmation** | None | Small |
| 12 | **#1 — Custom service states** | None | Medium |
| 13 | **#13 — Docker healthchecks** | None | Small |

Items 1–5 are small bug fixes that can be batched together. Items 9–11 are small frontend improvements that can also be batched. Items 12 and 13 are independent infrastructure improvements.

---

## Database Migrations

| Migration | Description |
|-----------|-------------|
| `003_normalise_data` | Backfill normalised exercise names in `lifting_sets`, `personal_records`, `warmup_templates` (#2) + normalise Strava sport types in `activities` (#12) |
| `004_add_pr_notes_manual_prs` | Add `notes` column to `personal_records` (#4) |

---

## Summary of All File Changes

### New Files
- [`backend/app/services/exercise_db.py`](../backend/app/services/exercise_db.py) (#2)
- [`backend/alembic/versions/003_normalise_data.py`](../backend/alembic/versions/003_normalise_data.py) (#2, #12)
- [`backend/alembic/versions/004_add_pr_notes_manual_prs.py`](../backend/alembic/versions/004_add_pr_notes_manual_prs.py) (#4)
- [`frontend/src/components/ui/ExerciseAutocomplete.tsx`](../frontend/src/components/ui/ExerciseAutocomplete.tsx) (#2)

### Modified Files
- [`fittrack.py`](../fittrack.py) — Custom startup states (#1)
- [`docker-compose.yml`](../docker-compose.yml) — Worker/beat healthchecks (#13)
- [`backend/app/models/lifting.py`](../backend/app/models/lifting.py) — PR `notes` column (#4)
- [`backend/app/models/activity.py`](../backend/app/models/activity.py) — Reverse relationship for linked sessions (#3)
- [`backend/app/schemas/lifting.py`](../backend/app/schemas/lifting.py) — `PersonalRecordCreate` (#4)
- [`backend/app/schemas/activity.py`](../backend/app/schemas/activity.py) — `LinkedLiftingSessionSummary` (#3)
- [`backend/app/services/lifting.py`](../backend/app/services/lifting.py) — Normaliser integration (#2), PR deduplication (#10), PR deletion fixes (#5, #8), volume recalculation (#7), manual PR creation (#4)
- [`backend/app/services/strava.py`](../backend/app/services/strava.py) — Sport type normalisation (#12)
- [`backend/app/api/lifting.py`](../backend/app/api/lifting.py) — `GET /exercises` (#2), `POST /prs` (#4), PR `category` (#6)
- [`backend/app/api/activities.py`](../backend/app/api/activities.py) — Eager load linked session (#3)
- [`frontend/src/lib/api.ts`](../frontend/src/lib/api.ts) — New types for all features
- [`frontend/src/app/(app)/lifting/page.tsx`](../frontend/src/app/(app)/lifting/page.tsx) — Autocomplete (#2), PR reordering (#6), manual PR form (#4), session editing (#9), session delete (#11)
- [`frontend/src/app/(app)/activities/page.tsx`](../frontend/src/app/(app)/activities/page.tsx) — Linked session display (#3)
- [`AGENTS.md`](../AGENTS.md) — Update with new endpoints, models, and patterns
