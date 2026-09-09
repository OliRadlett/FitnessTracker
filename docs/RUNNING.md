# FitTrack — Running Commands, Tests & Environment

> **Purpose**: The canonical reference for HOW to execute commands in this project — which shell, how to run services, how to run tests, lint, migrations. Read this before running anything non-trivial.

## Host Environment

- **OS**: Windows 11 with WSL2 (Ubuntu 26.04 LTS)
- **Shell**: bash (running inside WSL2); OpenCode is configured with `"shell": "bash"` in [`opencode.json`](../opencode.json). Note: the `pwsh` command is a symlink to `bash` on this machine, so it is functionally identical.
- **Bash syntax**: `&&`, `||`, `grep`, `sed`, `awk`, `cat`, `ls` all work. Quote paths with spaces using double quotes. Env vars: `export VAR="value"` or `VAR="value" command`.

### Installed Host Tools

| Tool | Version | Purpose |
|------|---------|---------|
| Docker | 29.7.2 | Container runtime (daemon via Docker Desktop on Windows host) |
| Docker Compose | v5.4.0 | Service orchestration |
| Python | 3.14.4 | `fittrack.py`, host-side scripts (`python` → `python3`) |
| pip | 26.2.1 | Python package installer (via get-pip.py, `--break-system-packages`) |
| ruff | 0.16.5 | Backend linting & formatting |
| pytest | 9.1.1 | Backend testing (host fallback; also runs in container) |
| Node.js | v24.20.0 | Frontend dev |
| npm | 11.19.0 | Package management |
| uv | 0.12.9 | Available but **not used by the project** — backend uses `pip install` via Dockerfile |
| Git | 2.53.0 | Version control |
| gh | 2.100.0 | GitHub CLI |
| curl | 8.18.0 | Downloads |

> **Note**: `uv` is installed on the host for convenience but the project itself does **not** use UV. Backend dependencies are in `pyproject.toml` and installed via `pip install -e ".[dev]"` in the Dockerfile.

## Service Management — `fittrack.py`

**All service lifecycle goes through [`fittrack.py`](../fittrack.py)** (wraps Docker Compose). Never run raw `docker compose up/down` unless `fittrack.py` can't do it.

```bash
python fittrack.py up --migrate     # Start all services + apply migrations (dev mode)
python fittrack.py --prod up        # Production mode (GHCR images, no dev command)
python fittrack.py down             # Stop all
python fittrack.py restart backend  # Restart one service
python fittrack.py restart worker beat  # REQUIRED after Celery task changes (no hot-reload)
python fittrack.py status           # Service status
python fittrack.py logs backend --tail 30   # Tail logs
python fittrack.py build            # Rebuild images (needed after new pip deps)
python fittrack.py migrate          # Apply Alembic migrations
python fittrack.py reset            # Full teardown + rebuild + restart (DB preserved)
python fittrack.py patch-cert       # Fix SSL cert errors (regen Caddy CA + install)
```

### Executing commands inside containers

⚠️ **`docker compose exec` does NOT work in this setup** (Pitfall #3). Use:

```bash
python fittrack.py exec <service> <command>
# e.g.
python fittrack.py exec backend pytest backend/tests/ -v --tb=short
python fittrack.py exec backend python -c "from app.main import app; print('OK')"
python fittrack.py exec backend alembic current
```

### Hot reload behaviour

| Component | Hot reload? | After changes |
|-----------|-------------|---------------|
| Backend (uvicorn) | Yes (`--reload`) | Nothing |
| Frontend (next dev) | Yes | Nothing |
| Celery worker/beat | **No** | `python fittrack.py restart worker beat` |
| New pip/npm dependency | — | `python fittrack.py build` then restart |

## Running Tests

### Backend (pytest)

Run inside the backend container (has all deps + DB access):

```bash
# Full suite
python fittrack.py exec backend pytest backend/tests/ -v --tb=short

# Unit tests only (fast, no integration marker)
python fittrack.py exec backend pytest backend/tests/ -m "not integration"

# Quick CI subset
python fittrack.py exec backend pytest backend/tests/ -m smoke
```

Markers (defined in [`backend/pyproject.toml`](../backend/pyproject.toml)):
- `integration` — requires real PostgreSQL; the integration conftest creates its own test database (override via `TEST_DATABASE_URL` env var). Transactional rollback per test.
- `cheap` / `expensive` / `smoke` — speed tiers for filtering.

⚠️ Dev compose mounts only `backend/app` + `backend/alembic` — `tests/` is baked into the image, so container runs use stale tests after edits (see AGENTS.md pitfall #19). Run from the host instead:
`TEST_DATABASE_URL="postgresql+asyncpg://fittrack:fittrack_dev@localhost:5432/fittrack_test" python -m pytest backend/tests/ -q`

pytest config: `asyncio_mode = "auto"` — async test functions need no decorator.

Or use the OpenCode command: `/test` runs both suites.

### Frontend (vitest + Playwright)

Run from the host in `frontend/` (node_modules installed locally):

```bash
npm run test              # vitest run (single pass)
npm run test:watch        # vitest watch
npm run test:coverage     # coverage report
npm run test:e2e          # Playwright E2E
```

Note: `cd frontend && npm run test` works in bash, but in the OpenCode bash tool each command starts from the project root — use the `workdir` parameter instead.

## Lint, Format & Typecheck

```bash
# Backend (ruff)
ruff check backend/ --fix
ruff format backend/

# Frontend
cd frontend
npm run lint              # next lint
npx tsc --noEmit          # typecheck
```

OpenCode auto-formats `.py` files with ruff on save (configured in `opencode.json`). `/lint` runs both ruff steps.

## Database Migrations

⚠️ Chain is sequential from `"001"`; `014_add_composite_indexes.py` is a **stale duplicate** — real chain is 013→014(surface)→015(indexes)→...→047.

```bash
# Generate
python fittrack.py exec backend alembic revision --autogenerate -m "description"
# Review the generated file, then apply
python fittrack.py migrate
# Verify
python fittrack.py exec backend alembic current

# ALWAYS verify before committing:
python fittrack.py exec backend alembic downgrade <prev>
python fittrack.py exec backend alembic upgrade head
```

## Verification Workflow

1. Make **one small change**, verify, then continue (don't batch).
2. After sync/service/Celery changes: check logs — `python fittrack.py logs backend --tail 30`.
3. Before finishing any code change: run relevant tests + `ruff check` (backend) or `tsc --noEmit` (frontend).

## OpenCode Permissions

Pre-approved bash patterns (in `opencode.json` → `permission.bash`): `python fittrack.py *`, `docker compose *`, `npm *`, `npx *`, `pip *`, `pytest *`, `alembic *`, `ruff *`, `uvicorn *`, `git *`. Everything else prompts. Add patterns with `/allow <pattern>`.

> **Note**: `./start.sh` (Linux/macOS/WSL) and `.\start.ps1` (Windows PowerShell) are thin wrappers around `python fittrack.py` — use either interchangeably. DEPLOY.md references the shell scripts; AGENTS.md and this file use `python fittrack.py` directly.

Specialized agents (`@backend`, `@frontend`, `@debugger`, `@sync-engineer`) already allow `python fittrack.py exec backend *`.

## Git Discipline

- Only stage/commit files modified in the current session.
- If the git index changes unexpectedly mid-operation, another session may be using git → stop immediately.
- All changes via feature branches + PRs. `prod` branch auto-deploys; never commit directly to it. No code changes on the production Droplet.
