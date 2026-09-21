# Frontend CODEMAP

> Next.js 14 App Router, all pages `'use client'`, React Query, Tailwind dark theme.

## Pages (`app/(app)/`)

| Route | File | Description |
|-------|------|-------------|
| `/dashboard` | `dashboard/page.tsx` | Main dashboard — Today/Weekly/Monthly tabs. **Today**: rest-day banner (with one-tap adaptive apply action, QW3), readiness strip, today's planned workout (from active training plan), compact top-3 goals strip (QW6), KPI grid, form trend chart (CTL/ATL/TSB), side-by-side activities + lifting cards. **Weekly**: readiness, events, KPIs, charts, streaks, goals, AI analysis. **Monthly**: summary cards + year-in-review. Cross-links: event cards → `/training`, CTL/ATL/TSB cards → `/cycling`, weather-location + Whoop/Strava connect prompts → `/settings`, recent activity/session rows deep-link to `/activities?activity=` / `/lifting?session=` |
| `/training` | `training/page.tsx` | Training plans, events, periodization chart; segmented view toggle (**Plan Builder \| This Week** — WeeklyView) above the main pane when a plan is selected. Workout-planner FTP prompt links to `/cycling`; WorkoutPlanner has "Add to plan day" write-back via `updatePlanDay` (RM1, standalone section kept); route picker has a "Route library →" link to `/routes`. Each event card has a "📄 Export Prep PDF" button (§3.14) — blob-downloads `/api/v1/export/event-report/{id}` with the Bearer token |
| `/activities` | `activities/page.tsx` | Activity list with advanced filters (text search, min/max distance/duration/TSS), sort dropdown, List/Week/Timeline/Patterns view toggle, stream-overlay comparison (pick 2 rides → overlaid power/HR charts + stats delta table), weekly summary with mini inline bars. Deep-link `?activity=<id>` selects/expands a specific activity (rendered from fetched detail when not in the loaded list); "View route →" deep-links to `/routes?route=` |
| `/calendar` | `calendar/page.tsx` | Calendar view of activities + lifting. Day-detail activity titles → `/activities?activity=`, standalone lifting sessions → `/lifting?session=` |
| `/cycling` | `cycling/page.tsx` | Cycling analytics — power curve, zones, training load, FTP, VO2max (SuggestedCycleCard removed in Phase 5B). Weight-trend empty state links to `/settings` |
| `/health` | `health/page.tsx` | **Health page (§3.2)** — readiness + respiratory-rate status, recovery/HRV/resting-HR/respiration trend charts, recovery-vs-performance + sleep-quality + Whoop-strain charts (QW2), sleep intelligence (consistency/debt/optimal bedtime — the previously-unrendered `/metrics/sleep-*` endpoints), strain + sleep metric cards, tabbed health-alert history with dismiss, AI health analysis card |
| `/lifting` | `lifting/page.tsx` | Lifting sessions, PRs, exercise progress, warmup templates, weekly-volume chart (QW2, with injury-risk insight), estimated-1RM-history chart with exercise selector (QW2). **§1.1 video chips**: session + PR cards show a "📹 N" badge when videos are linked — click opens a gallery modal with inline video playback. Live Lift entry banner + Whoop-unmatched warning (live sessions with `started_at`/`ended_at`, no `whoop_strain`, ended >3h ago). Session cards + detail show live-session start–end times and duration. Deep-link `?session=<id>` selects a session; empty state CTAs to `/lifting/live`; linked-Strava card deep-links to `/activities?activity=` |
| `/goals` | `goals/page.tsx` | Dedicated goals page — Active/Achieved/Expired/All tabs, goal cards with progress + alignment badges, **ProjectionCard summary strip (Phase 7)** for active goals with target dates, create modal (metric-registry-driven), detail modal with check-in chart + projection line + edit/delete/reactivate. Sport-specific goal cards cross-link: cycling → `/cycling`, lifting (1RM/volume/big3) → `/lifting` |
| `/lifting/live` | `lifting/live/page.tsx` | **Live Lift** — mobile-first live session tracker. Pre-start (focus/program/warmup template; **"Load from today's plan" suggest-only chip** when an active plan schedules a strength day today — tap prefills focus + first exercise; surfaces an orphaned server-side active session via `GET /sessions/active` with **Resume session** (rebuilds local state from the server)` + Close it) → active workout (`LiveWorkout`: steppers w/ smart prefill from last logged set or last-session reference, count-up since-last-set pill, honest `⟳ N to sync` / `✓ Synced` pill, 1-tap logging, double-tap undo, Wake Lock, PR toasts) → finish sheet (RPE/notes; invalidates `['lifting-sessions']`+`['personal-records']` so next "last session" line is fresh) → **post-finish "Session saved" summary** (duration/volume/sets/RPE/exercises, deep-link to `/lifting?session=<id>`, Start another). Interrupted-finish overlay has Retry + Discard. Local-first: state persisted to localStorage every mutation, background syncer lazily creates the remote session then pushes sets/deletes, flushes on reconnect/foreground. "← Lifting" back links on pre-start + active headers. Active workout extras: live **e1RM projection**, **recovery-adapted rest target** (from `['readiness']`), **plate calculator** modal, and a per-exercise **set-target checklist** when started from today's plan; post-finish summary has **Export CSV** |
| `/lifting/videos` | `lifting/videos/page.tsx` | **§1.1 Video Bank** — list all strength videos with source/exercise/date filters, preview modal, add-video modal (R2 upload only — URL mode removed 2026-09-09), per-video delete, AI form-analysis panel |
| `/routes` | `routes/page.tsx` | Route management — **List/Map/Grid view toggle** (keyboard 1/2/3), filtering (status, sport, source, **surface type**, route type, distance, elevation, sort, search), route list with **difficulty badges** (Easy/Moderate/Hard/Extreme from elevation/distance ratio), **compare checkboxes** (pick 2 → overlaid elevation profiles + stats delta modal; modal only opens once both routes load, one-route state shows a hint pill), route detail with tabs (Overview, Map & Profile, History, Merged View, Weather, Effort, Segments). **Mobile**: route detail opens as a **bottom sheet** (`MobileRouteDetailSheet`) with swipe-down dismiss. **Desktop**: slide-over panel. GPX upload/download. **Heatmap toggle** on map view shows Strava-style activity density around home area. Deep-link `?route=<id>` selects a route; ride-history rows deep-link to `/activities?activity=` |
| `/routes/duplicates` | `routes/duplicates/page.tsx` | Duplicate-route review queue — candidate pairs with merge/auto-merge actions, linked from the routes header |
| `/wiki` | `wiki/page.tsx` | In-app wiki — 11 sections: Overview, Getting Started, Metrics Glossary, Science & Research, Maximizing Impact, Weakness Analysis, Ride Fueling, Weather Integration, Training Plans & Conformity, Goals & Projections, **What's New (changelog)**. Sticky sidebar nav with IntersectionObserver scroll highlighting. Feature mentions hyperlink to the owning page via a shared `WikiLink` helper |
| `/notifications` | `notifications/page.tsx` | **Notifications page (Phase C §3.5)** — full history of typed notifications (severity/type badges, deep links), unread dot + mark-read/mark-all, tabbed **preferences panel** (per-type toggles persist to `/notifications/preferences`, syncs `NotificationSettings`) |
| `/analytics` | `analytics/page.tsx` | **Feature 3/B-15 Analytics** — six deterministic athlete-model cards (recovery cost, sleep→performance, load split, power norms, PR conditions, TSB peak) with collecting/low/medium/high confidence badges + sample counts, drill-down tables, on-demand Recompute |
| `/today` | `today/page.tsx` | **Feature 5/B-16 morning-brief POC** — deterministic verdict (recovery + TSB + sleep debt, visible reasoning), today's plan, weather note, top AthleteInsight. Self-contained; verdict engine in `lib/brief.ts` |
| `/settings` | `settings/page.tsx` | OAuth connections, cycling profile, **exercise library management** (add/search exercises), **Preferences card (§3.6)** — unit system (kg/km vs lb/mi), date locale (en-GB/en-US), time format (12/24h) pill toggles via `useUnits()` → `/user/preferences` |

## API Clients (`lib/api/`)

> **2026-09 dead-client sweep**: the `activities`, `dashboard`, `nutrition`,
> `events`, `llmAnalysis`, `workoutPlanner`, `deficiency` and `auth` client modules were
> deleted (zero importers — those pages call endpoints inline via `authFetch`), and dead
> functions were pruned from survivors. **B-10 (2026-09-20)**: `cycling.ts` (12 unused fns),
> `crossDomain.ts`, `preferences.ts` deleted; 3 unused video fns pruned from `lifting.ts`.
> All remaining module functions are imported somewhere. Domain **types** under `types/` are unaffected.

| File | Backend Prefix | Key Functions |
|------|---------------|---------------|
| `fetch.ts` | — | `apiFetch`, `apiFetchWithHeaders`, `apiUpload`, `useAuthFetch` hook |
| `types.ts` | — | Barrel re-exports from `types/` domain modules |
| `lifting.ts` | `/api/v1/lifting/` | `getLiftingSessions`, `getActiveLiftingSession`, `createLiftingSession`, `updateLiftingSession`, `deleteLiftingSession`, `addSetToSession`, `deleteLiftingSet`, `getPersonalRecords`, `getWarmupTemplates`, `suggestLoad` (`POST /suggest-load` %e1RM prescription, FL3), video AI (`createLiftVideo`, `getVideoUploadUrl`, `getVideoStreamUrl`, `deleteLiftVideo`, `processLiftVideo` — read-path fns removed B-10, pages fetch inline) |
| `routes.ts` | `/api/v1/routes/` | `getRoutes`, `getRoute`, `syncRoutes`, **duplicates** (`getDuplicateRoutes`, `mergeRoutes`, `autoMergeDuplicates`), `downloadRouteGpx`, **merged view** (`getMergedRouteView` — per-source polylines + ridden segments), **heatmap** (`getHomeAreaHeatmap` — activity points near home). Smart collections via typed `createCollectionFromFilters`; remaining tag/quality/effort/bulk operations are called inline by the routes UI |
| `goals.ts` | `/api/v1/goals/` | `listGoals`, `createGoal`, `updateGoal`, `deleteGoal`, `getGoalMetrics`, `addCheckIn`, `getCheckIns`, `reactivateGoal` |
| `trainingPlans.ts` | `/api/v1/training-plans/` | `getTrainingPlans`, **week view** (`getPlanWeek` — `GET /{id}/week/{n}?include_weather`; days carry `targets_stale`, FL1), targeted day edits (`updatePlanDay`, `copySessionToPlanDay`, `copyPlanDayToDate`), **target refresh** (`refreshTargets` — `POST /{id}/refresh-targets`, FL1/FL3), **workout preview** (`previewWorkout` + `WorkoutPreviewTargets`/`WorkoutPreviewResponse` types — used by PlanBuilder), **adaptive** (`getAdaptiveSuggestions` — §3.11 weekly advice) |
| `conformity.ts` | `/api/v1/training-plans/` | Phase 5C conformity: `getPlanConformity` (`GET /{id}/conformity?weeks=N`), `getDayConformity` (`GET /{id}/days/{dayId}/conformity`), `linkPlanActivities` (`POST /{id}/link-activities`) — types in `types/conformity.ts`: `PlanConformityResponse`, `WeekConformity`, `DayConformityResponse`, `ConformityComponent`, `DayConformityStatus`, `LinkActivitiesResponse` |
| `weather.ts` | `/api/v1/weather/` | `getCurrentWeather`, `getForecast` — 404 → `null` (no location set / untagged); takes backend JWT explicitly since `apiFetch` can't distinguish 404s (`types/weather.ts`: `CurrentWeather`, `ForecastResponse`, `ForecastDay`) |
| `projections.ts` | `/api/v1/projections/` | `getGoalProjection` (`GET /goal/{id}`) — types in `types/projections.ts`: `GoalProjectionResponse`, `TrendInfo`, `ProjectionPoint` |
| `exercises.ts` | `/api/v1/lifting/exercises` | `searchExercises`, `createExercise`, `deleteExercise` — DB-backed exercise library CRUD (`types`: `ExerciseEntry`, `ExerciseDetail`) |
| `notifications.ts` | `/api/v1/notifications/` | `listNotifications`, `markNotificationRead`, `markAllNotificationsRead`, `getNotificationPreferences`, `updateNotificationPreferences` — authFetch-first pattern (`types/notifications.ts`: `AppNotification`, `NotificationPreferences`, `NotificationType`, `NotificationSeverity`) |
| `weight.ts` | `/api/v1/metrics/weight` | `getWeightHistory`, `createWeightEntry`, `updateWeightEntry`, `deleteWeightEntry` — manual weigh-in CRUD with optional body-composition payload (`WeightEntryPayload`: body_fat_% + muscle; types via `types/health.ts` `WeightEntry` incl. composition fields/`WeightHistoryResponse`) |
| `search.ts` | `/api/v1/search` | `globalSearch` — cross-domain command-palette lookup (activities/routes/lifting sessions/exercises/goals/events) |
| `account.ts` | `/api/v1/export`, `/api/v1/account` | **§3.9 data portability** — `exportFullJson` (`GET /export/json`), `deleteAccount` (`DELETE /account/delete` with `confirm_email` body), `downloadExport` (client-side blob download), `logoutBackend` (`POST /auth/logout`, SEC-07). Types in `types/export.ts` |
| `segments.ts` | `/api/v1/segments`, `/api/v1/routes/{id}/segments` | `getSegments`, `getSegmentDetail`, `recomputeRouteSegments` (§3.13 climb segments) |
| `healthPrefs.ts` | `/api/v1/metrics/health-preferences` | `getHealthPreferences`, `updateHealthPreferences` (§3.12 tuning) |
| `index.ts` | — | Barrel re-exports the above + `types`/`fetch` |

> B-10 removed `preferences.ts` (fns unused — `units.tsx` calls `/user/preferences` inline; types stay in `types/preferences.ts`) and `crossDomain.ts` (fn unused — WeeklyTab calls inline).

## Components

### `ui/` — Shared primitives
| Component | Purpose |
|-----------|---------|
| `Card` | Styled card container with header/title |
| `Badge` | Colored badge for sport types, statuses |
| `Skeleton` | Loading skeleton primitives (metric, chart, row) |
| `EmptyState` | Empty state with icon, title, CTA button |
| `Changelog` | Accordion-style release history rendered in the Wiki's "What's New" section; data from `lib/changelog.ts` |
| `ErrorBoundary` | React error boundary with retry |
| `GoalCard` | Goal display with progress bar, alignment badge, direction-aware fill |
| `PRCelebration` | Animated PR celebration toast |
| `ReadinessIndicator` | Training readiness gauge |
| `PageLoadingBar` | Top loading bar for route transitions |
| `ExerciseAutocomplete` | Exercise name autocomplete input |
| `Modal` | Responsive modal — bottom sheet on mobile (<sm), centered dialog on desktop (≥sm). Focus trap + once-only initial focus + `aria-modal` + `inert` app shell; opt-in `guardClose` blocks backdrop/Escape dismiss for dirty forms. Includes `ModalHeader` sub-component (44px close) |
| `TabGroup` | Accessible tab bar with ARIA tablist/tab/selected attributes |
| `ProviderBadge` | Provider icon + color badge (strava, komoot, wahoo, manual). Exports `ProviderIcon`, `PROVIDER_COLORS`, `PROVIDER_ICONS`. Icon paths carry the `/fittrack` basePath prefix (raw `<img>` is not prefixed automatically); manual falls back to a lucide `Pencil` |
| `MetricCard` | Unified metric card — supports simple trend strings (dashboard) and complex MetricTrend/benchmark (cycling). Icon, unit, tooltip (focusable via `group-focus-within`), subtitle. Values use `tabular-nums` |
| `NotificationBell` | Fixed top-right bell with unread badge (`['notifications']`, 30s refetch) + dropdown panel (severity-tagged, type icons, mark-read on click, mark-all, "View all" → `/notifications`). Mounted in `(app)/layout.tsx` |
| `CommandPalette` | **Global ⌘P/Ctrl+P search (Phase C §3.4)** — modal command palette over `GET /api/v1/search`, debounced, keyboard-navigable (↑/↓/Enter/Esc), grouped cross-domain hits with deep links (`?activity=`, `?route=`, `?session=`). Opens via keyboard or sidebar Search button (`fittrack:command-palette` custom event). Mounted in `(app)/layout.tsx` |
| `TrendArrow` | Trend direction arrow (↑/↓/→) with color coding — moved from `dashboard/helpers` |
| `DeficiencyCard` | Weakness/deficiency analysis card (`['deficiency']` query) — severity-grouped lifting/cycling weaknesses; rendered on dashboard WeeklyTab + lifting page. Moved from `dashboard/` |
| `Button` / `IconButton` | Single button primitive — variants primary/secondary/tinted/ghost/danger/success, sizes sm/md/lg with 44px default, `loading` spinner slot. `IconButton` is 44×44 with required `aria-label` |
| `Spinner` | Single loading spinner (`role="status"` + sr-only label). Prefer shape-matched `Skeleton*` for content areas |
| `PageHeader` | Single page-header pattern (title + subtitle + actions + status). Replaces ad-hoc `<h1>` strings |
| `SectionLabel` | Small-caps section label — the one allowed `uppercase` pattern |
| `Stat` | Metric-stat pattern (label + tabular value + unit + delta). Content-only — wrap in `Card`/grid at the call site |
| `Field` | Labelled form field — assigns `id`, wires `aria-describedby`/`aria-invalid`, renders hint/error |
| `Toast` | App-wide toast system (`ToastProvider` mounted in `Providers`; `useToast().success/error/toast`). Success/info auto-dismiss, errors sticky |
| `ConfirmDialog` | Accessible confirm dialog (built on `Modal`) for destructive actions — replaces native `confirm()` |
| `ErrorState` | Query-error card (`role="alert"`) with Retry. Use for `isError` — never render "no data" for failures |
| `AppIcon` | Lucide icon wrapper — consistent sizing, `aria-hidden` by default |

### `analysis/` — Shared analysis components
| Component | Purpose |
|-----------|---------|
| `AiAnalysisCard` | Shared AI analysis card — base component for all per-domain AI analysis cards (cycling, lifting, health, events). Collapsed-by-default "Based on" grounding chips from `stats_json` (RM2) |

### `charts/` — Data visualization
| Component | Purpose |
|-----------|---------|
| `Chart` | Generic Recharts wrapper — line, bar, scatter, area, pie + CSS-grid calendar heatmap. Renders `ChartData` from backend. Unit-aware tooltips, date tick formatting, adaptive dots, secondary Y axis (`y_axis`), built-in empty state via `hasData()` |
| `ChartBody` | Quad-state chart body — loading spinner / error + Retry / empty message / Chart |
| `ChartCard` | Card wrapper with title, header actions slot, and ChartBody (`isError`/`onRetry` passthrough) |

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
| `LlmAnalysisCard` | Overall cycling Gemini LLM analysis display |
| `WeightPanel` | **Body-weight management (Phase C §3.1)** + Withings composition — quick-add form (date + kg → `POST /metrics/weight`, optional body-fat %/muscle via +Composition toggle), 7-day rolling avg summary, source badges (Withings teal / Whoop purple / Manual gray; non-manual entries read-only), expandable per-entry composition grid, invalidates `['weight-history']` + weight/body-comp/W-kg chart queries. Rendered on `/cycling` (full) and dashboard Today strip (`compact` prop). Deletes go through `ConfirmDialog` + toast |
| `PowerModelSection` | **Modal power models** — CP/W′/R² + personalized VO2max + adaptive CTL/ATL taus (`['power-model']` query, GET `/cycling/power-model`); empty state notes weekly Sunday fitting |
| `WeatherAnalysisSection` | **Modal weather-performance** — power-vs-temp, wind penalties, decoupling threshold, HR drift, insight bullets (`['weather-analysis']` query, GET `/cycling/weather-analysis`); rendered on `/cycling` after the power model |

### `lifting/` — Lifting-specific
| Component | Purpose |
|-----------|---------|
| `AddExerciseForm` | Add exercise + sets to session |
| `ExerciseGroup` | Grouped sets for one exercise |
| `ExerciseProgressSection` | Exercise progress over time |
| `LiftingAnalysisCard` | Post-session analysis card |
| `SessionAiAnalysisCard` | Per-session AI lifting analysis (on-demand Gemini) |
| `LinkActivityModal` | Link activity to lifting session |
| `LiveWorkout` | Active-session UI for `/lifting/live` — header (elapsed timer from `started_at` timestamp, volume/sets, count-up since-last-set pill, sync status pill that shows `⟳ N to sync` while sets/deletes are queued locally instead of a false ✓), exercise autocomplete + recent chips, weight/reps steppers (`Stepper`, tap-target ≥44px, configurable step size cycled ±1/2.5/5kg persisted in localStorage; draft-buffer input allows natural typing incl. trailing decimal points, select-all on focus, commit-on-blur), optional RPE dots + warm-up toggle, last-session reference line (`reference.ts` map), set log with two-tap delete for **any** set (not just the last), bottom LOG SET button (debounced), inline PR toasts via `detectPr()` (Brzycki e1RM vs stored PRs), live projected/session-best **e1RM**, **recovery-adapted rest target** pill, **plate-calculator** modal, and a **plan set-target checklist**. Prefill uses `reference.lastSet` (true last logged set, not highest-volume) and is applied whenever the exercise changes — including the initial mount (plan preset / resumed session); Wake Lock is released on unmount so finishing in place doesn't leave the screen locked |
| `ManualPRForm` | Manual PR entry form |
| `WarmupTemplateManager` | Warmup template CRUD |
| `VideoEmbed` | **§1.1/§3.18** — R2 `<video>` player; presigned GET via `getVideoStreamUrl` with an **Original / Trimmed / Pose** variant toggle (defaults to Original; Pose = skeleton + bar-path overlay), retries failed loads |
| `VideoChip` | **§1.1** — Small purple badge showing "📹 N" with video count. Split from `VideoEmbed` |
| `VideoGalleryModal` | **§1.1** — Modal listing videos for a session/PR, each rendered via `VideoEmbed` |
| `LiftVideoForm` | **§1.1** — Add-strength-video modal: R2 presigned PUT with progress bar; exercise autocomplete, optional session/PR linkage, expected-reps and **camera-angle** selectors (side unlocks sagittal form checks). Validation/upload errors render in an inline `role="alert"` banner (no native `alert()`) |
| `VideoAnalysisPanel` | **§3.18** — Post-analysis card: form-score ring + IPF badge, deviations/cues, velocity (mean/peak/loss + VBT zone), per-rep table (ROM/time/velocity), RPE. Shows a camera-view badge, or a "film side-on" hint when the angle is unknown |

### `health/` — Health-specific
| Component | Purpose |
|-----------|---------|
| `HealthAiAnalysisCard` | AI health analysis (HRV, sleep, recovery — on-demand Gemini) |
| `HealthAlertsSection` | Health alert history with dismiss — moved from `dashboard/` |
| `RespiratoryRateCard` | Respiratory rate trend card — moved from `dashboard/` |
| `WhoopWeeklyCard` | Whoop weekly recovery/strain summary — moved from `dashboard/` |

### `routes/` — Route components
| Component | Purpose |
|-----------|---------|
| `RoutesSidebar` | Collapsible tag/collection tree with smart collections, tag chips, drag-drop support |
| `RouteFilterBar` | Unified filter bar with search, sort, advanced filters (distance, elevation, surface, quality, favorite), keyboard shortcuts, **"Save as Collection" button** (serializes active filters → smart collection via `POST /collections/from-filters`, including `is_ridden`). Debounced search only writes when the query changed |
| `RoutesMapView` | Map-first browse with custom markers showing quality scores, popups with route info. Heatmap toggle shows activity density around home area. CARTO dark basemap to match the theme |
| `RoutesListView` | Card-based list with route stats, difficulty badges, provider icons. Rows are keyboard-operable (`Card onClick`); compare checkbox is a 44px labelled control |
| `RoutesGridView` | Grid of route cards for visual/mobile browsing, touch-friendly. Cards keyboard-operable; single compare checkbox per card (no double-toggle) |
| `RouteDetailPanel` | Slide-over detail panel with tabs (Overview, Map & Profile, History, Merged View, Weather, Effort), edit/favorite/delete actions. Map & Profile tab has a 2D/3D toggle — 3D lazy-loads `Route3D`. `scrollable={false}` disables the panel's own scrollers when embedded in the mobile sheet (single-scroller) |
| `MobileRouteDetailSheet` | Mobile (<lg) bottom-sheet wrapper around `RouteDetailPanel` — slides up from bottom with backdrop, velocity-aware swipe-down to dismiss, 44px grab handle, Escape close, dialog semantics; passes `scrollable={false}` |
| `Route3D` | **§3.16 3D terrain** — three.js drapes the route polyline (fat `Line2` drape) over an Open-Meteo Copernicus DEM heightmap (≤200-point grid via `computeGrid`, no API key, attribution shown); vertex-coloured by elevation or diverging slope ramp (blue descent → green flat → red climb via `slopeColor`/`DESCENT_COLOR`, legend spans `minSlopePct…GRADE_SCALE`), start/end/summit markers, **§3.13 climb-segment overlays** (orange spans + name labels via `segments` prop), in-scene **north arrow + world-unit scale bar**, 2D-profile **hover marker** (`highlightDistKm`), **relief slider** (auto or 1–15×) + **frame top-climb/steepest-km** button, orbit/zoom/pan via `OrbitControls` (camera pose preserved across rebuilds), WebGL fallback + graceful flat-drape when the DEM fetch fails. Lazily imported `next/dynamic ssr:false` so `three` stays out of the `/routes` first-load bundle; side-by-side instances in `CompareRoutesModal`. Pure math in `lib/route3d.ts` (unit-tested `src/__tests__/route3d.test.ts`); DEM fetch in `lib/terrain.ts`. Roadmap: `plans/archive/3d-ride-view-enhancements.md` |
| `MergedRouteMapView` | Merged route view — draws each contributing source's polyline with distinct colors + highlights ridden activity segments in green. CARTO dark basemap |
| `QualityBadge` | Circular quality score indicator with color tiers (Excellent/Good/Average/Fair/Poor) |
| `EffortEstimateCard` | Power-based effort estimation (Martin model) using user FTP, weight, distance, elevation |
| `RouteWeatherCard` | Current conditions + 7-day forecast for route location with "best day to ride" highlight |
| `RouteHistorySection` | Ride history table with personal best summary |
| `SegmentsCard` | **§3.13** Climb-segment browser in `RouteDetailPanel`'s Segments tab: `['route-segments', routeId]` (GET `/segments?route_id=`); per-segment PR time / times-ridden / best power with Strava-style Category badge (HC/1–4) **+ Modal intelligence badges (climb-type chip, difficulty score)**; expandable rows fetch `['segment-detail', id]` leaderboard-of-self (rank, PR flag, elapsed, avg W, VAM, date); "↻ Recompute" → `POST /routes/{id}/segments/recompute` |
| `CompareRoutesModal` | Side-by-side route comparison — overlaid elevation profiles, surface breakdown, stats delta table |
| `DifficultyBadge` | Route difficulty badge (Easy/Moderate/Hard/Extreme from elevation/distance ratio) — extracted from `routeUtils` |

### `maps/` — Map components
| Component | Purpose |
|-----------|---------|
| `RouteMap` | Leaflet map with route polyline, start/end markers, isLoop indicator. CARTO dark basemap |
| `ElevationProfile` | Elevation chart for route |
| `SurfaceBreakdown` | Surface type stacked bar |

### `activities/` — Activity page components
| Component | Purpose |
|-----------|---------|
| `SummaryStatsBar` | Summary stats grid (count, distance, time, TSS) shown above activity list |
| `ActivityCard` | Activity list item card with sport badge, source badges, weather, compare checkbox, linked lifting indicator |
| `CompareActivitiesModal` | Stream-overlay comparison modal — power/HR charts + stats delta table for 2 activities; **3D Side-by-Side tab** with linked playback (one master clock, Linked/Independent toggle) |
| `Replay3D` | **§3.16 3D ride replay** — three.js scene (fat `Line2` path coloured by **speed/power/HR/grade** with per-mode legend, missing samples as slate gaps; growing ridden trail, heading-oriented rider cone, km-marker dots + sprite labels, live speed/power/HR/cadence/grade HUD chip, **orbit/chase/cockpit cameras** (bounded zoom, zoom-to-cursor, double-click focus, Reset/Top/Rider presets), scene-scale ground grid, play/scrub/tour-speeds (whole ride in ~2m/1m/30s)) fed by `buildReplay()` from `lib/replay` (result carries `lat0/lng0/altMin/zScale` frame for mesh alignment; points carry `cadence` + `grade`); **opt-in DEM terrain button** (off by default — lazy `terrain.ts` + `route3d.buildTerrainMesh`, swaps `GridHelper` for Copernicus bed, attribution footer); power stream lookup via `lib/streams.ts` (`watts` Strava → `power` FIT); velocity via `velocity`/`velocity_smooth`/`enhanced_speed`; HR via `heartrate`/`hr`/`heart_rate`; `onElapsed` 10 fps callback drives the `3D ▸ m:ss` chip in the expanded activity view; optional `link: ReplayLink` for parent-owned linked playback (side-by-side compare); lazy-loaded via `next/dynamic` `ssr:false` so `three` stays out of the `/activities` first-load bundle; WebGL fallback message. `TelemetryStrip` (same file): SVG HR/power + expandable speed/cadence/altitude rows with synced playhead and live values; Coggan zone bands behind the power row when `ftpWatts` is passed. The expanded activity view marks the 3D playhead on the 2D stream chart via `ChartData.reference_line` (2 fps quantized). Pure math lives in `lib/replay.ts` (unit-tested in `src/__tests__/replay.test.ts`). Roadmap: `plans/archive/3d-ride-view-enhancements.md` |
| `StatsView` | ⚠️ Dead code — Stats tab view (monthly distance bars, sport breakdown pie, weekly TSS trend). Present but unimported (activities page uses List/Week/Timeline/Patterns). Wire it up or delete |
| `ActivityAiAnalysisCard` | Per-activity AI ride analysis (on-demand Gemini) — moved from `cycling/`, uses shared `AiAnalysisCard` |
| `WeatherBadge` | Inline `🌧️ 12°C 💨 25km/h` indicator for activity rows (weather fields on `Activity`) — moved from `cycling/` |
| `TssSourceBadge` | TSS provenance badge (QW4: ⚡P power / ~H hrTSS / ⧉P provider / ✎M manual, NULL → nothing), rendered next to TSS in `ActivityCard` + context badges |

### `calendar/` — Calendar page components
| Component | Purpose |
|-----------|---------|
| `DayDetailPanel` | Selected day detail — recovery/sleep cards, activity details with stats grid, lifting session notes editor |
| `CalendarAgendaView` | Mobile agenda list (phones only) — day rows with activity badges and recovery score |

### `dashboard/` — Dashboard tab sections
| Component | Purpose |
|-----------|---------|
| `RestDayBanner` | Rest-day suggestion banner — TSB/recovery/consecutive-days triptych + reasons list; shared by Today + Weekly tabs. Optional `action` slot renders the one-tap adaptive apply row on Today (QW3) |
| `TodayAdaptiveAction` | One-tap adaptive apply on the Today tab (QW3) — fetches plan suggestions, applies today's (or next) rest/cut/raise action via `updatePlanDay`, invalidates plan + dashboard queries; renders nothing when inactive |
| `GoalsSection` | Compact top-3 active goals on dashboard — progress bars + "View all →" link to /goals |
| `WeatherWidget` | Current-conditions card (`['weather-current']` query) — hero header of dashboard; prompt state when no home location set |
| `DashboardRefresh` | **§3.15 stale-data UX** — "Last updated" timestamp (freshest `dataUpdatedAt` across the 16 dashboard queries, via `queryCache.subscribe`) + manual refresh button (`refetchQueries` by query-key prefix) + spinning "Syncing…" state (`useIsFetching` predicate). Hero header next to `WeatherWidget`; all dashboard queries also set `refetchOnWindowFocus: true` |
| `CrossDomainInsightsCard` | **Modal cross-domain** — sleep-performance / cross-sport / race-retrospective insight groups (`['cross-domain-insights']` query, GET `/cross-domain`); returns null when empty. Rendered on dashboard WeeklyTab |

### `goals/` — Goal management
| Component | Purpose |
|-----------|---------|
| `GoalCreateModal` | Create-goal modal driven by `GET /goals/metrics` — metric select (label+unit), dynamic filter inputs (exercise autocomplete, sport select), target value, optional target date, notes |
| `GoalDetailModal` | Full goal detail — check-in history Recharts line chart with target reference line + projection line (Phase 7, dashed), projection badge/info section, manual check-in form, edit mode (target/date/notes/filter), delete with confirmation, reactivate when expired/abandoned |
| `ProjectionCard` | Compact projection summary strip (Phase 7) — shown on goals page for active goals with target dates; each goal shows metric label, badge (On Track/At Risk/Unlikely), projected date; click opens GoalDetailModal |

### `training/` — Training plan components
| Component | Purpose |
|-----------|---------|
| `PlanBuilder` | Full plan builder (Phase 5A): empty state (scratch/template creation w/ event taper select), plan header (inline rename, badges, event link/unlink, Activate/Delete), week tabs + "All" per-week summary, 7-col day cards with sport-aware expandable editors (cycle: power/zone; strength: session type + RPE/exercise list via `ExerciseAutocomplete` + computed volume), HTML5 drag-to-swap dates (desktop) + ⇄ Swap-date picker in the day editor (touch alternative, same `swapDates` logic), pointer-aware drag tip, sticky unsaved-changes footer. Edits accumulate locally keyed by `day_date`; Save PATCHes the FULL days array (backend upserts by date and deletes missing dates — never send partial days). Keyed by plan id from training page to reset state on plan switch. Copy Session / Duplicate disabled on draft days |
| `WeeklyView` | Weekly planning view (Phase 5B, sibling of PlanBuilder — toggle "This Week" on training page): Monday-aligned week navigation (week math mirrors backend: `week1 = start − weekday(start)`), readiness strip (CTL/ATL/TSB + recommended-zone dot), **conformity summary strip (Phase 5C, `['plan-conformity', planId]` staleTime 60s)** — overall % big number, trend arrow (↑/↓/→), per-sport chips from the viewed week's `by_sport`, warning-tinted patterns box, "Link activities" button (`POST /link-activities`); **TSB projection strip (Phase 7, `['tsb-projection', planId]` — event-linked plans only)** — race-day TSB + freshness assessment; **stale-target badges + "Refresh targets" button (FL1)** with CP/FTP mismatch warning; 7 responsive day cards with weather emoji + bad-weather chips, actual activity/lifting summaries in green blocks, `ConformityBadge` status per day (done/pending/missed; rest hidden), expandable panel with planned-exercise table + route matches ("Assign" → single-day PATCH `{planned_route_id}`) + quick-edit (duration/TSS/notes) + `DayConformityPanel`. Queries `['plan-week', planId, week]`; edits use targeted `updatePlanDay` PATCHes and invalidate week + both conformity queries — unlike PlanBuilder's full-array saves |
| `ConformityBadge` | Tiny inline day-status badge (Phase 5C): done → green dot + %, partial → yellow, missed → muted-red "Missed", extra → blue "Extra", pending → gray "—", rest → renders nothing; tooltip = classification when present (optional `title` override used by WeeklyView's heuristic labels) |
| `EventResultPanel` | **Race result logging (Phase C §3.3)** — renders on past event cards (Training page) with result badges (#overall / #class / PB / finish time), inline add/edit form (time-or-seconds, overall/class position, PB checkbox, notes) via `PUT /events/{id}/result`, clear via `DELETE` behind `ConfirmDialog` + toast; invalidates `['events']` + `['notifications']` |
| `AdaptiveSuggestionsCard` | **§3.11** Weekly adaptive advice card (mounted in `WeeklyView`): `['adaptive-suggestions', planId]` query (GET `/training-plans/{planId}/suggestions`); fatigue badge + summary; per-axis stance chips (recover/rest/ease/maintain/build) with severity dots; suggestion list with one-tap apply buttons → `updatePlanDay` PATCH mutation invalidating `plan-week`/`plan-conformity`/`adaptive-suggestions`/`training-plan`/`training-plans`. Hides itself when there's no advice yet |
| `DayConformityPanel` | Expanded plan-vs-actual detail for one day (Phase 5C): lazy `['day-conformity', dayId]` query fetched only while mounted (WeeklyView expanded panel), header badge + classification, weighted component table (humanized metric labels, planned → actual with units W/kg/min/%, deviation colored red-over/blue-under, weight %, component-score mini bar), "→" deviation notes in warning color, loading skeleton rows, status-appropriate empty message ("Not yet logged" / "Nothing planned") |
| `WeatherForecast` | 7-day forecast chips (`['weather-forecast']` query) with poor-cycling-conditions warning dots — rendered above plans grid on training page |
| `EventAiAnalysisCard` | AI event/race preparation analysis (on-demand Gemini) |
| `RoutePickerModal` | Route selection modal for training plan day assignment — browse/search routes, preview on map |

### `settings/` — Settings page components
| Component | Purpose |
|-----------|---------|
| `ExerciseManager` | Exercise library management — search, add custom exercises with aliases, view all exercises by category. Rendered on `/settings` page |
| `NotificationSettings` | Per-type notification toggles (health alerts / PRs / goal milestones / plan reminders) — `['notification-preferences']` query, PATCH on toggle. Rendered on `/settings` page |
| `HealthAlertSettings` | **§3.12 Health-alert tuning card** — per-signal enable toggle, snooze (3/7/14/30 days), and threshold inputs for the new performance-decline / sleep-consistency / resting-HR signals (persist via `GET/PUT /metrics/health-preferences`). Rendered on `/settings` page |
| `WebPushCard` | **§3.8 Web Push settings card** — capability detection, Enable (subscribe → `/push/subscriptions`) / Disable (unsubscribe) buttons, device count, permission-denied notice. Rendered under the notifications card on `/settings` page |
| `DataPortabilityCard` | **§3.9 data portability card** — JSON export (client-side blob download from `GET /export/json`) + account deletion (Modal with email confirmation, `DELETE /account/delete` → `signOut`). Rendered at the bottom of `/settings` page |
| `IntelligenceStatusCard` | **Modal intelligence status** — per-feature fitted/not-fitted state from `CyclingProfile` (`power_model_fitted_at`, `weather_analyzed_at`) + static entries for cross-domain/segments. Rendered on `/settings` before Export Data |

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
| `routeUtils.ts` | Pure route utility functions (renamed from `.tsx`) — distance/elevation formatting, difficulty calculation, + re-exports `DifficultyBadge` |
| `training/week.ts` | Week-math helpers shared by WeeklyView + TodayTab: `toDateStr`, `diffDays`, `mondayOf`, `getWeek1Start`, `getTotalWeeks`, `getCurrentWeek` — mirrors backend week numbering |
| `streams.ts` | Activity-stream accessors — single Strava-vs-FIT spelling matrix (`watts|power`, `velocity|velocity_smooth|enhanced_speed`, `heartrate|hr|heart_rate`): `streamInput`/`getStreamValues`/`presentStreamTypes`/`hasStream`. Used by the expanded activity view + compare modal (unit-tested `src/__tests__/streams.test.ts`) |

### `lib/lifting/` — Live session logic
| File | Purpose |
|------|---------|
| `useLiveSession.ts` | Local-first live-session state hook. Persists full state to localStorage (`fittrack-live-session`) on every change; background syncer lazily POSTs the remote session (idempotent via stable `liveKey`, accumulated sets carry `client_id`) on first flush and maps **real** remote ids from the echoed response (undo deletes remotely); pushes unsynced sets / pending deletes with per-set `client_id` idempotency; flush progress merged into freshest storage (`mergeWithStorage(working, processedDeletes)`) so mid-flight logging isn't clobbered, undo-race sets get queued for remote delete, deletes already pushed this flush are never re-queued (BUG-089), and a mid-flush discard **or session replacement** aborts the sync (`mergeWithStorage` → `null`, BUG-090); a `404` on delete is treated as done; follows up with another flush pass if a mutation landed mid-flight; never blocks logging on network — failures stay queued and retry on `online`/`visibilitychange` and a 4s finish-retry effect that runs even with no `sessionId`; finish flow persists `endedAt` at request time (not sync time) and PATCHes local-tz `session_date` + `ended_at`; network calls read the token via `authFetchRef` so a refreshed backend token is picked up. `resumeSession(serverSession)` rebuilds an active state from `GET /sessions/active` (same-device recovery when local state was lost). Exposes `logSet`/`undoLastSet`/`removeSet`/`requestFinish`/`discardSession`/`resumeSession`. Unit tests: `src/__tests__/live-session-sync.test.tsx` |

| `reference.ts` | Session-start reference data: `buildLastSessionMap` (exercise → most recent sets, limited to the **last 12 weeks** so stale prescriptions never prefill as current), `recentExerciseNames`, `detectPr` (Brzycki e1RM vs stored PRs + today's sets), `brzycki1rm`, `normaliseExerciseKey` (snake_case ↔ free-text exercise match for the plan checklist) |
| `plates.ts` | `computePlates(weightKg, barWeight)` — per-side greedy plate loading (25/20/15/10/5/2.5/1.25 kg) + unreachable remainder; powers `PlateCalculator` |
| `csv.ts` | `setsToCsv` (RFC-4180-ish) + `downloadTextFile` — client-side CSV export of a finished session |
| `rest.ts` | `suggestedRestSeconds(recoveryScore, readiness)` — recovery-adapted rest target (210 / 150 / 120 s); informational only |

### `lib/hooks/` — Shared React hooks
| File | Purpose |
|------|---------|
| `useAiAnalysis.ts` | Shared hook for on-demand Gemini AI analysis — fetches `/analysis/{domain}/{id}`, handles loading/error/analysis states. Used by all AI analysis cards (cycling, lifting, health, events) |

## Patterns

- **Auth**: `useAuthFetch()` hook returns `{ authFetch, authFetchWithHeaders }` — injects JWT from session
- **Data fetching**: React Query `useQuery` + `useMutation`. Query keys are string arrays like `['activities', filters]`
- **Styling**: Tailwind with custom dark theme tokens (`background/surface/surface-light/accent/positive/warning/muted` + semantic `info/caution/foreground`). Inter via `next/font` (`--font-inter`), tabular numerals app-wide, global `:focus-visible` ring, `prefers-reduced-motion` guard. No CSS modules. Prefer shared primitives (`Button`, `Stat`, `Field`, `PageHeader`, `SectionLabel`, `Toast`, `ConfirmDialog`, `ErrorState`, `AppIcon`) over ad-hoc markup; lucide-react icons only (emoji reserved for content strings)
- **State**: Local `useState` for UI state. React Query for server state. Zustand stores for cross-component state (`lib/stores/routesStore.ts`: view mode, selection, tags, filters, detail tab, compare mode). No global Redux
- **Error handling**: `ErrorBoundary` wraps app layout. Query errors use `ErrorState` (with Retry) / `ChartBody` error slot — never "no data" for failures. Toasts via `useToast()`; destructive actions via `ConfirmDialog`. AI analysis cards show user-friendly error messages for Gemini API failures
- **Mobile**: Responsive grids (`grid-cols-1 sm:grid-cols-N`), `Modal` bottom-sheet on phones, calendar agenda view (`md:hidden`), hamburger sidebar + bottom tab bar (`MobileBottomNav`, `md:hidden`, 5 primary destinations + More) with `pt-20`/`pb-24` shell clearance, 44px touch targets on header/tab/filter buttons, Routes `Organize` drawer (`lg:hidden`) instead of the persistent sidebar
- **PWA**: `manifest.ts` (App Router metadata route; installable — icons, standalone), `public/sw.js` (runtime caching — network-only for `/api/v1/` API calls since they're authenticated/user-specific; cached navigations/statically-versioned assets only; **§3.8 Web Push**: `push` → `showNotification`, `notificationclick` → focus/open under `/fittrack` base; CACHE_NAME `fittrack-v5`), `PwaRegister.tsx` (production-only SW registration + **§3.7 install prompt**: `beforeinstallprompt` capture → in-app Install pill w/ localStorage dismiss + `appinstalled`). `lib/useOnlineStatus.ts` (online/offline state + last-online stamp) → `OfflineBanner` (amber "You're offline" bar, §3.7) and `OfflineSnapshot` (§3.7 — persists last-known `dashboard*` query data to localStorage, restores stale on next load so the dashboard works offline; refreshed on first successful refetch)
- **Sport utils**: `lib/sportUtils.ts` — `getSportColor`, `getSportTextColor`, `getSportBorderColor`, `getSportEmoji`, `isStrengthType`, `isCyclingOrRunning`, `STRENGTH_TYPES`, `getRecoveryColor`
- **3D replay (§3.16)**: `lib/replay.ts` — pure flight-path math (`buildReplay`: polyline→local metric plane, velocity×resolution→cumulative distance→polyline mapping, altitude z-exaggeration, `maxSamples` decimation; `projectPolyline`/`cumulativeFromVelocity`/`timeFmt`). Rendered by `components/activities/Replay3D.tsx` (three.js, lazily imported `ssr:false`). No external tile/API-key dependency — local-plane projection only. Rider marker asset: `public/models/cube-agree-c62-2026.glb` (2026 glacier'n'black Cube Agree C62 Race, 74K faces / 10.4MB, meters, nose +Z / up +Y (verified numerically); built from `bike_model/` via `retexture_glacier.py` → `surgical_clean.py` → `fork_split.py`/`classify_frame.py` → `transplant_decals.py` → `build_glb_blender.py`)
- **3D route terrain (§3.16)**: `lib/route3d.ts` — pure route-view math (`computeGrid`: ≤200-point DEM grid over the padded bbox (≥80 m cells); `buildRoute3D`: local-plane path drape with z-exaggeration from route `elevation_profile` or bilinear-sampled DEM; `pointColor`/`slopeColor`: hypsometric elevation / diverging slope ramp (blue descent → red climb); `steepestKm`: max ~1 km-window gradient; `buildTerrainMesh`). DEM heights via `lib/terrain.ts` → Open-Meteo `/v1/elevation` (Copernicus GLO-90, free, no key — same provider as the weather caches). Rendered by `components/routes/Route3D.tsx` (three.js, lazily imported `ssr:false`, WebGL fallback, flat-drape when the DEM fetch fails; 2D `ElevationProfile` hover syncs a marker via `highlightDistKm`)
- **Page titles**: `usePageTitle('Page Name')` hook in `lib/usePageTitle.ts` — sets `document.title` with " | FitTrack" suffix
- **Deep-links**: `useDeepLink` hook in `lib/useDeepLink.ts` — reads URL query params once on mount and updates them via `history.replaceState` (no Suspense needed). Powers record deep-linking: `/activities?activity=`, `/routes?route=`, `/lifting?session=`
- **Live Lift sync**: `lib/lifting/useLiveSession.ts` — local-first session state (localStorage), lazy idempotent sync (create→set→delete→finish via `live_key`/`client_id`, backend contract in AGENTS pitfall 18), finish-retry backoff, resume-from-server. **§3.7b explicit offline mode**: tracks `navigator.onLine` (`isOffline`), `pendingCount`, 4-state `syncStatus` (`synced`/`pending`/`offline`/`error`); flush scheduling is skipped while browser-offline and the whole backlog replays on the `online` event
- **Collapsible sidebar**: Desktop sidebar collapses to icon-only (`w-16`) via localStorage-persisted toggle. Lucide icons with Overview/Train/Resources section labels, accent active rail, FitTrack brand mark. Mobile unaffected
- **Chart zoom**: Recharts `Brush` on line/area charts when >20 data points (dark theme styled)
- **Themes (B-25)**: tokens are CSS channels (`rgb(var(--surface) / <alpha-value>)`, `tailwind.config.js` + `globals.css` `:root`/`[data-theme='light']`). `text-foreground` for surface text (adapts); `text-white` ONLY on solid colored backgrounds (accent/positive/warning buttons, badges, video overlays). `ThemeProvider` (`lib/theme.tsx`, persisted, dark default) + Appearance pills in Settings. Leaflet legit (`globals.css`, dark tiles)
- **Forecast overlays (B-14)**: `lib/projection.ts` — `useMetricProjection` (metric history + 8-wk regression line), `withProjection` (merges a `dashed: true` series onto any `ChartData`), `useForecastChart` one-liner. `ChartSeries.dashed` renders `strokeDasharray 6 4`. Live on FTP / VO₂max / weight / 1RM charts
- **Brief + prescriptions (B-16/B-17)**: `lib/brief.ts` (deterministic verdict engine + insight picker), `lib/prescription.ts` (next-session suggestion, RPE autoregulation, what-if weeks math). Surfaces: `/today` brief, `NextSessionCard` (+`Auto` on cycling), `AutoregulationCard` (lifting) + `→suggested` hints in plan strength tables, What-If Lab on `/analytics`
