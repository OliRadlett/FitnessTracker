# Frontend CODEMAP

> Next.js 14 App Router, all pages `'use client'`, React Query, Tailwind dark theme.

## Pages (`app/(app)/`)

| Route | File | Description |
|-------|------|-------------|
| `/dashboard` | `dashboard/page.tsx` | Main dashboard — Today/Weekly/Monthly tabs. **Today**: rest-day banner, readiness strip, today's planned workout (from active training plan), KPI grid, form trend chart (CTL/ATL/TSB), side-by-side activities + lifting cards. **Weekly**: readiness, events, KPIs, charts, streaks, goals, AI analysis. **Monthly**: summary cards + year-in-review. Cross-links: event cards → `/training`, CTL/ATL/TSB cards → `/cycling`, weather-location + Whoop/Strava connect prompts → `/settings`, recent activity/session rows deep-link to `/activities?activity=` / `/lifting?session=` |
| `/training` | `training/page.tsx` | Training plans, events, periodization chart; segmented view toggle (**Plan Builder \| This Week** — WeeklyView) above the main pane when a plan is selected. Workout-planner FTP prompt links to `/cycling`; route picker has a "Route library →" link to `/routes` |
| `/activities` | `activities/page.tsx` | Activity list with advanced filters (text search, min/max distance/duration/TSS), sort dropdown, List/Week/Stats view toggle, stream-overlay comparison (pick 2 rides → overlaid power/HR charts + stats delta table), weekly summary with mini inline bars. Deep-link `?activity=<id>` selects/expands a specific activity (rendered from fetched detail when not in the loaded list); "View route →" deep-links to `/routes?route=` |
| `/calendar` | `calendar/page.tsx` | Calendar view of activities + lifting. Day-detail activity titles → `/activities?activity=`, standalone lifting sessions → `/lifting?session=` |
| `/cycling` | `cycling/page.tsx` | Cycling analytics — power curve, zones, training load, FTP, VO2max (SuggestedCycleCard removed in Phase 5B). Weight-trend empty state links to `/settings` |
| `/lifting` | `lifting/page.tsx` | Lifting sessions, PRs, exercise progress, warmup templates. Live Lift entry banner + Whoop-unmatched warning (live sessions with `started_at`/`ended_at`, no `whoop_strain`, ended >3h ago). Session cards + detail show live-session start–end times and duration. Deep-link `?session=<id>` selects a session; empty state CTAs to `/lifting/live`; linked-Strava card deep-links to `/activities?activity=` |
| `/goals` | `goals/page.tsx` | Dedicated goals page — Active/Achieved/Expired/All tabs, goal cards with progress + alignment badges, **ProjectionCard summary strip (Phase 7)** for active goals with target dates, create modal (metric-registry-driven), detail modal with check-in chart + projection line + edit/delete/reactivate. Sport-specific goal cards cross-link: cycling → `/cycling`, lifting (1RM/volume/big3) → `/lifting` |
| `/lifting/live` | `lifting/live/page.tsx` | **Live Lift** — mobile-first live session tracker. Pre-start (focus/program/warmup template) → active workout (`LiveWorkout`: steppers w/ smart prefill from last set or last-session reference, count-up since-last-set pill, 1-tap logging, double-tap undo, Wake Lock, PR toasts) → finish sheet (RPE/notes). Local-first: state persisted to localStorage every mutation, background syncer lazily creates the remote session then pushes sets/deletes, flushes on reconnect/foreground; resume/discard prompt after crash. "← Lifting" back links on pre-start + active headers |
| `/routes` | `routes/page.tsx` | Route management — **List/Map view toggle**, filtering (status, sport, source, **surface type**, route type, distance, elevation, sort, search), route list with **difficulty badges** (Easy/Moderate/Hard/Extreme from elevation/distance ratio), **compare checkboxes** (pick 2 → overlaid elevation profiles + stats delta modal), route detail (map, elevation, surface breakdown, **ride history with PB table**), GPX upload/download. Deep-link `?route=<id>` selects a route; ride-history rows deep-link to `/activities?activity=` |
| `/wiki` | `wiki/page.tsx` | In-app wiki — 10 sections: Overview, Getting Started, Metrics Glossary, Science & Research, Maximizing Impact, Weakness Analysis, Ride Fueling, Weather Integration, Training Plans & Conformity, Goals & Projections. Sticky sidebar nav with IntersectionObserver scroll highlighting. Feature mentions hyperlink to the owning page via a shared `WikiLink` helper |
| `/settings` | `settings/page.tsx` | OAuth connections, cycling profile, preferences, **exercise library management** (add/search exercises) |

## API Clients (`lib/api/`)

| File | Backend Prefix | Key Functions |
|------|---------------|---------------|
| `fetch.ts` | — | `apiFetch`, `apiFetchWithHeaders`, `apiUpload`, `useAuthFetch` hook |
| `types.ts` | — | Barrel re-exports from `types/` domain modules |
| `types/llm.ts` | — | `LlmAnalysis`, `LlmAnalysisSummary` interfaces |
| `activities.ts` | `/api/v1/activities/` | `fetchActivities`, `fetchActivity`, `fetchCalendar`, `fetchStreams`, `getActivityAiAnalysis`, `triggerActivityAiAnalysis` |
| `lifting.ts` | `/api/v1/lifting/` | `fetchSessions`, `createSession`, `getActiveSession`, `updateSession`, `addSet`, `deleteSet`, `fetchPRs`, `fetchWarmupTemplates`, `getSessionAiAnalysis`, `triggerSessionAiAnalysis` |
| `cycling.ts` | `/api/v1/cycling/` | `fetchProfile`, `fetchTrainingLoad`, `fetchPowerCurve`, `fetchPowerZones` |
| `dashboard.ts` | `/api/v1/dashboard/` | `fetchSummary`, `fetchWeeklyReport`, `fetchToday` |
| `routes.ts` | `/api/v1/routes/` | `getRoutes`, `getRoute`, `deleteRoute`, `updateRoute`, `syncRoutes`, `getRouteHistory`, `downloadRouteGpx`, `uploadRouteGpx` + new: **tags CRUD** (`getTags`, `createTag`, `deleteTag`, `addRouteTag`, `removeRouteTag`), **collections** (`getCollections`, `createCollection`, `createSmartCollection`, `addToCollection`, `removeFromCollection`), **quality** (`getRouteQualityScores`, `recomputeRouteQuality`), **effort** (`getEffortEstimate`, `postEffortEstimate`), **duplicates** (`getDuplicateRoutes`, `mergeRoutes`, `autoMergeDuplicates`), **bulk** (`bulkExportGpx`, `bulkDeleteRoutes`) |
| `goals.ts` | `/api/v1/goals/` | `fetchGoals`, `createGoal`, `updateGoal`, `deleteGoal` |
| `projections.ts` | `/api/v1/projections/` | `getGoalProjection` (`GET /goal/{id}`), `getTsbProjection` (`GET /tsb/{planId}?days=N`) — types in `types/projections.ts`: `GoalProjectionResponse`, `TsbProjectionResponse`, `TrendInfo`, `ProjectionPoint`, `TsbProjectionPoint` |
| `deficiency.ts` | `/api/v1/deficiency/` | `getDeficiency` — weakness/deficiency analysis (`types/deficiency.ts`: `DeficiencyResponse`, `WeaknessItem`) |
| `nutrition.ts` | `/api/v1/nutrition/` | `createFuelPlan`, `getFuelPlan`, `getFuelPlanForActivity`, `updateFuelPlanActuals`, `deleteFuelPlan` (`types/nutrition.ts`: `RideFuelPlan`, `FuelScheduleEntry`, `CreateFuelPlanPayload`, `FuelActualsUpdatePayload`) |
| `weather.ts` | `/api/v1/weather/` | `getCurrentWeather`, `getForecast`, `getActivityWeather` — 404 → `null` (no location set / untagged); takes backend JWT explicitly since `apiFetch` can't distinguish 404s (`types/weather.ts`: `CurrentWeather`, `ForecastResponse`, `ForecastDay`, `ActivityWeather`) |
| `trainingPlans.ts` | `/api/v1/training-plans/` | `fetchPlans`, `createPlan`, `generatePlan`, `getPlanWeek` (Phase 5B: `GET /{id}/week/{n}?include_weather`), `updatePlanDay` (Phase 5B: targeted single-day `PATCH /{id}/days/{dayId}`) — weekly types in `types/training.ts`: `TrainingWeekResponse`, `TrainingWeekDay`, `DayWeather`, `BadWeather`, `WeekActualActivity`, `WeekActualLiftingSession`, `WeekRouteMatchEntry`, `WeekReadiness`, `UpdateTrainingPlanDayPayload` |
| `conformity.ts` | `/api/v1/training-plans/` | Phase 5C conformity: `getPlanConformity` (`GET /{id}/conformity?weeks=N`), `getDayConformity` (`GET /{id}/days/{dayId}/conformity`), `linkPlanActivities` (`POST /{id}/link-activities`) — types in `types/conformity.ts`: `PlanConformityResponse`, `WeekConformity`, `DayConformityResponse`, `ConformityComponent`, `DayConformityStatus`, `LinkActivitiesResponse` |
| `events.ts` | `/api/v1/events/` | `fetchEvents`, `createEvent`, `updateEvent`, `getEventAiAnalysis`, `triggerEventAiAnalysis` |
| `llmAnalysis.ts` | `/api/v1/cycling/llm-analysis/` | `getLatestLlmAnalysis`, `triggerLlmAnalysis`, `getLlmAnalysisHistory`, `getHealthAiAnalysis`, `triggerHealthAiAnalysis`, `getEventAiAnalysis`, `triggerEventAiAnalysis` |
| `auth.ts` | — | NextAuth config, `authOptions`, JWT/session callbacks |
| `exercises.ts` | `/api/v1/lifting/exercises` | `searchExercises`, `createExercise`, `updateExercise`, `deleteExercise` — DB-backed exercise library CRUD |
| `notifications.ts` | `/api/v1/notifications/` | `listNotifications`, `markNotificationRead`, `markAllNotificationsRead`, `getNotificationPreferences`, `updateNotificationPreferences` — authFetch-first pattern (`types/notifications.ts`: `AppNotification`, `NotificationPreferences`, `NotificationType`, `NotificationSeverity`) |
| `index.ts` | — | Barrel re-exports all modules |

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
| `NotificationBell` | Fixed top-right bell with unread badge (`['notifications']`, 30s refetch) + dropdown panel (severity-tagged, type icons, mark-read on click, mark-all). Mounted in `(app)/layout.tsx` |

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
| `SuggestedCycleCard` | ⚠️ **Orphaned/unused** since Phase 5B — removed from cycling page (route matching absorbed by `training/WeeklyView`); file + `suggested-cycle` client/types kept for potential reuse. No component renders it and the `'suggested-cycle'` query no longer runs |

### `lifting/` — Lifting-specific
| Component | Purpose |
|-----------|---------|
| `AddExerciseForm` | Add exercise + sets to session |
| `ExerciseGroup` | Grouped sets for one exercise |
| `ExerciseProgressSection` | Exercise progress over time |
| `LiftingAnalysisCard` | Post-session analysis card |
| `SessionAiAnalysisCard` | Per-session AI lifting analysis (on-demand Gemini) |
| `LinkActivityModal` | Link activity to lifting session |
| `LiveWorkout` | Active-session UI for `/lifting/live` — header (elapsed timer from `started_at` timestamp, volume/sets, count-up since-last-set pill, sync status), exercise autocomplete + recent chips, weight/reps steppers (`Stepper`, tap-target ≥44px, configurable step size cycled ±1/2.5/5kg persisted in localStorage; draft-buffer input allows natural typing incl. trailing decimal points, select-all on focus, commit-on-blur), optional RPE dots + warm-up toggle, last-session reference line (`reference.ts` map), set log with double-tap undo, bottom LOG SET button (debounced), inline PR toasts via `detectPr()` (Brzycki e1RM vs stored PRs) |
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
| `RoutesMapView` | Map-first browse with custom markers showing quality scores, popups with route info |
| `RoutesListView` | Card-based list with route stats, difficulty badges, provider icons |
| `RoutesGridView` | Grid of route cards for visual/mobile browsing, touch-friendly |
| `RouteDetailPanel` | Slide-over detail panel with tabs (Overview, Map & Profile, History), edit/favorite/delete actions |
| `QualityBadge` | Circular quality score indicator with color tiers (Excellent/Good/Average/Fair/Poor) |
| `EffortEstimateCard` | Power-based effort estimation (Martin model) using user FTP, weight, distance, elevation |
| `RouteWeatherCard` | Current conditions + 7-day forecast for route location with "best day to ride" highlight |
| `RouteHistorySection` | Ride history table with personal best summary |
| `CompareRoutesModal` | Side-by-side route comparison with overlaid elevation profiles |

### `maps/` — Map components
| Component | Purpose |
|-----------|---------|
| `RouteMap` | Leaflet map with route polyline, start/end markers, isLoop indicator |
| `ElevationProfile` | Elevation chart for route |
| `SurfaceBreakdown` | Surface type stacked bar |
| Component | Purpose |
|-----------|---------|
| `SummaryStatsBar` | Summary stats grid (count, distance, time, TSS) shown above activity list |
| `ActivityCard` | Activity list item card with sport badge, source badges, weather, compare checkbox, linked lifting indicator |
| `CompareActivitiesModal` | Stream-overlay comparison modal — power/HR charts + stats delta table for 2 selected activities |
| `StatsView` | Stats tab view — monthly distance bars, sport breakdown pie, weekly TSS trend |

### `routes/` — Route page components
| Component | Purpose |
|-----------|---------|
| `CompareRoutesModal` | Side-by-side route comparison — overlaid elevation profiles, surface breakdown, stats delta table |
| `MapBrowseView` | Leaflet map with route markers for browse mode — click marker to select route |

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
| `DayConformityPanel` | Expanded plan-vs-actual detail for one day (Phase 5C): lazy `['day-conformity', dayId]` query fetched only while mounted (WeeklyView expanded panel), header badge + classification, weighted component table (humanized metric labels, planned → actual with units W/kg/min/%, deviation colored red-over/blue-under, weight %, component-score mini bar), "→" deviation notes in warning color, loading skeleton rows, status-appropriate empty message ("Not yet logged" / "Nothing planned") |
| `WeatherForecast` | 7-day forecast chips (`['weather-forecast']` query) with poor-cycling-conditions warning dots — rendered above plans grid on training page |
| `EventAiAnalysisCard` | AI event/race preparation analysis (on-demand Gemini) |

### `settings/` — Settings page components
| Component | Purpose |
|-----------|---------|
| `ExerciseManager` | Exercise library management — search, add custom exercises with aliases, view all exercises by category. Rendered on `/settings` page |
| `NotificationSettings` | Per-type notification toggles (health alerts / PRs / goal milestones / plan reminders) — `['notification-preferences']` query, PATCH on toggle. Rendered on `/settings` page |
| `RoutePickerModal` | Route selection modal for training plan day assignment — browse/search routes, preview on map |

### `lib/` — Shared utilities
| File | Purpose |
|------|---------|
| `analysisRenderer.tsx` | Shared markdown renderer (`renderAnalysisText`, `renderInline`) and `relativeTime` helper used by all AI analysis cards |
| `utils.ts` | `formatDuration`, `formatDistance`, `weatherEmoji` (conditions → emoji mapping shared by weather UI) |
| `training/week.ts` | Week-math helpers shared by WeeklyView + TodayTab: `toDateStr`, `diffDays`, `mondayOf`, `getWeek1Start`, `getTotalWeeks`, `getCurrentWeek` — mirrors backend week numbering |

### `lib/lifting/` — Live session logic
| File | Purpose |
|------|---------|
| `useLiveSession.ts` | Local-first live-session state hook. Persists full state to localStorage (`fittrack-live-session`) on every change; background syncer lazily POSTs the remote session (idempotent via stable `liveKey`, accumulated sets carry `client_id`) on first flush and maps **real** remote ids from the echoed response (undo deletes remotely); pushes unsynced sets / pending deletes with per-set `client_id` idempotency; flush progress merged into freshest storage (`mergeWithStorage`) so mid-flight logging isn't clobbered; never blocks logging on network — failures stay queued and retry on `online`/`visibilitychange`; finish flow PATCHes `ended_at` and clears storage; exposes `logSet`/`undoLastSet`/`requestFinish`/`discardSession` |
| `reference.ts` | Session-start reference data: `buildLastSessionMap` (exercise → most recent sets), `recentExerciseNames`, `detectPr` (Brzycki e1RM vs stored PRs + today's sets), `brzycki1rm` |

## Patterns

- **Auth**: `useAuthFetch()` hook returns `{ authFetch, authFetchWithHeaders }` — injects JWT from session
- **Data fetching**: React Query `useQuery` + `useMutation`. Query keys are string arrays like `['activities', filters]`
- **Styling**: Tailwind with custom dark theme tokens. No CSS modules
- **State**: Local `useState` for UI state. React Query for server state. Zustand stores for cross-component state (`lib/stores/routesStore.ts`: view mode, selection, tags, filters, detail tab, compare mode). No global Redux
- **Error handling**: `ErrorBoundary` wraps app layout. Query errors shown inline. AI analysis cards show user-friendly error messages for Gemini API failures
- **Mobile**: Responsive grids (`grid-cols-1 sm:grid-cols-N`), `Modal` bottom-sheet on phones, calendar agenda view (`md:hidden`), hamburger sidebar with `pt-16` clearance
- **PWA**: `manifest.ts` (App Router metadata route), `public/sw.js` (runtime caching — network-first navigations, stale-while-revalidate static, network-first API GETs with cache fallback), `PwaRegister.tsx` (production-only SW registration)
- **Sport utils**: `lib/sportUtils.ts` — `getSportColor`, `getSportTextColor`, `getSportBorderColor`, `getSportEmoji`, `isStrengthType`, `isCyclingOrRunning`, `STRENGTH_TYPES`, `getRecoveryColor`
- **Page titles**: `usePageTitle('Page Name')` hook in `lib/usePageTitle.ts` — sets `document.title` with " | FitTrack" suffix
- **Deep-links**: `useDeepLink` hook in `lib/useDeepLink.ts` — reads URL query params once on mount and updates them via `history.replaceState` (no Suspense needed). Powers record deep-linking: `/activities?activity=`, `/routes?route=`, `/lifting?session=`
- **Collapsible sidebar**: Desktop sidebar collapses to icon-only (`w-16`) via localStorage-persisted toggle. Mobile unaffected
- **Chart zoom**: Recharts `Brush` on line/area charts when >20 data points (dark theme styled)
