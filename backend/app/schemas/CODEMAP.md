# Schemas CODEMAP

> Pydantic v2 schemas. All use `model_config = {"from_attributes": True}` for ORM conversion.

| File | Key Schemas |
|------|-------------|
| `auth.py` | `UserRead`, `OAuthConnectionRead`, `TokenPayload`, `AuthResponse` |
| `activity.py` | `ActivityCreate/Read`, `ActivitySourceRead`, `ActivityStreamRead`, `LinkedLiftingSessionSummary`, `ActivityCalendarEntry` |
| `lifting.py` | `Session/Set Create/Read/Update`, `PersonalRecordCreate/Read`, `VolumeTrend`, `LinkActivity` |
| `route.py` | `RouteRead/Summary/Create/Update`, `RouteSourceRead`, `MergeRequest` |
| `cycling.py` | `CyclingProfileRead/Update`, `FtpHistoryRead/Create`, `TrainingLoad`, `PowerCurve`, `PowerZones`, `CyclingMetricsSummary` |
| `dashboard.py` | `DashboardSummary`, `WeeklyReport`, `RestDaySuggestion` |
| `goal.py` | `GoalCreate/Read/Update` |
| `training_plan.py` | `TrainingPlanCreate/Read/Update/Summary`, `TrainingPlanDayCreate/Read`, `GeneratePlanRequest` |
| `event.py` | `EventCreate/Read/Update`, `EventWithCountdown` |
