# API Routes CODEMAP

> All endpoints prefixed with `/api/v1/`. Handlers validate input, call services, return responses. Uses `get_db` + `get_current_user` DI.

| File | Prefix | Key Endpoints |
|------|--------|---------------|
| `auth.py` | `/auth/` | `POST /sync-user`, `GET /oauth/{provider}/authorize`, `GET /oauth/{provider}/callback` |
| `connections.py` | `/connections/` | `GET /`, `DELETE /{id}`, `POST /{id}/sync` |
| `activities.py` | `/activities/` | `GET /` (list+filter: sport_type, source, date range, q name search, distance/duration/tss ranges, sort_by/sort_order), `GET /summary` (aggregate totals: count, total distance/time/TSS across all matching activities), `GET /calendar`, `GET /{id}`, `GET /{id}/streams`, `GET /{id}/analysis`, `GET/POST /{id}/ai-analysis` |
| `lifting.py` | `/lifting/` | Sessions CRUD (`GET /sessions/active` = unfinished live-tracked session for `/lifting/live` resume; registered BEFORE `/{session_id}` so "active" isn't parsed as UUID), sets CRUD, PRs, volume trends, warmup templates, activity linking, `GET /sessions/{id}/analysis`, `GET/POST /sessions/{id}/ai-analysis`. Session create accepts `started_at`, PATCH accepts `started_at`/`ended_at` (live flow) |
| `routes.py` | `/routes/` | Route CRUD, filtering (incl. `surface_type`, `tag_ids`, `collection_id`, `is_favorite`, `min_quality_score`), GPX download/upload, sync, merge, duplicates + auto-merge. New: `/tags` (CRUD + assign/unassign), `/collections` (CRUD + smart from-filters), `/quality` (list + recompute), `/{id}/effort-estimate`, `/{id}/weather`, `/merged-view` (per-source polylines + ridden activity segments), `/heatmap/home` (activity points near home for heatmap), `/bulk/export-gpx`, `/bulk/delete`, `/duplicates/auto-merge` |
| `cycling/` | `/cycling/` | Profile, FTP history, training load, power curve/zones, metrics, FTP estimation, backfill |
| `charts.py` | `/charts/` | `GET /available`, `GET /{chart_name}` — registry-driven chart data; required params → 422, stream-heavy charts Redis-cached 5 min |
| `dashboard/` | `/dashboard/` | `GET /summary`, `GET /weekly-report`, `GET /today` |
| `webhooks.py` | `/webhooks/` | `GET /strava` (challenge), `POST /strava` (event receiver — HMAC-verifies + persists to `strava_webhook_events` queue for async Celery processing; never processes inline) |
| `export.py` | `/export/` | Data export endpoints |
| `training_plans.py` | `/training-plans/` | Thin router → `services/training_plan.py`. Plan CRUD, `POST /generate` (mixed-week template: rest Sun, strength Tue/Thu, cycle rides), `event_id` on POST/PATCH links event + auto-taper; PATCH days are non-destructive upsert by `day_date`; `GET /{plan_id}/week/{n}` (weekly view: Monday-aligned weeks, readiness CTL/ATL/TSB, weather + bad-weather badges, actual activity/lifting summaries, route matches on cycle days; `include_weather` query), `PATCH /{plan_id}/days/{day_id}` (targeted single-day partial update) |
| `events.py` | `/events/` | Event CRUD with countdown/taper info, `upcoming_only` filter, `GET/POST /{id}/ai-analysis` |
| `workout_planner.py` | `/workout-planner/` | `GET /zones`, `POST /plan`, `POST /match-routes` — intensity zones, workout targets, route matching |
| `metrics.py` | `/metrics/` | Health metrics CRUD, health analysis, `GET/POST /health-ai-analysis` |
| `deficiency.py` | `/deficiency/` | `GET /` (`weeks` query, 4–26) — weakness analysis: strength standards, Big-3 ratios, push/pull balance, VO2max/FTP mismatch, decoupling, zone distribution |
| `nutrition.py` | `/nutrition/` | Ride fuel plans: `POST /fuel-plan` (generate from activity_id or planned_duration_min/planned_if), `GET/PATCH/DELETE /fuel-plan/{id}` (PATCH logs actuals), `GET /fuel-plan/activity/{activity_id}` — endpoint has error logging; actuals clearing (empty string → null) supported; regenerate/delete UI on frontend |
| `notifications.py` | `/notifications/` | In-app notifications: `GET /` (limit, unread_only), `PATCH /{id}/read`, `POST /read-all`, `GET/PATCH /preferences` (per-type toggles). Rows created by `services/notifications.notify()` from health alerts, PRs, goal milestones, plan reminders |
| `llm_analysis.py` | `/cycling/llm-analysis/` | `GET /latest`, `POST /on-demand`, `GET /history` |
| `weather.py` | `/weather/` | Open-Meteo integration: `GET /current`, `GET /forecast` (days 1–7), `GET /historical` (start/end dates), `POST /tag-activity/{id}`, `GET /for-activity/{id}` — lat/lng optional (falls back to user home location); provider failures → 503 |
| `goals.py` | `/goals/` | Semantic goals (Phase 6) — thin router over `services/goals.py` + `services/goal_metrics.py`. `GET /` (`status_filter`, items enriched with direction/alignment_pct/progress_pct/metric label+unit), `POST /` (validates metric in registry + required filters, snapshots `starting_value`), `GET /metrics` (registry listing for dynamic forms), `GET/PATCH/DELETE /{id}`, `POST/GET /{id}/checkins`, `POST /{id}/reactivate`. Status transitions run on every read/write path via `update_goal_status` |
| `projections.py` | `/projections/` | Phase 7 — projections & success prediction. `GET /goal/{goal_id}` (trend, projected date, badge, history, projection_line), `GET /metric/{metric_key}?months=6&filter_json={}` (trend for any registry metric), `GET /tsb/{plan_id}?days=14` (event-linked TSB trajectory only; 400 if no event linked) |
