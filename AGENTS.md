# FitTrack — Agent Context Guide

> **Rule**: Update this file when changing the codebase, but keep it **lean** —
> DSH injects it into every session. Detail belongs in the linked docs and
> CODEMAP files; feature status belongs in [`plans/README.md`](plans/README.md).
> Budget: **24 KB**, guarded by `backend/tests/test_agent_docs.py`.

## How to use this file

DSH loads this file automatically at session start. Everything else is loaded
on demand:

- **Skills** — project skills live in `.dsh/skills/` and appear in the session
  skill catalog. Load one with the `skill` tool when its description matches;
  don't load them speculatively.
- **Docs** — read only what the routing table points at.
- **Tooling** — how DSH is wired for this repo (tools, subagents, plugins,
  approvals): [`docs/DSH.md`](docs/DSH.md).

## Context Routing

| Task Type | Read |
|-----------|------|
| Backend API/service | Architecture, Conventions>Backend, Database, [`docs/PITFALLS.md`](docs/PITFALLS.md) |
| Frontend component/page | Architecture, Conventions>Frontend, [`docs/PITFALLS.md`](docs/PITFALLS.md) |
| Integration/sync | Architecture, Key Algorithms, Conventions>Backend, [`docs/PITFALLS.md`](docs/PITFALLS.md) |
| Database/model | Database, Conventions>Backend, [`docs/PITFALLS.md`](docs/PITFALLS.md) |
| Debugging | [`docs/PITFALLS.md`](docs/PITFALLS.md), Development Lessons, Agent Efficiency Rules |
| Production issues (SSH) | [`docs/PITFALLS.md`](docs/PITFALLS.md), `ssh-production-debugger` skill |
| Android app | [`docs/ANDROID.md`](docs/ANDROID.md), [`plans/android-lifting-parity.md`](plans/android-lifting-parity.md) |
| New feature planning | Overview, Architecture, [`plans/README.md`](plans/README.md) |
| Running commands/tests | [`docs/RUNNING.md`](docs/RUNNING.md) |
| Agent tooling / DSH | [`docs/DSH.md`](docs/DSH.md) |
| Historical bug reference | [`docs/BUGS.md`](docs/BUGS.md) (active bugs only; fixed bugs archived in `docs/BUGS-archive.md`) |
| Deployment | [`docs/DEPLOY.md`](docs/DEPLOY.md) |

## Agent Efficiency Rules

1. **Only commit files from this session**: Do not commit files worked on by another session. Let each session commit its own files when ready. `git add` only the files you modified.
2. **Stand down if another session is using git**: If the git index changes unexpectedly between your commands (files you didn't stage appear staged, your staged files disappear, or staging doesn't match what you just ran), another session is concurrently manipulating git. **Stop all git operations immediately**, tell the user, and retry only after they confirm the other session is done. Never fight over the index.
3. **Stop after 2 failed attempts**: If the same fix fails twice, describe what you tried, what error you saw, and what you're unsure about. Ask the user.
4. **Don't read files speculatively**: Only read files needed for the current task. Use CODEMAP files for orientation.
5. **One question, not a loop**: If unsure about user intent, ask once. Don't assume then debug your assumption.
6. **Check AGENTS.md first**: Before reading multiple files, check if this file already answers your question.
7. **Prefer small changes**: Make one change, verify it works, then proceed. Don't batch changes and debug.
8. **No code changes on production**: Never make code changes directly on the production server or on the production branch (`prod` — only this branch auto-deploys; `main` does not). All changes go through feature branches and PRs; hotfixes are made locally and deployed via the normal pipeline.
9. **Keep documentation up to date**: When changing the codebase, update the relevant docs in the same change — `AGENTS.md`, CODEMAP files, `docs/*.md`, and `plans/`. Stale docs mislead future sessions.
10. **No bulk scripted rewrites**: Never apply a single scripted find/replace across many source files. One subtle bug in such a script (e.g. a nested-array flattening that silently turned a token swap into a global `t`→`e` replace) corrupts every file at once, invisibly. Use the Edit tool per-file (`replaceAll` is fine). If a bulk change is genuinely unavoidable, do it in small batches (≤5 files) with a `git diff --stat` + spot-read between batches.
11. **Check file ownership before touching files**: Before editing a file, run `git status`. A file with uncommitted changes is owned by another session — do not rewrite it in place without coordinating. This extends rule #1 from the index to file *contents*.
12. **Rollback safety net**: Only run high-blast-radius operations (bulk edits, scripted rewrites, content migrations) on files with a clean working tree, so `git checkout -- <file>` is a working rollback. A file with uncommitted changes has no git rollback path — treat it with extra care or don't touch it.
13. **No shell-based in-place edits to source files**: Never use PowerShell/Shell (`Set-Content`, `[IO.File]::WriteAllText`, `-replace`, `sed`) to mutate source files in place. The Edit tool preserves encoding and line-endings and makes each change visible. Scripted text mutation is only for temp/generated artifacts.
14. **Verify before destructive writes**: After any multi-file change, review `git diff --stat` and spot-read at least 2 changed files *before* running typecheck/lint. Never let the first verification come after all writes are complete.

## Delegation in DSH

DSH has no `@agent` syntax. Delegate with the `subagent` tool; a child starts
with a fresh context, so the prompt must be self-contained.

- **When**: self-contained work that would otherwise flood this session — a
  scoped implementation, a multi-file investigation, a review, a migration
  audit. Not for a single-file edit or anything under ~3 tool calls.
- **Prompt**: repo path, task, files to read first, constraints (these rules, no
  commits, don't touch another session's files), and the exact deliverable.
- **Fork**: `subagent_fork` when the child needs this conversation's context.
- **Parallel**: put independent delegations in one message.
- **Fan-out**: the `workflow` tool only for many independent pieces.
- **Personas**: the old OpenCode agent prompts remain as prompt material in
  `.opencode/agents/*.md`; they are not callable agents in DSH.

## Overview

FitTrack: personal fitness tracker for **powerlifting + cycling**. Aggregates Strava, Komoot, Wahoo, Whoop into a dashboard with trends, correlations, routes, health alerts, training plans, goals, and events.

**Stack**: Python 3.12/FastAPI/SQLAlchemy 2.0 (async) · Next.js 14/React 18/TypeScript/Tailwind/Recharts · PostgreSQL 16 · Redis 7 · Celery + Beat · NextAuth.js · Docker Compose + Caddy · Prometheus · ReportLab (PDF) · Kotlin/Compose Android client

**Android** (`android/`): native Kotlin + Compose, v0.1 — the gym flow, not a web
port. Build with `gradle :app:assembleDebug` from `android/`; rules live in
`SessionEngine`; full feature map in [`docs/ANDROID.md`](docs/ANDROID.md).

## Architecture

**Three-layer backend** (`backend/app/`):
1. **API** (`api/`) — FastAPI route handlers, uses `get_db`/`get_current_user` DI
2. **Services** (`services/`) — Business logic, accept `(db: AsyncSession, user_id, ...)`
3. **Models** (`models/`) — SQLAlchemy 2.0 ORM with `Mapped` annotations, UUID PKs, inherit from `Base`

**Frontend** (`frontend/src/`): Next.js App Router, all pages `'use client'`, React Query, `useAuthFetch` hook for JWT-injected fetch. API client split by domain in `lib/api/` with barrel at `index.ts`. See [`api/CODEMAP.md`](frontend/src/lib/api/CODEMAP.md).

### CODEMAP Files

Quick reference maps in each package — use these for orientation before reading source:
- [`backend/app/api/CODEMAP.md`](backend/app/api/CODEMAP.md) — API routes and endpoints
- [`backend/app/models/CODEMAP.md`](backend/app/models/CODEMAP.md) — Models and relationships
- [`backend/app/schemas/CODEMAP.md`](backend/app/schemas/CODEMAP.md) — Pydantic schemas
- [`backend/app/services/CODEMAP.md`](backend/app/services/CODEMAP.md) — Service functions
- [`frontend/src/CODEMAP.md`](frontend/src/CODEMAP.md) — Pages, components, API clients, patterns
- [`frontend/src/lib/api/CODEMAP.md`](frontend/src/lib/api/CODEMAP.md) — API client modules + lifting utilities

### Authentication (two systems bridged)

1. **Frontend**: NextAuth.js (Google/GitHub OAuth) → `signIn` callback checks email allowlist → `jwt` callback calls `POST /api/v1/auth/sync-user` → gets JWT → stored as `token.backendToken` → `session()` callback copies to `session.backendToken`
2. **Backend**: JWT via [`create_access_token()`](backend/app/services/auth.py) (30-day HS256). [`get_current_user`](backend/app/services/auth.py) decodes `Authorization: Bearer <token>`
3. **Fitness integrations**: Separate OAuth flows → `/api/v1/auth/oauth/{provider}/authorize` ([`backend/app/api/auth.py`](backend/app/api/auth.py)) → tokens stored in `OAuthConnection` ([`backend/app/models/user.py`](backend/app/models/user.py))

## Key Algorithms & Thresholds

See [`docs/algorithms.md`](docs/algorithms.md) for scoring algorithms, TSS/CTL/ATL formulas, chart system, and specialised algorithms (VO2max, decoupling, workout planner, encryption, lifting TSS). Full Celery task list in [`backend/app/tasks/scheduler.py`](backend/app/tasks/scheduler.py).

## Database

**57 tables, UUID PKs**; every model must be registered in `app/models/__init__.py`
(import **and** `__all__` — pitfall 14). The authoritative model and relationship
map is [`backend/app/models/CODEMAP.md`](backend/app/models/CODEMAP.md). Core
shape:

- `User` → activities, lifting sessions, daily metrics, goals, plans, routes, events
- `Activity` → sources/streams; optionally one lifting session and one route
- `LiftingSession` → sets, ordered by `order_index` (pitfall 30)
- `Course` → routes → rides (`Activity.route_link_status` must be `confirmed`)
- `TrainingPlan` → days + stored blocks; `Goal` → check-ins

## Modal Intelligence Platform

Serverless containers handle compute-heavy features. Data flows in via JSON args, pure computation runs, results flow back. **No DB credentials in Modal containers** — all DB I/O happens in Celery tasks or API endpoints. See `docs/algorithms.md` for modal-specific algorithms. Config: `MODAL_TOKEN_ID` + `MODAL_TOKEN_SECRET` in `.env` (Modal endpoints return 501 when unset).

| Worker file | Purpose | Beat task |
|------------|---------|-----------|
| `route_intelligence.py` | Terrain classification + similarity graph | Saturday `classify_route_terrain` |
| `route_road_graph.py` | OSM road-graph map-matching (Phase 2) | Sunday `map_match_routes` |
| `power_models.py` | CP/W'/Pmax + personalized VO2max + adaptive CTL/ATL | Sunday `fit_personalized_power_models` |
| `weather_analysis.py` | Weather-performance correlation | Sunday `analyze_weather_performance_weekly` |
| `segment_intelligence.py` | Climb detection + DBSCAN clustering | Sunday `analyze_segments_intelligence_weekly` |
| `cross_domain.py` | Sleep-performance + cross-sport + race retrospective | Sunday `analyze_cross_domain_weekly` |

## Conventions

### Backend
- **Async everywhere**: `AsyncSession` + `await`. [`get_db`](backend/app/database.py) handles commit/rollback
- **UUID PKs**: `uuid.uuid4()` default on all models
- **Pydantic v2**: `model_config = {"from_attributes": True}`, convert via `.model_validate()`
- **No raw SQL**: Use SQLAlchemy `select()` constructs
- **Service signature**: `(db: AsyncSession, user_id: UUID, ...)` — services don't use FastAPI DI
- **Structured logging**: JSON in production, human-readable in debug. Correlation IDs via middleware.
- **Encryption**: [`EncryptedString`](backend/app/services/encryption.py) TypeDecorator for OAuth tokens
- **Celery tasks**: Use [`task_session()`](backend/app/database.py) for a fresh engine per invocation
- **Whoop API reference**: https://developer.whoop.com (not vendored locally)
- **Jev decision layer**: `TYPESAFE_API_KEY` enables TypeSafe Jev. See [`docs/JEV_TAGGING.md`](docs/JEV_TAGGING.md) + [`plans/jev-implementation-plan-2026-09-27.md`](plans/jev-implementation-plan-2026-09-27.md)
- **Rate limiting**: auth/`/sync-user` go through a Redis fixed-window limiter ([`check_rate_limit`](backend/app/services/cache.py), fail-open on Redis outage), keyed on the **real client IP** via [`get_client_ip`](backend/app/services/client_ip.py). `X-Forwarded-For` is honoured only when the immediate peer is a trusted proxy (`TRUSTED_PROXIES`, default loopback + private ranges) — the backend has no public port, so Caddy is always the peer.
- **Prometheus**: `/metrics` endpoint via prometheus-fastapi-instrumentator

### Frontend
- **Client-side rendering**: All pages `'use client'` with React Query
- **Query keys**: `['lifting-sessions']`, `['activities', filters]`, etc. — string arrays, domain-prefixed
- **Tailwind theme**: Dark mode, custom tokens: `background`, `surface`, `surface-light`, `accent`, `positive`, `warning`, `muted`. See [`tailwind.config.js`](frontend/tailwind.config.js)
- **Component structure**: `ui/`, `charts/`, `cycling/`, `lifting/`, `maps/`, `training/`, `routes/`, `goals/`, `dashboard/`, `health/`, `calendar/`, `activities/`, `settings/`, `sync/`
- **Modal component**: [`Modal`](frontend/src/components/ui/Modal.tsx) — bottom sheet on mobile (<sm), centered dialog on desktop (≥sm)
- **Review vs Act**: data-rich viz ("data porn") is welcome but gated away from action surfaces — tabs/zones/floating action layer, read-only viz components. See [`docs/review-vs-act.md`](docs/review-vs-act.md)
- **PWA**: `manifest.ts` + `public/sw.js` + `PwaRegister.tsx`. Runtime caching (no build-time precache). SW registers in production only. **API calls must be network-only** (not cached).
- **Error boundary**: [`ErrorBoundary`](frontend/src/components/ui/ErrorBoundary.tsx) wraps all app pages

## Critical Pitfalls — index

Full detail in [`docs/PITFALLS.md`](docs/PITFALLS.md). Numbering is stable; code,
plans and reviews cite "pitfall N". Read the full entry before changing the area
it names.

1. Celery tasks: `asyncio.run()` + `task_session()`.
2. NextAuth `jwt` sync failure leaves a stale `backendToken` (401s up to 1h).
3. `docker compose exec` doesn't work — use `python fittrack.py exec`.
4. Frontend `API_BASE_URL` must be `''`; never set `NEXT_PUBLIC_API_URL`.
5. OAuth `redirect_uri` must match `settings.public_url`; `NEXTAUTH_URL` includes `/api/auth`.
6. Alembic: trust `revision`/`down_revision`, not filenames.
7. `EncryptedString`: `decrypt_token()` falls back to raw pre-migration ciphertext.
8. Token refresh commits immediately and `SELECT … FOR UPDATE`s the row.
9. Webhook POSTs are queued; drain via `process_strava_webhook_events`.
10. ServiceWorker: API calls network-only; `.catch()` must return a `Response`.
11. React Query auth queries need `enabled: !!token`.
12. Don't IntersectionObserver-gate essential queries.
13. FastAPI: single-segment static routes precede `/{param}` — check the *earliest* dynamic handler.
14. Register new models in `app/models/__init__.py` (import + `__all__`).
15. Modals portal to `document.body` (`<main inert>`).
16. Modal workers: stdlib imports only at module scope.
17. Modal: mount every imported module in `_get_modal_image`.
18. `extract_pose_track` lists are index-aligned; guard on `any(w is not None ...)`.
19. Bilateral weights are per-arm; add to `PER_ARM_EXERCISES`.
20. Caddy routing: `/fittrack*`, `/api/v1/*`, `/health`.
21. Purge migrations filter on provenance (`activity_sources`), not mutable `source`.
22. Dialect types need the dialect import (`postgresql.JSONB()`); transactional DDL means a failed migration is a half-release.
23. Backend tests run host-side, not via `exec` (image is stale).
24. A migration can be stamped without running; edit nothing applied, add a forward migration.
25. Geometry gates: decide the reference direction before asserting symmetry.
26. `ALLOWED_SPORT_TYPES` empty = allow-all; blank must degrade open.
27. A `prod` push with no CI run can't be retried — keep `workflow_dispatch` on both workflows.
28. `None` → JSONB writes JSON `null`; use `none_as_null=True` where NULL is meaningful.
29. An "exclude from X" filter is load-bearing for every other X.
30. `now()` is the transaction timestamp; order with an explicit `order_index`.
31. Nullable dedup keys need a PARTIAL unique index.
32. Row-returning lookups that get enriched must eager-load.
33. Integration `db_session` is committed out from under itself; teardown drops the schema.
34. A migration revision number is not branch-local; check `origin/main` before renumbering.
35. Pitfall 13 is about colliding path shapes, not registration order generally.
36. Pure clustering keys and persisted keys have different stability requirements.
37. `SegmentEffort.is_pr` was read but never written — denormalised columns need a writer.
38. The pre-commit hook is ruff-only, not a test runner.
39. `asyncio.gather` on one `AsyncSession` is not a concurrency test.
40. A JSONB payload comes back JSON-native (UUID → str).
41. Order by `(created_at, id)`; it does not recover insertion order.
42. A composite verdict must report silent engines.
43. Composite responses degrade per component.

## Development Lessons

1. **Test after each change**: Restart backend, hit endpoint. Don't batch changes then debug
2. **Verify migrations**: `alembic downgrade <prev>` + `alembic upgrade head` before committing
3. **Check logs after sync/service changes**: `python fittrack.py logs backend --tail 30`
4. **Quick backend checks**: `python fittrack.py exec backend python -c "from app.models.activity import Activity; print(Activity.__table__.columns.keys())"`
5. **OAuth callbacks need `user_id`**: Callback runs server-side without session — look up user explicitly via JWT state parameter
6. **Stash other sessions' files before branch switches**: `git stash push <specific_files>` (not `git stash -u`)

## Active Planning

Active programmes and their status live in [`plans/README.md`](plans/README.md);
plan documents are snapshots of intent and the code is the truth. Start there
before feature work. Headline programmes: routes atlas + courses, the
data-integrity programme (Waves 0–4 landed), the training surface
(Week · Plan), Jev strength labels, and Wahoo zone sync.

## Git & Deployment Strategy

**Model**: `main` is the trunk, `prod` deploys. All features/fixes land on `main`; `prod` auto-deploys via GitHub Actions. `main` is merged into `prod` **only** to ship a release.

1. **Feature branches PR into `main`**, never directly into `prod`.
2. **Deploy = merge `main` into `prod` and push.** Triggers CI → Deploy workflow → GHCR images → Droplet.
3. **Keep `main` and `prod` content-identical** between releases.
4. **Before pushing a release**: `git log --oneline origin/main..origin/prod` + `git diff --stat origin/main origin/prod`.
5. **`prod` is a release branch, not a working branch.** Commit locally, PR into `main`, then merge `main` → `prod` to ship.
6. After deploying: `git checkout main && git pull origin main`. ⚠️ **Check the checkout succeeded before pulling** — this repo has several worktrees and any of them can already hold `main`, in which case `git checkout main` fails and the `git pull origin main` then merges `main` into whatever branch you were on. It happened silently once and left a stray merge commit on a feature branch. Either verify with `git branch --show-current`, or pull without switching: `git fetch origin && git log --oneline origin/main`.
7. **Local hooks**: `git config core.hooksPath .githooks` enables the committed `pre-commit` (ruff backend lint, fail-open without ruff) and `commit-msg` (conventional commits) hooks. CI remains the authority for typecheck/tests.

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

Backend hot-reload: `uvicorn --reload`. Frontend hot-reload: `npm run dev`. Celery: no hot-reload, restart manually. Full command reference: [`docs/RUNNING.md`](docs/RUNNING.md).

**Alternative entrypoints**: `./start.sh` (Linux/macOS/WSL) and `.\start.ps1` (Windows PowerShell) are thin wrappers. See [`docs/DEPLOY.md`](docs/DEPLOY.md).

## DSH tips

- **Skills**: project skills appear in the session skill catalog; load one with
  the `skill` tool when its description matches. Don't load them speculatively.
- **Subagents**: see Delegation above — `subagent` / `subagent_fork`, not `@`.
- **Deliverables**: `present` a file only when the user needs a separate
  artifact (Office docs, PDFs, images); otherwise answer inline.
- **Approvals**: if the profile runs with approvals disabled, a tool that would
  need approval is rejected — don't request escalation; follow the git rules.
- **Long work**: `todo_write` for multi-step tasks; `create_goal` only for a
  genuinely long-running objective that should survive turns.

## graphify

This project has a knowledge graph at `graphify-out/` with god nodes, community
structure, and cross-file relationships. Use the `graphify` skill for the full
pipeline.

Rules:
- For codebase questions, first run `graphify query "<question>"` when `graphify-out/graph.json` exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty `graphify-out/` files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If `graphify-out/wiki/index.md` exists, use it for broad navigation instead of raw source browsing.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
