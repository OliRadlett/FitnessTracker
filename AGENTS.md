# FitTrack — Agent Context Guide

> **Rule**: Update this file when changing the codebase. Stale docs are worse than none. Keep this file under 15KB — if it grows, compress or remove discoverable content.

## Overview

FitTrack: personal fitness tracker for **powerlifting + cycling**. Aggregates Strava, Komoot, Wahoo data into a dashboard with trends, correlations, routes, and health alerts.

**Stack**: Python 3.12/FastAPI/SQLAlchemy 2.0 (async) · Next.js 14/React 18/TypeScript/Tailwind/Recharts · PostgreSQL 16 · Redis 7 · Celery + Beat · NextAuth.js (frontend JWT bridge) · Docker Compose + Caddy

## Architecture

**Three-layer backend** (`backend/app/`):
1. **API** (`api/`) — FastAPI route handlers, uses `get_db`/`get_current_user` DI
2. **Services** (`services/`) — Business logic, accept `(db: AsyncSession, user_id, ...)`
3. **Models** (`models/`) — SQLAlchemy 2.0 ORM with `Mapped` annotations, UUID PKs, inherit from `Base`

**Frontend** (`frontend/src/`): Next.js App Router, all pages `'use client'`, React Query (`useQuery`/`useMutation`), `useAuthFetch` hook for JWT-injected fetch. See [`api/fetch.ts`](frontend/src/lib/api/fetch.ts:28). API client split by domain: `api/types.ts` (interfaces), `api/auth.ts`, `api/activities.ts`, `api/lifting.ts`, `api/routes.ts`, `api/cycling.ts`, `api/dashboard.ts`, barrel at `api/index.ts`.

### Authentication (two systems bridged)

1. **Frontend**: NextAuth.js (Google/GitHub OAuth) → [`signIn` callback](frontend/src/lib/auth.ts:38) calls `POST /api/v1/auth/sync-user` → gets JWT → stored as `session.backendToken`
2. **Backend**: JWT via [`create_access_token()`](backend/app/services/auth.py:24) (7-day HS256). [`get_current_user`](backend/app/services/auth.py) decodes `Authorization: Bearer <token>`
3. **Fitness integrations**: Separate OAuth flows → [`/api/v1/auth/oauth/{provider}/authorize`](backend/app/api/auth.py:95) → tokens stored in [`OAuthConnection`](backend/app/models/user.py:30)

## Key Algorithms & Thresholds

| Algorithm | Location | Threshold | Scoring |
|-----------|----------|-----------|---------|
| Activity merge (dedup) | [`merge_service.py`](backend/app/services/merge_service.py) | `ACTIVITY_MERGE_THRESHOLD=0.65` | date 50%, sport 20%, duration 15%, distance 15% |
| Activity↔Route link | [`merge_service.py`](backend/app/services/merge_service.py) | `ACTIVITY_ROUTE_LINK_THRESHOLD=0.70` | proximity + distance + shape |
| Activity↔Lifting link | [`strava.py`](backend/app/services/strava.py) `_match_score()` | 0.55 | date 50%, duration 20%, exercise overlap 30% |
| Route dedup | [`route_service.py`](backend/app/services/route_service.py) | 0.60 | start/end proximity 40%, distance 30%, name 15%, shape 15% |
| PR detection | [`lifting.py`](backend/app/services/lifting.py) `_check_and_record_pr()` | Brzycki: `weight × (36/(37-reps))` | Updated in-place (one PR per exercise) |
| Exercise normalisation | [`exercise_db.py`](backend/app/services/exercise_db.py) | — | Canonical names, aliases, categories (big3/compound/accessory) |

**Merge priority**: Strava (3) > Wahoo (2) > Komoot (1). Lower-priority only fills NULL fields. Strava is source of truth for activities. Wahoo enriches existing Strava activities only.

**TSS**: `(duration_s × NP × IF) / (FTP × 3600) × 100`, where `IF = NP / FTP`. Auto-computed during Strava sync if FTP exists. Uses `weighted_average_watts` (NP) if available, else `average_watts`.

**CTL/ATL/TSB**: Computed on-the-fly. CTL = 42-day EWMA of TSS, ATL = 7-day EWMA, TSB = CTL − ATL.

**Power curve**: Rolling averages over power stream data, buckets from 5s to 120min. More accurate than activity-level averages.

**Chart system**: Backend-driven registry [`CHART_REGISTRY`](backend/app/api/charts.py:17) → [`ChartService`](backend/app/services/charts.py:37) → [`ChartData`](backend/app/services/charts.py:26) → frontend [`Chart`](frontend/src/components/charts/Chart.tsx:49) renders Recharts. Available: `power_curve`, `ftp_over_time`, `weekly_tss`, `estimated_1rm_history`, `weekly_volume`, `hrv_trend`, `recovery_vs_strain`, `sleep_quality_trend`, `training_load`, `ftp_history`, `stream_power_curve`, `power_zones`, `daily_tss`, `exercise_progress`.

## Database (17 tables, UUID PKs)

Key relationships: `User` → has many `OAuthConnection`, `Activity`, `LiftingSession`, `DailyMetric`, `SleepLog`, `PersonalRecord`, `HealthAlert`, `WarmupTemplate`, `Route`, `FtpHistory`; has one `CyclingProfile`. `Activity` → has many `ActivitySource`, `ActivityStream`; optionally linked to `LiftingSession` (via `activity_id`) and `Route` (via `route_id`). `LiftingSession` → has many `LiftingSet`. `Route` → has many `RouteSource`. `WarmupTemplate` → has many `WarmupTemplateStep`.

**JSONB columns**: `OAuthConnection.provider_metadata`, `Activity.raw_data`, `ActivityStream.data`, `ActivitySource.raw_data`, `DailyMetric.raw_data`, `SleepLog.raw_data`, `HealthAlert.evidence`, `Route.elevation_profile`, `RouteSource.raw_data`.

**Unique constraints**: `activities(source, provider_activity_id)`, `activity_sources(provider, provider_activity_id)`, `daily_metrics(user_id, metric_date, source)`, `route_sources(provider, provider_route_id)`, `cycling_profiles(user_id)`.

## Celery Tasks

| Task | Schedule | Notes |
|------|----------|-------|
| `sync_all_strava_activities` | 30 min | Also syncs Wahoo, backfills route links |
| `generate_health_alerts` | Daily 6AM UTC | HRV/sleep decline detection |
| `cleanup_old_data` | Weekly Sun 3AM | Streams older than 90 days |
| `sync_all_routes` | 2 hours | All providers with dedup |
| `auto_estimate_ftp_weekly` | Weekly Sun 4AM | For users with `auto_estimate_ftp=True` |

All tasks use `asyncio.run()` to bridge Celery (sync) with async SQLAlchemy.

## Conventions

### Backend
- **Async everywhere**: `AsyncSession` + `await`. [`get_db`](backend/app/database.py:28) handles commit/rollback
- **UUID PKs**: `uuid.uuid4()` default on all models
- **Pydantic v2**: `model_config = {"from_attributes": True}`, convert via `.model_validate()`
- **No raw SQL**: Use SQLAlchemy `select()` constructs
- **Service signature**: `(db: AsyncSession, user_id: UUID, ...)` — services don't use FastAPI DI

### Frontend
- **Client-side rendering**: All pages `'use client'` with React Query
- **Query keys**: `['lifting-sessions']`, `['activities', filters]`, etc.
- **Tailwind theme**: Dark mode, custom tokens: `background`, `surface`, `surface-light`, `accent`, `positive`, `warning`, `muted`. See [`tailwind.config.js`](frontend/tailwind.config.js)
- **Component structure**: `ui/` (Card, Badge, ExerciseAutocomplete), `charts/` (Chart), `lifting/` (extracted components), `maps/` (RouteMap, ElevationProfile)
- **Field name mismatch warning**: Frontend TS interfaces in [`api/types.ts`](frontend/src/lib/api/types.ts) sometimes differ from backend schemas (e.g., `distance_m` vs `distance_meters`). Check both sides.

## Critical Pitfalls

1. **Celery tasks must use `asyncio.run()`** with a fresh DB session — workers are synchronous
2. **NextAuth signIn timing**: [`pendingBackendToken`](frontend/src/lib/auth.ts:9) is fragile module-level state — only one sign-in in flight at a time
3. **`docker compose exec` doesn't work**: Use `docker compose run --rm <service>`. The [`fittrack.py`](fittrack.py) `exec` command uses `run --rm`
4. **Frontend `API_BASE_URL` must be `''`**: Client fetches use relative URLs. [`api/fetch.ts`](frontend/src/lib/api/fetch.ts) hardcodes `API_BASE_URL = ''`. [`next.config.js`](frontend/next.config.js) rewrites to `http://localhost:8000`. **Never** set `NEXT_PUBLIC_API_URL` to a full URL — causes CORS/mixed-content issues
5. **OAuth `redirect_uri` must match exactly**: Settings page sends `https://localhost/api/v1/auth/oauth/{provider}/callback` — backend must use same URL via `settings.public_url`
6. **Strava Routes API requires `profile:read_all` scope**: Users who connected before this scope was added must re-authorize. Activity-derived routes (from `map.summary_polyline`) work without it
7. **Wahoo API returns dict-wrapped responses**: `{"routes": [...]}` or `{"workouts": [...]}` — always check `isinstance(response, dict)` and unwrap
8. **CORS**: Backend allows `settings.allowed_origins` (default `http://localhost:3000,https://localhost`). Update for production
9. **Caddy routing**: [`Caddyfile`](infra/Caddyfile) routes `/api/auth/*` → frontend (NextAuth), `/api/v1/*` → backend. Don't confuse prefixes
10. **Alembic numbering**: Initial = `"001"`. Sequential numbering. Self-heal in [`main.py`](backend/app/main.py) lifespan is a safety net, not primary path

## Development Lessons

1. **Test after each change**: Restart backend, hit endpoint. Don't batch 15 changes then debug
2. **Verify migrations**: `alembic downgrade <prev>` + `alembic upgrade head` before committing
3. **Check logs after sync/service changes**: `python fittrack.py logs backend --tail 30`
4. **Quick backend checks**: `python fittrack.py exec backend python -c "from app.models.activity import Activity; print(Activity.__table__.columns.keys())"`
5. **Alembic stamp recovery**: If stamped to head but not run, `alembic downgrade <prev>` then `alembic upgrade head`
6. **OAuth callbacks need `user_id`**: Callback runs server-side without session — look up user explicitly

## Planned / Incomplete

- **Whoop integration**: Config exists in [`config.py`](backend/app/config.py:29), no sync service. "Coming Soon" in frontend
- **Health alert engine**: Model + task exist, only HRV/sleep decline implemented. Overtraining/illness/injury detection planned
- **Cross-sport correlation**: Not yet implemented

## Quick Reference

```bash
python fittrack.py up --migrate    # Start all services
python fittrack.py down            # Stop all
python fittrack.py restart worker beat  # Restart after task changes
python fittrack.py logs backend --tail 30
python fittrack.py exec backend alembic revision --autogenerate -m "desc"
python fittrack.py migrate         # Apply migrations
```

## Platform Notes

- **Windows**: Commands use `cmd.exe` syntax (`&&` for chaining, `\` path separators). PowerShell is the default shell in VSCode but `fittrack.py` uses `subprocess` with `cmd.exe`-compatible commands
- **Shell scripts**: `start.ps1` (PowerShell) and `start.sh` (bash) are thin wrappers around `fittrack.py`
- **Docker Compose**: Use `docker compose run --rm <service>` instead of `docker compose exec` (exec has TTY issues in some environments)

## Database Backup & Restore

```bash
# Backup
python fittrack.py backup                       # → backups/fittrack_YYYYMMDD_HHMMSS.sql.gz
python fittrack.py backup --output my_backup.sql # Custom path (plain SQL)

# Restore
python fittrack.py restore backups/fittrack_20260101_120000.sql.gz
python fittrack.py restore my_backup.sql --force # Skip confirmation prompt
```

Backups are `pg_dump` compressed with gzip. Restore drops and recreates the database before loading.

Backend hot-reload: `uvicorn --reload`. Frontend hot-reload: `npm run dev`. Celery: no hot-reload, restart manually.
