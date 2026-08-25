# Schemas CODEMAP

> Pydantic v2 schemas. All use `model_config = {"from_attributes": True}` for ORM conversion.

| File | Key Schemas |
|------|-------------|
| `auth.py` | `UserRead`, `OAuthConnectionRead`, `TokenPayload`, `AuthResponse` |
| `activity.py` | `ActivityCreate/Read`, `ActivitySourceRead`, `ActivityStreamRead`, `LinkedLiftingSessionSummary`, `ActivityCalendarEntry`, `RideAnalysisResponse` |
| `lifting.py` | `Session/Set Create/Read/Update`, `PersonalRecordCreate/Read`, `VolumeTrend`, `LinkActivity`, `LiftingAnalysisResponse` |
| `route.py` | `RouteRead/Summary/Create/Update`, `RouteSourceRead`, `MergeRequest`, `RouteHistoryResponse`, `RouteHistoryRide`, `RouteHistoryPersonalBest` |
| `cycling.py` | `CyclingProfileRead/Update`, `FtpHistoryRead/Create`, `TrainingLoad`, `PowerCurve`, `PowerZones`, `CyclingMetricsSummary` |
| `dashboard.py` | `DashboardSummary`, `WeeklyReport`, `RestDaySuggestion`, `TodaySummary`, `TodayActivitySummary`, `TodayLiftingSummary` |
| `goal.py` | `GoalCreate` (metric + filter_json), `GoalUpdate`, `GoalRead`, `GoalEnriched` (adds direction/alignment_pct/progress_pct/metric_label/unit), `GoalCheckInCreate/Read`, `MetricInfo` (registry entry), `ReactivateResponse`; `status` is Literal active/achieved/expired/abandoned |
| `training_plan.py` | `TrainingPlanCreate/Read/Update/Summary` (incl. `event_id`), `TrainingPlanDayCreate/Read` (sport cycle/strength/rest, workout_description, planned_focus — merged session-type field with values squat/bench/deadlift/overhead_press/accessories/full_body/push/pull/legs/upper/lower — exercises/volume/rpe/power/zone/route/lifting_session — exercises validated as list-of-dicts with exercise+sets+reps), `TrainingPlanDayUpdate` (partial single-day PATCH), `GeneratePlanRequest` (optional `event_id`), Phase 5B weekly view: `TrainingWeekResponse`, `TrainingWeekDay` (day + weather/bad_weather/actual_activity/actual_lifting_session/route_matches), `DayWeather`, `BadWeather`, `ActualActivity`, `ActualLiftingSession`, `WeekRouteMatch`, `WeekReadiness` |
| `event.py` | `EventCreate/Read/Update`, `EventWithCountdown` |
| `workout_planner.py` | `WorkoutZone`, `ReadinessInfo`, `WorkoutZonesResponse`, `WorkoutPlanRequest/Response`, `RouteMatchRequest/Response` |
| `llm_analysis.py` | `LlmAnalysisRead`, `LlmAnalysisSummary` |
| `deficiency.py` | `WeaknessItem`, `DeficiencySummary`, `DeficiencyResponse` (weakness analysis contract) |
| `nutrition.py` | `FuelPlanCreate`, `RideFuelPlanRead`, `FuelScheduleEntry`, `FuelPlanActualsUpdate` (ride fuel plan contract) |
| `weather.py` | `CurrentWeatherResponse`, `ForecastDay`, `ForecastResponse`, `ActivityWeatherResponse`, `TagActivityResponse` (Open-Meteo normalized contract) |
| `projections.py` | `TrendInfo` (slope_per_day/week, r_squared, data_points), `ProjectionPoint` (date+value), `GoalProjectionResponse` (goal projection with badge/history/projection_line), `MetricTrendResponse` (metric trend with classification), `TsbProjectionPoint` (date/ctl/atl/tsb), `TsbProjectionResponse` (plan TSB projection with freshness_assessment) |
