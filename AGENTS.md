# FitTrack — Agent Context Guide

> **Rule**: Update this file when changing the codebase. Keep additions concise; prefer CODEMAP files for detail. Move feature status to `plans/*.md`.

## Context Routing

Read only the sections relevant to your task:

| Task Type | Read Sections |
|-----------|--------------|
| Backend API/service | Architecture, Conventions>Backend, Database, Critical Pitfalls |
| Frontend component/page | Architecture, Conventions>Frontend, Critical Pitfalls |
| Integration/sync | Architecture, Key Algorithms, Conventions>Backend, Critical Pitfalls |
| Database/model | Database, Conventions>Backend, Critical Pitfalls |
| Debugging | Critical Pitfalls, Development Lessons, Agent Efficiency Rules |
| Production issues (SSH) | Critical Pitfalls, Agent Efficiency Rules (use `@production` agent) |
| New feature planning | Overview, Architecture, `plans/*.md` |
| Running any command/tests | @running (`docs/RUNNING.md`) |
| OpenCode TUI/config | @opencode (`docs/OPENCODE.md`) |
| Historical bug reference | `docs/BUGS.md` (active bugs only; fixed bugs archived in `docs/BUGS-archive.md`) |

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

## Subagent Delegation Rules

Delegate to specialized agents when the task clearly fits their domain:

| When to Delegate | Agent | Example Prompt |
|-----------------|-------|----------------|
| Backend API/service changes | `@backend` | "Add a new endpoint for X following the pattern in @backend/app/api/activities.py" |
| Frontend component/page changes | `@frontend` | "Create a new settings page following the pattern in @frontend/src/app/(app)/settings/" |
| Debugging errors/logs | `@debugger` | "The Strava sync is failing with 401 — investigate token refresh in @backend/app/integrations/strava_client.py" |
| OAuth/integration/sync issues | `@sync-engineer` | "Whoop token refresh is broken — check @backend/app/services/whoop.py and @backend/app/integrations/whoop_client.py" |
| Production issues (SSH) | `@production` | "Users reporting 500 errors — check backend logs on the Droplet and verify DB connectivity" |
| Q&A / code explanation | `@ask` | "Explain the token refresh flow in @backend/app/services/connection_health.py" |
| Adding a new AI analysis endpoint | `@add-ai-analysis` | "Add a Gemini-powered analysis endpoint for cycling power distribution" |
| Adding a new chart | `@add-chart` | "Add a VO2max trend chart to the cycling page" |
| Adding a new integration | `@add-integration` | "Add a Garmin Connect OAuth integration" |

**When NOT to delegate**: Quick single-file edits, AGENTS.md updates, config changes, or tasks under 3 tool calls. Just do it directly.

**Delegation pattern**: Always include the specific files/paths to investigate in the prompt.

## Overview

FitTrack: personal fitness tracker for **powerlifting + cycling**. Aggregates Strava, Komoot, Wahoo, Whoop into a dashboard with trends, correlations, routes, health alerts, training plans, goals, and events.

**Stack**: Python 3.12/FastAPI/SQLAlchemy 2.0 (async) · Next.js 14/React 18/TypeScript/Tailwind/Recharts · PostgreSQL 16 · Redis 7 · Celery + Beat · NextAuth.js · Docker Compose + Caddy · Prometheus · ReportLab (PDF)

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
2. **Backend**: JWT via [`create_access_token()`](backend/app/services/auth.py:24) (7-day HS256). [`get_current_user`](backend/app/services/auth.py) decodes `Authorization: Bearer <token>`
3. **Fitness integrations**: Separate OAuth flows → [`/api/v1/auth/oauth/{provider}/authorize`](backend/app/api/auth.py:115) → tokens stored in [`OAuthConnection`](backend/app/models/user.py:88)

## Key Algorithms & Thresholds

See [`docs/algorithms.md`](docs/algorithms.md) for scoring algorithms, TSS/CTL/ATL formulas, chart system, and specialised algorithms (VO2max, decoupling, workout planner, encryption, FFT, lifting TSS). Full Celery task list in [`backend/app/tasks/scheduler.py`](backend/app/tasks/scheduler.py).

## Database (45 tables, UUID PKs)

| Parent | Children | Link |
|--------|----------|------|
| `User` | `OAuthConnection`, `Activity`, `LiftingSession`, `DailyMetric`, `SleepLog`, `PersonalRecord`, `HealthAlert`, `WarmupTemplate`, `Route`, `FtpHistory`, `WeightLog`, `Goal`, `TrainingPlan`, `Event`, `LlmAnalysis`, `Exercise`, `Notification`, `LiftVideo`, `LiftVideoAnalysis`, `RpeCalibration`, `RideFuelPlan`, `CrossDomainInsight`, `PushSubscription`, `AthleteInsight` | has many |
| `User` | `CyclingProfile` | has one |
| `Activity` | `ActivitySource`, `ActivityStream` | has many |
| `Activity` | `LiftingSession`, `Route` | optionally linked |
| `LiftingSession` | `LiftingSet` | has many |
| `Route` | `RouteSource`, `RouteTag` (via `RouteTagging`), `Segment`, `RouteQuality` | has many / one |
| `RouteCollection` | `RouteCollectionItem` | has many (manual + smart JSON rules) |
| `WarmupTemplate` | `WarmupTemplateStep` | has many |
| `TrainingPlan` | `TrainingPlanDay` | has many |
| `Goal` | `GoalCheckIn` | has many |
| `User` | `StravaWebhookEvent` | has many (async webhook queue) |

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
- **PWA**: `manifest.ts` + `public/sw.js` + `PwaRegister.tsx`. Runtime caching (no build-time precache). SW registers in production only. **API calls must be network-only** (not cached).
- **Error boundary**: [`ErrorBoundary`](frontend/src/components/ui/ErrorBoundary.tsx) wraps all app pages

## Critical Pitfalls

1. **Celery tasks must use `asyncio.run()`** with a fresh DB session via `task_session()` — workers are synchronous
2. **NextAuth `jwt` callback token sync timing**: Calls `POST /api/v1/auth/sync-user` with a backoff (`SYNC_RETRY_BACKOFF_S = 3600s`). If sync fails, `token.backendToken` stays stale → every API call 401s until the next retry window (up to 1 hour). The `signIn` callback only checks the email allowlist — it does NOT call sync-user.
3. **`docker compose exec` doesn't work**: Use `python fittrack.py exec backend <command>`
4. **Frontend `API_BASE_URL` must be `''`**: Client fetches use relative URLs. **Never** set `NEXT_PUBLIC_API_URL` to a full URL
5. **OAuth `redirect_uri` must match exactly**: Backend must use same URL via `settings.public_url`. ⚠️ NextAuth v4 builds redirect_uri as `<NEXTAUTH_URL>/callback/<provider>` — `NEXTAUTH_URL` MUST include `/api/auth` (e.g. `https://oliradlett.co.uk/fittrack/api/auth`), otherwise Google returns `redirect_uri_mismatch`
6. **Alembic numbering**: Revisions are sequential `"001"`→head. Filenames don't always match revisions — `003_add_pr_notes.py` carries `revision = "004"`. Trust `revision`/`down_revision` headers, not filenames
7. **EncryptedString**: OAuth tokens are encrypted in DB. `decrypt_token()` falls back to raw value for non-Fernet ciphertext (pre-migration rows)
8. **Token refresh commits immediately**: `refresh_connection()` commits rotated tokens/health state on its own so a later per-user rollback can't discard them. It also `SELECT … FOR UPDATE`s the row — don't "optimise" that away
9. **Webhook POSTs are queued, not processed**: `POST /webhooks/strava` only HMAC-verifies (empty secret → 503) and persists to `strava_webhook_events`; the `process_strava_webhook_events` Celery task drains the queue. Add new event handling in `app/services/strava/webhook_queue.py`, not inline
10. **ServiceWorker must not cache API responses**: Use `event.respondWith(fetch(request))` network-only for `/api/v1/` paths. Always return a `Response` object in `.catch()` — never `undefined`. Bump `CACHE_NAME` to force SW update on fixes
11. **React Query `enabled: !!token` required for auth queries**: Without this, queries fire before `session.backendToken` is ready, causing 401s that SWs swallow
12. **Remove IntersectionObserver for essential queries**: Lazy-loading via `enabled: visibleSections.has('powerCurve')` causes intermittent data not loading. Core power data, daily TSS, and weight trends should load eagerly
13. **FastAPI route ordering**: Register static single-segment routes (`/tags`, `/collections`, `/quality`, `/duplicates`, `/orphans`) **before** any `/{param}` dynamic route in the same router, else `422`. ⚠️ "Before" means above the *earliest* dynamic handler, wherever it sits — not grouped with the other static routes at the bottom of the file. In `api/routes.py`, `PATCH /{route_id}` lives mid-file at line 831, so `/orphans` was first added beside `/duplicates` near the end (following the file's own comment) and was shadowed by it: the endpoint existed, the docs said it was ordered correctly, and the request 422'd. A test that asserts the *index* of `/orphans` in the decorator order catches this; one that asserts the handler is defined catches nothing
14. **New models must be registered in `app/models/__init__.py`**: A model class not imported into `__init__.py` is invisible to `Base.metadata.create_all()` → `UndefinedTableError` at runtime. Add to both the import **and** `__all__`
15. **Modals must portal to `document.body`**: `Modal` sets `<main inert>` while open — rendering a dialog inside `<main>` makes it inert too (clicks/inputs dead). Always `createPortal(dialog, document.body)`
16. **Modal remote workers must import only stdlib at module scope**: Each compute integration decorates a module-global worker; Modal imports the whole module in a bare image. An `app.config` import at module scope drags in `pydantic_settings` (not installed) → crash-loop. Keep app/config imports inside functions (`_modal_configured`). Guarded by `tests/test_modal_workers.py::test_worker_modules_import_without_config_or_pydantic`
17. **Modal module mounting**: Every module a Modal function imports must be mounted into its image via `_get_modal_image` `add_local_file`s in `modal_client.py`
18. **`extract_pose_track` lists are index-aligned**: `world` is `None`-padded to match `landmarks`/`timestamps`. Never use `if world:` — guard on `any(w is not None for w in world)`
19. **Bilateral weights are per-arm, always**: Dumbbell/dual-handle-cable moves log ONE implement (`PER_ARM_EXERCISES` + `weight_convention()` in `exercise_db.py`, migration 072). New bilateral exercises go in the set, not ad-hoc halving
20. **Caddy routing**: [`Caddyfile`](infra/Caddyfile) routes `/fittrack*` → frontend (with `/api/auth*` redirected to `/fittrack` for NextAuth basePath), `/api/v1/*` → backend, `/health` → backend
21. **Purge migrations must use provenance, not a mutable field**: Migration 085 deleted legacy Wahoo rows by filtering on `activities.source = 'wahoo'`, but rows that had already been merged with Strava had `source` flipped to `'strava'` — so 28 mislabelled rows survived. Filter on `EXISTS (FROM activity_sources WHERE provider = 'wahoo')` instead — migration 087 does exactly that, fixing the 28 survivors forward (085 is already applied to `prod`, so editing it would be a no-op). Migration 087 also added `sport_type` to `_MERGE_FIELDS` so a higher-priority provider (Strava) correcting a lower-priority one (Wahoo) happens at sync time, not just in a one-off migration.
22. **Dialect types need the dialect import**: `sa.JSONB()` does not exist — `JSONB` lives in `sqlalchemy.dialects.postgresql`, so write `from sqlalchemy.dialects import postgresql` and use `postgresql.JSONB()`. Migration 087 shipped with `sa.JSONB()`, which raised `AttributeError` under `alembic upgrade head`; because alembic uses **transactional DDL**, that reverted the *entire* migration and left `prod` at revision 086 while the code shipped as 087 — code declaring `activities.road_match*` columns that did not exist, and a Celery task filtering on them. `sa.UUID()`, `sa.JSON()`, `sa.Text()` are fine at top level (SQLAlchemy 2.0 exports those). Guarded by `tests/test_migration_dialect_types.py`, which AST-walks the whole chain — a `downgrade`/`upgrade` round-trip cannot catch this, because it only re-exercises migrations already applied everywhere. **A failed Deploy run means a half-applied release**: read the run, don't assume the merge deployed.
23. **Backend tests run host-side, not via `exec`**: the `backend` service has no volume mount (code is baked into the image), so `python fittrack.py exec backend pytest` tests the *image* and silently cannot see test files you just wrote — it reports `file or directory not found`. Run `python -m pytest tests/ -q` from `backend/` on the host, with CI's env vars set (`SECRET_KEY`, `DEBUG=true`, `DATABASE_URL`, `TEST_DATABASE_URL`, `REDIS_URL`; see `.github/workflows/test.yml`). A worktree needs `.env` copied in, since it is gitignored.
24. **A migration can be stamped without ever having run**: a table built by `create_all()` before the migration existed gets stamped by a later `alembic upgrade`, and the migration believes it created a table it did not. `lift_video_analyses` had exactly this shape — model expected `video_count`, production had `sample_count`, and 053's unique index was absent (that missing index is the tell). The resulting `UndefinedColumnError` **aborts its transaction**, so the follow-on query fails with `current transaction is aborted` and names the *wrong table* — always read further up the log for the real cause. Fixed by migration 090, whose test cross-checks the migration against the model so the two cannot drift again. **Edit nothing that is already applied**; add a forward migration.
25. **Compare directions before asserting symmetry in a geometry gate**: §4's detour test is *one-directional* (ride vs course). Run symmetrically it asks how far the course strays from the ride, so a 6.7 km lap of a 20 km course measured 13.3 km of false divergence and was rejected. When a gate compares two things that are not interchangeable, decide which is the reference and assert that direction in a test.
26. **`ALLOWED_SPORT_TYPES` is an allowlist, and empty means allow-all**: ingestion is gated in `app/services/sport_filter.py`, consulted *before* duplicate detection at every provider (a blocked sport merged onto a live activity would rewrite its `sport_type` and undo the purge). Blank must degrade open — otherwise a typo silently stops all syncing, and the symptom (an empty dashboard) gives no hint that config is at fault.
27. **Neither workflow has `workflow_dispatch`**: a `prod` push that registers no CI run cannot be retried cleanly, and the only lever is a no-op commit. Add `workflow_dispatch` to `test.yml` and `deploy.yml` — it happened once during the quarantine release and cost a stray empty commit on `prod`.

## Development Lessons

1. **Test after each change**: Restart backend, hit endpoint. Don't batch changes then debug
2. **Verify migrations**: `alembic downgrade <prev>` + `alembic upgrade head` before committing
3. **Check logs after sync/service changes**: `python fittrack.py logs backend --tail 30`
4. **Quick backend checks**: `python fittrack.py exec backend python -c "from app.models.activity import Activity; print(Activity.__table__.columns.keys())"`
5. **OAuth callbacks need `user_id`**: Callback runs server-side without session — look up user explicitly via JWT state parameter
6. **Stash other sessions' files before branch switches**: `git stash push <specific_files>` (not `git stash -u`)

## Active Planning

Feature plans live in [`plans/`](plans/). Current priority order: [`plans/backlog-2026-09-20.md`](plans/backlog-2026-09-20.md) (Phases 0–5 built; remaining items tracked there). Detailed spec plans: [`plans/lift-video-tracking-v2.md`](plans/lift-video-tracking-v2.md), [`plans/relive-3d-redesign.md`](plans/relive-3d-redesign.md), [`plans/route-matching-phase2.md`](plans/route-matching-phase2.md), [`plans/route-laps-and-variants.md`](plans/route-laps-and-variants.md), [`plans/jev-implementation-plan-2026-09-27.md`](plans/jev-implementation-plan-2026-09-27.md), [`plans/wahoo-planned-workout-push.md`](plans/wahoo-planned-workout-push.md), [`plans/underdeveloped-features-2026-09-27.md`](plans/underdeveloped-features-2026-09-27.md), [`plans/training-aid-review.md`](plans/training-aid-review.md).

## Git & Deployment Strategy

**Model**: `main` is the trunk, `prod` deploys. All features/fixes land on `main`; `prod` auto-deploys via GitHub Actions. `main` is merged into `prod` **only** to ship a release.

1. **Feature branches PR into `main`**, never directly into `prod`.
2. **Deploy = merge `main` into `prod` and push.** Triggers CI → Deploy workflow → GHCR images → Droplet.
3. **Keep `main` and `prod` content-identical** between releases.
4. **Before pushing a release**: `git log --oneline origin/main..origin/prod` + `git diff --stat origin/main origin/prod`.
5. **`prod` is a release branch, not a working branch.** Commit locally, PR into `main`, then merge `main` → `prod` to ship.
6. After deploying: `git checkout main && git pull origin main`.
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

Backend hot-reload: `uvicorn --reload`. Frontend hot-reload: `npm run dev`. Celery: no hot-reload, restart manually.

**Alternative entrypoints**: `./start.sh` (Linux/macOS/WSL) and `.\start.ps1` (Windows PowerShell) are thin wrappers. See [`docs/DEPLOY.md`](docs/DEPLOY.md).

## OpenCode TUI Tips

- **Paste on Windows**: `Ctrl+V` works — bound to Windows Terminal's paste action.
- **Multiline input**: Use `Shift+Enter` (requires Windows Terminal config).
- **File references**: Use `@filename` to include file context in prompts.
- **Quick commands**: Use `!command` to run shell commands and include output.
- **Plan mode**: Press `Tab` to switch to Plan mode for analysis without changes.
- **Subagent delegation**: Use `@backend`, `@frontend`, `@debugger`, `@sync-engineer`, `@production`, or `@ask`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
