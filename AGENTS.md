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
| Production issues (SSH) | Critical Pitfalls, Agent Efficiency Rules (use `@production` agent) |
| New feature planning | Overview, Architecture, Planned/Incomplete |
| Running any command/tests | @running (docs/RUNNING.md) |
| OpenCode TUI/config | @opencode (docs/OPENCODE.md) |

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

**Frontend** (`frontend/src/`): Next.js App Router, all pages `'use client'`, React Query, `useAuthFetch` hook for JWT-injected fetch. See [`api/fetch.ts`](frontend/src/lib/api/fetch.ts:28). API client split by domain in `api/` with barrel at `api/index.ts`.

### CODEMAP Files

Quick reference maps in each package — use these for orientation before reading source:
- [`backend/app/api/CODEMAP.md`](backend/app/api/CODEMAP.md) — API routes and endpoints
- [`backend/app/models/CODEMAP.md`](backend/app/models/CODEMAP.md) — Models and relationships
- [`backend/app/schemas/CODEMAP.md`](backend/app/schemas/CODEMAP.md) — Pydantic schemas
- [`backend/app/services/CODEMAP.md`](backend/app/services/CODEMAP.md) — Service functions
- [`frontend/src/CODEMAP.md`](frontend/src/CODEMAP.md) — Pages, components, API clients, patterns

### Authentication (two systems bridged)

1. **Frontend**: NextAuth.js (Google/GitHub OAuth) → [`signIn` callback](frontend/src/lib/auth.ts:38) calls `POST /api/v1/auth/sync-user` → gets JWT → stored as `session.backendToken`
2. **Backend**: JWT via [`create_access_token()`](backend/app/services/auth.py:24) (7-day HS256). [`get_current_user`](backend/app/services/auth.py) decodes `Authorization: Bearer <token>`
3. **Fitness integrations**: Separate OAuth flows → [`/api/v1/auth/oauth/{provider}/authorize`](backend/app/api/auth.py:95) → tokens stored in [`OAuthConnection`](backend/app/models/user.py:30)

## Key Algorithms & Thresholds

See [`docs/algorithms.md`](docs/algorithms.md) for full details on scoring algorithms, TSS/CTL/ATL formulas, chart system, and specialised algorithms (VO2max, decoupling, workout planner, encryption).

## Database (29 tables, UUID PKs)

**Relationships (compact)**:

| Parent | Children | Link |
|--------|----------|------|
| `User` | `OAuthConnection`, `Activity`, `LiftingSession`, `DailyMetric`, `SleepLog`, `PersonalRecord`, `HealthAlert`, `WarmupTemplate`, `Route`, `FtpHistory`, `WeightLog`, `Goal`, `TrainingPlan`, `Event`, `LlmAnalysis`, `Exercise`, `Notification` | has many |
| `User` | `CyclingProfile` | has one |
| `Activity` | `ActivitySource`, `ActivityStream` | has many |
| `Activity` | `LiftingSession`, `Route` | optionally linked |
| `LiftingSession` | `LiftingSet` | has many |
| `Route` | `RouteSource` | has many |
| `WarmupTemplate` | `WarmupTemplateStep` | has many |
| `TrainingPlan` | `TrainingPlanDay` | has many |
| `Goal` | `GoalCheckIn` | has many |
| `User` | `RideFuelPlan` | has many |
| `User` | `CachedWeather` | has many |

## Celery Tasks

| Task | Schedule | Notes |
|------|----------|-------|
| `sync_all_strava_activities` | 30 min | Incremental via `last_synced_at` watermark (−24h overlap). Also syncs Wahoo, backfills route links |
| `sync_all_whoop_data` | 30 min | Incremental via watermark. Cycles, recovery, sleep, workouts, weight. Recovery second-pass bounded to incremental window (start → today) |
| `generate_health_alerts` | Daily 6AM UTC | HRV/sleep decline, respiratory rate elevation |
| `refresh_weather_forecasts` | Daily 5AM UTC | Open-Meteo forecast cache per user home location. Also tags recent activities with historical weather after Strava sync |
| `record_goal_checkins` | Weekly Mon 6AM UTC | Snapshots every active goal into `goal_checkins` (source auto, skips goals already checked in today). Also fires `goal_milestone` notifications on 50/75/100% crossings |
| `send_plan_reminders` | Daily 7AM UTC | Fires a `plan_reminder` notification per user when today's active plan has a non-rest session (dedup per date) |
| `cleanup_old_data` | Weekly Sun 3AM | Stream cleanup disabled — streams retained indefinitely |
| `sync_all_routes` | 2 hours | All providers with dedup. Komoot synced once (global creds), not per-user |
| `auto_estimate_ftp_weekly` | Weekly Sun 4AM | For users with `auto_estimate_ftp=True` |
| `backup_database` | Weekly Sun 2AM | pg_dump to BACKUP_DIR, cleanup >30 days |
| `weekly_llm_analysis` | Weekly Sun 5AM UTC | Gemini API analysis of cycling stats. Skips if `GEMINI_API_KEY` not set |
| `backfill_streams_for_all_activities` | Weekly Sat 3AM UTC | Backfills missing activity streams for all cycling activities |
| `process_strava_webhook_events` | 5 min | Drains the `strava_webhook_events` queue oldest-first, with attempts/error tracking and retry-then-fail |
| `reconcile_strava_activities` | Weekly Sun 4:30AM UTC | Heals drift (missed deletes/renames) against the Strava list within a bounded recent window |

All tasks use `asyncio.run()` with a fresh engine per invocation (`task_session()`) to avoid asyncpg cross-loop pool conflicts. Per-user failures are isolated via `await db.rollback()` in except blocks; successful users are committed immediately so watermarks survive mid-task crashes. The 4 sync tasks (`sync_all_strava_activities`, `sync_all_whoop_data`, `sync_all_routes`, `backfill_streams_*`) run under a task-level Redis lock (`_run_task_guarded`, fail-open on Redis outage) with Celery `expires` on their beat entries, and each per-user section acquires `sync:{user}:{provider}` so manual syncs and beat runs can't overlap.

## Connection Health (BUG-072)

`OAuthConnection` tracks `status` (`active`/`needs_reauth`), `consecutive_failures`, `last_error_at`, `last_error`, `last_refreshed_at`. Token refresh is centralized in `app/services/connection_health.py::refresh_connection()`: `SELECT … FOR UPDATE` row-lock, immediate commit of rotated tokens, typed error classification (`app/integrations/errors.py` — `PermanentAuthError` marks `needs_reauth`, `TransientSyncError` counts failures). Sync loops skip `needs_reauth` connections. The OAuth callback resets status to `active`. The UI surfaces this via Settings badges/reconnect + a global `SyncHealthBanner`.

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
- **Celery tasks**: Use [`task_session()`](backend/app/database.py) for a fresh engine per invocation — never import `async_session_factory` directly in tasks

### Frontend
- **Client-side rendering**: All pages `'use client'` with React Query
- **Query keys**: `['lifting-sessions']`, `['activities', filters]`, etc. — string arrays, domain-prefixed
- **Tailwind theme**: Dark mode, custom tokens: `background`, `surface`, `surface-light`, `accent`, `positive`, `warning`, `muted`. See [`tailwind.config.js`](frontend/tailwind.config.js)
- **Component structure**: `ui/`, `charts/`, `cycling/`, `lifting/`, `maps/`, `training/`
- **Responsive sidebar**: Mobile hamburger menu via SidebarProvider context
- **Responsive mobile**: Grids use `grid-cols-1 sm:grid-cols-N` pattern; `pt-16` clearance for fixed hamburger; calendar has mobile agenda view (`md:hidden`)
- **Modal component**: [`Modal`](frontend/src/components/ui/Modal.tsx) — bottom sheet on mobile (<sm), centered dialog on desktop (≥sm). Use instead of hand-rolling modals
- **PWA**: `manifest.ts` + `public/sw.js` + `PwaRegister.tsx`. Runtime caching (no build-time precache). SW registers in production only
- **Error boundary**: [`ErrorBoundary`](frontend/src/components/ui/ErrorBoundary.tsx) wraps all app pages
- **File uploads**: [`apiUpload`](frontend/src/lib/api/fetch.ts) for multipart/form-data (GPX, FIT imports)
- **Adding a new page**: Create `app/(app)/yourpage/page.tsx` (`'use client'`), add nav item in [`Sidebar.tsx`](frontend/src/components/Sidebar.tsx:8), add API client in `lib/api/`
- **Adding a new API client**: Create `lib/api/yourDomain.ts`, export functions using `useAuthFetch`, add barrel export in `lib/api/index.ts`
- **Auth flow**: [`signIn` callback](frontend/src/lib/auth.ts) syncs with backend in `jwt` callback → `token.backendToken` → `session.backendToken` → [`useAuthFetch`](frontend/src/lib/api/fetch.ts:84) injects Bearer header
- **Local dev OAuth**: browse `https://dev.oliradlett.co.uk/fittrack` (hosts file → 127.0.0.1). Backed by gitignored `infra/Caddyfile.local` + `docker-compose.override.yml` (local TLS via Caddy internal CA, root cert installed in Windows store). Strava suffix-matches its single callback domain so one app serves dev + prod. Start the stack via `python fittrack.py up` — a bare `docker compose up` omits `docker-compose.dev.yml`, producing a mount-less frontend that serves stale chunks

## Critical Pitfalls

1. **Celery tasks must use `asyncio.run()`** with a fresh DB session — workers are synchronous
2. **NextAuth signIn timing**: [`pendingBackendToken`](frontend/src/lib/auth.ts:9) is fragile module-level state
3. **`docker compose exec` doesn't work**: Use `docker compose run --rm <service>`
4. **Frontend `API_BASE_URL` must be `''`**: Client fetches use relative URLs. **Never** set `NEXT_PUBLIC_API_URL` to a full URL
5. **OAuth `redirect_uri` must match exactly**: Backend must use same URL via `settings.public_url`. ⚠️ NextAuth v4 builds redirect_uri as `<NEXTAUTH_URL>/callback/<provider>` — `NEXTAUTH_URL` MUST include `/api/auth` (e.g. `https://oliradlett.co.uk/fittrack/api/auth`), otherwise Google returns `redirect_uri_mismatch`
6. **Wahoo API returns dict-wrapped responses**: Always check `isinstance(response, dict)` and unwrap
7. **Caddy routing**: [`Caddyfile`](infra/Caddyfile) routes `/api/auth/*` → frontend, `/api/v1/*` → backend
8. **Alembic numbering**: Initial = `"001"`. Sequential numbering. ⚠️ `014_add_composite_indexes.py` is a stale duplicate — the real chain is 013→014(surface)→015(indexes)→016→017→018→019→020→021→022→023→024→…→038(head)
9. **EncryptedString**: OAuth tokens are encrypted in DB. `decrypt_token()` falls back to raw value for non-Fernet ciphertext (pre-migration rows)
10. **fitparse/reportlab**: New dependencies — rebuild backend container after adding
11. **`fittrack.py` dev mode only**: Uses `docker-compose.dev.yml` for hot-reload frontend. Use `--prod` flag for production overrides (GHCR images, no dev command)
12. **Caddyfile has no `tls internal`**: Caddy auto-detects localhost → self-signed, real domains → Let's Encrypt. Do NOT add `tls internal` — deploy workflow resets this file every push
13. **`GEMINI_API_KEY` optional**: The weekly LLM analysis task skips gracefully if the key is not set. On-demand analysis returns 400 if key is missing.
14. **`INTERNAL_API_SECRET` required**: Set in `.env` to protect `/sync-user` endpoint. Generate with `python -c "import secrets; print(secrets.token_hex(32))"`
15. **Frontend Dockerfile ENTRYPOINT**: `node:20-slim` has `docker-entrypoint.sh` that mangles exec-form CMD. The Dockerfile overrides with `ENTRYPOINT ["node", "server.js"]` + `CMD []`. Do NOT revert to `CMD ["node", "server.js"]` without the ENTRYPOINT override.
16. **`downloadRouteGpx()` uses relative URL**: Was using `NEXT_PUBLIC_API_URL` — fixed to use relative URL like other API clients. Verified at `frontend/src/lib/api/routes.ts:223`.
17. **Recharts `<Brush>` with category XAxis**: Always pass `ariaLabel`, explicit `startIndex`/`endIndex`, and `tickFormatter` to `<Brush>`. Without these, Recharts renders literal "undefined" labels and NaN geometry. See `Chart.tsx:renderBrush()`.
18. **Live-sync idempotency contract**: The live lift tracker relies on backend dedupe — `POST /sessions` collapses duplicates by `live_key`; `POST .../sets` returns the existing row for a repeated `(session_id, client_id)`. The frontend must always send these keys (`useLiveSession.ts`) and map real set ids from create responses (never fake "synced" markers — undo must delete remotely). Migration `034`.
19. **Dev compose mounts only `backend/app` + `backend/alembic`**: `tests/` is baked into the image, so `fittrack.py exec backend pytest tests/...` runs stale tests after editing them. Rebuild the image or run pytest from the host with `TEST_DATABASE_URL=postgresql+asyncpg://fittrack:fittrack_dev@localhost:5432/fittrack_test`.
20. **SSE backfill sessions own their commits**: The Strava/Whoop backfill endpoints create their session via `async_session_factory()` (never `get_db`), so anything only `flush()`ed is rolled back when the endpoint closes it. The generators must `await db.commit()` explicitly (Whoop per-chunk, Strava at the end) — see BUG-073/074.
21. **Token refresh commits immediately**: `refresh_connection()` commits rotated tokens/health state on its own so a later per-user rollback can't discard them. It also `SELECT … FOR UPDATE`s the row — don't "optimise" that away or strict-rotation providers (Wahoo) can invalidate the loser's refresh token.
22. **Webhook POSTs are queued, not processed**: `POST /webhooks/strava` only HMAC-verifies (empty secret → 503) and persists to `strava_webhook_events`; the `process_strava_webhook_events` Celery task drains the queue. Add new event handling in `app/services/strava/webhook_queue.py`, not inline in the API handler.
23. **ServiceWorker must not cache API responses**: The SW's `fetch` handler was caching API GETs and returning `undefined` when network failed (no cached entry), causing "non-Response value 'undefined'" errors. API calls are authenticated/user-specific. Fix: use `event.respondWith(fetch(request))` network-only for `/api/v1/` paths. Always return a `Response` object (e.g. `new Response(null, { status: 503 })`) in `.catch()` — never `undefined`. Bump `CACHE_NAME` to force SW update on deployed fixes.
24. **React Query `enabled: !!token` required for auth queries**: Queries that need a JWT will fire before `session.backendToken` is ready, causing 401s that SWs swallow into silent failures. Always add `enabled: !!token` to `useQuery` calls that pass a token to the API.
25. **Remove IntersectionObserver for essential queries**: Lazy-loading via `enabled: visibleSections.has('powerCurve')` causes intermittent data not loading (observer race conditions, scroll timing). Only use it for genuinely optional/expired data (VO2max, FTP history). Core power data, daily TSS, and weight trends should load eagerly.
26. **Schema field changes require 3-layer updates**: Adding a field to a Pydantic summary schema requires changes in: (1) the schema class `app/schemas/`, (2) the API endpoint's manual model construction in `app/api/`, and (3) the frontend type interface in `src/lib/api/types/`. If the endpoint uses `.model_validate()` no API change needed, but manual construction does.

## Development Lessons

1. **Test after each change**: Restart backend, hit endpoint. Don't batch changes then debug
2. **Verify migrations**: `alembic downgrade <prev>` + `alembic upgrade head` before committing
3. **Check logs after sync/service changes**: `python fittrack.py logs backend --tail 30`
4. **Quick backend checks**: `python fittrack.py exec backend python -c "from app.models.activity import Activity; print(Activity.__table__.columns.keys())"`
5. **OAuth callbacks need `user_id`**: Callback runs server-side without session — look up user explicitly via JWT state parameter
6. **Stash other sessions' files before branch switches**: Before `git checkout` to another branch, run `git status`. If another session's files are modified, `git stash push <specific_files` (not `git stash -u`) to preserve them. Never commit files you didn't modify in this session.

## Planned / Incomplete

- **Komoot client rework**: Basic Auth fallback, v007 API (Phase 7)
- **New integrations**: Garmin Connect, TrainingPeaks, Zwift, Apple Health — requires OAuth app registration
- **Pace Zones for Running**: Jack Daniels model — skipped (user only cycles)
- **Activities page overhaul**: Complete — Phase A (context endpoint + enriched cards + connections), Timeline tab, Patterns tab, reverse links done. Phase B (`?include_context=true` bulk list enrichment) deferred to after performance testing.
- **Background activity analysis**: Post-sync task to precompute activity context (zones, decoupling, load position) at sync time — future work
- **Routes redesign (Phase 8A complete)**: Tags, collections, quality scoring, effort estimation, weather for routes, smart collections. [Full plan](plans/routes-redesign.md). Phases 2-4: calendar planner integration, social popularity, full E2E tests.
- **Full E2E tests**: Playwright login flow, activity sync, lifting session creation, **routes page** (tagging, collection creation, GPX upload, effort estimate)
- **Frontend component tests**: Vitest + RTL infrastructure exists (`vitest.config.ts`, 4 test files in `src/__tests__/`). Expand coverage for charts, pages, API clients.
- See [`plans/archive/audit-changelog-2026-08-18.md`](plans/archive/audit-changelog-2026-08-18.md) for full debugging reference

## Git & Deployment Strategy

**Model: `main` is the trunk, `prod` deploys.** All features/fixes land on `main`; `prod` is the single branch that auto-deploys (GitHub Actions `Deploy` workflow, triggered when CI completes on `prod`). `main` is merged into `prod` **only** to ship a release.

**Rules (these prevent the history mess from Aug 2026):**

1. **Feature branches PR into `main`, never directly into `prod`.** `prod` only ever receives merges of `main`. Direct `feature → prod` merges (PRs #2/#4/#5) created diverging topologies that are painful to reconcile.
2. **Deploy = merge `main` into `prod` and push.** That single push triggers CI on `prod` → the `Deploy` workflow builds GHCR images and redeploys the Droplet. Do not merge directly to `prod` for anything other than a release.
3. **Keep `main` and `prod` content-identical between releases.** After a release, `main` and `prod` should have the same tree (`git diff origin/main origin/prod` empty). If they drift, reconcile before the next release — the drift compounds.
4. **Prefer squash or simple merge commits over long chains of interleaved merges.** Avoid merge commits that only re-merge already-merged content (e.g. `Merge sync-hardening into main` followed by `Merge main into prod` where both carry the same feature commits).
5. **Before pushing a release, check the delta**: `git log --oneline origin/main..origin/prod` and `git diff --stat origin/main origin/prod` — the diff should be exactly the intended release content, nothing else.
6. **CI (`test.yml`) runs on `push`/`pull_request` for `[main, prod]`.** If CI on a `prod` push is stuck `queued` (GitHub Actions runner availability), the deploy is blocked — do not try to force it; monitor `gh run watch <id>` or the Actions tab. (Aug 2026: runners queued 50+ min intermittently.)
7. **`prod` is a release branch, not a working branch.** Never commit directly to it. Commit locally, PR into `main`, then merge `main` → `prod` to ship.
8. **Fetch before pull/merge**: `git pull` fails when the working tree has uncommitted changes (yours or another session's). Before fetching or pulling, run `git status` and `git fetch origin` first. If another session's files appear as modified, stash only those files (`git stash push <file1> <file2>`) before rebasing/merging, then `git stash pop` afterwards. Never `git stash --include-untracked` blindly — untracked files may belong to a running task in another session.
9. **Always switch back to `main` after a deploy.** After merging `main` into `prod` and pushing, immediately `git checkout main && git pull origin main`. Staying on `prod` invites accidental commits to the release branch. The only legitimate reason to be on `prod` is during the brief merge+push window.

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

## OpenCode TUI Tips

- **Paste on Windows**: `Ctrl+V` works — bound explicitly to Windows Terminal's paste action (`{ "id": "Terminal.PasteFromClipboard", "keys": ["ctrl+v", "ctrl+shift+v"] }` in settings.json). WT's paste inserts clipboard text via bracketed paste, which opencode handles. Do NOT unbind ctrl+v — passing the raw key through to opencode does not work. Alternatively, use the OpenCode Desktop app.
- **Multiline input**: Use `Shift+Enter` (requires Windows Terminal config — already set up).
- **File references**: Use `@filename` to include file context in prompts.
- **Quick commands**: Use `!command` to run shell commands and include output.
- **Plan mode**: Press `Tab` to switch to Plan mode for analysis without changes.
- **Subagent delegation**: Use `@backend`, `@frontend`, `@debugger`, `@sync-engineer`, or `@production` in prompts to delegate to specialized agents.
