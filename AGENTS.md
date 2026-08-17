# FitTrack — AI Agent Context Guide

> **⚠️ Living Document Rule**: This file must be kept up-to-date at all times. Whenever you make changes to the codebase — adding new endpoints, changing schemas, modifying models, introducing new patterns, or discovering new gotchas — **update this document before completing your task**. Treat AGENTS.md as the single source of truth for AI agent context. If your changes affect any section (architecture, directory structure, API endpoints, database schema, conventions, environment variables, etc.), reflect those changes here. Stale documentation is worse than no documentation.

This document provides comprehensive context for AI agents working on the FitTrack fitness tracker codebase. It covers architecture, conventions, key patterns, and gotchas.

## Project Overview

FitTrack is a personal fitness tracker for **powerlifting and cycling** that aggregates data from Strava, Komoot, and Wahoo into a unified dashboard with trend analysis, correlation insights, route management, and health alerts.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2.0 (async), Pydantic v2 |
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, Recharts, date-fns |
| Database | PostgreSQL 16 (via asyncpg) |
| Cache/Broker | Redis 7 |
| Background Jobs | Celery + Celery Beat |
| Auth | NextAuth.js (Google + GitHub OAuth) on frontend; JWT (python-jose) on backend |
| Deployment | Docker Compose + Caddy reverse proxy |
| Package Mgmt | Backend: pip via uv / pyproject.toml; Frontend: npm |

## Directory Structure

```
fitness-tracker/
├── AGENTS.md                 # ← You are here
├── README.md                 # Project overview and setup instructions
├── .env.example              # Environment variable template
├── docker-compose.yml        # Service orchestration (db, redis, backend, worker, beat, frontend)
├── fittrack.py               # Service manager CLI (Python, no deps) — monitor, control, manage all services
├── start.ps1                 # Windows launcher (delegates to fittrack.py)
├── start.sh                  # Linux/macOS launcher (delegates to fittrack.py)
│
├── plans/                    # Architecture & planning docs
│   ├── phase-2.md            # Phase 2 enhancement plan (13 work items)
│   ├── phase-3.md            # Phase 3 plan — cycling integrations & route management (13 work items)
│   └── phase-4.md            # Phase 4 plan — multi-provider merging, page polish & lifting UX (15 work items)
│
├── backend/                  # FastAPI API server
│   ├── Dockerfile            # Python 3.12-slim, uv for deps
│   ├── pyproject.toml        # Project metadata and dependencies
│   ├── alembic.ini           # Alembic config (async migrations)
│   ├── alembic/
│   │   ├── env.py            # Async migration runner (imports all models)
│   │       └── versions/
│   │           ├── 001_initial_schema.py  # Initial migration — all 10 tables
│   │           ├── 002_add_warmup_templates.py  # Warmup templates tables
│   │           ├── 003_add_pr_notes.py  # Add notes column to personal_records
│   │           ├── 005_add_routes.py  # Routes and route_sources tables
│   │           ├── 006_add_cycling_profiles.py  # cycling_profiles and ftp_history tables
│   │           ├── 007_add_auto_estimate_ftp.py  # Add auto_estimate_ftp to cycling_profiles
│   │           ├── 008_add_lifting_set_created_at.py  # Add created_at to lifting_sets
│   │           ├── 009_add_activity_sources.py  # Activity sources table for multi-provider merging
│   │           └── 010_add_activity_route_link.py  # Add route_id FK to activities
│   └── app/
│       ├── __init__.py
│       ├── main.py           # FastAPI app, CORS, router includes, lifespan
│       ├── config.py         # Pydantic Settings (env vars, .env file)
│       ├── database.py       # Async engine, session factory, Base, get_db dependency
│       ├── api/              # Route handlers (prefix: /api/v1/)
│       │   ├── auth.py       # OAuth authorize/callback, sync-user, /me
│       │   ├── connections.py# List/disconnect/sync OAuth connections
│       │   ├── activities.py # List/filter/get activities + streams
│       │   ├── lifting.py    # Full CRUD for sessions/sets, PRs, volume trends, activity linking
│       │   ├── routes.py     # Route CRUD, filtering, GPX download/upload, sync, merge
│       │   ├── cycling.py    # Cycling profile, FTP history, training load, power analysis, zones
│       │   ├── charts.py     # Generic GET /{chart_name} with registry
│       │   ├── dashboard.py  # Summary and weekly report endpoints
│       │   └── webhooks.py   # Strava webhook challenge + event receiver
│       ├── models/           # SQLAlchemy ORM models (all use UUID PKs)
│       │   ├── user.py       # User, OAuthConnection
│       │   ├── activity.py   # Activity, ActivitySource, ActivityStream
│       │   ├── lifting.py    # LiftingSession, LiftingSet, PersonalRecord
│       │   ├── route.py      # Route, RouteSource (multi-provider route merging)
│       │   ├── cycling.py    # CyclingProfile, FtpHistory
│       │   ├── daily_metric.py # DailyMetric (recovery, HRV, strain)
│       │   ├── sleep.py      # SleepLog (stages, efficiency)
│       │   └── health_alert.py # HealthAlert (overtraining, illness, injury)
│       ├── schemas/          # Pydantic request/response models
│       │   ├── auth.py       # UserRead, OAuthConnectionRead, TokenPayload, AuthResponse
│       │   ├── activity.py   # ActivityCreate/Read, ActivitySourceRead, ActivityStreamRead, LinkedLiftingSessionSummary
│       │   ├── lifting.py    # Session/Set Create/Read/Update, PersonalRecordCreate/Read, VolumeTrend, LinkActivity
│       │   ├── route.py      # RouteRead/Summary/Create/Update, RouteSourceRead, MergeRequest
│       │   ├── cycling.py    # CyclingProfileRead/Update, FtpHistoryRead/Create, TrainingLoad, PowerCurve, PowerZones, etc.
│       │   └── dashboard.py  # DashboardSummary, WeeklyReport
│       ├── services/         # Business logic layer
│       │   ├── auth.py       # JWT helpers, OAuth provider configs, get_current_user
│       │   ├── strava.py     # Strava sync logic, webhook handling, activity-to-lifting linking, route sync, TSS auto-computation
│       │   ├── komoot.py     # Komoot route sync service
│       │   ├── wahoo.py      # Wahoo activity sync + route sync service
│       │   ├── merge_service.py # Activity dedup/merge engine, activity↔route auto-linking
│       │   ├── route_service.py # Route CRUD, dedup/merge logic (proximity + distance + name + shape scoring)
│       │   ├── polyline_utils.py # Polyline encode/decode, Haversine distance, provider conversions, elevation profile extraction
│       │   ├── gpx.py        # GPX 1.1 generation and parsing
│       │   ├── lifting.py    # Session/Set CRUD, volume calc, PR detection (Brzycki), activity linking
│       │   ├── exercise_db.py # Exercise database, aliases, normalisation, categorisation (Big 3, compound, accessory)
│       │   ├── cycling.py    # TSS calc, CTL/ATL/TSB, power curve from streams, power zones, cycling metrics
│       │   └── charts.py     # ChartService class with chart generation methods
│       ├── integrations/     # External API clients
│       │   ├── strava_client.py # StravaClient (httpx-based, singleton) — activities, routes, streams
│       │   ├── komoot_client.py # KomootClient — OAuth, tours, routes
│       │   └── wahoo_client.py  # WahooClient — OAuth, routes, workouts
│       └── tasks/            # Celery background jobs
│           └── scheduler.py  # Celery app, Beat schedule, task definitions
│
├── frontend/                 # Next.js 14 web app
│   ├── Dockerfile            # Multi-stage Node 20 Alpine build
│   ├── package.json          # Dependencies and scripts
│   ├── next.config.js        # Standalone output, API rewrites
│   ├── tailwind.config.js    # Custom color theme (dark mode)
│   ├── tsconfig.json
│   ├── postcss.config.js
│   └── src/
│       ├── app/
│       │   ├── globals.css   # Global styles
│       │   ├── layout.tsx    # Root layout (Providers wrapper)
│       │   ├── page.tsx      # Login page (Google/GitHub OAuth)
│       │   ├── (app)/        # Authenticated route group
│       │   │   ├── layout.tsx    # Sidebar + auth guard
│       │   │   ├── dashboard/page.tsx  # Summary cards, TSS chart, recent data
│       │   │   ├── activities/page.tsx # Activity log with sport-type-aware display, summary stats, week view, multi-provider badges
│       │   │   ├── calendar/page.tsx   # Custom activity calendar grid (date-fns CSS Grid), sport type badges, day detail panel with editable lifting notes
│       │   │   ├── cycling/page.tsx    # Cycling dashboard: power curve, training load, FTP, zones, metrics
│       │   │   ├── lifting/page.tsx    # Lifting session orchestrator (delegates to extracted components)
│       │   │   ├── routes/page.tsx     # Route archive with sort/filter, ride stats, GPX, provider provenance
│       │   │   └── settings/page.tsx   # Profile, integration management
│       │   └── api/auth/[...nextauth]/route.ts  # NextAuth API route
│       ├── components/
│       │   ├── Providers.tsx  # SessionProvider + QueryClientProvider
│       │   ├── Sidebar.tsx    # Navigation sidebar
│       │   ├── charts/
│       │   │   └── Chart.tsx  # Reusable chart renderer (line/bar/scatter/area/pie)
│       │   ├── maps/
│       │   │   ├── RouteMap.tsx       # Interactive Leaflet map for route display
│       │   │   └── ElevationProfile.tsx # Recharts area chart for elevation data
│       │   ├── lifting/
│       │   │   ├── LinkActivityModal.tsx        # Modal for linking Strava activities to lifting sessions
│       │   │   ├── WarmupTemplateManager.tsx    # CRUD UI for warmup templates
│       │   │   ├── AddExerciseForm.tsx          # Form to add exercises/sets to a session (with warmup template picker)
│       │   │   ├── ExerciseGroup.tsx            # Inline set editor grouped by exercise in session detail
│       │   │   ├── ManualPRForm.tsx             # Form for manually creating personal records
│       │   │   └── ExerciseProgressSection.tsx  # Exercise progress chart with exercise/week selectors
│       │   └── ui/
│       │       ├── Card.tsx   # Card, CardHeader, CardTitle
│       │       ├── Badge.tsx  # Badge with sport-type variants
│       │       └── ExerciseAutocomplete.tsx  # Exercise name autocomplete with category grouping
│       └── lib/
│           ├── api.ts        # API client, useAuthFetch hook, TypeScript interfaces (incl. LinkedActivity, Route)
│           ├── auth.ts       # NextAuth config (Google/GitHub providers, signIn callback)
│           └── polyline.ts   # Google polyline decoder for frontend map rendering
│
└── infra/
    └── Caddyfile             # Caddy reverse proxy config (TLS, routing)
```

## Architecture Patterns

### Backend Layering

The backend follows a **three-layer architecture**:

1. **API Layer** ([`backend/app/api/`](backend/app/api/)) — Route handlers that validate input, call services, and return responses. Uses FastAPI dependency injection for `get_db` and `get_current_user`.

2. **Service Layer** ([`backend/app/services/`](backend/app/services/)) — Business logic. Services accept `AsyncSession` and perform database operations. Example: [`lifting.py`](backend/app/services/lifting.py) handles CRUD, volume calculation, and PR detection.

3. **Model Layer** ([`backend/app/models/`](backend/app/models/)) — SQLAlchemy 2.0 ORM models using `Mapped` type annotations. All models inherit from [`Base`](backend/app/database.py:24) and use UUID primary keys.

### Authentication Flow

There are **two separate auth systems** that bridge together:

1. **Frontend Auth (NextAuth.js)**: Handles Google/GitHub OAuth login. On successful sign-in, the [`signIn` callback](frontend/src/lib/auth.ts:38) calls the backend's [`POST /api/v1/auth/sync-user`](backend/app/api/auth.py:40) endpoint to create/find the user and obtain a JWT. The JWT is stored in the NextAuth session as `session.backendToken`.

2. **Backend Auth (JWT)**: The backend issues JWTs via [`create_access_token()`](backend/app/services/auth.py:24) (7-day expiry, HS256). Authenticated endpoints use [`get_current_user`](backend/app/services/auth.py) as a FastAPI dependency, which decodes the `Authorization: Bearer <token>` header.

3. **Fitness Integration Auth (Strava, Whoop, Wahoo)**: Separate OAuth flows managed by the backend. Users initiate via the frontend Settings page, which redirects to [`/api/v1/auth/oauth/{provider}/authorize`](backend/app/api/auth.py:95). The callback exchanges the code for tokens and stores them in [`OAuthConnection`](backend/app/models/user.py:30).

### Data Flow for Strava Sync

1. **Manual trigger**: User clicks "Sync" on Settings page → `POST /api/v1/connections/{id}/sync` → [`sync_activities()`](backend/app/services/strava.py)
2. **Webhook**: Strava sends events to `POST /api/v1/webhooks/strava` → [`handle_strava_event()`](backend/app/services/strava.py)
3. **Scheduled**: Celery Beat runs [`sync_all_strava_activities`](backend/app/tasks/scheduler.py) every 30 minutes — also syncs Wahoo activities and backfills route links.

Activities are deduplicated via [`ActivitySource`](backend/app/models/activity.py:49) (`(provider, provider_activity_id)` unique constraint). The **merge engine** ([`merge_service.py`](backend/app/services/merge_service.py)) detects same-activity-from-different-providers using a weighted scoring algorithm (date proximity 50%, sport type 20%, duration 15%, distance 15%) with a configurable threshold (`ACTIVITY_MERGE_THRESHOLD`, default 0.65).

**Strava is the single source of truth for activities.** Wahoo data is used only to enrich existing Strava activities (fill gaps — power, HR, elevation, calories). If no matching Strava activity exists, the Wahoo workout is skipped. Merge priority: Strava (3) > Wahoo (2) > Komoot (1). Lower-priority providers only fill NULL fields.

After syncing, the system **automatically computes TSS** for cycling activities if the user has an FTP set in their [`CyclingProfile`](backend/app/models/cycling.py). TSS is calculated as `(duration_s × NP × IF) / (FTP × 3600) × 100` where `IF = NP / FTP`. If Strava provides `weighted_average_watts` (normalized power), it is used; otherwise `average_watts` is used.

The system also **automatically attempts to link**:
- Strava strength activities to existing lifting sessions using [`link_activity_to_lifting_sessions()`](backend/app/services/strava.py)
- GPS activities (cycling, running) to saved routes using [`link_activity_to_route()`](backend/app/services/merge_service.py) with threshold `ACTIVITY_ROUTE_LINK_THRESHOLD` (default 0.70)

### Activity ↔ Lifting Session Linking

Strength activities from Strava (`WeightTraining`, `Workout`, `CrossFit`) are automatically matched to lifting sessions logged in the app. The matching algorithm in [`_match_score()`](backend/app/services/strava.py) considers:

1. **Date proximity** (same day = 1.0, ±1 day = 0.5, ±2 days = 0.1) — weighted 50%
2. **Duration similarity** (ratio of shorter/longer) — weighted 20%
3. **Exercise name/focus overlap** (keyword extraction from Strava activity name vs session focus) — weighted 30%

A match threshold of **0.55** is required. The `LiftingSession.activity_id` FK → `Activity` already existed in the schema.

Manual linking is also supported via:
- `PUT /api/v1/lifting/sessions/{id}/link` — link/unlink a session to an activity
- `GET /api/v1/lifting/sessions/{id}/linkable-activities` — find candidate activities
- `POST /api/v1/lifting/backfill-links` — re-run auto-linking for all unlinked activities

### Chart System

Charts use a **backend-driven registry pattern**:

1. [`CHART_REGISTRY`](backend/app/api/charts.py:17) maps chart names to service methods and their required parameters.
2. [`ChartService`](backend/app/services/charts.py:37) contains the actual chart generation logic, querying the DB and returning [`ChartData`](backend/app/services/charts.py:26) dataclasses.
3. The frontend [`Chart`](frontend/src/components/charts/Chart.tsx:49) component accepts a `ChartData` object and renders the appropriate Recharts chart type (line, bar, scatter, area, pie).

Available charts: `power_curve`, `ftp_over_time`, `weekly_tss`, `estimated_1rm_history`, `weekly_volume`, `hrv_trend`, `recovery_vs_strain`, `sleep_quality_trend`, `training_load`, `ftp_history`, `stream_power_curve`, `power_zones`, `daily_tss`.

The cycling-specific charts (`training_load`, `ftp_history`, `stream_power_curve`, `power_zones`, `daily_tss`) use the [`cycling.py`](backend/app/services/cycling.py) service for TSS aggregation, CTL/ATL/TSB computation, and power stream analysis.

### Lifting PR Detection

When a lifting set is created, [`_check_and_record_pr()`](backend/app/services/lifting.py) uses the **Brzycki formula** to estimate 1RM: `weight × (36 / (37 - reps))`. If the estimated 1RM exceeds the current best for that exercise, the [`PersonalRecord`](backend/app/models/lifting.py:51) is **updated in-place** (deduplication — only one PR per exercise/record_type). If no PR exists, a new one is created.

When a set or session is deleted, [`_recalculate_pr_after_set_change()`](backend/app/services/lifting.py) is called to find the next-best remaining set across all sessions and update or remove the PR accordingly.

Manual PRs (for sessions not logged in the app) can be created via `POST /api/v1/lifting/prs` — these have `session_id=None`.

### Exercise Name Normalisation

[`exercise_db.py`](backend/app/services/exercise_db.py) provides a built-in exercise database with canonical names, aliases, and categories (`big3`, `compound`, `accessory`). When a set is added, [`normalise_exercise_name()`](backend/app/services/exercise_db.py) maps user input to canonical form (e.g., "squat" → "Back Squat", "bench" → "Bench Press"). The [`GET /api/v1/lifting/exercises`](backend/app/api/lifting.py) endpoint provides autocomplete suggestions grouped by category. The frontend [`ExerciseAutocomplete`](frontend/src/components/ui/ExerciseAutocomplete.tsx) component uses this for the exercise name input fields.

### Route Management & Deduplication

Routes from Strava, Komoot, and Wahoo are stored in a two-table model: [`Route`](backend/app/models/route.py) (canonical geometry) and [`RouteSource`](backend/app/models/route.py) (provider provenance). When a new route arrives from any provider, [`create_or_merge_route()`](backend/app/services/route_service.py) checks for duplicates using a weighted scoring algorithm:

1. **Start/end proximity** (Haversine distance) — weighted 40%
2. **Distance similarity** (ratio) — weighted 30%
3. **Name similarity** (SequenceMatcher) — weighted 15%
4. **Shape similarity** (sampled point comparison) — weighted 15%

A threshold of **0.60** is required. Matches result in a new `RouteSource` added to the existing `Route`; non-matches create a new `Route`.

Route sync is triggered by: manual "Sync" button on Settings page, `POST /api/v1/routes/sync`, or Celery Beat (`sync_all_routes` every 2 hours). Each provider's sync service is in its own module: [`strava.py`](backend/app/services/strava.py) (`sync_strava_routes`), [`komoot.py`](backend/app/services/komoot.py), [`wahoo.py`](backend/app/services/wahoo.py).

Polyline encoding/decoding uses Google's Encoded Polyline Algorithm. Utility functions in [`polyline_utils.py`](backend/app/services/polyline_utils.py) handle encoding, decoding, Haversine distance, sampling, and provider-specific coordinate format conversions.

GPX generation and parsing is in [`gpx.py`](backend/app/services/gpx.py) — routes can be downloaded as GPX 1.1 files and uploaded via `POST /api/v1/routes/upload-gpx`.

The frontend [`RouteMap`](frontend/src/components/maps/RouteMap.tsx) component renders routes on an interactive Leaflet map with OpenStreetMap tiles. The [`ElevationProfile`](frontend/src/components/maps/ElevationProfile.tsx) shows elevation data as a Recharts area chart. Both are used on the [Routes page](frontend/src/app/(app)/routes/page.tsx) and the Activities page.

### Cycling Analysis & Training Load

The cycling system provides power analysis, training load management, and FTP tracking:

1. **FTP Management**: Users set their FTP (Functional Threshold Power) via [`CyclingProfile`](backend/app/models/cycling.py). FTP changes are automatically recorded in [`FtpHistory`](backend/app/models/cycling.py) with dates and source (manual/estimated/strava).

2. **TSS Calculation**: [`calculate_power_tss()`](backend/app/services/cycling.py) computes TSS as `(duration_s × NP × IF) / (FTP × 3600) × 100`. TSS is auto-computed during Strava sync and can be manually recalculated via `POST /api/v1/cycling/recalculate-tss`.

3. **CTL / ATL / TSB**: [`compute_training_load()`](backend/app/services/cycling.py) computes Chronic Training Load (42-day EWMA of TSS), Acute Training Load (7-day EWMA of TSS), and Training Stress Balance (CTL − ATL). These are computed on-the-fly from activity TSS data — no separate storage table needed.

4. **Power Curve from Streams**: [`compute_power_curve_from_streams()`](backend/app/services/cycling.py) uses rolling averages over power stream data to find best power at each duration bucket (5s to 120min). This is more accurate than using activity-level average power.

5. **Power Zones**: [`compute_power_zones_from_streams()`](backend/app/services/cycling.py) distributes power stream data across the Coggan 7-zone model (Active Recovery → Neuromuscular) based on the user's FTP.

6. **Cycling Metrics**: The `/api/v1/cycling/metrics-summary` endpoint computes IF (Intensity Factor = NP/FTP), VI (Variability Index = NP/AP), VAM, best 20min power, and W/kg.

The frontend [Cycling page](frontend/src/app/(app)/cycling/page.tsx) displays all of this with interactive charts (training load chart, power curve, power zones, daily TSS, power vs HR scatter) and a profile editor for FTP/weight.

### Activity Calendar

The [Calendar page](frontend/src/app/(app)/calendar/page.tsx) uses a **custom-built calendar grid** using [date-fns](https://date-fns.org) for date utilities and CSS Grid (7 columns) for layout. Each day cell is 120px tall and shows inline activity badges with sport type emoji and key stats (e.g. "🚴 45.2 km · 1h 30m · 120 TSS"). The calendar fetches lightweight data from [`GET /api/v1/activities/calendar`](backend/app/api/activities.py) with `start_date` and `end_date` params covering the visible month range (including leading/trailing days from adjacent months). Activities are grouped by date into a `Map<string, ActivityCalendarEntry[]>` for O(1) lookup.

The calendar features month/year navigation with prev/next buttons and a "Today" shortcut, day-of-week headers (Mon–Sun), today highlighted with an accent border, and the selected day highlighted with an accent background fill. Sport type colors match the Badge component: cycling=blue-500, running=green-500, strength=purple-500, swimming=cyan-500, walking/hiking=amber-500.

Below the calendar grid, a **day detail panel** shows full activity details for the selected day. For cycling/running activities, it fetches full activity data from [`GET /api/v1/activities`](backend/app/api/activities.py) and shows distance, duration, avg power, and TSS in a stats grid. For strength/lifting activities, it fetches lifting sessions from [`GET /api/v1/lifting/sessions`](backend/app/api/lifting.py), filters client-side by date, and shows exercises with set details (weight × reps). Each lifting session has an **editable notes field** — changes are saved via [`PATCH /api/v1/lifting/sessions/{id}`](backend/app/api/lifting.py). The [`ActivityCalendarEntry`](backend/app/schemas/activity.py:98) schema is defined in the backend and mirrored as a TypeScript interface in [`api.ts`](frontend/src/lib/api.ts:106).

## Database Schema

**17 tables**, all using UUID primary keys. Key relationships:

- [`User`](backend/app/models/user.py:11) → has many `OAuthConnection`, `Activity`, `LiftingSession`, `DailyMetric`, `SleepLog`, `PersonalRecord`, `HealthAlert`, `WarmupTemplate`, `Route`, `FtpHistory`; has one `CyclingProfile`
- [`Activity`](backend/app/models/activity.py:11) → has many `ActivitySource`, `ActivityStream`; optionally linked to `LiftingSession` and `Route`
- [`ActivitySource`](backend/app/models/activity.py:49) → provider provenance for merged activities (mirrors `RouteSource` pattern)
- [`LiftingSession`](backend/app/models/lifting.py:11) → has many `LiftingSet`
- [`PersonalRecord`](backend/app/models/lifting.py:51) → references both `Activity` and `LiftingSession`; includes `notes` for manual PR context
- [`WarmupTemplate`](backend/app/models/lifting.py:70) → has many `WarmupTemplateStep`; user-defined warmup sequences per exercise
- [`Route`](backend/app/models/route.py) → has many `RouteSource`; has many `Activity` (via `route_id` FK); stores canonical route geometry with multi-provider provenance
- [`CyclingProfile`](backend/app/models/cycling.py) → per-user FTP, weight, and `auto_estimate_ftp` flag; one-to-one with `User`
- [`FtpHistory`](backend/app/models/cycling.py) → tracks FTP changes over time with effective dates and source (manual/estimated/strava)

**JSONB columns** are used for: `OAuthConnection.provider_metadata`, `Activity.raw_data`, `ActivityStream.data`, `ActivitySource.raw_data`, `DailyMetric.raw_data`, `SleepLog.raw_data`, `HealthAlert.evidence`, `Route.elevation_profile`, `RouteSource.raw_data`.

**Unique constraints**:
- `activities`: `(source, provider_activity_id)` — legacy deduplication (kept for backward compat)
- `activity_sources`: `(provider, provider_activity_id)` — primary deduplication for multi-provider merging
- `daily_metrics`: `(user_id, metric_date, source)` — one metric per source per day
- `route_sources`: `(provider, provider_route_id)` — one source per provider per route
- `cycling_profiles`: `(user_id)` — one profile per user

## Environment Variables

See [`.env.example`](.env.example) for the full list. Key variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | Async PostgreSQL connection string | `postgresql+asyncpg://fittrack:fittrack_dev@db:5432/fittrack` |
| `REDIS_URL` | Redis connection for Celery | `redis://redis:6379/0` |
| `SECRET_KEY` | JWT signing key | `change-me-to-a-random-secret-key` |
| `NEXT_PUBLIC_API_URL` | Backend API URL (frontend) | `http://localhost:8000` |
| `GOOGLE_CLIENT_ID/SECRET` | Google OAuth for app login | — |
| `GITHUB_CLIENT_ID/SECRET` | GitHub OAuth for app login | — |
| `STRAVA_CLIENT_ID/SECRET` | Strava OAuth integration | — |
| `KOMOOT_CLIENT_ID/SECRET` | Komoot OAuth integration | — |
| `WAHOO_CLIENT_ID/SECRET` | Wahoo OAuth integration | — |
| `STRAVA_VERIFY_TOKEN` | Webhook verification token | `fittrack_strava_webhook` |
| `ACTIVITY_MERGE_THRESHOLD` | Activity duplicate detection threshold | `0.65` |
| `ACTIVITY_ROUTE_LINK_THRESHOLD` | Activity↔route matching threshold | `0.70` |

## Development Workflow

### FitTrack Service Manager ([`fittrack.py`](fittrack.py))

The primary way to manage development services is via [`fittrack.py`](fittrack.py) — a zero-dependency Python CLI utility that wraps Docker Compose with live monitoring, per-service control, and an interactive dashboard.

**Launcher scripts** ([`start.ps1`](start.ps1) / [`start.sh`](start.sh)) are thin wrappers that delegate to `fittrack.py`. They accept the same arguments.

#### Quick Reference

```bash
# Interactive menu (default — no args)
python fittrack.py

# Start / stop all services
python fittrack.py up
python fittrack.py up --migrate       # start + run migrations
python fittrack.py up --build         # rebuild images + start
python fittrack.py down

# Per-service control
python fittrack.py up backend frontend
python fittrack.py restart backend
python fittrack.py stop worker beat

# Live monitoring dashboard (refreshes every 5s)
python fittrack.py monitor
python fittrack.py monitor -i 2       # custom interval

# Status (one-shot)
python fittrack.py status

# Logs
python fittrack.py logs               # all services
python fittrack.py logs backend       # single service
python fittrack.py logs --tail 50     # last 50 lines
python fittrack.py logs --no-follow   # don't follow

# Build & migrate
python fittrack.py build              # all images
python fittrack.py build backend      # single image
python fittrack.py migrate            # run Alembic migrations

# Execute command in a container
python fittrack.py exec backend bash
python fittrack.py exec db psql -U fittrack
```

Or via the launcher scripts (identical arguments):
```bash
# Linux/macOS
./start.sh up --migrate
./start.sh monitor
./start.sh logs backend

# Windows PowerShell
.\start.ps1 up --migrate
.\start.ps1 monitor
.\start.ps1 logs backend
```

When run with no arguments, `fittrack.py` enters an **interactive menu** with numbered commands and a `fittrack>` prompt.

The `monitor` command provides a continuously refreshing dashboard showing service state, health (HTTP probes for backend/frontend, Docker healthchecks for db/redis/worker/beat), port mappings, and uptime.

### Running Locally with Docker (Recommended)

1. Ensure Docker Desktop is running
2. Run: `python fittrack.py up --migrate` (or `./start.sh up --migrate`)
3. The tool will auto-copy `.env.example` → `.env` on first run (edit with OAuth credentials)

Services: PostgreSQL (:5432), Redis (:6379), Backend (:8000), Celery Worker, Celery Beat, Frontend (:3000).

### Hot-Reload

Both backend and frontend support hot-reload in Docker:

- **Backend**: `uvicorn --reload` watches [`backend/app/`](backend/app/) for Python file changes. Edits to routes, models, services, etc. trigger an automatic server restart.
- **Frontend**: `npm run dev` (Next.js dev server) watches [`frontend/src/`](frontend/src/) for TypeScript/React/CSS changes. Edits trigger instant browser refresh via Fast Refresh.
- **Celery Worker/Beat**: No hot-reload. Restart with `python fittrack.py restart worker beat` after changing task code.

### Running Without Docker

**Backend**:
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload
```

**Frontend**:
```bash
cd frontend
npm install
npm run dev
```

### Database Migrations

Uses **Alembic** with async support. The [`env.py`](backend/alembic/env.py) imports all models for autogenerate.

```bash
# Create a new migration after model changes
python fittrack.py exec backend alembic revision --autogenerate -m "description"

# Apply migrations
python fittrack.py migrate
```

### Linting

Backend uses **Ruff** (configured in [`pyproject.toml`](backend/pyproject.toml)). Frontend uses **ESLint** via `next lint`.

## Key Conventions

### Backend

- **Async everywhere**: All database operations use `AsyncSession` and `await`. The [`get_db`](backend/app/database.py:28) dependency handles commit/rollback automatically.
- **UUID primary keys**: All models use `uuid.uuid4()` as default.
- **Pydantic v2**: Schemas use `model_config = {"from_attributes": True}` for ORM → Pydantic conversion via `.model_validate()`.
- **No raw SQL**: All queries use SQLAlchemy's `select()` construct.
- **Service functions accept `(db, user_id, ...)`**: Services don't use FastAPI dependencies directly.

### Frontend

- **All pages are `'use client'`**: Client-side rendering with React Query for data fetching.
- **`useAuthFetch` hook**: Returns an authenticated `fetch` wrapper that includes the backend JWT. See [`api.ts`](frontend/src/lib/api.ts:34).
- **TanStack Query**: All data fetching uses `useQuery`/`useMutation` with query key conventions like `['lifting-sessions']`, `['activities', filters]`.
- **Tailwind CSS custom theme**: Dark mode with custom color tokens (`background`, `surface`, `surface-light`, `accent`, `positive`, `warning`, `muted`). See [`tailwind.config.js`](frontend/tailwind.config.js).
- **Route groups**: `(app)` group contains authenticated pages with shared layout and Sidebar.
- **Component structure**: `ui/` for primitives (Card, Badge), `charts/` for data visualization, `lifting/` for lifting page extracted components, `maps/` for route/activity map components.

### TypeScript Interfaces

Frontend TypeScript interfaces are defined in [`api.ts`](frontend/src/lib/api.ts:48). Note: some field names in the frontend interfaces differ slightly from the backend schemas (e.g., `distance_m` vs `distance_meters`, `duration_s` vs `duration_seconds`). Check both sides when working with data shapes.

## Celery Background Jobs

Defined in [`scheduler.py`](backend/app/tasks/scheduler.py). Five scheduled tasks:

| Task | Schedule | Description |
|------|----------|-------------|
| `sync_all_strava_activities` | Every 30 min | Syncs Strava + Wahoo activities, auto-links to lifting sessions and routes |
| `generate_health_alerts` | Daily at 6 AM UTC | Analyzes metrics for HRV drops and sleep decline |
| `cleanup_old_data` | Weekly (Sun 3 AM) | Deletes activity streams older than 90 days |
| `sync_all_routes` | Every 2 hours | Syncs routes from all connected providers (Strava, Komoot, Wahoo) with deduplication |
| `auto_estimate_ftp_weekly` | Weekly (Sun 4 AM UTC) | Auto-estimates FTP for users with `auto_estimate_ftp=True` using power stream data |

Tasks use `asyncio.run()` internally to bridge Celery (sync) with async SQLAlchemy.

## API Endpoints

All endpoints are prefixed with `/api/v1/`. See the running Swagger UI at `http://localhost:8000/docs` for interactive documentation.

### Auth (`/api/v1/auth/`)
- `POST /sync-user` — Bridge NextAuth → backend user + JWT
- `GET /oauth/{provider}/authorize` — Start OAuth flow
- `GET /oauth/{provider}/callback` — Handle OAuth callback

### Connections (`/api/v1/connections/`)
- `GET /` — List user's OAuth connections
- `DELETE /{id}` — Disconnect
- `POST /{id}/sync` — Trigger manual sync

### Activities (`/api/v1/activities/`)
- `GET /` — List with filters (sport_type, source, date range, limit, offset). Includes `linked_lifting_session` summary, `encoded_polyline`, `sources` list, and `route_name` for linked activities.
- `GET /calendar` — Lightweight calendar data (params: `start_date`, `end_date`). Returns `[{id, date, sport_type, name, duration_seconds, distance_meters, tss}]`. Must be registered before `/{activity_id}` to avoid path conflicts.
- `GET /{id}` — Get single activity (includes `linked_lifting_session`, `sources`, `route_name`)
- `GET /{id}/streams` — Get activity streams
- `POST /backfill-route-links` — Re-run activity↔route linking for all unlinked GPS activities

### Routes (`/api/v1/routes/`)
- `GET /` — List routes with filters and sorting. Params: `sport_type`, `source`, `is_loop`, `min_distance`, `max_distance`, `min_elevation`, `max_elevation`, `q` (name search), `sort_by` (name/distance/elevation/ride_count/last_ridden/created_at), `sort_order` (asc/desc). Response includes `ride_count` and `last_ridden_date` computed from the activities table.
- `GET /{id}` — Get route detail with all sources and encoded polyline
- `POST /` — Manually create a route (from GPX data or encoded polyline)
- `PATCH /{id}` — Update route name/sport type
- `DELETE /{id}` — Delete route (cascades to sources)
- `GET /{id}/gpx` — Download route as GPX file
- `POST /upload-gpx` — Upload a GPX file to create a new route
- `GET /duplicates` — List potential duplicate route pairs for manual review
- `POST /merge` — Manually merge two routes
- `POST /sync` — Trigger route sync from all connected providers

### Lifting (`/api/v1/lifting/`)
- `POST /sessions` — Create session (with nested sets)
- `GET /sessions` — List sessions (includes `linked_activity` with Strava data)
- `GET /sessions/{id}` — Get session detail (includes `linked_activity`)
- `PATCH /sessions/{id}` — Update session
- `DELETE /sessions/{id}` — Delete session
- `PUT /sessions/{id}/link` — Link/unlink session to a Strava activity
- `GET /sessions/{id}/linkable-activities` — Find Strava strength activities for linking
- `POST /backfill-links` — Auto-link all unlinked Strava strength activities
- `POST /sessions/{id}/sets` — Add set (triggers PR check; normalises exercise name)
- `PATCH /sets/{id}` — Update set (recalculates session volume and PRs)
- `DELETE /sets/{id}` — Delete set (recalculates session volume and PRs)
- `GET /prs` — List personal records (includes `notes` field)
- `POST /prs` — Manually create a PR (for sessions not logged in the app)
- `GET /exercises?q=` — Search built-in exercise database (returns canonical names with categories)
- `GET /volume-trends` — Weekly volume trends
- `GET /warmup-templates` — List warmup templates (optional filter: `exercise_name`)
- `POST /warmup-templates` — Create warmup template (with nested steps)
- `GET /warmup-templates/{id}` — Get warmup template detail
- `PATCH /warmup-templates/{id}` — Update warmup template (replaces steps if provided)
- `DELETE /warmup-templates/{id}` — Delete warmup template

### Cycling (`/api/v1/cycling/`)
- `GET /profile` — Get cycling profile (FTP, weight, auto_estimate_ftp)
- `PATCH /profile` — Update cycling profile (auto-records FTP history on change; also handles `auto_estimate_ftp` toggle)
- `GET /ftp-history` — Get FTP history entries
- `POST /ftp-history` — Manually add FTP history entry
- `GET /training-load` — CTL/ATL/TSB training load data (params: days)
- `GET /power-curve` — Best power curve from stream data (params: days)
- `GET /power-zones` — Power zone distribution based on FTP (params: days)
- `GET /power-vs-hr` — Power vs heart rate scatter data (params: days)
- `GET /metrics-summary` — Cycling metrics summary (7d TSS, rides, distance, IF, VI, best 20min, FTP, W/kg)
- `POST /recalculate-tss` — Auto-compute TSS for cycling activities missing it (params: days)
- `POST /estimate-ftp` — Auto-estimate FTP from best power data (20min×0.95, 8min×0.855, 5min×0.95). Params: days, accept (bool). When accept=true, saves the estimate as the user's FTP and records it in FTP history.
- `POST /backfill-streams` — Fetch power/HR streams for existing cycling activities that are missing them. Params: days, limit. Useful for backfilling data after initial sync.
- `POST /backfill-ftp-history` — Estimate FTP for historical monthly snapshots (last N months) and create FTP history entries. Params: months. Skips months that already have entries.

### Charts (`/api/v1/charts/`)
- `GET /available` — List chart types
- `GET /{chart_name}` — Get chart data (params: days, weeks, exercise_name)
- Available charts: `power_curve`, `ftp_over_time`, `weekly_tss`, `estimated_1rm_history`, `weekly_volume`, `hrv_trend`, `recovery_vs_strain`, `sleep_quality_trend`, `training_load`, `ftp_history`, `stream_power_curve`, `power_zones`, `daily_tss`, `exercise_progress` (params: exercise_name, weeks)
- Available charts: `power_curve`, `ftp_over_time`, `weekly_tss`, `estimated_1rm_history`, `weekly_volume`, `hrv_trend`, `recovery_vs_strain`, `sleep_quality_trend`, `training_load`, `ftp_history`, `stream_power_curve`, `power_zones`, `daily_tss`, `exercise_progress` (params: exercise_name, weeks)

### Dashboard (`/api/v1/dashboard/`)
- `GET /summary` — Current week summary
- `GET /weekly-report` — Detailed weekly report

### Webhooks (`/api/v1/webhooks/`)
- `GET /strava` — Verification challenge
- `POST /strava` — Event receiver

## Planned / Incomplete Features

- **Whoop integration**: OAuth config exists in [`config.py`](backend/app/config.py:29) and [`auth.py`](backend/app/services/auth.py:64) (partially), but no sync service yet. Marked "Coming Soon" in frontend.
- **Health alert engine**: Model and Celery task exist, but only basic HRV/sleep decline detection is implemented. Overtraining, illness, and injury detection are planned.
- **Sport-specific trend analysis and cross-sport correlation**: Not yet implemented.

## Common Pitfalls

1. **Frontend/backend field name mismatch**: The frontend TypeScript interfaces in [`api.ts`](frontend/src/lib/api.ts:48) sometimes use different field names than the backend Pydantic schemas (e.g., `distance_m` vs `distance_meters`). Always check both when debugging data issues.

2. **Celery tasks must use `asyncio.run()`**: Celery workers are synchronous. Each task wraps its async logic in `asyncio.run()` with a fresh database session.

3. **NextAuth signIn callback timing**: The [`pendingBackendToken`](frontend/src/lib/auth.ts:9) variable uses module-level state to pass the JWT from the `signIn` callback to the `jwt` callback. This works but is a fragile pattern — only one sign-in can be in flight at a time.

4. **Alembic migration numbering**: The initial migration is revision `"001"`. New migrations should follow sequential numbering.

5. **CORS**: Backend allows origins from `settings.allowed_origins` (comma-separated, defaults to `http://localhost:3000,https://localhost`). Update this for production deployments.

6. **Caddy routing**: The [`Caddyfile`](infra/Caddyfile) routes `/api/auth/*` to the frontend (for NextAuth) and `/api/v1/*` to the backend. Don't confuse these prefixes.

7. **`docker compose exec` doesn't work in this terminal**: The terminal environment doesn't support TTY allocation. Always use `docker compose run --rm <service>` instead of `docker compose exec`. The [`fittrack.py`](fittrack.py) `exec` command uses `run --rm` for this reason.

8. **Frontend API_BASE_URL must be empty string**: The [`api.ts`](frontend/src/lib/api.ts:4) `API_BASE_URL` is hardcoded to `''`. Client-side fetches use relative URLs (e.g., `/api/v1/activities`). The [`next.config.js`](frontend/next.config.js) rewrites proxy server-side to `http://localhost:8000`. **Do not** set `NEXT_PUBLIC_API_URL` to a full URL — it causes CORS/mixed-content issues. Caddy handles HTTPS proxying separately.

9. **OAuth callback redirect_uri must match**: For Wahoo/Komoot OAuth, the [`redirect_uri`](backend/app/api/auth.py) used in the token exchange must exactly match the one sent to the provider's authorize endpoint. The settings page sends `https://localhost/api/v1/auth/oauth/{provider}/callback` — the backend must use the same URL (via `settings.public_url`).

## Development Workflow Lessons

These lessons were learned during Phase 4 implementation. Follow them to avoid repeating mistakes.

1. **Test after each work item, not at the end**: After each backend change, restart the backend and hit the affected endpoint. Catching bugs immediately (e.g., `scalar_one_or_none` called twice, null `user_id`) saves significant debugging time vs. discovering them after 15 items are committed.

2. **Verify migrations before committing**: Run `alembic downgrade <previous>` + `alembic upgrade head` to verify migrations apply cleanly. The self-heal mechanism in [`main.py`](backend/app/main.py) lifespan is a safety net, not the primary migration path.

3. **Check backend logs immediately after sync/service changes**: Run `docker compose logs backend --tail 30` after any change to [`strava.py`](backend/app/services/strava.py), [`wahoo.py`](backend/app/services/wahoo.py), [`merge_service.py`](backend/app/services/merge_service.py), or [`connections.py`](backend/app/api/connections.py). Don't wait for the user to report a 500.

4. **Use `fittrack.py exec` for quick backend checks**:
   ```bash
   python fittrack.py exec backend python -c "from app.models.activity import Activity; print(Activity.__table__.columns.keys())"
   ```

5. **Narrower subtask scope**: When delegating to subtasks, limit scope to one work item per subtask. Large subtasks (5+ items) introduce multiple bugs that are hard to isolate.

6. **Alembic stamp + downgrade/upgrade pattern**: When Alembic is stamped to head but migrations haven't actually run (e.g., after `create_all`), use `alembic downgrade <previous_version>` then `alembic upgrade head` to re-apply. This is more reliable than trying to run individual migrations.

7. **OAuth connections require user_id**: When creating [`OAuthConnection`](backend/app/models/user.py) records in OAuth callbacks, always set `user_id`. The callback runs server-side without a session — look up the user explicitly.
