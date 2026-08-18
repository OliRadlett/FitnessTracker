# API Routes CODEMAP

> All endpoints prefixed with `/api/v1/`. Handlers validate input, call services, return responses. Uses `get_db` + `get_current_user` DI.

| File | Prefix | Key Endpoints |
|------|--------|---------------|
| `auth.py` | `/auth/` | `POST /sync-user`, `GET /oauth/{provider}/authorize`, `GET /oauth/{provider}/callback` |
| `connections.py` | `/connections/` | `GET /`, `DELETE /{id}`, `POST /{id}/sync` |
| `activities.py` | `/activities/` | `GET /` (list+filter), `GET /calendar`, `GET /{id}`, `GET /{id}/streams` |
| `lifting.py` | `/lifting/` | Sessions CRUD, sets CRUD, PRs, volume trends, warmup templates, activity linking |
| `routes.py` | `/routes/` | Route CRUD, filtering, GPX download/upload, sync, merge, duplicates |
| `cycling.py` | `/cycling/` | Profile, FTP history, training load, power curve/zones, metrics, FTP estimation, backfill |
| `charts.py` | `/charts/` | `GET /available`, `GET /{chart_name}` — registry-driven chart data |
| `dashboard.py` | `/dashboard/` | `GET /summary`, `GET /weekly-report` |
| `webhooks.py` | `/webhooks/` | `GET /strava` (challenge), `POST /strava` (event receiver) |
| `export.py` | `/export/` | Data export endpoints |
| `training_plans.py` | `/training-plans/` | Plan CRUD, `POST /generate` (template-based auto-generation) |
| `events.py` | `/events/` | Event CRUD with countdown/taper info, `upcoming_only` filter |
