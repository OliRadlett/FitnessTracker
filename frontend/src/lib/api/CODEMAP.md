# Frontend API Client & Lifting CODEMAP

> Detailed reference for `src/lib/api/` modules and `src/lib/lifting/` utilities.
> See `CODEMAP.md` for the high-level overview — this file documents each module's
> exports, backend endpoints, and return types.

## API Client Modules (`src/lib/api/`)

All API functions use `apiFetch<T>()` (from `fetch.ts`) which issues relative URL
requests with an optional JWT Bearer token and `credentials: 'include'`.

### `fetch.ts`
| Export | Type | Description |
|--------|------|-------------|
| `apiFetch(path, options, token?)` | `async function<T>` | GET/POST/PUT/DELETE with JSON body. Throws on non-2xx. |
| `apiFetchWithHeaders(path, options, token?)` | `async function<T>` | Same but returns `{ data, headers }` — for accessing pagination headers. |
| `apiUpload(path, file, token?)` | `async function<T>` | Multipart/form-data upload (GPX, FIT imports). |
| `useAuthFetch()` | `hook` | Returns `{ authFetch, authFetchWithHeaders }` — injects JWT from NextAuth session. |

### `index.ts` — Barrel file
Re-exports from: `types`, `fetch`, `auth`, `activities`, `lifting`, `routes`, `cycling`, `dashboard`, `goals`, `trainingPlans`, `events`, `llmAnalysis`, `workoutPlanner`, `deficiency`, `nutrition`, `weather`, `conformity`, `projections`, `exercises`, `notifications`.

### Per-module API surface

| Module | Backend Prefix | Exported Functions | Key Types |
|--------|---------------|-------------------|-----------|
| **`activities.ts`** | `/api/v1/activities/` | `getActivities`, `getActivity`, `backfillActivities`, `backfillRouteLinks`, `analyzeMergeThresholds`, `importGpxFile`, `importFitFile`, `getActivityAnalysis`, `getActivityAiAnalysis`, `triggerActivityAiAnalysis`, `getActivityContext`, `getActivitiesWithContext` | `Activity`, `ActivityDetail`, `ActivityContext`, `RideAnalysis`, `ActivityFilters`, `MergeThresholdResult` |
| **`cycling.ts`** | `/api/v1/cycling/` | `getCyclingProfile`, `updateCyclingProfile`, `getFtpHistory`, `getFtpHistoryEntry`, `createFtpHistoryEntry`, `getTrainingLoad`, `getPowerCurve`, `getPowerZones`, `getHrZones`, `getCyclingMetricsSummary`, `getPowerVsHr`, `recalculateTss`, `estimateFtp`, `backfillStreams`, `getLifetimePBs`, `backfillFtpHistory`, `getVo2max`, `getVo2maxHistory`, `getDecouplingHistory`, `getDecouplingForActivity` | `CyclingProfile`, `FtpHistoryEntry`, `PowerCurveResponse`, `PowerZonesResponse`, `HrZonesResponse`, `TrainingLoadResponse`, `Vo2maxResponse`, `DecouplingHistoryResponse`, `DecouplingSingleResponse` |
| **`routes.ts`** | `/api/v1/routes/` | `getRoutes`, `getRoute`, `deleteRoute`, `updateRoute`, `syncRoutes`, `getRouteHistory`, `downloadRouteGpx`, `uploadRouteGpx`, `getTags`, `createTag`, `updateTag`, `deleteTag`, `addRouteTag`, `removeRouteTag`, `getCollections`, `createCollection`, `createSmartCollection`, `updateCollection`, `deleteCollection`, `addToCollection`, `removeFromCollection`, `getRouteQualityScores`, `recomputeRouteQuality`, `getEffortEstimate`, `postEffortEstimate`, `getDuplicateRoutes`, `mergeRoutes`, `autoMergeDuplicates`, `bulkExportGpx`, `bulkDeleteRoutes` | `RouteData`, `RouteTag`, `RouteCollection`, `RouteQualityScore`, `EffortEstimate`, `DuplicatePair`, `RouteSyncResult` |
| **`lifting.ts`** | `/api/v1/lifting/` | `getLiftingSessions`, `getActiveLiftingSession`, `createLiftingSession`, `updateLiftingSession`, `getLiftingSession`, `addSetToSession`, `deleteLiftingSet`, `getPersonalRecords`, `getVolumeTrends`, `linkSession`, `getLinkableActivities`, `backfillLinks`, `getWarmupTemplates`, `getWarmupTemplate`, `createWarmupTemplate`, `updateWarmupTemplate`, `deleteWarmupTemplate`, `getLiftingAnalysis`, `getSessionAiAnalysis`, `triggerSessionAiAnalysis` | `LiftingSession`, `LiftingSet`, `PersonalRecord`, `VolumeTrendResponse`, `WarmupTemplate`, `LiftingAnalysis`, `LlmAnalysis` |
| **`trainingPlans.ts`** | `/api/v1/training-plans/` | `getTrainingPlans`, `getTrainingPlan`, `createTrainingPlan`, `updateTrainingPlan`, `deleteTrainingPlan`, `generateTrainingPlan`, `getPlanWeek`, `updatePlanDay`, `copySessionToPlanDay`, `copyPlanDayToDate`, `previewWorkout` | `TrainingPlan`, `TrainingPlanSummary`, `TrainingWeekResponse`, `TrainingWeekDay`, `UpdateTrainingPlanDayPayload`, `GeneratePlanPayload`, `WorkoutPlanRequest`, `WorkoutPlanResponse` |
| **`dashboard.ts`** | `/api/v1/dashboard/` | `getDashboardSummary`, `getDashboardWeeklyReport`, `getMonthlySummary`, `getTrainingStreaks`, `getChart`, `getYearlySummary`, `getTodaySummary` | `DashboardSummary`, `WeeklyReport`, `MonthlySummaryItem`, `TrainingStreaks`, `ChartData`, `YearlySummary`, `TodaySummary` |
| **`goals.ts`** | `/api/v1/goals/` | `listGoals`, `createGoal`, `updateGoal`, `deleteGoal`, `getGoalMetrics`, `addCheckIn`, `getCheckIns`, `reactivateGoal` | `Goal`, `MetricInfo`, `GoalCheckIn`, `CreateGoalPayload`, `UpdateGoalPayload` |
| **`events.ts`** | `/api/v1/events/` | `getEvents`, `getEvent`, `createEvent`, `updateEvent`, `deleteEvent`, `getEventAiAnalysis`, `triggerEventAiAnalysis` | `Event`, `CreateEventPayload`, `UpdateEventPayload` |
| **`llmAnalysis.ts`** | `/api/v1/cycling/llm-analysis/` | `getLatestLlmAnalysis`, `triggerLlmAnalysis`, `getLlmAnalysisHistory`, `getHealthAiAnalysis`, `triggerHealthAiAnalysis`, `getEventAiAnalysis`, `triggerEventAiAnalysis` | `LlmAnalysis`, `LlmAnalysisSummary` |
| **`workoutPlanner.ts`** | `/api/v1/workout-planner/` | `getWorkoutZones`, `planWorkout`, `matchRoutes` | `WorkoutZonesResponse`, `WorkoutPlanRequest`, `WorkoutPlanResponse`, `WorkoutPreviewTargets`, `WorkoutPreviewResponse` |
| **`conformity.ts`** | `/api/v1/training-plans/` | `getPlanConformity`, `getDayConformity`, `linkPlanActivities` | `PlanConformityResponse`, `WeekConformity`, `DayConformityResponse` |
| **`deficiency.ts`** | `/api/v1/deficiency/` | `getDeficiency` | `DeficiencyResponse`, `WeaknessItem` |
| **`nutrition.ts`** | `/api/v1/nutrition/` | `createFuelPlan`, `getFuelPlan`, `getFuelPlanForActivity`, `updateFuelPlanActuals`, `deleteFuelPlan` | `RideFuelPlan`, `CreateFuelPlanPayload`, `FuelActualsUpdatePayload` |
| **`weather.ts`** | `/api/v1/weather/` | `getCurrentWeather`, `getForecast`, `getActivityWeather` | `CurrentWeather`, `ForecastResponse`, `ForecastDay`, `ActivityWeather` |
| **`projections.ts`** | `/api/v1/projections/` | `getGoalProjection`, `getTsbProjection` | `GoalProjectionResponse`, `TsbProjectionResponse`, `ProjectionPoint` |
| **`exercises.ts`** | `/api/v1/lifting/exercises` | `searchExercises`, `createExercise`, `updateExercise`, `deleteExercise` | `ExerciseEntry`, `ExerciseDetail` |
| **`notifications.ts`** | `/api/v1/notifications/` | `listNotifications`, `markNotificationRead`, `markAllNotificationsRead`, `getNotificationPreferences`, `updateNotificationPreferences` | `AppNotification`, `NotificationPreferences` |
| **`auth.ts`** | — | `getOAuthAuthorizeUrl(provider)`, `getCurrentUser()` | `User` |

### `types/` subdirectory
Domain type modules re-exported via `types.ts`:
- `types/lifting.ts` — `LiftingSession`, `LiftingSet`, `CreateSessionPayload`, `AddSetPayload`, etc.
- `types/activities.ts` — `Activity`, `ActivityDetail`, `ActivityFilters`, `ActivityContext`, etc.
- `types/cycling.ts` — `CyclingProfile`, `PowerCurveResponse`, `TrainingLoadResponse`, etc.
- `types/routes.ts` — `RouteData`, `RouteTag`, `RouteCollection`, `RouteQualityScore`, etc.
- `types/training.ts` — `TrainingPlan`, `TrainingWeekDay`, `UpdateTrainingPlanDayPayload`, etc.
- `types/dashboard.ts` — `DashboardSummary`, `WeeklyReport`, `TodaySummary`, etc.
- `types/llm.ts` — `LlmAnalysis`, `LlmAnalysisSummary`
- `types/goals.ts`, `types/events.ts`, `types/nutrition.ts`, `types/weather.ts`,
  `types/projections.ts`, `types/conformity.ts`, `types/deficiency.ts`,
  `types/notifications.ts`

## Lifting Utilities (`src/lib/lifting/`)

### `reference.ts`
| Export | Type | Description |
|--------|------|-------------|
| `brzycki1rm(weightKg, reps)` | `function` | Brzycki formula for estimated 1RM. Returns `null` for invalid inputs. |
| `ExerciseReference` | `interface` | `{ date, sets: { weight_kg, reps, rpe? }[] }` — one exercise's reference data |
| `buildLastSessionMap(sessions, excludeSessionId?)` | `function` | Returns `Record<exerciseName, ExerciseReference>` from most recent session per exercise. Skips warmup sets. Caps at 8 sets per exercise. |
| `detectPr(exerciseName, weightKg, reps, prs, todaySets)` | `function` | Returns PR celebration text if the set beats stored PRs + today's prior sets, else `null`. Uses `brzycki1rm` with 0.5% tolerance. |
| `recentExerciseNames(sessions, limit?)` | `function` | Returns exercises sorted by most recent use (default limit 6). |

### `useLiveSession.ts`
| Export | Type | Description |
|--------|------|-------------|
| `LoggedSet` | `interface` | `{ clientId, exercise_name, set_number, weight_kg, reps, rpe?, is_warmup, is_amrap, remoteId }` |
| `LiveSessionState` | `interface` | Full session state: phase, sessionId, liveKey, startedAt, sets, pendingDeletes, finish_requested, etc. |
| `FinishMeta` | `interface` | `{ rpe_session?, notes? }` — passed to `requestFinish()` |
| `useLiveSession(authFetch)` | `hook` | Local-first live session manager. Persists to localStorage. Background syncer creates remote session via `createLiftingSession`, maps real remote IDs from echoed `client_id`, pushes unsynced sets/deletes with idempotency. Retry on `online`/`visibilitychange`. Exposed: `state`, `hydrated`, `syncError`, `prEvents`, `totalVolume`, `exercises`, `startSession`, `logSet`, `undoLastSet`, `setCurrentExercise`, `discardSession`, `requestFinish`, `retrySync`, `setsForExercise`, `nextSetNumberFor`. |

## Patterns

- **Auth**: `useAuthFetch()` hook injects JWT Bearer token from NextAuth session
- **Query keys**: String arrays, domain-prefixed — `['activities', filters]`, `['cycling-profile']`, etc.
- **Type imports**: Types come from `@/lib/api` barrel (re-exported from `types/`)
- **Token forwarding**: Some functions accept optional `token?` param for server-side callers that need to pass the JWT explicitly (e.g., webhook-triggered sync)
