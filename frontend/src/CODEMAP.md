# Frontend CODEMAP

> Next.js 14 App Router, all pages `'use client'`, React Query, Tailwind dark theme.

## Pages (`app/(app)/`)

| Route | File | Description |
|-------|------|-------------|
| `/dashboard` | `dashboard/page.tsx` | Main dashboard — Today/Weekly/Monthly tabs. **Today**: rest-day banner, readiness strip, today's planned workout (from active training plan), KPI grid, form trend chart (CTL/ATL/TSB), side-by-side activities + lifting cards. **Weekly**: readiness, events, KPIs, charts, streaks, goals, AI analysis. **Monthly**: summary cards + year-in-review. Cross-links: event cards → `/training`, CTL/ATL/TSB cards → `/cycling`, weather-location + Whoop/Strava connect prompts → `/settings`, recent activity/session rows deep-link to `/activities?activity=` / `/lifting?session=` |
| `/training` | `training/page.tsx` | Training plans, events, periodization chart; segmented view toggle (**Plan Builder \| This Week** — WeeklyView) above the main pane when a plan is selected. Workout-planner FTP prompt links to `/cycling`; route picker has a "Route library →" link to `/routes`. Each event card has a "📄 Export Prep PDF" button (§3.14) — blob-downloads `/api/v1/export/event-report/{id}` with the Bearer token |
| `/activities` | `activities/page.tsx` | Activity list with advanced filters (text search, min/max distance/duration/TSS), sort dropdown, List/Week/Stats view toggle, stream-overlay comparison (pick 2 rides → overlaid power/HR charts + stats delta table), weekly summary with mini inline bars. Deep-link `?activity=<id>` selects/expands a specific activity (rendered from fetched detail when not in the loaded list); "View route →" deep-links to `/routes?route=` |
| `/calendar` | `calendar/page.tsx` | Calendar view of activities + lifting. Day-detail activity titles → `/activities?activity=`, standalone lifting sessions → `/lifting?session=` |
| `/cycling` | `cycling/page.tsx` | Cycling analytics — power curve, zones, training load, FTP, VO2max (SuggestedCycleCard removed in Phase 5B). Weight-trend empty state links to `/settings` |
| `/health` | `health/page.tsx` | **Health page (§3.2)** — readiness + respiratory-rate status, recovery/HRV/resting-HR/respiration trend charts, sleep intelligence (consistency/debt/optimal bedtime — the previously-unrendered `/metrics/sleep-*` endpoints), strain + sleep metric cards, tabbed health-alert history with dismiss, AI health analysis card |
| `/lifting` | `lifting/page.tsx` | Lifting sessions, PRs, exercise progress, warmup templates. Live Lift entry banner + Whoop-unmatched warning (live sessions with `started_at`/`ended_at`, no `whoop_strain`, ended >3h ago). Session cards + detail show live-session start–end times and duration. Deep-link `?session=<id>` selects a session; empty state CTAs to `/lifting/live`; linked-Strava card deep-links to `/activities?activity=` |
| `/goals` | `goals/page.tsx` | Dedicated goals page — Active/Achieved/Expired/All tabs, goal cards with progress + alignment badges, **ProjectionCard summary strip (Phase 7)** for active goals with target dates, create modal (metric-registry-driven), detail modal with check-in chart + projection line + edit/delete/reactivate. Sport-specific goal cards cross-link: cycling → `/cycling`, lifting (1RM/volume/big3) → `/lifting` |
| `/lifting/live` | `lifting/live/page.tsx` | **Live Lift** — mobile-first live session tracker. Pre-start (focus/program/warmup template; **"Load from today's plan" suggest-only chip** when an active plan schedules a strength day today — tap prefills focus + first exercise; surfaces an orphaned server-side active session via `GET /sessions/active` with **Resume session** (rebuilds local state from the server)` + Close it) → active workout (`LiveWorkout`: steppers w/ smart prefill from last logged set or last-session reference, count-up since-last-set pill, honest `⟳ N to sync` / `✓ Synced` pill, 1-tap logging, double-tap undo, Wake Lock, PR toasts) → finish sheet (RPE/notes; invalidates `['lifting-sessions']`+`['personal-records']` so next "last session" line is fresh) → **post-finish "Session saved" summary** (duration/volume/sets/RPE/exercises, deep-link to `/lifting?session=<id>`, Start another). Interrupted-finish overlay has Retry + Discard. Local-first: state persisted to localStorage every mutation, background syncer lazily creates the remote session then pushes sets/deletes, flushes on reconnect/foreground. "← Lifting" back links on pre-start + active headers |
| `/routes` | `routes/page.tsx` | Route management — **List/Map view toggle**, filtering (status, sport, source, **surface type**, route type, distance, elevation, sort, search), route list with **difficulty badges** (Easy/Moderate/Hard/Extreme from elevation/distance ratio), **compare checkboxes** (pick 2 → overlaid elevation profiles + stats delta modal), route detail with tabs (Overview, Map & Profile, History, Merged View, Weather, Effort), GPX upload/download. **Heatmap toggle** on map view shows Strava-style activity density around home area. Deep-link `?route=<id>` selects a route; ride-history rows deep-link to `/activities?activity=` |
| `/wiki` | `wiki/page.tsx` | In-app wiki — 10 sections: Overview, Getting Started, Metrics Glossary, Science & Research, Maximizing Impact, Weakness Analysis, Ride Fueling, Weather Integration, Training Plans & Conformity, Goals & Projections. Sticky sidebar nav with IntersectionObserver scroll highlighting. Feature mentions hyperlink to the owning page via a shared `WikiLink` helper |
| `/notifications` | `notifications/page.tsx` | **Notifications page (Phase C §3.5)** — full history of typed notifications (severity/type badges, deep links), unread dot + mark-read/mark-all, tabbed **preferences panel** (per-type toggles persist to `/notifications/preferences`, syncs `NotificationSettings`) |
| `/settings` | `settings/page.tsx` | OAuth connections, cycling profile, **exercise library management** (add/search exercises), **Preferences card (§3.6)** — unit system (kg/km vs lb/mi), date locale (en-GB/en-US), time format (12/24h) pill toggles via `useUnits()` → `/user/preferences` |

## API Clients (`lib/api/`)

> **2026-09 dead-client sweep**: the `activities`, `cycling`, `dashboard`, `nutrition`,
> `events`, `llmAnalysis`, `workoutPlanner`, `deficiency` and `auth` client modules were
> deleted (zero importers — those pages call endpoints inline via `authFetch`), and dead
> functions were pruned from survivors. Domain **types** under `types/` are unaffected.

| File | Backend Prefix | Key Functions |
|------|---------------|---------------|
| `fetch.ts` | — | `apiFetch`, `apiFetchWithHeaders`, `apiUpload`, `useAuthFetch` hook |
| `types.ts` | — | Barrel re-exports from `types/` domain modules |
| `lifting.ts` | `/api/v1/lifting/` | `getLiftingSessions`, `getActiveLiftingSession`, `createLiftingSession`, `updateLiftingSession`, `deleteLiftingSession`, `addSetToSession`, `deleteLiftingSet`, `getPersonalRecords`, `getWarmupTemplates` |
| `routes.ts` | `/api/v1/routes/` | `getRoutes`, `getRoute`, `syncRoutes`, **duplicates** (`getDuplicateRoutes`, `mergeRoutes`, `autoMergeDuplicates`), `downloadRouteGpx`, **merged view** (`getMergedRouteView` — per-source polylines + ridden segments), **heatmap** (`getHomeAreaHeatmap` — activity points near home). Tag/collection/quality/effort/bulk operations are called inline by the routes UI |
| `goals.ts` | `/api/v1/goals/` | `listGoals`, `createGoal`, `updateGoal`, `deleteGoal`, `getGoalMetrics`, `addCheckIn`, `getCheckIns`, `reactivateGoal` |
| `trainingPlans.ts` | `/api/v1/training-plans/` | `getTrainingPlans`, **week view** (`getPlanWeek` — `GET /{id}/week/{n}?include_weather`), targeted day edits (`updatePlanDay`, `copySessionToPlanDay`, `copyPlanDayToDate`), **workout preview** (`previewWorkout` + `WorkoutPreviewTargets`/`WorkoutPreviewResponse` types — used by PlanBuilder) |
| `conformity.ts` | `/api/v1/training-plans/` | Phase 5C conformity: `getPlanConformity` (`GET /{id}/conformity?weeks=N`), `getDayConformity` (`GET /{id}/days/{dayId}/conformity`), `linkPlanActivities` (`POST /{id}/link-activities`) — types in `types/conformity.ts`: `PlanConformityResponse`, `WeekConformity`, `DayConformityResponse`, `ConformityComponent`, `DayConformityStatus`, `LinkActivitiesResponse` |
| `weather.ts` | `/api/v1/weather/` | `getCurrentWeather`, `getForecast` — 404 → `null` (no location set / untagged); takes backend JWT explicitly since `apiFetch` can't distinguish 404s (`types/weather.ts`: `CurrentWeather`, `ForecastResponse`, `ForecastDay`) |
| `projections.ts` | `/api/v1/projections/` | `getGoalProjection` (`GET /goal/{id}`) — types in `types/projections.ts`: `GoalProjectionResponse`, `TrendInfo`, `ProjectionPoint` |
| `exercises.ts` | `/api/v1/lifting/exercises` | `searchExercises`, `createExercise`, `deleteExercise` — DB-backed exercise library CRUD (`types`: `ExerciseEntry`, `ExerciseDetail`) |
| `notifications.ts` | `/api/v1/notifications/` | `listNotifications`, `markNotificationRead`, `markAllNotificationsRead`, `getNotificationPreferences`, `updateNotificationPreferences` — authFetch-first pattern (`types/notifications.ts`: `AppNotification`, `NotificationPreferences`, `NotificationType`, `NotificationSeverity`) |
| `weight.ts` | `/api/v1/metrics/weight` | `getWeightHistory`, `createWeightEntry`, `updateWeightEntry`, `deleteWeightEntry` — manual weigh-in CRUD (types via `types/health.ts` `WeightEntry` incl. `id`/`WeightHistoryResponse`) |
| `search.ts` | `/api/v1/search` | `globalSearch` — cross-domain command-palette lookup (activities/routes/lifting sessions/exercises/goals/events) |
| `preferences.ts` | `/api/v1/user/preferences` | `getPreferences`, `updatePreferences` — unit system / locale / time format (`types/preferences.ts`: `UserPreferences`, `UnitSystem`, `DateLocale`, `TimeFormat`) |
| `account.ts` | `/api/v1/export`, `/api/v1/account` | **§3.9 data portability** — `exportFullJson` (`GET /export/json`), `deleteAccount` (`DELETE /account/delete` with `confirm_email` body), `downloadExport` (client-side blob download). Types in `types/export.ts` |
| `index.ts` | — | Barrel re-exports the above + `types`/`fetch` |

## Components

### `ui/` — Shared primitives
| Component | Purpose |
|-----------|---------|
| `Card` | Styled card container with header/title |
| `Badge` | Colored badge for sport types, statuses |
| `Skeleton` | Loading skeleton primitives (metric, chart, row) |
| `EmptyState` | Empty state with icon, title, CTA button |
| `ErrorBoundary` | React error boundary with retry |
| `GoalCard` | Goal display with progress bar, alignment badge, direction-aware fill |
| `PRCelebration` | Animated PR celebration toast |
| `ReadinessIndicator` | Training readiness gauge |
| `PageLoadingBar` | Top loading bar for route transitions |
| `ExerciseAutocomplete` | Exercise name autocomplete input |
| `Modal` | Responsive modal — bottom sheet on mobile (<sm), centered dialog on desktop (≥sm). Includes `ModalHeader` sub-component |
| `TabGroup` | Accessible tab bar with ARIA tablist/tab/selected attributes |
| `ProviderBadge` | Provider icon + color badge (strava, komoot, wahoo, manual). Exports `ProviderIcon`, `ProviderBadge`, `PROVIDER_COLORS` |
| `MetricCard` | Unified metric card — supports simple trend strings (dashboard) and complex MetricTrend/benchmark (cycling). Icon, unit, tooltip, subtitle |
| `NotificationBell` | Fixed top-right bell with unread badge (`['notifications']`, 30s refetch) + dropdown panel (severity-tagged, type icons, mark-read on click, mark-all, "View all" → `/notifications`). Mounted in `(app)/layout.tsx` |
| `CommandPalette` | **Global ⌘P/Ctrl+P search (Phase C §3.4)** — modal command palette over `GET /api/v1/search`, debounced, keyboard-navigable (↑/↓/Enter/Esc), grouped cross-domain hits with deep links (`?activity=`, `?route=`, `?session=`). Opens via keyboard or sidebar Search button (`fittrack:command-palette` custom event). Mounted in `(app)/layout.tsx` |

### `charts/` — Data visualization
| Component | Purpose |
|-----------|---------|
| `Chart` | Generic Recharts wrapper — line, bar, scatter, area, pie + CSS-grid calendar heatmap. Renders `ChartData` from backend. Unit-aware tooltips, date tick formatting, adaptive dots, secondary Y axis (`y_axis`), built-in empty state via `hasData()` |
| `ChartBody` | Tri-state chart body — loading spinner / empty message / Chart |
| `ChartCard` | Card wrapper with title, header actions slot, and ChartBody |

### `cycling/` — Cycling-specific
| Component | Purpose |
|-----------|---------|
| `MetricCard` | Cycling metric with trend indicator |
| `PowerCurveTable` | Power duration table |
| `PowerZonesDisplay` | Power zone horizontal bars |
| `HRZonesDisplay` | HR zone horizontal bars |
| `ProfileEditor` | FTP/weight/LTHR + home lat/lng editor (feeds weather location) |
| `RideAnalysisCard` | Post-ride analysis card |
| `FuelPlanCard` | Ride fuel plan card (`['fuel-plan', activityId]` query) — target badges, fuelling timeline, pre/during/post actuals; rendered in activities expanded detail for cycling |
| `ActivityAiAnalysisCard` | Per-activity AI ride analysis (on-demand Gemini) |
| `LlmAnalysisCard` | Overall cycling Gemini LLM analysis display |
| `WeatherBadge` | Inline `🌧️ 12°C 💨 25km/h` indicator for activity rows (weather fields on `Activity`) |
| `WeightPanel` | **Body-weight management (Phase C §3.1)** — quick-add form (date + kg → `POST /metrics/weight`), 7-day rolling avg summary, editable/deletable history (Whoop entries read-only), invalidates `['weight-history']` + weight/W-kg chart queries. Rendered on `/cycling` (full) and dashboard Today strip (`compact` prop) |

### `lifting/` — Lifting-specific
| Component | Purpose |
|-----------|---------|
| `AddExerciseForm` | Add exercise + sets to session |
| `ExerciseGroup` | Grouped sets for one exercise |
| `ExerciseProgressSection` | Exercise progress over time |
| `LiftingAnalysisCard` | Post-session analysis card |
| `SessionAiAnalysisCard` | Per-session AI lifting analysis (on-demand Gemini) |
| `LinkActivityModal` | Link activity to lifting session |
| `LiveWorkout` | Active-session UI for `/lifting/live` — header (elapsed timer from `started_at` timestamp, volume/sets, count-up since-last-set pill, sync status pill that shows `⟳ N to sync` while sets/deletes are queued locally instead of a false ✓), exercise autocomplete + recent chips, weight/reps steppers (`Stepper`, tap-target ≥44px, configurable step size cycled ±1/2.5/5kg persisted in localStorage; draft-buffer input allows natural typing incl. trailing decimal points, select-all on focus, commit-on-blur), optional RPE dots + warm-up toggle, last-session reference line (`reference.ts` map), set log with double-tap undo, bottom LOG SET button (debounced), inline PR toasts via `detectPr()` (Brzycki e1RM vs stored PRs). Prefill uses `reference.lastSet` (true last logged set, not highest-volume) |
| `ManualPRForm` | Manual PR entry form |
| `WarmupTemplateManager` | Warmup template CRUD |

### `health/` — Health-specific
| Component | Purpose |
|-----------|---------|
| `HealthAiAnalysisCard` | AI health analysis (HRV, sleep, recovery — on-demand Gemini) |

### `routes/` — Route components
| Component | Purpose |
|-----------|---------|
| `RoutesSidebar` | Collapsible tag/collection tree with smart collections, tag chips, drag-drop support |
| `RouteFilterBar` | Unified filter bar with search, sort, advanced filters (distance, elevation, surface, quality, favorite), keyboard shortcuts |
| `RoutesMapView` | Map-first browse with custom markers showing quality scores, popups with route info. Heatmap toggle shows activity density around home area |
| `RoutesListView` | Card-based list with route stats, difficulty badges, provider icons |
| `RoutesGridView` | Grid of route cards for visual/mobile browsing, touch-friendly |
| `RouteDetailPanel` | Slide-over detail panel with tabs (Overview, Map & Profile, History, Merged View, Weather, Effort), edit/favorite/delete actions |
| `MergedRouteMapView` | Merged route view — draws each contributing source's polyline with distinct colors + highlights ridden activity segments in green |
| `QualityBadge` | Circular quality score indicator with color tiers (Excellent/Good/Average/Fair/Poor) |
| `EffortEstimateCard` | Power-based effort estimation (Martin model) using user FTP, weight, distance, elevation |
| `RouteWeatherCard` | Current conditions + 7-day forecast for route location with "best day to ride" highlight |
| `RouteHistorySection` | Ride history table with personal best summary |
| `SegmentsCard` | **§3.13** Climb-segment browser in `RouteDetailPanel`'s Segments tab: `['route-segments', routeId]` (GET `/segments?route_id=`); per-segment PR time / times-ridden / best power with Strava-style Category badge (HC/1–4); expandable rows fetch `['segment-detail', id]` leaderboard-of-self (rank, PR flag, elapsed, avg W, VAM, date); "↻ Recompute" → `POST /routes/{id}/segments/recompute` |
| `CompareRoutesModal` | Side-by-side route comparison — overlaid elevation profiles, surface breakdown, stats delta table |
| `MapBrowseView` | Leaflet map with route markers for browse mode — click marker to select route |
| `VirtualRouteList` | Virtualised list fallback for route browse (perf, no map) |

### `maps/` — Map components
| Component | Purpose |
|-----------|---------|
| `RouteMap` | Leaflet map with route polyline, start/end markers, isLoop indicator |
| `ElevationProfile` | Elevation chart for route |
| `SurfaceBreakdown` | Surface type stacked bar |

### `activities/` — Activity page components
| Component | Purpose |
|-----------|---------|
| `SummaryStatsBar` | Summary stats grid (count, distance, time, TSS) shown above activity list |
| `ActivityCard` | Activity list item card with sport badge, source badges, weather, compare checkbox, linked lifting indicator |
| `CompareActivitiesModal` | Stream-overlay comparison modal — power/HR charts + stats delta table for 2 selected activities |
| `Replay3D` | **§3.16 3D fly-through** — three.js scene (speed-coloured path, growing ridden trail, rider marker, orbit/zoom, play/scrub/1·4·8×) fed by `buildReplay()` from `lib/replay`; lazy-loaded via `next/dynamic` `ssr:false` so `three` stays out of the `/activities` first-load bundle; WebGL fallback message. `TelemetryStrip` (same file): SVG power/HR overlay with synced playhead. Pure math lives in `lib/replay.ts` (unit-tested in `src/__tests__/replay.test.ts`) |
| `StatsView` | Stats tab view — monthly distance bars, sport breakdown pie, weekly TSS trend |

### `calendar/` — Calendar page components
| Component | Purpose |
|-----------|---------|
| `DayDetailPanel` | Selected day detail — recovery/sleep cards, activity details with stats grid, lifting session notes editor |
| `CalendarAgendaView` | Mobile agenda list (phones only) — day rows with activity badges and recovery score |

### `dashboard/` — Dashboard tab sections
| Component | Purpose |
|-----------|---------|
| `RestDayBanner` | Rest-day suggestion banner — TSB/recovery/consecutive-days triptych + reasons list; shared by Today + Weekly tabs |
| `DeficiencyCard` | Weakness/deficiency analysis card (`['deficiency']` query) — severity-grouped lifting/cycling weaknesses; rendered on dashboard WeeklyTab + lifting page |
| `GoalsSection` | Compact top-3 active goals on dashboard — progress bars + "View all →" link to /goals |
| `WeatherWidget` | Current-conditions card (`['weather-current']` query) — hero header of dashboard; prompt state when no home location set |
| `DashboardRefresh` | **§3.15 stale-data UX** — "Last updated" timestamp (freshest `dataUpdatedAt` across the 16 dashboard queries, via `queryCache.subscribe`) + manual refresh button (`refetchQueries` by query-key prefix) + spinning "Syncing…" state (`useIsFetching` predicate). Hero header next to `WeatherWidget`; all dashboard queries also set `refetchOnWindowFocus: true` |

### `goals/` — Goal management
| Component | Purpose |
|-----------|---------|
| `GoalCreateModal` | Create-goal modal driven by `GET /goals/metrics` — metric select (label+unit), dynamic filter inputs (exercise autocomplete, sport select), target value, optional target date, notes |
| `GoalDetailModal` | Full goal detail — check-in history Recharts line chart with target reference line + projection line (Phase 7, dashed), projection badge/info section, manual check-in form, edit mode (target/date/notes/filter), delete with confirmation, reactivate when expired/abandoned |
| `ProjectionCard` | Compact projection summary strip (Phase 7) — shown on goals page for active goals with target dates; each goal shows metric label, badge (On Track/At Risk/Unlikely), projected date; click opens GoalDetailModal |

### `training/` — Training plan components
| Component | Purpose |
|-----------|---------|
| `PlanBuilder` | Full plan builder (Phase 5A): empty state (scratch/template creation w/ event taper select), plan header (inline rename, badges, event link/unlink, Activate/Delete), week tabs + "All" per-week summary, 7-col day cards with sport-aware expandable editors (cycle: power/zone; strength: session type + RPE/exercise list via `ExerciseAutocomplete` + computed volume), HTML5 drag-to-swap dates, sticky unsaved-changes footer. Edits accumulate locally keyed by `day_date`; Save PATCHes the FULL days array (backend upserts by date and deletes missing dates — never send partial days). Keyed by plan id from training page to reset state on plan switch. Copy Session / Duplicate disabled on draft days |
| `WeeklyView` | Weekly planning view (Phase 5B, sibling of PlanBuilder — toggle "This Week" on training page): Monday-aligned week navigation (week math mirrors backend: `week1 = start − weekday(start)`), readiness strip (CTL/ATL/TSB + recommended-zone dot), **conformity summary strip (Phase 5C, `['plan-conformity', planId]` staleTime 60s)** — overall % big number, trend arrow (↑/↓/→), per-sport chips from the viewed week's `by_sport`, warning-tinted patterns box, "Link activities" button (`POST /link-activities`); **TSB projection strip (Phase 7, `['tsb-projection', planId]` — event-linked plans only)** — race-day TSB + freshness assessment; 7 responsive day cards with weather emoji + bad-weather chips, actual activity/lifting summaries in green blocks, `ConformityBadge` status per day (done/pending/missed; rest hidden), expandable panel with planned-exercise table + route matches ("Assign" → single-day PATCH `{planned_route_id}`) + quick-edit (duration/TSS/notes) + `DayConformityPanel`. Queries `['plan-week', planId, week]`; edits use targeted `updatePlanDay` PATCHes and invalidate week + both conformity queries — unlike PlanBuilder's full-array saves |
| `ConformityBadge` | Tiny inline day-status badge (Phase 5C): done → green dot + %, partial → yellow, missed → muted-red "Missed", extra → blue "Extra", pending → gray "—", rest → renders nothing; tooltip = classification when present (optional `title` override used by WeeklyView's heuristic labels) |
| `EventResultPanel` | **Race result logging (Phase C §3.3)** — renders on past event cards (Training page) with result badges (#overall / #class / PB / finish time), inline add/edit form (time-or-seconds, overall/class position, PB checkbox, notes) via `PUT /events/{id}/result`, clear via `DELETE`; invalidates `['events']` + `['notifications']` |
| `AdaptiveSuggestionsCard` | **§3.11** Weekly adaptive advice card (mounted in `WeeklyView`): `['adaptive-suggestions', planId]` query (GET `/training-plans/{planId}/suggestions`); fatigue badge + summary; per-axis stance chips (recover/rest/ease/maintain/build) with severity dots; suggestion list with one-tap apply buttons → `updatePlanDay` PATCH mutation invalidating `plan-week`/`plan-conformity`/`adaptive-suggestions`/`training-plan`/`training-plans`. Hides itself when there's no advice yet |
| `DayConformityPanel` | Expanded plan-vs-actual detail for one day (Phase 5C): lazy `['day-conformity', dayId]` query fetched only while mounted (WeeklyView expanded panel), header badge + classification, weighted component table (humanized metric labels, planned → actual with units W/kg/min/%, deviation colored red-over/blue-under, weight %, component-score mini bar), "→" deviation notes in warning color, loading skeleton rows, status-appropriate empty message ("Not yet logged" / "Nothing planned") |
| `WeatherForecast` | 7-day forecast chips (`['weather-forecast']` query) with poor-cycling-conditions warning dots — rendered above plans grid on training page |
| `EventAiAnalysisCard` | AI event/race preparation analysis (on-demand Gemini) |

### `settings/` — Settings page components
| Component | Purpose |
|-----------|---------|
| `ExerciseManager` | Exercise library management — search, add custom exercises with aliases, view all exercises by category. Rendered on `/settings` page |
| `NotificationSettings` | Per-type notification toggles (health alerts / PRs / goal milestones / plan reminders) — `['notification-preferences']` query, PATCH on toggle. Rendered on `/settings` page |
| `HealthAlertSettings` | **§3.12 Health-alert tuning card** — per-signal enable toggle, snooze (3/7/14/30 days), and threshold inputs for the new performance-decline / sleep-consistency / resting-HR signals (persist via `GET/PUT /metrics/health-preferences`). Rendered on `/settings` page |
| `WebPushCard` | **§3.8 Web Push settings card** — capability detection, Enable (subscribe → `/push/subscriptions`) / Disable (unsubscribe) buttons, device count, permission-denied notice. Rendered under the notifications card on `/settings` page |
| `DataPortabilityCard` | **§3.9 data portability card** — JSON export (client-side blob download from `GET /export/json`) + account deletion (Modal with email confirmation, `DELETE /account/delete` → `signOut`). Rendered at the bottom of `/settings` page |
| `RoutePickerModal` | Route selection modal for training plan day assignment — browse/search routes, preview on map |

#### `onboarding/` — First-run wizard (§3.10)
| Component | Purpose |
|-----------|---------|
| `OnboardingWizard` | 4-step soft-prompt modal (preferences → connections → fitness profile FTP/weight/home → optional first goal). Auto-opens ~1.2s after auth unless `fittrack-onboarding-done` (localStorage) is set; opens via `fittrack:onboarding` custom event. Mounted in `(app)/layout.tsx` inside `UnitsProvider` |
| `OnboardingToggle` | "Re-run onboarding" button in Settings — dispatches `fittrack:onboarding` |

### `lib/` — Shared utilities
| File | Purpose |
|------|---------|
| `analysisRenderer.tsx` | Shared markdown renderer (`renderAnalysisText`, `renderInline`) and `relativeTime` helper used by all AI analysis cards |
| `utils.ts` | `formatDuration`, `formatDistance`, `formatDateDMY`, `formatTime`, `formatWeight` (distance/weight/time/date honor the active user preferences — metric/en-GB/24h defaults), `weatherEmoji` (conditions → emoji mapping shared by weather UI), `setActivePreferences`/`getActiveLocale`/`getActiveUnitSystem`/`getActiveTimeFormat` (singleton synced by `UnitsProvider`) |
| `units.tsx` | **§3.6 preferences context** — `UnitsProvider` (mounts in `(app)/layout.tsx`, fetches `/user/preferences`, syncs the utils singleton, optimistic PATCH with rollback) + `useUnits()` hook (`{ preferences, isImperial, setPreference }`). WeightPanel + ProfileEditor read it so kg↔lb toggles apply live |
| `webPush.ts` | **§3.8 Web Push helpers** — `getPushCapability` (`unsupported/denied/available/granted`), `subscribeToWebPush`/`unsubscribeFromWebPush`/`getPushCount` (browser PushManager ↔ `/push/subscriptions`, VAPID key from backend, urlBase64↔Uint8Array). Used by `settings/WebPushCard` |
| `healthPrefs.ts` | **§3.12 Health-alert preferences client** — `getHealthPreferences` / `updateHealthPreferences` (`GET/PUT /metrics/health-preferences`; types + `HEALTH_SIGNAL_LABELS` in `lib/api/types/health.ts`). Used by `settings/HealthAlertSettings` |
| `training/week.ts` | Week-math helpers shared by WeeklyView + TodayTab: `toDateStr`, `diffDays`, `mondayOf`, `getWeek1Start`, `getTotalWeeks`, `getCurrentWeek` — mirrors backend week numbering |

### `lib/lifting/` — Live session logic
| File | Purpose |
|------|---------|
| `useLiveSession.ts` | Local-first live-session state hook. Persists full state to localStorage (`fittrack-live-session`) on every change; background syncer lazily POSTs the remote session (idempotent via stable `liveKey`, accumulated sets carry `client_id`) on first flush and maps **real** remote ids from the echoed response (undo deletes remotely); pushes unsynced sets / pending deletes with per-set `client_id` idempotency; flush progress merged into freshest storage (`mergeWithStorage`) so mid-flight logging isn't clobbered, undo-race sets get queued for remote delete, and a mid-flush discard aborts the sync (`mergeWithStorage` → `null`); follows up with another flush pass if a mutation landed mid-flight; never blocks logging on network — failures stay queued and retry on `online`/`visibilitychange` and a 4s finish-retry effect that runs even with no `sessionId`; finish flow persists `endedAt` at request time (not sync time) and PATCHes local-tz `session_date` + `ended_at`; network calls read the token via `authFetchRef` so a refreshed backend token is picked up. `resumeSession(serverSession)` rebuilds an active state from `GET /sessions/active` (same-device recovery when local state was lost). Exposes `logSet`/`undoLastSet`/`requestFinish`/`discardSession`/`resumeSession` |

| `reference.ts` | Session-start reference data: `buildLastSessionMap` (exercise → most recent sets, limited to the **last 12 weeks** so stale prescriptions never prefill as current), `recentExerciseNames`, `detectPr` (Brzycki e1RM vs stored PRs + today's sets), `brzycki1rm` |
## Patterns

- **Auth**: `useAuthFetch()` hook returns `{ authFetch, authFetchWithHeaders }` — injects JWT from session
- **Data fetching**: React Query `useQuery` + `useMutation`. Query keys are string arrays like `['activities', filters]`
- **Styling**: Tailwind with custom dark theme tokens. No CSS modules
- **State**: Local `useState` for UI state. React Query for server state. Zustand stores for cross-component state (`lib/stores/routesStore.ts`: view mode, selection, tags, filters, detail tab, compare mode). No global Redux
- **Error handling**: `ErrorBoundary` wraps app layout. Query errors shown inline. AI analysis cards show user-friendly error messages for Gemini API failures
- **Mobile**: Responsive grids (`grid-cols-1 sm:grid-cols-N`), `Modal` bottom-sheet on phones, calendar agenda view (`md:hidden`), hamburger sidebar with `pt-16` clearance
- **PWA**: `manifest.ts` (App Router metadata route; installable — icons, standalone), `public/sw.js` (runtime caching — network-only for `/api/v1/` API calls since they're authenticated/user-specific; cached navigations/statically-versioned assets only; **§3.8 Web Push**: `push` → `showNotification`, `notificationclick` → focus/open under `/fittrack` base; CACHE_NAME `fittrack-v4`), `PwaRegister.tsx` (production-only SW registration + **§3.7 install prompt**: `beforeinstallprompt` capture → in-app Install pill w/ localStorage dismiss + `appinstalled`). `lib/useOnlineStatus.ts` (online/offline state + last-online stamp) → `OfflineBanner` (amber "You're offline" bar, §3.7) and `OfflineSnapshot` (§3.7 — persists last-known `dashboard*` query data to localStorage, restores stale on next load so the dashboard works offline; refreshed on first successful refetch)
- **Sport utils**: `lib/sportUtils.ts` — `getSportColor`, `getSportTextColor`, `getSportBorderColor`, `getSportEmoji`, `isStrengthType`, `isCyclingOrRunning`, `STRENGTH_TYPES`, `getRecoveryColor`
- **3D replay (§3.16)**: `lib/replay.ts` — pure flight-path math (`buildReplay`: polyline→local metric plane, velocity×resolution→cumulative distance→polyline mapping, altitude z-exaggeration, `maxSamples` decimation; `projectPolyline`/`cumulativeFromVelocity`/`timeFmt`). Rendered by `components/activities/Replay3D.tsx` (three.js, lazily imported `ssr:false`). No external tile/API-key dependency — local-plane projection only
- **Page titles**: `usePageTitle('Page Name')` hook in `lib/usePageTitle.ts` — sets `document.title` with " | FitTrack" suffix
- **Deep-links**: `useDeepLink` hook in `lib/useDeepLink.ts` — reads URL query params once on mount and updates them via `history.replaceState` (no Suspense needed). Powers record deep-linking: `/activities?activity=`, `/routes?route=`, `/lifting?session=`
- **Live Lift sync**: `lib/lifting/useLiveSession.ts` — local-first session state (localStorage), lazy idempotent sync (create→set→delete→finish via `live_key`/`client_id`, backend contract in AGENTS pitfall 18), finish-retry backoff, resume-from-server. **§3.7b explicit offline mode**: tracks `navigator.onLine` (`isOffline`), `pendingCount`, 4-state `syncStatus` (`synced`/`pending`/`offline`/`error`); flush scheduling is skipped while browser-offline and the whole backlog replays on the `online` event
- **Collapsible sidebar**: Desktop sidebar collapses to icon-only (`w-16`) via localStorage-persisted toggle. Mobile unaffected
- **Chart zoom**: Recharts `Brush` on line/area charts when >20 data points (dark theme styled)
