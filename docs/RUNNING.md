# FitTrack — Running Commands, Tests & Environment

> **Purpose**: The canonical reference for HOW to execute commands in this project — which shell, how to run services, how to run tests, lint, migrations. Read this before running anything non-trivial.

## Host Environment

- **OS**: Windows 11 (`win32`)
- **Shell**: PowerShell 5.1 on the host; OpenCode is configured with `"shell": "pwsh"` in [`opencode.json`](../opencode.json)
- **No bash**: Do NOT use bash syntax. Specifically:
  - `&&` does not work → use `cmd1; if ($?) { cmd2 }`
  - No `grep`, `sed`, `awk`, `cat`, `ls -la` → use `Select-String`, `Get-Content`, `Get-ChildItem` or the OpenCode Grep/Read/Glob tools
  - Quote paths with spaces using double quotes
  - Env vars: `$env:VAR = "value"`, not `VAR=value cmd`

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

Note: `cd frontend && npm run test` doesn't work in PowerShell as chained — use the `workdir` parameter instead.

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

⚠️ Chain is sequential from `"001"`; `014_add_composite_indexes.py` is a **stale duplicate** — real chain is 013→014(surface)→015(indexes)→...→024.

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

Pre-approved bash patterns (in `opencode.json` → `permission.bash`): `python fittrack.py *`, `docker compose *`, `npm *`, `npx *`, `pip *`, `alembic *`, `ruff *`, `uvicorn *`, `git *`. Everything else prompts. Add patterns with `/allow <pattern>`.

Specialized agents (`@backend`, `@frontend`, `@debugger`, `@sync-engineer`) already allow `python fittrack.py exec backend *`.

## Git Discipline

- Only stage/commit files modified in the current session.
- If the git index changes unexpectedly mid-operation, another session may be using git → stop immediately.
- All changes via feature branches + PRs. `prod` branch auto-deploys; never commit directly to it. No code changes on the production Droplet.
