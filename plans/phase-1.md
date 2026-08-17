# Phase 1 — Foundation

> Status: **Complete**

Core infrastructure and initial feature set for FitTrack.

## Features

- **Dashboard** — Summary cards, weekly TSS chart, recent activities and lifting sessions
- **Activities** — Cycling activity sync from Strava with filtering and stream data charts
- **Lifting** — Manual session logging with sets/reps/weight/RPE, automatic PR detection (Brzycki formula), volume tracking
- **Charts** — Backend-driven chart service with reusable frontend renderer
- **Authentication** — NextAuth.js with Google/GitHub OAuth, JWT bridge to backend
- **Service Manager** — `fittrack.py` CLI with interactive menu, health checks, and per-service monitoring

## Infrastructure

- Docker Compose with PostgreSQL 16, Redis 7, Celery worker + beat, Caddy reverse proxy
- SQLAlchemy 2.0 async ORM with Alembic migrations
- Next.js 14 App Router with React Query, Tailwind CSS
- `start.ps1` / `start.sh` thin wrappers for cross-platform startup
