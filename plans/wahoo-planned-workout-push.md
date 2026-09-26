# Push planned cycle (+ route) to a Wahoo computer

> Status: **implemented** (phases 1–3; phase 4 auto-push still deferred)
> Scope: a `TrainingPlanDay` with `sport="cycle"` (and optionally an assigned
> `planned_route_id`) can be pushed to Wahoo as a scheduled structured workout
> and/or as a route, so it appears on the ELEMNT bike computer.

## Implementation summary

Shipped as described below. Notable decisions taken during implementation:

- **FIT writer hand-rolled** (`app/services/fit_course.py`) rather than adding
  `fit_tool` — the format is round-trip-verified through a definition-aware
  reader in `tests/test_fit_course.py` (and `fitparse` when installed).
- **Plan file builder** (`app/services/wahoo_plan_file.py`) synthesises
  warmup(10%)/main(80%)/cooldown(10%); power target emitted first.
- **One migration `073`** adds `wahoo_plan_id/wahoo_workout_id/wahoo_route_id/
  wahoo_pushed_at/wahoo_push_workout/wahoo_push_route` to `training_plan_days`
  and `wahoo_route_id/wahoo_route_pushed_at` to `routes`.
- **Endpoints**: `POST/DELETE /training-plans/{plan_id}/days/{day_id}/push-to-wahoo`.
  Errors are typed: 404 not-found, 409 no connection, 403 missing scopes, 400/422
  bad selection.
- **UI**: `WahooPushModal` (workout/route checkboxes + pushed state + remove),
  opened from the cycle day's expanded panel in `WeeklyView`.
- Week responses carry the `wahoo_*` fields automatically via
  `TrainingPlanDayRead.model_validate(day)`.
- **Open follow-ups**: exact `workout_type_location` enum values were confirmed
  as 0=indoor / 1=outdoor; auto-push scheduling and unpush-of-unused-plans are
  not implemented.

## 1. Goal / UX

On a cycle day in the training-plan **This Week** view, the user opens the day
detail panel and hits **Push to Wahoo**. A small modal lets them choose:

- [ ] **Structured workout** — built from the day's `planned_zone` /
      `planned_power_watts` / `planned_duration_min` / `workout_description`.
      Disabled when neither FTP nor a zone/power target is available.
- [ ] **Route** — uploads the day's `planned_route_id` route as a Wahoo route.
      Disabled when no route is assigned.

The modal shows push state (`Pushed 2h ago` / `Not pushed`) with **Re-push** and
**Remove from Wahoo** actions. Only days inside Wahoo's display window
(today … +6 days) will actually show on the ELEMNT; the UI warns for days
outside it.

Manual, per-day push only. No automatic/nightly push in v1.

## 2. Current state (what already exists)

| Need | Exists? | Where |
|------|---------|-------|
| Planned cycle day w/ targets | Yes | `TrainingPlanDay` — `planned_zone`, `planned_power_watts`, `planned_duration_min`, `workout_description`, `planned_route_id` (`backend/app/models/training_plan.py:55`) |
| Zone → IF ranges + FTP | Yes | `WORKOUT_ZONES`, `plan_workout()` (`backend/app/services/workout_planner.py:20`, `:213`) |
| Route geometry | Yes | `Route.encoded_polyline`, `elevation_profile`, `start_lat/lng`, `distance_meters`, `elevation_gain_meters` (`backend/app/models/route.py:20`) |
| Polyline decode/encode | Yes | `decode_polyline`, `encode_polyline` (`backend/app/services/polyline_utils.py:16`, `:53`) |
| Wahoo OAuth + token refresh | Yes | `WahooClient`, `refresh_if_needed` (`backend/app/integrations/wahoo_client.py`, `backend/app/services/wahoo.py:69`) |
| Wahoo route/workout **read** | Yes | `get_routes`, `get_workouts` (`wahoo_client.py:85`, `:119`) |
| Wahoo **write** (plans/workouts/routes) | **No** | — |
| Structured `plan.json` builder | **No** | — |
| FIT course encoder (for route upload) | **No** | only `fitparse` (read-only) is a dependency |
| Write OAuth scopes | **No** | scope is `user_read workouts_read routes_read` (`backend/app/services/auth.py:90`) |

## 3. Wahoo API contract (verified against cloud-api.wahooligan.com)

All three flows are the documented "planned structured workout" path.

### 3.1 Create/update a plan (the interval definition)

`POST https://api.wahooligan.com/v1/plans` — multipart form, `plans_write`:

| field | required | value |
|-------|----------|-------|
| `plan[file]` | yes | `data:application/json;base64,<base64(plan.json)>` |
| `plan[filename]` | no | `plan.json` |
| `plan[external_id]` | yes | stable id — we use `fittrack-day-{day_id}` |
| `plan[provider_updated_at]` | yes | ISO8601 of our last update |

Returns a `Plan` with numeric `id`. Update via `PUT /v1/plans/{id}` (also
`plan[file]` + `plan[provider_updated_at]`). Look up by
`GET /v1/plans?external_id=...` for idempotency. Requires `plans_write`.

### 3.2 Schedule a workout instance

`POST https://api.wahooligan.com/v1/workouts` — form, `workouts_write`:

| field | required | value |
|-------|----------|-------|
| `workout[name]` | yes | day description / plan name |
| `workout[workout_token]` | yes | stable — our `day_id` |
| `workout[workout_type_id]` | yes | `0` = BIKING_OUTDOOR, `13` = BIKING_INDOOR |
| `workout[starts]` | yes | `day_date` at 00:00 (or user-preferred time) |
| `workout[minutes]` | yes | `planned_duration_min` |
| `workout[plan_id]` | no | id from 3.1 (structured workout) |
| `workout[route_id]` | no | id from 3.3 (route attached to same workout) |

Update via `PUT /v1/workouts/{id}`. Returns numeric `id`.

> Key: **a workout can carry both `plan_id` and `route_id`** — so one Wahoo
> workout instance can be the structured session *and* the route. If the user
> picks only one, send only that field.

### 3.3 Create/update a route

`POST https://api.wahooligan.com/v1/routes` — multipart, `routes_write`:

| field | required | value |
|-------|----------|-------|
| `route[file]` | yes | `data:application/vnd.fit;base64,<base64(FIT course)>` |
| `route[filename]` | no | `route.fit` |
| `route[external_id]` | yes | stable — our `route_id` |
| `route[provider_updated_at]` | yes | route `updated_at` |
| `route[name]` | yes | route name |
| `route[workout_type_family_id]` | yes | `0` = BIKING |
| `route[start_lat]` / `route[start_lng]` | yes | route start |
| `route[distance]` | yes | meters |
| `route[ascent]` | yes | meters |

Update via `PUT /v1/routes/{id}`; look up via `GET /v1/routes?external_id=...`.
Routes pushed this way sync to the Wahoo App and directly to the ELEMNT
computer (not the ELEMNT phone app).

### 3.4 Plan file (`plan.json`) shape

Header: `name`, `version`, `description`, `duration_s`, `workout_type_family`
(`0` = BIKING), `workout_type_location` (outdoor/indoor enum), optional `ftp`.
Intervals: array of steps, each with `name`, `exit_trigger_type` (`time`),
`exit_trigger_value` (seconds), `intensity_type`
(`wu`/`active`/`recover`/`cd`), and `targets[]` where a target is
`{type:"ftp", low, high}` (fractions of FTP) and/or `{type:"rpm", low, high}`.

> ELEMNT bike computers only honour the **first** target type per interval —
> always emit the power (`ftp`) target first.

### 3.5 Display window

A plan/workout only appears on the ELEMNT when the workout is scheduled
**today through +6 days**. Pushing a day further out still creates the records;
it surfaces when it enters the window.

## 4. Data model changes (one migration)

Migration `071_wahoo_push`:

`training_plan_days` — new nullable columns:
- `wahoo_plan_id: int | None`
- `wahoo_workout_id: int | None`
- `wahoo_route_id: int | None`
- `wahoo_pushed_at: datetime | None`
- `wahoo_push_workout: bool` (server_default false) — what the user chose
- `wahoo_push_route: bool` (server_default false)

`routes` — new nullable columns (a route is reusable across days, so cache the
Wahoo id here rather than re-uploading):
- `wahoo_route_id: int | None`
- `wahoo_route_pushed_at: datetime | None`

Rationale for dedicated columns over reusing `RouteSource`: `RouteSource` is the
**sync-in** ledger keyed by `(provider, provider_route_id)` with a unique
constraint; a pushed route is the **same `Route`** getting an outbound id, and a
route can be both synced-from-Wahoo and pushed-to-Wahoo. Keep the ledgers
separate to avoid clobbering.

No new tables. Update `backend/app/models/training_plan.py` and
`backend/app/models/route.py`, plus the Pydantic `TrainingPlanDayRead` /
`TrainingPlanDayUpdate` schemas (`backend/app/schemas/training_plan.py`).

## 5. Backend implementation

### 5.1 New: `app/integrations/wahoo_client.py` write methods

Add to `WahooClient`, all following the existing `retry_request` pattern:

- `create_plan(token, plan_json, external_id, provider_updated_at) -> dict`
- `update_plan(token, plan_id, plan_json, provider_updated_at) -> dict`
- `find_plan_by_external_id(token, external_id) -> dict | None`
- `create_workout(token, payload) -> dict`
- `update_workout(token, workout_id, payload) -> dict`
- `create_route(token, fit_bytes, meta) -> dict`
- `update_route(token, route_id, fit_bytes, meta) -> dict`
- `find_route_by_external_id(token, external_id) -> dict | None`
- `delete_workout(token, workout_id)` / `delete_plan` / `delete_route` (for unpush)

Multipart bodies via `httpx` `data=`/`files=` (base64 data-URI strings as the
docs show). 403 responses must be surfaced as a typed "scope missing" error.

### 5.2 New: `app/services/wahoo_plan_file.py` (pure)

`build_plan_json(day, ftp) -> dict | None`:

- Return `None` when there is no FTP and no usable target (caller then pushes
  route-only or refuses).
- Map `planned_zone` → IF range via `WORKOUT_ZONES`; if only
  `planned_power_watts` is set, derive `low/high` around it (±5%).
- Split `planned_duration_min` into **warmup 10% / main 80% / cooldown 10%**
  (min 60s each) as three intervals; warmup/cooldown target `0.45–0.65` /
  `0.40–0.55` FTP, main interval uses the zone range.
- `intensity_type`: `wu` / `active` / `cd`.
- Header `workout_type_family=0` (BIKING); `workout_type_location` set to
  indoor when the day has no route, else outdoor.
- Power target always first in `targets`.

This is intentionally simple for v1 (days don't carry interval structures).
Future: derive real intervals if/when cycle days gain a structured interval
field.

### 5.3 New: `app/services/fit_course.py` (pure)

Encode a FIT **course** file from `decode_polyline(Route.encoded_polyline)` +
`Route.elevation_profile`:

- Course points: lat/lng/altitude + cumulative distance.
- Course header: name, sport = cycling.
- CRC handling.

**Dependency decision (open question, see §9):** `fitparse` is read-only. Either
add `fit_tool` (pure-Python FIT writer, minimal) or hand-roll a small FIT
writer. Hand-rolling keeps deps flat but is ~150 lines of binary packing; a
library is safer. Recommend `fit_tool`.

### 5.4 New: `app/services/wahoo_push.py`

Orchestrator, signature `(db, user_id, plan_id, day_id, push_workout, push_route)`:

1. Load day + plan (ownership check), load connection via
   `get_wahoo_connection`; `refresh_if_needed`.
2. If `push_workout`: build plan.json; `find_plan_by_external_id` →
   create or update plan; then create/update the workout instance with
   `plan_id` (+ `route_id` if also pushing/known).
3. If `push_route`: load `Route`; if `Route.wahoo_route_id` is null, encode FIT
   and create; else update. Then attach `route_id` to the workout instance.
4. Persist `wahoo_*` ids/timestamps on the day and `Route`.
5. Return a status dict.

All writes happen in the request session (`get_db` commits). Failures roll back
so no half-pushed day is recorded.

`remove_from_wahoo(db, user_id, plan_id, day_id)` deletes the Wahoo workout
(and optionally the plan; leave the route in the library).

### 5.5 API endpoints (add to `backend/app/api/training_plans.py`)

- `POST /training-plans/{plan_id}/days/{day_id}/push-to-wahoo`
  body `{"push_workout": bool, "push_route": bool}` → status.
  - 400 if neither selected / no target & no route.
  - 409 if no Wahoo connection.
  - 403 (typed) if the connection lacks write scopes → frontend prompts
    reconnect.
- `DELETE /training-plans/{plan_id}/days/{day_id}/push-to-wahoo` → unpush.
- `GET  /training-plans/{plan_id}/days/{day_id}/wahoo-status` → current ids
  (or fold into the week response — see §5.6).

### 5.6 Week response

Add `wahoo_pushed: bool` / `wahoo_pushed_at` / `wahoo_plan_id` /
`wahoo_workout_id` / `wahoo_route_id` to `TrainingWeekDay`
(`backend/app/schemas/training_plan.py:213`) and populate in
`get_plan_week` so the UI can render state without an extra round-trip.
Remember pitfall #26: manual construction in the API needs the new fields.

### 5.7 OAuth scope migration

- Update `auth.py:90` scopes to
  `user_read workouts_read workouts_write routes_read routes_write plans_read plans_write`.
- The Wahoo developer app must have these scopes enabled/approved (portal).
- **Existing connections won't have write scopes** — they are not retroactively
  granted. The push endpoint's 403 must carry a clear "Reconnect Wahoo to grant
  write access" message; the UI links to the existing reconnect flow
  (`connection_health` / Settings badge). Consider marking the connection
  `needs_reauth` when a write returns 403 so the global banner shows it.

## 6. Frontend implementation

- **Types** (`frontend/src/lib/api/types/`): extend `TrainingWeekDay` with the
  wahoo fields; add `WahooPushRequest` / `WahooPushStatus`.
- **API client**: `pushPlanDayToWahoo`, `removePlanDayFromWahoo` — in
  `lib/api/trainingPlans.ts` (day-scoped, same file) using `useAuthFetch`.
- **UI** (`frontend/src/components/training/WeeklyView.tsx`):
  - In `ExpandedPanel`, for `day.sport === 'cycle'`, render a **Push to Wahoo**
    button (or a `Pushed` badge with re-push/remove when already pushed).
  - New `WahooPushModal.tsx` in `components/training/` (use the shared
    `Modal`, which portals to `document.body` — pitfall #32): two checkboxes
    with availability guards, display-window warning, status line.
  - Hide/disable entirely when the user has no Wahoo connection; show a
    one-line "Connect Wahoo in Settings" hint.
  - On 403 scope error, show "Reconnect Wahoo" CTA.
- **Settings**: no new UI needed beyond the existing connection card; the
  reconnect action already re-runs the OAuth flow with the new scopes.

## 7. Edge cases / limitations

- **No FTP and no power/zone target** → workout push unavailable; only route
  push is offered.
- **Day outside today…+6** → records created but not shown on device yet; warn.
- **Route without elevation** → FIT course still valid (altitude omitted);
  ascent sent as 0.
- **Very long routes** → cap/decimate course points (e.g. every Nth point) to
  keep the FIT file small; document the threshold.
- **Duplicate protection** via `external_id` (plans/routes) and stored ids
  (workouts); always look up before create.
- **Wahoo token limits** (10 unrevoked access tokens/user from 2026-01-01):
  `refresh_if_needed` already commits rotated tokens immediately; push must
  actually make the API call right after refresh (it does).
- **Unpush** deletes the Wahoo workout; the plan and route stay in the library
  (matching Wahoo's own delete semantics).
- **Indoor vs outdoor**: workout location inferred from route presence; not
  user-selectable in v1.

## 8. Testing plan

Unit (pure, no network):
- `build_plan_json`: zone→IF mapping, warmup/main/cooldown split, duration
  accounting, power-first target ordering, no-FTP returns `None`.
- `fit_course`: encode a small polyline+elevation → parse back with `fitparse`
  and assert lat/lng/alt/distance round-trip (nice because `fitparse` is already
  a dep).
- external_id determinism (`fittrack-day-{id}`, route id).

Service (mock `wahoo_client`):
- create-vs-update branching on `find_*_by_external_id`.
- plan+route attached to one workout instance.
- ids/timestamps persisted; rollback leaves no partial state.
- 403 surfaces the scope error.

API integration (existing `tests/integration/` harness, mocked client):
- `POST .../push-to-wahoo` happy path, 400/409/403 branches.
- `DELETE .../push-to-wahoo`.

Manual:
- Sandbox Wahoo app → real push → confirm the session + route appear on an
  ELEMNT (within the +6-day window).

## 9. Open questions

1. **FIT writer**: add `fit_tool` dependency, or hand-roll a minimal course
   encoder? (Recommend `fit_tool`.)
2. **Plan/route `external_id` scheme**: confirm `fittrack-day-{day_id}` and
   `route_id` are acceptable stable ids (they are per our ownership).
3. **`workout_type_location` enum values** for the plan header: confirm
   indoor/outdoor numeric values from the plan-json-format PDF before coding.
4. **Auto-push** later: optional nightly push of the next 7 days' cycle days
   for users who opt in (out of scope for v1).
5. **Unpush scope**: delete only the workout, or also the plan/route when no
   other day uses them?

## 10. Suggested phasing

1. **Workout push** — plan.json builder + `plans`/`workouts` client methods +
   service + endpoint + minimal modal. No new dependency.
2. **Route push** — FIT encoder (+ dependency) + `routes` client methods +
   route cache columns.
3. **Polish** — week-response status fields, unpush, display-window warning,
   scope-reconnect UX.
4. **Optional** — auto-push scheduler.
