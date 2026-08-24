# Frontend CODEMAP

> Next.js 14 App Router, all pages `'use client'`, React Query, Tailwind dark theme.

## Pages (`app/(app)/`)

| Route | File | Description |
|-------|------|-------------|
| `/dashboard` | `dashboard/page.tsx` | Main dashboard — Today/Weekly/Monthly tabs, goals, alerts, LLM analysis |
| `/training` | `training/page.tsx` | Training plans, events, periodization chart |
| `/activities` | `activities/page.tsx` | Activity list with filters, merge analysis |
| `/calendar` | `calendar/page.tsx` | Calendar view of activities + lifting |
| `/cycling` | `cycling/page.tsx` | Cycling analytics — power curve, zones, training load, FTP, VO2max |
| `/lifting` | `lifting/page.tsx` | Lifting sessions, PRs, exercise progress, warmup templates |
| `/routes` | `routes/page.tsx` | Route management, map view, GPX upload/download |
| `/wiki` | `wiki/page.tsx` | In-app wiki — features, glossary, science |
| `/settings` | `settings/page.tsx` | OAuth connections, cycling profile, preferences |

## API Clients (`lib/api/`)

| File | Backend Prefix | Key Functions |
|------|---------------|---------------|
| `fetch.ts` | — | `apiFetch`, `apiFetchWithHeaders`, `apiUpload`, `useAuthFetch` hook |
| `types.ts` | — | Barrel re-exports from `types/` domain modules |
| `types/llm.ts` | — | `LlmAnalysis`, `LlmAnalysisSummary` interfaces |
| `activities.ts` | `/api/v1/activities/` | `fetchActivities`, `fetchActivity`, `fetchCalendar`, `fetchStreams`, `getActivityAiAnalysis`, `triggerActivityAiAnalysis` |
| `lifting.ts` | `/api/v1/lifting/` | `fetchSessions`, `createSession`, `addSet`, `fetchPRs`, `fetchWarmupTemplates`, `getSessionAiAnalysis`, `triggerSessionAiAnalysis` |
| `cycling.ts` | `/api/v1/cycling/` | `fetchProfile`, `fetchTrainingLoad`, `fetchPowerCurve`, `fetchPowerZones` |
| `dashboard.ts` | `/api/v1/dashboard/` | `fetchSummary`, `fetchWeeklyReport`, `fetchToday` |
| `routes.ts` | `/api/v1/routes/` | `fetchRoutes`, `createRoute`, `uploadGpx`, `mergeRoutes` |
| `goals.ts` | `/api/v1/goals/` | `fetchGoals`, `createGoal`, `updateGoal`, `deleteGoal` |
| `deficiency.ts` | `/api/v1/deficiency/` | `getDeficiency` — weakness/deficiency analysis (`types/deficiency.ts`: `DeficiencyResponse`, `WeaknessItem`) |
| `nutrition.ts` | `/api/v1/nutrition/` | `createFuelPlan`, `getFuelPlan`, `getFuelPlanForActivity`, `updateFuelPlanActuals`, `deleteFuelPlan` (`types/nutrition.ts`: `RideFuelPlan`, `FuelScheduleEntry`, `CreateFuelPlanPayload`, `FuelActualsUpdatePayload`) |
| `weather.ts` | `/api/v1/weather/` | `getCurrentWeather`, `getForecast`, `getActivityWeather` — 404 → `null` (no location set / untagged); takes backend JWT explicitly since `apiFetch` can't distinguish 404s (`types/weather.ts`: `CurrentWeather`, `ForecastResponse`, `ForecastDay`, `ActivityWeather`) |
| `trainingPlans.ts` | `/api/v1/training-plans/` | `fetchPlans`, `createPlan`, `generatePlan` |
| `events.ts` | `/api/v1/events/` | `fetchEvents`, `createEvent`, `updateEvent`, `getEventAiAnalysis`, `triggerEventAiAnalysis` |
| `llmAnalysis.ts` | `/api/v1/cycling/llm-analysis/` | `getLatestLlmAnalysis`, `triggerLlmAnalysis`, `getLlmAnalysisHistory`, `getHealthAiAnalysis`, `triggerHealthAiAnalysis`, `getEventAiAnalysis`, `triggerEventAiAnalysis` |
| `auth.ts` | — | NextAuth config, `authOptions`, JWT/session callbacks |
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
| `GoalCard` | Goal display with progress bar + GoalForm |
| `PRCelebration` | Animated PR celebration toast |
| `ReadinessIndicator` | Training readiness gauge |
| `PageLoadingBar` | Top loading bar for route transitions |
| `ExerciseAutocomplete` | Exercise name autocomplete input |

### `charts/` — Data visualization
| Component | Purpose |
|-----------|---------|
| `Chart` | Generic Recharts wrapper — line, bar, scatter, area, pie. Renders `ChartData` from backend |

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

### `lifting/` — Lifting-specific
| Component | Purpose |
|-----------|---------|
| `AddExerciseForm` | Add exercise + sets to session |
| `ExerciseGroup` | Grouped sets for one exercise |
| `ExerciseProgressSection` | Exercise progress over time |
| `LiftingAnalysisCard` | Post-session analysis card |
| `SessionAiAnalysisCard` | Per-session AI lifting analysis (on-demand Gemini) |
| `LinkActivityModal` | Link activity to lifting session |
| `ManualPRForm` | Manual PR entry form |
| `WarmupTemplateManager` | Warmup template CRUD |

### `health/` — Health-specific
| Component | Purpose |
|-----------|---------|
| `HealthAiAnalysisCard` | AI health analysis (HRV, sleep, recovery — on-demand Gemini) |

### `maps/` — Map components
| Component | Purpose |
|-----------|---------|
| `RouteMap` | Leaflet map with route polyline |
| `ElevationProfile` | Elevation chart for route |
| `SurfaceBreakdown` | Surface type stacked bar |

### `dashboard/` — Dashboard tab sections
| Component | Purpose |
|-----------|---------|
| `DeficiencyCard` | Weakness/deficiency analysis card (`['deficiency']` query) — severity-grouped lifting/cycling weaknesses; rendered on dashboard WeeklyTab + lifting page |
| `WeatherWidget` | Current-conditions card (`['weather-current']` query) — hero header of dashboard; prompt state when no home location set |

### `training/` — Training plan components
| Component | Purpose |
|-----------|---------|
| `PlanBuilder` | Weekly calendar plan builder |
| `WeatherForecast` | 7-day forecast chips (`['weather-forecast']` query) with poor-cycling-conditions warning dots — rendered above plans grid on training page |
| `EventAiAnalysisCard` | AI event/race preparation analysis (on-demand Gemini) |

### `lib/` — Shared utilities
| File | Purpose |
|------|---------|
| `analysisRenderer.tsx` | Shared markdown renderer (`renderAnalysisText`, `renderInline`) and `relativeTime` helper used by all AI analysis cards |
| `utils.ts` | `formatDuration`, `formatDistance`, `weatherEmoji` (conditions → emoji mapping shared by weather UI) |

## Patterns

- **Auth**: `useAuthFetch()` hook returns `{ authFetch, authFetchWithHeaders }` — injects JWT from session
- **Data fetching**: React Query `useQuery` + `useMutation`. Query keys are string arrays like `['activities', filters]`
- **Styling**: Tailwind with custom dark theme tokens. No CSS modules
- **State**: Local `useState` for UI state. React Query for server state. No global state manager
- **Error handling**: `ErrorBoundary` wraps app layout. Query errors shown inline. AI analysis cards show user-friendly error messages for Gemini API failures
