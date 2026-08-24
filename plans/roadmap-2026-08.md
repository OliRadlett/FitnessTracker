# Feature Roadmap — August 2026

Agreed plan for the feature list in `prompt.txt`. Worked through collaboratively; each phase below was designed and approved before implementation.

**Execution order:** Phase 1 → 2 → 3 → 4 → 5 (A→B→C) → 6 → 7 → 8 → 9

---

## ⚠️ SESSION HANDOFF — READ THIS FIRST (updated 2026-08-24)

**Status: Phases 1 & 2 COMPLETE. Next up: Phase 3 (Ride Fueling).**

Completed and verified this session:
- **Phase 1**: VO2max ACSM formula fix (BUG-049), Whoop respiratory-rate/backfill/retry/gap-detection fixes (BUG-050), provider SVG icons on activities page, BUG-039/043/044 quick wins. All in `docs/BUGS.md`.
- **Phase 2**: Full weakness/deficiency feature — backend (`services/deficiency.py`, `api/deficiency.py` at `/api/v1/deficiency?weeks=8`, `schemas/deficiency.py`, registered in main.py), frontend (`lib/api/deficiency.ts`, `types/deficiency.ts`, `DeficiencyCard.tsx` on dashboard WeeklyTab + lifting page), 43 unit tests passing, tsc + vitest green.

**Uncommitted**: ALL of the above work is uncommitted in the working tree (user has not requested commits). Check `git status` first — per AGENTS.md, only commit files from your own session; ask before committing these.

**To resume Phase 3**, read the Phase 3 spec below. Implementation order:
1. `backend/app/models/nutrition.py` — RideFuelPlan model
2. Alembic migration — check latest revision head first (⚠️ Pitfall #8: chain is 001…013→014(surface)→015…→024; number sequentially)
3. `schemas/nutrition.py`, `services/nutrition.py` (fuel schedule generation), `api/nutrition.py` (CRUD), register router in main.py
4. Frontend: `lib/api/nutrition.ts`, `types/nutrition.ts`, barrel exports, `FuelPlanCard.tsx`, integrate into activities page detail + training page planned rides
5. Update CODEMAPs + this doc

Phases 4–6 are fully specced below and approved. Phases 7–9 need planning discussion with the user before implementation.

---

## Phase 1: Bug Fixes & Data Quality — **DONE**

### 1A. VO2max Critical Fix
- **Critical bug**: ACSM power formula double-divides by body weight (`vo2max.py:85-88, 104-105, 121-122, 255-256`). The sanity check always rejects the inflated value → power-based method never produces a result; all users only see HR-based estimates.
  - Fix: `vo2_ml_kg_min = (10.8 * power_watts) / weight_kg + 7`
- Docstring confidence fix: says 0.5 without weight, code uses 0.4
- History function silently defaults to 75kg with no confidence tracking → flag defaulted weight in output
- Highest-estimate selection biases upward → prefer highest confidence, tie-break by value
- `get_or_create_cycling_profile` called twice per estimate → fetch once
- Frontend trend text misstates time span (`Vo2maxSection.tsx:55`)

### 1B. Respiratory Rate Fixes (`backend/app/services/whoop.py`)
- Backfill query only checks `recovery_score IS NULL` → change to `(recovery_score IS NULL) OR (respiratory_rate IS NULL)` (lines 404-459)
- `backfill_whoop_data()` has no recovery retry pass → add equivalent second-pass retry (lines 1155-1261)
- Stale docstring in `whoop_client.py` (flat vs nested recovery response)

### 1C. Whoop Data Gaps
- `get_recovery_for_cycle` swallows 500-series errors as `None` (`whoop_client.py:247-265`) → let `retry_request` handle retries; only return None on 404
- Backfill pass has zero retry logic + uses `logger.debug` for failures (`whoop.py:404-459`) → add 3x rate-limit retry loop, upgrade to `logger.warning`
- `backfill_whoop_data` uses 100ms delay vs 300ms in regular sync → increase to 300ms
- Add gap detection: after sync, log warnings for missing days

### 1D. Wahoo/Provider Logo Consistency
- `activities/page.tsx:45-85`: replace emoji icons with SVG paths + ProviderIcon component (match routes page pattern):
  - `strava: '🚴'` → `/icons/strava.svg`, `komoot: '🗺️'` → `/icons/komoot.svg`, `wahoo: '📊'` → `/icons/wahoo.svg`

### 1E. Deferred Bug Quick Wins
- BUG-039: Refactor dashboard `handleAnalyze` to `useMutation` (~15 lines)
- BUG-043: Extract calendar IIFE to `DayMetricsBadges` component (~20 lines)
- BUG-044: Unify `formatDuration` into shared utility in `lib/utils.ts`

**Skipped (deferred):** BUG-015 (double-commit), BUG-025 (OAuth redirect_uri), BUG-040/041 (dashboard architecture), BUG-045/048 (ops tasks)

---

## Phase 2: Weakness/Deficiency Analysis — **DONE** (thresholds adjustable later)

Implemented: `services/deficiency.py`, `api/deficiency.py` (`GET /api/v1/deficiency?weeks=8`),
`schemas/deficiency.py`, `DeficiencyCard.tsx` on dashboard + lifting page, 43 unit tests.
Note: Big-3 standards use Squat 1.0/1.5/2.0/2.5×BW, Bench 0.6/1.0/1.4/1.8×BW, Deadlift 1.2/1.75/2.4/3.0×BW
(refined from the draft table below during implementation). Sumo/front-squat variants NOT folded into Big-3 PRs.

Both lifting AND cycling weaknesses. Detailed numeric output with external standards.

### Architecture
```
backend/app/services/deficiency.py    — analysis engine
backend/app/api/deficiency.py         — GET /api/v1/deficiency
frontend/src/components/dashboard/DeficiencyCard.tsx
```

### Lifting Analysis
**A. Bodyweight-strength standards** (embedded table, StrStandards/ExRx-style, by BW bands):

| Lift | Beginner | Intermediate | Advanced | Elite |
|------|----------|--------------|----------|-------|
| Squat | 0.8×BW | 1.2×BW | 1.8×BW | 2.2×BW |
| Bench | 0.6×BW | 0.9×BW | 1.2×BW | 1.5×BW |
| Deadlift | 1.0×BW | 1.5×BW | 2.2×BW | 2.6×BW |

**B. Inter-exercise ratios:** Bench/Squat 0.65–0.75 ideal; Deadlift/Squat 1.0–1.2; Bench/Deadlift 0.55–0.65

**C. Push vs Pull volume balance:** ideal push:pull 1.0–1.3 over recent N weeks; <0.8 = pulling deficit

### Cycling Analysis
- VO2max classification vs FTP classification mismatch (e.g., Good VO2max + Average FTP = threshold limiter)
- Decoupling >8% = aerobic deficiency → more Z2
- Power zone distribution (30d): >80% Z1/Z2 = missing intensity; >40% Z4+ = too much intensity; <5% Z3 = missing tempo

### API Response Shape
```json
{
  "weaknesses": [{"category", "type", "metric", "value", "unit", "severity",
                   "detail", "recommendation", "level", "next_level_target"}],
  "summary": {"total_weaknesses", "critical", "high", "medium", "low", "strengths"},
  "computed_at"
}
```
Severity-coded badges (red/orange/yellow/green); collapsible Medium/Low. Shown on dashboard + lifting page (cycling-only mode).

**Thresholds adjustable later** (user decision).

### Files
Create: `services/deficiency.py`, `api/deficiency.py`, `schemas/deficiency.py`, `lib/api/deficiency.ts`, `types/deficiency.ts`, `DeficiencyCard.tsx`
Update: api CODEMAP, `api/index.ts`, dashboard page, lifting page

---

## Phase 3: Ride Fueling (Nutrition) — **DONE**

Implemented: `models/nutrition.py` (RideFuelPlan), migration `025_add_ride_fuel_plans.py`,
`services/nutrition.py` (targets matrix + timed schedule + IF estimation NP/FTP→AP/FTP→TSS-derived),
`api/nutrition.py` (`POST/GET/PATCH/DELETE /api/v1/nutrition/fuel-plan`, `GET /fuel-plan/activity/{id}`),
21 unit tests. Frontend: `lib/api/nutrition.ts`, `types/nutrition.ts`, `FuelPlanCard.tsx`
(badges + timeline + actuals logging) in activities page detail for cycling rides.
Note: training-page "Generate Fuel Plan" for planned rides deferred to Phase 5B weekly view.

Scope: ride fueling ONLY (not full nutrition tracking — future work). Suggestions for planned rides + log actual consumption post-ride.

### Fuel Science (carbs g/hr by duration × IF)

| Duration | IF<0.75 | 0.75–0.85 | >0.85 |
|----------|---------|-----------|-------|
| <60min | none | optional snack | snack |
| 60–120 | 30 | 40 | 50 |
| 120–180 | 50 | 60 | 70 |
| 180–300 | 60 | 80 | 90 |
| >300 | 80 | 90 | 100–120 |

Hydration: 500–750ml/hr adjusted for weight/intensity. Sodium: 300mg/hr base, 500–750mg/hr for >2hr or high intensity.
Pre-ride (2hr before): 1–2g carbs/kg. Post-ride (<30min): 1.0–1.2g carbs/kg + 0.3g protein/kg.

### Full Schedule Output (user choice)
Timeline like: `30min: Gel 25g carbs + 250ml water` / `60min: Bar 40g carbs + electrolyte` etc., plus pre/post windows with food suggestions.

### Data Model (`models/nutrition.py`)
```
RideFuelPlan: id, user_id, activity_id (nullable), planned_duration_min, planned_if,
  pre_ride_carbs_g, during_carbs_per_hour_g, during_hydration_ml_per_hour,
  during_sodium_mg_per_hour, post_ride_carbs_g, post_ride_protein_g,
  actual_pre_ride_notes, actual_during_notes, actual_post_ride_notes,
  source ("auto"|"manual"), timestamps
```

### API
```
POST /api/v1/nutrition/fuel-plan
GET  /api/v1/nutrition/fuel-plan/{id}
PATCH /api/v1/nutrition/fuel-plan/{id}      — add actuals
GET  /api/v1/nutrition/fuel-plan/activity/{activity_id}
```

### Frontend
- `FuelPlanCard.tsx` — timeline view; planned rides editable, completed rides plan-vs-actual with green/yellow/red coding
- Activities page expanded detail: fuel section alongside stream charts
- Training page planned rides: "Generate Fuel Plan"

---

## Phase 4: Weather Integration — **DONE**

Implemented: `models/weather.py` (CachedWeather), migration `026_add_weather.py` (cached_weather table +
home_lat/home_lng on cycling_profiles + 5 weather_* columns on activities),
`services/weather.py` (Open-Meteo client, WMO mapping, bad-weather thresholds, coordinate resolution
profile→route→raw_data, caching 1hr/6hr/permanent, archive-vs-past_days handling for recent dates),
`api/weather.py` (`GET /current`, `GET /forecast`, `GET /historical`, `POST /tag-activity/{id}`,
`GET /for-activity/{id}`), Celery task `refresh_weather_forecasts` daily 5AM + post-sync tagging hook,
125+ backend tests passing.
Frontend: `WeatherWidget` (dashboard), `WeatherForecast` with bad-weather badges (training page),
`WeatherBadge` (activity list + detail), home lat/lng inputs in ProfileEditor, shared `weatherEmoji()` helper.

Provider: **Open-Meteo** (free, no key). All data types (current/forecast/historical), all use cases (widget, training forecast, bad-weather warnings, activity tags).

### Location Strategy
Add `home_lat`/`home_lng` to CyclingProfile (user sets once in settings). Fallback: most recent activity's location.
Coordinates per activity: `Route.start_lat/lng` (best) → `raw_data["start_latlng"]` → decode polyline first point.

### Endpoints
```
Current:    api.open-meteo.com/v1/forecast?latitude&longitude&current=temperature_2m,...
Forecast:   api.open-meteo.com/v1/forecast?...&daily=weather_code,temp_max/temp_min,precipitation_sum,...
Historical: archive-api.open-meteo.com/v1/archive?start_date&end_date&daily=...
```

### Data Model
- `CachedWeather`: id, user_id, lat/lng, weather_data JSONB, type ("current"|"forecast"|"historical"), cached_at, expires_at (+1hr/+6hr/permanent)
- Activity columns: `weather_temperature`, `weather_conditions`, `weather_wind_speed`, `weather_wind_direction`, `weather_precipitation_mm`

WMO code mapping: 0=Clear, 1-3=Partly/Overcast, 45/48=Fog, 51/53/55=Drizzle, 61/63/65=Rain, 71-75=Snow, 80-82=Showers, 95+=Thunderstorm

### Bad Weather Thresholds
Temp <5°C or >32°C · wind >40km/h strong, >60 dangerous · precip >50% prob or >2mm · rain/snow/thunder codes

### Celery Task
`refresh_weather_forecast` daily 5AM UTC: refresh forecasts for users with home set; check planned rides next 7 days → warnings.

### Post-Sync Tagging
After activity sync: resolve coordinates → fetch historical weather for activity date/location → store on Activity columns.

### Frontend
`WeatherWidget` (dashboard), `WeatherForecast` (training page w/ warning badges), `WeatherBadge` (activity cards), home-location input in settings.

Display-only — never modifies plans.

---

## Phase 5: Training Page Overhaul (3 sub-phases)

Context: three disconnected systems today — SuggestedCycleCard (cycling page, read-only), WorkoutPlanner (route matching, no persistence), PlanBuilder (buggy grid). Overhaul unifies them. **Strength training integrated throughout.**

### 5A. Plan Builder Full Redesign (full rewrite chosen)
- Creation: blank plan OR template
- Week tabs instead of one giant grid
- Day cards expandable: type, duration, TSS, notes, workout description, linked activity, mark-as-completed checkbox
- Drag-and-drop reorder within/between weeks
- Sport-aware day editor:
  - Cycle: power/HR/route targets
  - Strength: focus selector, exercise list editor (reuse ExerciseAutocomplete), sets×reps×weight, auto-computed target volume, target RPE
  - Rest
- Template generation produces mixed weeks matching suggested-cycle logic (Tue/Thu strength, Mon/Wed/Fri/Sat rides, Sun rest)

Model changes on TrainingPlanDay:
```
sport ("cycle"|"strength"|"rest"), planned_focus, planned_exercises JSONB,
planned_volume_kg, planned_rpe, planned_power_watts, planned_zone,
planned_route_id, workout_description, lifting_session_id FK
```
Backend: extract `_generate_plan_days` into `services/training_plan.py`; FIX destructive save (delete+recreate destroys completed/activity_id) with proper upsert.

Event-plan linkage: `event_id` FK on TrainingPlan; plan end date auto = event_date − taper_days; auto-taper phase generation.

Files: model update, new service, API update, schemas, rewrite `PlanBuilder.tsx`, new `StrengthDayEditor.tsx`.

### 5B. Weekly Planning (new weekly view)
- WeeklyView: 7-day grid for current week of active plan, week navigation prev/next
- Day cards show by sport:
  - Cycle: weather + bad-weather badge, route matches inline (WorkoutPlanner logic reused)
  - Strength: exercise summary, readiness indicator, warmup template suggestion
  - Actual side: linked activity/LiftingSession stats + conformity badge
- Detail panel: targets, hourly weather, route options w/ "Assign to this day", actual results, notes
- "Commit to this week" persists planned week with assignments (absorbs SuggestedCycleCard commit concept; SuggestedCycleCard removed from cycling page)
- Backend: `GET /training-plans/{id}/week/{n}`, `POST /training-plans/{id}/commit-week`

### 5C. Planned Cycle Conformity
Flow: commit planned cycle (HR/power/route/exercises) → activity syncs → auto-link → conformity score.

Auto-linking: extend existing ±1-day activity-lifting matching to also fill TrainingPlanDay.activity_id / lifting_session_id.

**Cycle conformity weights:** Duration 25%, Power 30%, HR 15%, TSS 20%, Route 10%.
Score = Σ `1 − abs(planned−actual)/planned` weighted; route = 100% same/50% different/0% unplanned.
Classification: ≥90 Excellent, 70–89 Good, 50–69 Partial deviation, <50 Significant.

**Strength conformity weights:** Volume 35%, exercises completed 30%, duration 15%, RPE ±1 = full 10%, focus match 10%.
Deviation text e.g. "82% of planned squat volume".

Weekly aggregate: overall adherence %, trend vs previous weeks, patterns. Dual-mode ConformityCard.

Endpoints: `GET /training-plans/{id}/conformity`, `GET /training-plans/{id}/day/{day_id}/conformity`.
Service: `services/conformity.py`.

Dependencies: 4→5B (weather); 5A→5B→5C.

---

## Phase 6: Semantic Goals & Data-Driven Check-ins

### Semantic Metric Registry (replaces goal_type + notes-overloading)
`Goal` model rework:
```
metric str, filter_json JSONB (e.g. {"exercise": "Back Squat"}),
target_value, target_date, status ("active"|"achieved"|"expired"|"abandoned"),
starting_value float (snapshot at creation), current_value cached, notes free-form
```

Registry (`services/goal_metrics.py`) — key/resolver/unit/default-direction:
ftp_watts, body_weight, estimated_1rm(+exercise), weekly_sessions(+sport),
monthly_distance_km(+sport), weekly_tss, vo2max,
squat_bw_ratio, bench_bw_ratio, deadlift_bw_ratio, big3_total, resting_hr (decrease), hrv_ms

**No direction column (user decision)**: achievement derived from starting_value vs target — if start above target, achieved when current ≤ target; if start below, achieved when current ≥ target.

### Data-Driven Check-ins
- `GoalCheckIn`: id, goal_id, user_id, check_in_date, value, alignment_pct, note, source ("auto"|"manual")
- **Cadence: WEEKLY (user decision)** — Celery task `record_goal_checkins` Mon 6AM UTC snapshots every active goal
- Manual check-ins with notes anytime; history renders as line chart per goal

### Alignment Score
```
elapsed  = (today − created) / (target_date − created)
progress = (current − start) / (target − start)   # sign-aware via start/target comparison
alignment_pct = clamp(progress / elapsed, 0–200)
```
>100 ahead · ~100 on track · <100 behind · negative regressing. No target_date → plain progress %.

### Fixed Transitions
- `_update_goal_status(goal)` service called uniformly on create/read/update (currently a GET-list side effect)
- Expired + metric later crosses target → "reactivate" endpoint/button
- Literal validation on status/metric in schemas

### Dedicated Goals Page
`app/(app)/goals/page.tsx` — tabs Active/Achieved/Expired/All; cards with progress bar, alignment badge, check-in sparkline, next-milestone text. GoalDetailModal: full chart + manual check-in form + edit/delete/reactivate. Dashboard keeps compact top-3. Sidebar nav entry added.

### Migration
Old→new: 5 known goal_types map to metrics; parse exercise out of notes for 1rm_target; backfill starting_value; weight_target goals default to target-weight semantics (no direction needed under new rule).

### API
```
GET/POST /goals, PATCH/DELETE /goals/{id}
GET /goals/metrics                    — drives form dynamically
POST/GET /goals/{id}/checkins
POST /goals/{id}/reactivate
```

---

## Phase 7: Projections & Success Prediction *(to be detailed after Phase 6)*

Linear regression trends (FTP/weight/VO2max), success probability per goal (builds on Phase 6 check-in history), TSB trajectory projection for events, projection charts on goals page.

## Phase 8: Activities & Routes Page Overhauls *(to be detailed)*
8A Activities: filtering, visualizations, weekly summary redesign. 8B Routes: comparison, surface/elevation improvements, recommendations.

## Phase 9: Wiki Expansion & Strength Videos *(to be detailed)*
Wiki sections for new features; video URL/upload on LiftingSession + PRs; video display component.

---

## Key Decisions Log
| Decision | Choice |
|----------|--------|
| Priority order | Bug fixes first |
| Nutrition scope | Ride fueling now; full system later |
| Training overhaul | Broken into 5A/5B/5C |
| Deficiency meaning | Weak areas (weak squat vs powerlifting numbers, weak vo2max vs cycling metrics) |
| Weakness scope | Both lifting + cycling, detailed numbers, external standards |
| Fuel specificity | Full schedule with timing |
| Hydration | Basic ml/hr + sodium/electrolytes |
| Fuel logging | Suggestions on planned rides + log actuals post-ride |
| Weather provider | Open-Meteo |
| Plan builder | Full redesign |
| Weekly planning | New view mode |
| Planned cycle | Commit mechanism for planned rides w/ conformity analysis (extends SuggestedCycle + WorkoutPlanner) |
| Plan-event link | Yes, auto-taper |
| Strength training | Integrated across 5A/5B/5C |
| Goal direction | No direction column — derive from starting_value vs target |
| Check-in cadence | Weekly |
