# Frontend API Client & Lifting CODEMAP

> Detailed reference for `src/lib/api/` modules and `src/lib/lifting/` utilities.
> See `CODEMAP.md` for the high-level overview — this file documents each module's
> exports, backend endpoints, and return types.

> **2026-09 dead-client sweep**: the `activities`, `cycling`, `dashboard`,
> `nutrition`, `events`, `llmAnalysis`, `workoutPlanner`, `deficiency` and `auth`
> API-client modules were deleted (zero importers — pages call those endpoints
> inline via `authFetch`). Dead functions were pruned from the surviving modules.
> The domain **types** in `types/` are unaffected and still exported via
> `types.ts`.

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
Re-exports from: `types`, `fetch`, `lifting`, `routes`, `goals`, `trainingPlans`, `weather`, `conformity`, `projections`, `exercises`, `notifications`.

### Per-module API surface

| Module | Backend Prefix | Exported Functions | Key Types |
|--------|---------------|-------------------|-----------|
| **`routes.ts`** | `/api/v1/routes/` | `getRoutes`, `getRoute`, `syncRoutes`, `getDuplicateRoutes`, `mergeRoutes`, `autoMergeDuplicates`, `downloadRouteGpx`, `getMergedRouteView`, `getHomeAreaHeatmap`, **`createCollectionFromFilters`** (POST smart collection from current filter state) | `RouteSummary`, `RouteData`, `RouteFilters`, `RouteSyncResult`, `DuplicatePair`, `MergedRouteView`, `HomeAreaHeatmapResponse`, `RouteCollection`, `RouteCollectionCreate` |
| **`lifting.ts`** | `/api/v1/lifting/` | `getLiftingSessions`, `getActiveLiftingSession`, `updateLiftingSession`, `createLiftingSession`, `deleteLiftingSession`, `addSetToSession`, `deleteLiftingSet`, `getPersonalRecords`, `getWarmupTemplates`, **`getLiftVideos`** (list+filter by source/exercise/session/PR/date), **`getLiftVideo`**, **`createLiftVideo`**, **`getVideoUploadUrl`** (R2 presigned PUT), **`getVideoStreamUrl`** (presigned GET or embed), **`deleteLiftVideo`** | `LiftingSession`, `LiftingSet`, `PersonalRecord`, `AddSetPayload`, `CreateSessionPayload`, `UpdateSessionPayload`, `WarmupTemplate`, **`LiftVideo`**, **`VideoUploadRequest`**, **`VideoUploadResponse`**, **`VideoStreamUrl`**, **`LiftVideoListParams`** |
| **`trainingPlans.ts`** | `/api/v1/training-plans/` | `getTrainingPlans`, `getPlanWeek`, `updatePlanDay`, `copySessionToPlanDay`, `copyPlanDayToDate`, `previewWorkout` | `TrainingPlanSummary`, `TrainingWeekResponse`, `UpdateTrainingPlanDayPayload`, `TrainingPlanDay`, `WorkoutPreviewTargets`, `WorkoutPreviewResponse` |
| **`goals.ts`** | `/api/v1/goals/` | `listGoals`, `createGoal`, `updateGoal`, `deleteGoal`, `getGoalMetrics`, `addCheckIn`, `getCheckIns`, `reactivateGoal` | `Goal`, `GoalCheckIn`, `MetricInfo`, `CreateGoalPayload`, `UpdateGoalPayload`, `GoalCheckInPayload`, `ReactivateResponse` |
| **`conformity.ts`** | `/api/v1/training-plans/` | `getPlanConformity`, `getDayConformity`, `linkPlanActivities` | `PlanConformityResponse`, `DayConformityResponse`, `LinkActivitiesResponse` |
| **`weather.ts`** | `/api/v1/weather/` | `getCurrentWeather`, `getForecast` | `CurrentWeather`, `ForecastResponse` |
| **`projections.ts`** | `/api/v1/projections/` | `getGoalProjection` | `GoalProjectionResponse` |
| **`exercises.ts`** | `/api/v1/lifting/exercises` | `searchExercises`, `createExercise`, `deleteExercise` | `ExerciseEntry`, `ExerciseDetail` |
| **`notifications.ts`** | `/api/v1/notifications/` | `listNotifications`, `markNotificationRead`, `markAllNotificationsRead`, `getNotificationPreferences`, `updateNotificationPreferences` | `AppNotification`, `NotificationPreferences`, `NotificationPreferencesUpdate` |

> Note: many pages (dashboard, activities, cycling, events, nutrition, LLM
> analysis, workout planner, deficiency) call their endpoints **inline** via
> `authFetch` instead of a typed client — that's why only 9 API-client modules
> remain.

### `types/` subdirectory
Domain type modules re-exported via `types.ts`:
- `types/common.ts`, `types/activity.ts`, `types/lifting.ts`, `types/routes.ts`,
  `types/cycling.ts`, `types/health.ts`, `types/dashboard.ts`,
  `types/training.ts`, `types/llm.ts`, `types/deficiency.ts`,
  `types/nutrition.ts`, `types/weather.ts`, `types/conformity.ts`,
  `types/projections.ts`, `types/notifications.ts`

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