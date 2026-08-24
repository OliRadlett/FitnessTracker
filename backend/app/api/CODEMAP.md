# API Routes CODEMAP

> All endpoints prefixed with `/api/v1/`. Handlers validate input, call services, return responses. Uses `get_db` + `get_current_user` DI.

| File | Prefix | Key Endpoints |
|------|--------|---------------|
| `auth.py` | `/auth/` | `POST /sync-user`, `GET /oauth/{provider}/authorize`, `GET /oauth/{provider}/callback` |
| `connections.py` | `/connections/` | `GET /`, `DELETE /{id}`, `POST /{id}/sync` |
| `activities.py` | `/activities/` | `GET /` (list+filter), `GET /calendar`, `GET /{id}`, `GET /{id}/streams`, `GET /{id}/analysis`, `GET/POST /{id}/ai-analysis` |
| `lifting.py` | `/lifting/` | Sessions CRUD (`GET /sessions/active` = unfinished live-tracked session for `/lifting/live` resume; registered BEFORE `/{session_id}` so "active" isn't parsed as UUID), sets CRUD, PRs, volume trends, warmup templates, activity linking, `GET /sessions/{id}/analysis`, `GET/POST /sessions/{id}/ai-analysis`. Session create accepts `started_at`, PATCH accepts `started_at`/`ended_at` (live flow) |
| `routes.py` | `/routes/` | Route CRUD, filtering, GPX download/upload, sync, merge, duplicates |
| `cycling/` | `/cycling/` | Profile, FTP history, training load, power curve/zones, metrics, FTP estimation, backfill |
| `charts.py` | `/charts/` | `GET /available`, `GET /{chart_name}` — registry-driven chart data |
| `dashboard/` | `/dashboard/` | `GET /summary`, `GET /weekly-report`, `GET /today` |
| `webhooks.py` | `/webhooks/` | `GET /strava` (challenge), `POST /strava` (event receiver) |
| `export.py` | `/export/` | Data export endpoints |
| `training_plans.py` | `/training-plans/` | Plan CRUD, `POST /generate` (template-based auto-generation) |
| `events.py` | `/events/` | Event CRUD with countdown/taper info, `upcoming_only` filter, `GET/POST /{id}/ai-analysis` |
| `workout_planner.py` | `/workout-planner/` | `GET /zones`, `POST /plan`, `POST /match-routes` — intensity zones, workout targets, route matching |
| `metrics.py` | `/metrics/` | Health metrics CRUD, health analysis, `GET/POST /health-ai-analysis` |
| `deficiency.py` | `/deficiency/` | `GET /` (`weeks` query, 4–26) — weakness analysis: strength standards, Big-3 ratios, push/pull balance, VO2max/FTP mismatch, decoupling, zone distribution |
| `nutrition.py` | `/nutrition/` | Ride fuel plans: `POST /fuel-plan` (generate from activity_id or planned_duration_min/planned_if), `GET/PATCH/DELETE /fuel-plan/{id}` (PATCH logs actuals), `GET /fuel-plan/activity/{activity_id}` |
| `llm_analysis.py` | `/cycling/llm-analysis/` | `GET /latest`, `POST /on-demand`, `GET /history` |
| `weather.py` | `/weather/` | Open-Meteo integration: `GET /current`, `GET /forecast` (days 1–7), `GET /historical` (start/end dates), `POST /tag-activity/{id}`, `GET /for-activity/{id}` — lat/lng optional (falls back to user home location); provider failures → 503 |
