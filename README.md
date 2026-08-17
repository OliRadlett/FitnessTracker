# FitTrack — Fitness Tracker for Powerlifting & Cycling

A personal fitness tracker that aggregates data from **Strava**, **Whoop**, and **Wahoo** into a unified dashboard with trend analysis, correlation insights, and health alerts.

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
├── plans/                # Architecture & planning docs
│   ├── fitness-tracker-architecture.md
│   └── phase-2.md        # Phase 2 enhancement plan
├── docker-compose.yml
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
docker compose up -d
```

This starts:
- **PostgreSQL** on `localhost:5432`
- **Redis** on `localhost:6379`
- **Backend API** on `localhost:8000` (with auto-reload)
- **Celery Worker** for background jobs
- **Celery Beat** for scheduled tasks
- **Frontend** on `localhost:3000`

### 3. Run database migrations

```bash
docker compose exec backend alembic upgrade head
```

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

## API Documentation

Once the backend is running, visit:
- Swagger UI: [http://localhost:8000/docs](http://localhost:8000/docs)
- ReDoc: [http://localhost:8000/redoc](http://localhost:8000/redoc)

## Features

### Phase 1 (Current)
- **Dashboard** — Summary cards, weekly TSS chart, recent activities and lifting sessions
- **Activities** — Cycling activity sync from Strava with filtering and stream data charts
- **Lifting** — Manual session logging with sets/reps/weight/RPE, automatic PR detection (Brzycki formula), volume tracking
- **Charts** — Backend-driven chart service with reusable frontend renderer

### Phase 2 (Planned) — [Detailed Plan](plans/phase-2.md)
**Features:**
- **Custom service runner states** — Per-service startup status in `fittrack.py` (e.g., "Installing node modules")
- **Exercise autocomplete + normalisation** — Built-in exercise database with canonical names to prevent "Squat"/"squat"/"squats" fragmentation
- **Linked sessions on Activities page** — Show linked lifting session data on Strava strength activities
- **Manual PR entry** — Record PRs from sessions not logged in the app
- **PR display reordering** — Big 3 (Squat, Bench, Deadlift) first, accessories behind toggle
- **Session editing UI** — Edit date, focus, notes, and other session fields after creation
- **Delete session** — Remove sessions with confirmation dialog
- **PR deduplication** — Keep only the single best PR per exercise (update rather than duplicate)

**Bug Fixes:**
- **PR persists after set deletion** — Recalculate PRs when the underlying set is deleted
- **PR persists after session deletion** — Recalculate PRs when a session is deleted
- **Session volume not updated on set edit** — Recalculate `total_volume_kg` when set weight/reps change
- **Strava sport type mismatch** — Normalise "WeightTraining"/"Workout"/"CrossFit" to "strength" during sync

**Infrastructure:**
- **Docker healthchecks for worker/beat** — Add proper healthchecks so `fittrack.py` can report accurate health status

Future integrations:
- Whoop integration (recovery, sleep, strain)
- Wahoo integration (indoor cycling workouts)
- Autopopulated training calendar

### Phase 3 (Planned)
- Sport-specific trend analysis
- Cross-sport correlation insights
- Health alert engine (overtraining, illness, injury detection)

## License

Private project — not for public distribution.
