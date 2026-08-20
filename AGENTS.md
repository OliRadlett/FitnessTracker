# FitTrack — Agent Context Guide

> **Rule**: Update this file when changing the codebase. Keep under 10KB — compress or remove discoverable content.

## Context Routing

Read only the sections relevant to your task:

| Task Type | Read Sections |
|-----------|--------------|
| Backend API/service | Architecture, Conventions>Backend, Database, Critical Pitfalls |
| Frontend component/page | Architecture, Conventions>Frontend, Critical Pitfalls |
| Integration/sync | Architecture, Key Algorithms, Celery Tasks, Critical Pitfalls |
| Database/model | Database, Conventions>Backend, Critical Pitfalls |
| Debugging | Critical Pitfalls, Development Lessons, Agent Efficiency Rules |
| New feature planning | Overview, Architecture, Planned/Incomplete |

## Agent Efficiency Rules

1. **Stop after 2 failed attempts**: If the same fix fails twice, describe what you tried, what error you saw, and what you're unsure about. Ask the user.
2. **Don't read files speculatively**: Only read files needed for the current task. Use CODEMAP files for orientation.
3. **One question, not a loop**: If unsure about user intent, ask once. Don't assume then debug your assumption.
4. **Check AGENTS.md first**: Before reading multiple files, check if this file already answers your question.
5. **Prefer small changes**: Make one change, verify it works, then proceed. Don't batch changes and debug.

## Overview

FitTrack: personal fitness tracker for **powerlifting + cycling**. Aggregates Strava, Komoot, Wahoo, Whoop into a dashboard with trends, correlations, routes, health alerts, training plans, goals, and events.

**Stack**: Python 3.12/FastAPI/SQLAlchemy 2.0 (async) · Next.js 14/React 18/TypeScript/Tailwind/Recharts · PostgreSQL 16 · Redis 7 · Celery + Beat · NextAuth.js · Docker Compose + Caddy · Prometheus · ReportLab (PDF)

## Architecture

**Three-layer backend** (`backend/app/`):
1. **API** (`api/`) — FastAPI route handlers, uses `get_db`/`get_current_user` DI
2. **Services** (`services/`) — Business logic, accept `(db: AsyncSession, user_id, ...)`
3. **Models** (`models/`) — SQLAlchemy 2.0 ORM with `Mapped` annotations, UUID PKs, inherit from `Base`

**Frontend** (`frontend/src/`): Next.js App Router, all pages `'use client'`, React Query, `useAuthFetch` hook for JWT-injected fetch. See [`api/fetch.ts`](frontend/src/lib/api/fetch.ts:28). API client split by domain in `api/` with barrel at `api/index.ts`.

### CODEMAP Files

Quick reference maps in each package — use these for orientation before reading source:
- [`backend/app/api/CODEMAP.md`](backend/app/api/CODEMAP.md) — API routes and endpoints
- [`backend/app/models/CODEMAP.md`](backend/app/models/CODEMAP.md) — Models and relationships
- [`backend/app/schemas/CODEMAP.md`](backend/app/schemas/CODEMAP.md) — Pydantic schemas
- [`backend/app/services/CODEMAP.md`](backend/app/services/CODEMAP.md) — Service functions

### Authentication (two systems bridged)

1. **Frontend**: NextAuth.js (Google/GitHub OAuth) → [`signIn` callback](frontend/src/lib/auth.ts:38) calls `POST /api/v1/auth/sync-user` → gets JWT → stored as `session.backendToken`
2. **Backend**: JWT via [`create_access_token()`](backend/app/services/auth.py:24) (7-day HS256). [`get_current_user`](backend/app/services/auth.py) decodes `Authorization: Bearer <token>`
3. **Fitness integrations**: Separate OAuth flows → [`/api/v1/auth/oauth/{provider}/authorize`](backend/app/api/auth.py:95) → tokens stored in [`OAuthConnection`](backend/app/models/user.py:30)

## Key Algorithms & Thresholds

| Algorithm | Location | Threshold | Scoring |
|-----------|----------|-----------|---------|
| Activity merge (dedup) | [`merge_service.py`](backend/app/services/merge_service.py) | `0.60` | date 50%, sport 20%, duration 15%, distance 15% |
| Activity↔Route link | [`merge_service.py`](backend/app/services/merge_service.py) | `0.70` | proximity + distance + shape |
| Activity↔Lifting link | [`strava.py`](backend/app/services/strava.py) `_match_score()` | `0.55` | date 50%, duration 20%, exercise overlap 30% |
| Route dedup | [`route_service.py`](backend/app/services/route_service.py) | `0.60` | start/end 40%, distance 30%, name 15%, shape 15% |
| PR detection | [`lifting.py`](backend/app/services/lifting.py) `_check_and_record_pr()` | Brzycki: `weight × (36/(37-reps))` | Updated in-place (one PR per exercise) |
| Exercise normalisation | [`exercise_db.py`](backend/app/services/exercise_db.py) | — | Canonical names, aliases, categories |
| Workout zone matching | [`workout_planner.py`](backend/app/services/workout_planner.py) | TSB-based readiness | 5 zones from FTP/LTHR, route scoring: TSS 35%, duration 25%, power 25%, HR 15% |

**Merge priority**: Strava (3) > Wahoo (2) > Komoot (1). Lower-priority only fills NULL fields. Strava is source of truth.

**TSS**: `(duration_s × NP × IF) / (FTP × 3600) × 100`. Auto-computed during Strava sync if FTP exists.

**CTL/ATL/TSB**: Computed on-the-fly. CTL = 42-day EWMA of TSS, ATL = 7-day EWMA, TSB = CTL − ATL.

**Charts**: Backend registry [`CHART_REGISTRY`](backend/app/api/charts.py) → [`ChartService`](backend/app/services/charts.py) → frontend [`Chart`](frontend/src/components/charts/Chart.tsx) renders Recharts. Charts include: training_load, ftp_history, power_curve, power_zones, daily_tss, exercise_progress, strain_vs_recovery, hrv_trend, weight_trend, vo2max_trend, decoupling_trend, hr_zone_distribution, periodization. Reference areas supported for zone coloring.

**VO2max**: ACSM power formula + Uth HR formula. Endpoint: `GET /api/v1/cycling/vo2max`.

**Decoupling**: HR vs power ratio across ride halves. Only for rides >60min with both streams.

**Workout Planner**: 5 intensity zones (Z1–Z5) derived from FTP and LTHR. Readiness recommendation based on TSB (CTL − ATL). Unridden route TSS estimated from distance + elevation. Endpoint: `GET /api/v1/workout-planner/zones`, `POST /api/v1/workout-planner/plan`, `POST /api/v1/workout-planner/match-routes`.

**Encryption**: OAuth tokens encrypted at rest via Fernet ([`encryption.py`](backend/app/services/encryption.py)). `EncryptedString` TypeDecorator transparent to services.

## Database (25 tables, UUID PKs)

**Relationships (compact)**:

| Parent | Children | Link |
|--------|----------|------|
| `User` | `OAuthConnection`, `Activity`, `LiftingSession`, `DailyMetric`, `SleepLog`, `PersonalRecord`, `HealthAlert`, `WarmupTemplate`, `Route`, `FtpHistory`, `WeightLog`, `Goal`, `TrainingPlan`, `Event`, `LlmAnalysis` | has many |
| `User` | `CyclingProfile` | has one |
| `Activity` | `ActivitySource`, `ActivityStream` | has many |
| `Activity` | `LiftingSession`, `Route` | optionally linked |
| `LiftingSession` | `LiftingSet` | has many |
| `Route` | `RouteSource` | has many |
| `WarmupTemplate` | `WarmupTemplateStep` | has many |
| `TrainingPlan` | `TrainingPlanDay` | has many |

## Celery Tasks

| Task | Schedule | Notes |
|------|----------|-------|
| `sync_all_strava_activities` | 30 min | Also syncs Wahoo, backfills route links |
| `generate_health_alerts` | Daily 6AM UTC | HRV/sleep decline, respiratory rate elevation |
| `cleanup_old_data` | Weekly Sun 3AM | Streams older than 90 days |
| `sync_all_routes` | 2 hours | All providers with dedup |
| `auto_estimate_ftp_weekly` | Weekly Sun 4AM | For users with `auto_estimate_ftp=True` |
| `backup_database` | Weekly Sun 2AM | pg_dump to BACKUP_DIR, cleanup >30 days |
| `weekly_llm_analysis` | Weekly Sun 5AM UTC | Gemini API analysis of cycling stats. Skips if `GEMINI_API_KEY` not set |

All tasks use `asyncio.run()` to bridge Celery (sync) with async SQLAlchemy.

## Conventions

### Backend
- **Async everywhere**: `AsyncSession` + `await`. [`get_db`](backend/app/database.py) handles commit/rollback
- **UUID PKs**: `uuid.uuid4()` default on all models
- **Pydantic v2**: `model_config = {"from_attributes": True}`, convert via `.model_validate()`
- **No raw SQL**: Use SQLAlchemy `select()` constructs
- **Service signature**: `(db: AsyncSession, user_id: UUID, ...)` — services don't use FastAPI DI
- **Structured logging**: JSON in production, human-readable in debug. Correlation IDs via middleware.
- **Rate limiting**: slowapi (100/min global, 20/min auth). In-memory — won't work across multiple workers.
- **Prometheus**: `/metrics` endpoint via prometheus-fastapi-instrumentator
- **Encryption**: [`EncryptedString`](backend/app/services/encryption.py) TypeDecorator for OAuth tokens
- **LLM analysis**: `GEMINI_API_KEY` config for Gemini-powered cycling analysis (optional — task skips gracefully if unset)

### Frontend
- **Client-side rendering**: All pages `'use client'` with React Query
- **Query keys**: `['lifting-sessions']`, `['activities', filters]`, etc.
- **Tailwind theme**: Dark mode, custom tokens: `background`, `surface`, `surface-light`, `accent`, `positive`, `warning`, `muted`. See [`tailwind.config.js`](frontend/tailwind.config.js)
- **Component structure**: `ui/`, `charts/`, `cycling/`, `lifting/`, `maps/`, `training/`
- **Responsive sidebar**: Mobile hamburger menu via SidebarProvider context
- **Error boundary**: [`ErrorBoundary`](frontend/src/components/ui/ErrorBoundary.tsx) wraps all app pages
- **File uploads**: [`apiUpload`](frontend/src/lib/api/fetch.ts) for multipart/form-data (GPX, FIT imports)

## Critical Pitfalls

1. **Celery tasks must use `asyncio.run()`** with a fresh DB session — workers are synchronous
2. **NextAuth signIn timing**: [`pendingBackendToken`](frontend/src/lib/auth.ts:9) is fragile module-level state
3. **`docker compose exec` doesn't work**: Use `docker compose run --rm <service>`
4. **Frontend `API_BASE_URL` must be `''`**: Client fetches use relative URLs. **Never** set `NEXT_PUBLIC_API_URL` to a full URL
5. **OAuth `redirect_uri` must match exactly**: Backend must use same URL via `settings.public_url`
6. **Wahoo API returns dict-wrapped responses**: Always check `isinstance(response, dict)` and unwrap
7. **Caddy routing**: [`Caddyfile`](infra/Caddyfile) routes `/api/auth/*` → frontend, `/api/v1/*` → backend
8. **Alembic numbering**: Initial = `"001"`. Sequential numbering. ⚠️ `014_add_composite_indexes.py` is a stale duplicate — the real chain is 013→014(surface)→015(indexes)→016→017→018→019
9. **EncryptedString**: OAuth tokens are encrypted in DB. `decrypt_token()` falls back to raw value for non-Fernet ciphertext (pre-migration rows)
10. **fitparse/reportlab**: New dependencies — rebuild backend container after adding
11. **`fittrack.py` dev mode only**: Does NOT auto-include `docker-compose.prod.yml`. Use `--prod` flag for production overrides
12. **Caddyfile has no `tls internal`**: Caddy auto-detects localhost → self-signed, real domains → Let's Encrypt. Do NOT add `tls internal` — deploy workflow resets this file every push
13. **`GEMINI_API_KEY` optional**: The weekly LLM analysis task skips gracefully if the key is not set. On-demand analysis returns 400 if key is missing.

## Development Lessons

1. **Test after each change**: Restart backend, hit endpoint. Don't batch changes then debug
2. **Verify migrations**: `alembic downgrade <prev>` + `alembic upgrade head` before committing
3. **Check logs after sync/service changes**: `python fittrack.py logs backend --tail 30`
4. **Quick backend checks**: `python fittrack.py exec backend python -c "from app.models.activity import Activity; print(Activity.__table__.columns.keys())"`
5. **OAuth callbacks need `user_id`**: Callback runs server-side without session — look up user explicitly

## Planned / Incomplete

- **Komoot client rework**: Basic Auth fallback, v007 API (Phase 7)
- **New integrations**: Garmin Connect, TrainingPeaks, Zwift, Apple Health — requires OAuth app registration
- **Pace Zones for Running**: Jack Daniels model — skipped (user only cycles)
- **Full E2E tests**: Playwright login flow, activity sync, lifting session creation
- **Frontend component tests**: Vitest + React Testing Library for charts, MetricCard, etc.
- See [`plans/archive/audit-changelog-2026-08-18.md`](plans/archive/audit-changelog-2026-08-18.md) for full debugging reference

## Quick Reference

```bash
python fittrack.py up --migrate    # Start all services (dev mode)
python fittrack.py --prod up       # Start with production overrides
python fittrack.py down            # Stop all
python fittrack.py restart worker beat  # Restart after task changes
python fittrack.py logs backend --tail 30
python fittrack.py exec backend alembic revision --autogenerate -m "desc"
python fittrack.py migrate         # Apply migrations
```

Backend hot-reload: `uvicorn --reload`. Frontend hot-reload: `npm run dev`. Celery: no hot-reload, restart manually.
