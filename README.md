# FitTrack — Fitness Tracker for Powerlifting & Cycling

A personal fitness tracker that aggregates data from **Strava**, **Whoop**, **Wahoo**, and **Komoot** into a unified dashboard with trend analysis, correlation insights, and health alerts.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12 + FastAPI + SQLAlchemy 2.0 (async) |
| Frontend | Next.js 14 + React + Tailwind CSS + Recharts |
| Database | PostgreSQL 16 |
| Cache/Broker | Redis 7 |
| Background Jobs | Celery + Celery Beat |
| Auth | NextAuth.js (Google + GitHub OAuth) |
| Deployment | Docker Compose + Caddy reverse proxy |

## Project Structure

```
fitness-tracker/
├── backend/              # FastAPI API server
│   ├── app/
│   │   ├── api/          # Route handlers
│   │   ├── models/       # SQLAlchemy models
│   │   ├── schemas/      # Pydantic request/response
│   │   ├── services/     # Business logic
│   │   ├── integrations/ # External API clients
│   │   └── tasks/        # Celery background jobs
│   ├── alembic/          # Database migrations
│   └── pyproject.toml
├── frontend/             # Next.js web app
│   ├── src/
│   │   ├── app/          # Pages (App Router)
│   │   ├── components/   # React components
│   │   └── lib/          # API client, auth config
│   └── package.json
├── infra/                # Deployment config
│   └── Caddyfile
├── docs/                 # Documentation
├── plans/                # Architecture & planning docs
├── scripts/              # Utility scripts
├── docker-compose.yml
├── docker-compose.prod.yml
├── fittrack.py           # Service manager CLI
├── start.sh              # POSIX shell wrapper
├── start.ps1             # Windows PowerShell wrapper
└── .env.example
```

## Quick Start (Local Development)

### Prerequisites

- Docker + Docker Compose
- Node.js 20+ (for frontend dev outside Docker)
- Python 3.12+ (for backend dev outside Docker)

### 1. Clone and configure

```bash
git clone <repo-url>
cd fitness-tracker
cp .env.example .env
# Edit .env with your OAuth credentials
```

### 2. Start with Docker

```bash
python fittrack.py up --migrate
```

This starts:
- **PostgreSQL** on `localhost:5432`
- **Redis** on `localhost:6379`
- **Backend API** on `localhost:8000` (with auto-reload)
- **Celery Worker** for background jobs
- **Celery Beat** for scheduled tasks
- **Frontend** on `localhost:3000`
- **Caddy** reverse proxy on `localhost:80/443`

### 3. Run database migrations

```bash
python fittrack.py migrate
```

Migrations also run automatically on backend startup via the lifespan handler.

### 4. Open the app

Visit [http://localhost:3000](http://localhost:3000) and sign in with Google or GitHub.

## Development (Without Docker)

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## OAuth Setup

### App Login (Google/GitHub)

1. **Google**: Create OAuth credentials at [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials
2. **GitHub**: Create OAuth app at [github.com/settings/developers](https://github.com/settings/developers)
3. Add credentials to `.env`

### Strava Integration

1. Create an API application at [strava.com/settings/api](https://www.strava.com/settings/api)
2. Set callback URL to `http://localhost:8000/api/v1/auth/oauth/strava/callback`
3. Add `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` to `.env`

### Whoop Integration

1. Register an app at [developer.whoop.com](https://developer.whoop.com)
2. Set callback URL to `http://localhost:8000/api/v1/auth/oauth/whoop/callback`
3. Add `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET` to `.env`

### Wahoo Integration

1. Register at [developer.wahooligan.com](https://developer.wahooligan.com)
2. Set callback URL to `http://localhost:8000/api/v1/auth/oauth/wahoo/callback`
3. Add `WAHOO_CLIENT_ID` and `WAHOO_CLIENT_SECRET` to `.env`

### Komoot Integration

Komoot uses **Basic Auth** (email + password), not OAuth. Add to `.env`:

```env
KOMOOT_EMAIL=your@email.com
KOMOOT_PASSWORD=your_password
KOMOOT_USER_ID=your_numeric_user_id  # Optional — auto-detected if not set
```

## API Documentation

Once the backend is running, visit:
- Swagger UI: [http://localhost:8000/docs](http://localhost:8000/docs)
- ReDoc: [http://localhost:8000/redoc](http://localhost:8000/redoc)
- Prometheus metrics: [http://localhost:8000/metrics](http://localhost:8000/metrics)

## Features

### Dashboard
- **Today / Weekly / Monthly tabs** — Switch between daily snapshot, weekly trends, and monthly/yearly review
- **Summary cards** — TSS, volume, distance, recovery, HRV, strain, sleep, training load (CTL/ATL/TSB)
- **Health Monitor** — Composite analysis for overtraining, injury risk, and illness detection
- **AI Performance Analysis** — Weekly Gemini-powered cycling analysis with personalized recommendations
- **Suggested Training Cycle** — 7-day training recommendations based on recovery and training load

### Activities
- **Multi-provider sync** — Strava, Wahoo, Komoot activity and route sync with intelligent deduplication
- **Activity calendar** — Visual calendar with activity dots and filtering
- **Stream data** — Power, HR, cadence, altitude, velocity time-series from connected devices
- **Ride Analysis** — Comprehensive post-ride report: power zones, pacing, VI, decoupling, climbing analysis
- **GPX/FIT import** — Upload activity data from GPX or FIT files

### Lifting
- **Session logging** — Manual session entry with sets/reps/weight/RPE
- **PR tracking** — Automatic PR detection using Brzycki 1RM formula
- **Volume tracking** — Session and per-exercise volume trends
- **Lifting Analysis** — Post-session report: volume breakdown, set progression, rep dropoff, PR proximity, fatigue index
- **Warmup templates** — Reusable warmup routines per exercise

### Cycling
- **FTP management** — Manual entry, auto-estimation from power curve, FTP history tracking
- **Training load** — CTL/ATL/TSB computation with EWMA model
- **Power analysis** — Power curve, power zones, normalized power, variability index
- **VO2max estimation** — ACSM power formula + Uth HR formula
- **Decoupling analysis** — Cardiac drift detection for rides >60min
- **Power vs HR** — Power-to-heart-rate correlation analysis

### Routes
- **Multi-provider sync** — Strava, Komoot, Wahoo route sync with deduplication
- **Route matching** — Automatic linking of activities to routes
- **GPX import/export** — Upload and download GPX files
- **Surface breakdown** — Surface type analysis for routes

### Training
- **Training plans** — Template-based plan generation with day-by-day scheduling
- **Workout planner** — 5-zone intensity model, route matching, TSS estimation
- **Goals** — Set and track fitness goals with progress monitoring
- **Events** — Race/event tracking with countdown and taper info

### Health & Recovery
- **Whoop integration** — Recovery scores, sleep tracking, HRV, strain, respiratory rate
- **Health alerts** — Automated detection of overtraining, injury risk, illness indicators
- **Rest day suggestions** — TSB and recovery-based training recommendations
- **Weight tracking** — Body weight logs from Whoop or manual entry

### Wiki
- **In-app documentation** — Features overview, metrics glossary, science explanations, usage guide
- **18 metric definitions** — TSS, CTL, ATL, TSB, FTP, NP, IF, VI, VAM, VO2max, and more
- **Research explanations** — Training load models, power algorithms, 1RM formulas

### Data & Export
- **CSV export** — Lifting sessions, activities, personal records
- **PDF reports** — Formatted training reports
- **Database backup** — Weekly automated pg_dump with 30-day retention

## License

Private project — not for public distribution.
