# Models CODEMAP

> All models use UUID PKs (`uuid.uuid4()`), `Mapped` type annotations, inherit from `Base`. JSONB for flexible data.

| File | Models | Key Relationships |
|------|--------|-------------------|
| `user.py` | `User`, `OAuthConnection` | User has many OAuthConnections |
| `activity.py` | `Activity`, `ActivitySource`, `ActivityStream` | Activity has many Sources/Streams; optionally links to LiftingSession + Route |
| `lifting.py` | `LiftingSession`, `LiftingSet`, `PersonalRecord`, `WarmupTemplate`, `WarmupTemplateStep` | Session has many Sets; Template has many Steps. Live-sync idempotency keys: `LiftingSession.live_key` (unique, nullable) + `LiftingSet.client_id` (unique per session, nullable) — NULL = manual entry, exempt |
| `route.py` | `Route`, `RouteSource` | Route has many Sources; has many Activities (via route_id) |
| `cycling.py` | `CyclingProfile`, `FtpHistory` | One profile per user; FTP changes tracked over time |
| `daily_metric.py` | `DailyMetric` | Recovery, HRV, strain per day per source |
| `sleep.py` | `SleepLog` | Sleep stages, efficiency |
| `health_alert.py` | `HealthAlert` | Overtraining/illness/injury with JSONB evidence |
| `weight.py` | `WeightLog` | Weight tracking per day |
| `goal.py` | `Goal`, `GoalCheckIn` | Semantic goals (Phase 6): `metric` key → registry in `services/goal_metrics.py`, `filter_json` (e.g. exercise/sport), `starting_value` snapshot (direction derived start-vs-target, no column), cached `current_value`; status active/achieved/expired/abandoned. Goal has many CheckIns (`check_in_date`, value, alignment_pct, source auto/manual) |
| `training_plan.py` | `TrainingPlan`, `TrainingPlanDay` | Plan has many Days; Day: `sport` (cycle/strength/rest), `planned_focus` (squat/bench/deadlift/overhead_press/accessories/full_body/push/pull/legs/upper/lower), planned exercises/volume/RPE/power/zone/route targets, optionally links Activity + LiftingSession; Plan optionally links Event (`event_id`) for auto-taper |
| `exercise.py` | `Exercise` | User-editable exercise library. Global seed rows (`user_id=NULL`) + per-user additions. Unique `(user_id, name)`. Fields: name, category (big3/compound/accessory), aliases (JSONB), is_active |
| `event.py` | `Event` | Race/ride/lift events with taper config |
| `llm_analysis.py` | `LlmAnalysis` | User has many LlmAnalysis; stores Gemini-powered analysis (cycling, activity, lifting_session, health, event). Optionally links to Activity, LiftingSession, or Event |
| `weather.py` | `CachedWeather` | Per-user Open-Meteo response cache keyed by weather_type + rounded coords (expires_at NULL = never expires) |
| `webhook_event.py` | `StravaWebhookEvent` | Async Strava webhook queue: raw payload, received_at, processed_at, attempts, status (pending/processed/failed), error. Drained by `process_strava_webhook_events` Celery task |
