# Feature Roadmap — August 2026

Agreed plan for the feature list in `prompt.txt`. Worked through collaboratively; each phase below was designed and approved before implementation.

**Execution order:** Phase 1 → 2 → 3 → 4 → 5 (A→B→C) → 6 → 7 → 8 → 9

---

## ⚠️ SESSION HANDOFF — READ THIS FIRST (updated 2026-08-25)

**Status: Phases 1–9 COMPLETE (wiki built, video system spec-only). Roadmap fully executed.**

All phases committed and pushed to `main`. Migrations 025–029 pending deployment
(`python fittrack.py migrate`). Video system (Phase 9) is specced but not built —
see the Phase 9 section for the full Cloudflare R2 architecture spec.

Key implementation notes:
- Training-plan day saves send the FULL days array (backend deletes dates missing from payload)
- `services/conformity.py::link_activities_to_plan_days` uses `populate_existing=True`
- `SuggestedCycleCard.tsx` orphaned (removed from cycling page, file kept)
- Frontend API clients: some take explicit `token` param (weather/conformity) due to 404-as-null needs

Remaining work not in the roadmap: video system implementation, full nutrition tracking,
Komoot client rework, new integrations (Garmin/TrainingPeaks/Zwift/Apple Health),
full E2E tests (Playwright), frontend component tests (Vitest + RTL).

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

### 5A. Plan Builder Full Redesign — **DONE**

Implemented: TrainingPlanDay sport fields (`sport`, `workout_description`, `planned_focus`,
`planned_exercises` JSONB, `planned_volume_kg`, `planned_rpe`, `planned_power_watts`,
`planned_zone`, `planned_route_id`, `lifting_session_id`) + `TrainingPlan.event_id`;
migration `027_add_training_day_sport_fields.py`; new `services/training_plan.py`
(non-destructive day upsert by day_date, mixed-week generation, event clamp + linear
100%→40% taper); thin router; PlanBuilder full rewrite (week tabs, sport-aware editors,
exercise autocomplete rows, drag-swap dates, sticky save bar, stale-state fix).
16 integration tests incl. destructive-save regression test.
NOTE: saves send the FULL days array — backend deletes dates missing from payload.

### 5B. Weekly Planning (new weekly view) — **DONE**

Implemented: `GET /training-plans/{id}/week/{n}?include_weather=` (Monday-aligned weeks,
readiness strip, per-day weather + bad-weather flags, actual activity/lifting summaries,
route matches for cycle days via WorkoutPlanner reuse) and
`PATCH /training-plans/{id}/days/{dayId}` (targeted single-day update).
Frontend `WeeklyView.tsx` on training page (Plan Builder | This Week toggle): week nav,
day cards w/ weather + warnings + actuals + ConformityBadge, expandable day panel with
route assignment and quick-edit, "Link activities" button.
SuggestedCycleCard removed from cycling page (component file kept, now orphaned).

### 5C. Planned Cycle Conformity — **DONE**

Implemented: `services/conformity.py` — cycle scoring (Duration .25/Power .30/TSS .20/Route .10,
weights renormalized over present components; no planned_hr column so HR skipped) +
strength scoring (Volume .35 capped at 120% over-performance / exercises-completed .30 /
duration .15 / RPE ±1 full score .10 / focus match .10); classification ≥90 Excellent /
≥70 Good / ≥50 Partial / else Significant; deviation sentences >8% deviation;
`GET /{plan_id}/conformity` weekly aggregate w/ trend + pattern heuristics,
`GET /{plan_id}/days/{day_id}/conformity`, `POST /{plan_id}/link-activities` +
auto-linking hook in the Strava sync celery task (⚠️ uses populate_existing to avoid
identity-map staleness). Frontend: ConformityBadge on day cards, DayConformityPanel
in expanded view, weekly conformity strip (overall %, trend arrow, per-sport chips, patterns).

Dependencies: 4→5B (weather); 5A→5B→5C.

---

## Phase 6: Semantic Goals & Data-Driven Check-ins — **DONE**

Implemented: Goal model rework (metric/filter_json/starting_value, goal_type dropped),
GoalCheckIn model, migration `029_semantic_goals.py` (data-maps 5 legacy goal_types →
metric keys, parses 1rm exercise from notes into filter_json, backfills starting_value
lazily), `services/goal_metrics.py` (13-metric registry with resolvers reusing existing
services), `services/goals.py` (direction derived from starting_value vs target — no
column, alignment_pct 0–200 clamped, status transitions on all read/write paths incl.
abandoned terminal, check-in CRUD with duplicate-today skip), weekly Celery task
`record_goal_checkins` Mon 6AM UTC, rewritten thin API router with enriched GET list +
`GET /goals/metrics` for dynamic forms + check-in/reactivate endpoints.
Frontend: dedicated `/goals` page (Active/Achieved/Expired/All tabs), GoalCreateModal
(metric-registry-driven dynamic form), GoalDetailModal (Recharts check-in history +
manual check-in + edit/delete/reactivate), updated GoalCard (direction-aware progress,
alignment badge), compact top-3 on dashboard, Goals sidebar entry.
58 goal tests + 31 integration tests; full suite 526 passed.

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

## Phase 7: Projections & Success Prediction — **DONE**

Implemented: `services/projections.py` (OLS linear regression, project_to_target,
success_badge On Track/At Risk/Unlikely/Not enough data, TSB projection via EMA),
`api/projections.py` (`GET /projections/goal/{id}`, `GET /projections/metric/{key}`,
`GET /projections/tsb/{plan_id}` event-linked only), 29 unit + 9 integration tests.
Frontend: projection line (dashed) + badge in GoalDetailModal, ProjectionCard strip
on goals page (top 5 active goals with target_date), TSB race-day freshness callout
in WeeklyView for event-linked plans. 12-week regression window, ≥4 points required.

### Regression Engine (`services/projections.py`)
- `linear_regression(points: list[(date, float)]) -> (slope_per_day, intercept, r_squared, n)` — OLS on day-offsets, pure function
- `project_to_target(metric_history, target_value, direction) -> {projected_date, days_remaining, confidence}` — extrapolates trend to target crossing; confidence from r² × data-point-count
- `success_badge(goal, checkins, today) -> str` — **badge only** (no percentage): "On Track" / "At Risk" / "Unlikely" / "Not enough data"; derived from: is slope heading toward target?, projected_date vs target_date, data sufficiency (n≥4 = good, n<2 = low)
- **12-week regression window** per goal; ≥4 data points required else "Not enough data"
- `tsb_projection(plan, ctl_atl_today, days_ahead) -> list[{date, tsb}]` — **event-linked plans only**: project CTL/ATL forward using planned TSS from training plan days; TSB = CTL - ATL; shows freshness on race day

### Endpoints
```
GET /api/v1/projections/goal/{goal_id}   — trend, projection, badge, history, projection_line
GET /api/v1/projections/metric/{key}?months=6  — trend for any registry metric
GET /api/v1/projections/tsb/{plan_id}?days=14  — event-linked TSB trajectory only
```

### Frontend
- GoalDetailModal: dashed projection line extending from last check-in to projected date + badge
- ProjectionCard on goals page: per active goal with target_date — badge + projected date
- Event-linked plan: race-day freshness callout ("TSB +15 on race day — optimal freshness")

### Tests
Pure regression math (known slopes, 1-point edge, flat trend, perfect correlation), badge boundaries, TSB projection with mock plan TSS.

---

## Phase 8A: Activities Page Overhaul — **DONE**

Implemented: 9 new query params on GET /activities (q, min/max distance/duration/tss,
sort_by, sort_order), stream-overlay comparison (pick 2 rides → overlaid power/HR +
stat deltas modal), Stats view mode (monthly distance bars, sport pie, weekly TSS area),
redesigned weekly summary with inline mini bars. 11 new integration tests.

## Phase 8B: Routes Page Overhaul — **DONE**

Implemented: surface_type filter (JSONB has_key), GET /routes/{id}/history with personal
bests, difficulty badge (elevation/km → Easy/Moderate/Hard/Extreme), route comparison
(overlaid elevation profiles + delta table), per-route history/PB section, Leaflet map
browse view, surface type dropdown. 5 new integration tests.

### Backend (`api/activities.py` GET `/`)
New query params: `q` (name ILIKE), `min_distance`/`max_distance` (meters), `min_duration`/`max_duration` (seconds), `min_tss`/`max_tss`, `sport_types` (multi-select).

### Frontend
- Full filter row + sort dropdown (date/distance/duration/TSS/avg power, asc/desc) — matches routes page pattern
- **Stream-overlay comparison**: tick 2 activities → overlaid power/HR stream charts + stat deltas table
- **Stats view mode** (third tab alongside List/Week): monthly distance bars, sport breakdown pie, weekly TSS chart
- Redesigned weekly summary with mini bar charts

---

## Phase 8B: Routes Page Overhaul

### Backend (`api/routes.py`)
- `surface_type` filter (from surface_profile JSONB)
- `GET /routes/{id}/history` — all activities on this route with time/distance/power, personal bests

### Frontend
- **Difficulty badge**: computed from elevation_gain/distance ratio + surface roughness (Easy/Moderate/Hard/Extreme)
- **Route comparison**: pick 2 routes → overlaid elevation profiles + comparison table
- **Route history**: per-route section showing all rides, PB time, trend chart
- **Map browse**: clustered Leaflet map view toggle (alternative to list)
- Surface type filter dropdown

---

## Phase 9: Wiki Expansion (build) + Strength Video System (spec-only)

### Wiki — **DONE**
Added 5 new sections to `wiki/page.tsx`: Weakness Analysis, Ride Fueling, Weather Integration, Training Plans & Conformity, Goals & Projections. tsc + vitest green.

### Video System — SPEC ONLY (not implemented this cycle)
Add 5 new sections to `wiki/page.tsx`: Weakness Analysis, Ride Fueling, Weather Integration, Training Plans & Conformity, Goals & Projections.

### Video System — SPEC ONLY (not implemented this cycle)

**Storage: Cloudflare R2** (S3-compatible, 10 GB free, zero egress fees).

**Model** (`LiftVideo`, migration 030):
```
id, user_id FK, url str(500) | None          # external link mode
storage_key str(500) | None                  # R2/S3 mode (mutually exclusive with url)
source_type ("youtube"|"vimeo"|"link"|"upload")
mime_type, size_bytes, duration_seconds | None
title, exercise_name | None, notes | None
session_id FK | None, personal_record_id FK | None
created_at
```

**Upload flow (presigned PUT)**:
1. `POST /lifting/videos/upload-url {filename, size_bytes, mime_type}` → validates mime ∈ {video/mp4, video/quicktime, video/webm}, size ≤ 250 MB → generates object key `videos/{user_id}/{uuid}.{ext}` → returns presigned PUT URL (15 min) + pending video_id
2. Client uploads directly to R2 (bypasses server bandwidth)
3. `POST /lifting/videos {storage_key, title?, exercise_name?, session_id?, pr_id?}` → creates row

**Playback flow (presigned GET)**:
- `GET /lifting/videos/{id}/stream-url` → 5-min presigned GET → native HTML5 `<video>` element

**Config** (graceful degradation): `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` — if unset, upload returns 501; URL-only mode (YouTube/Vimeo embeds + link cards) still works.

**Frontend spec**: VideoEmbed component (iframe for YouTube/Vimeo, `<video>` for uploads, link card otherwise); add-video per session + PR chips; Video Bank page (`/videos`) with exercise/date/source filters + player modal.

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
| Projection style | Badge only (On Track / At Risk / Unlikely) — no false-precision percentage |
| Regression window | 12 weeks, ≥4 points required |
| TSB projection | Event-linked plans only |
| Metric chart projections | Goals only first; FTP/weight/VO2max charts later if useful |
| Activities filters | Full filter set + sort (matching routes page pattern) |
| Activity comparison | Stream-overlay (pick 2 rides, overlaid power/HR) |
| Activities stats | Stats view mode (monthly bars, sport pie, weekly TSS) |
| Routes scope | All: history/PBs, difficulty badge, comparison, map browse, surface filter |
| Video storage | Cloudflare R2 (S3-compatible, 10 GB free, zero egress) |
| Video scope | Spec-only this cycle; wiki sections built |
| Video model | LiftVideo with url XOR storage_key; session + PR attachment; Video Bank page |
