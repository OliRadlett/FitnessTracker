# FitTrack — Project Audit Report

> **Date**: 2026-08-29  
> **Scope**: Full codebase review — backend (Python/FastAPI), frontend (Next.js/TS), infrastructure, CI/CD, testing, security  
> **Method**: Static analysis via ruff (v0.16.5), `tsc --noEmit --noUnusedLocals --noUnusedParameters`, manual code review, test infrastructure audit  
> **Status**: In progress — findings ready for remediation planning

---

## Executive Summary

FitTrack is a mature, well-architected fitness tracker (~70k LOC across backend + frontend) with 186 backend API endpoints, 95 frontend components, 39 migrations, and 4 external integrations. The codebase has undergone significant hardening — most of the 85 documented bugs (BUG-001 through BUG-085) are fixed, including critical security, sync, and data-integrity issues.

**However**, key gaps remain in **linting configuration**, **test coverage** (especially frontend), **code quality enforcement**, and **dead-code accumulation**. The ruff configuration is permissive (only 63 import-sorting warnings on the default rule set; 1,449 issues across 27 rule categories when checked with a broader ruleset). The frontend has **zero ESLint configuration** and **no `tsc --noEmit` in CI**, allowing 75 unused variables/types to accumulate silently. A newly discovered bug — **broken GPX download** (auth token not sent) — is not yet documented in BUGS.md.

---

## 1. Codebase Statistics

| Metric | Backend | Frontend |
|--------|---------|----------|
| Lines of code | 40,263 (app/) | 29,914 (src/) |
| Source files | ~100 Python files | 166 TSX/TS files |
| Test lines | 8,896 | 379 (unit only) |
| API endpoints | 187 | — |
| Components | — | 95 |
| Pages | — | 13 (App Router) |
| Database models | 20 | — |
| Services | 46 | — |
| Schemas | 18 | — |
| Migrations | 39 | — |
| Tests | 36 files (14 unit + 22 integration) | 4 unit + 13 e2e |

### File size hotspots (>500 lines)

**Backend** (8 files over 500 lines):
| File | Lines | Concern |
|------|-------|---------|
| `app/services/llm_analysis.py` | 1,996 | 5 nearly-identical `except Exception: pass` blocks; massive repetition across cycling/activity/lifting/health/event analysis |
| `app/services/whoop.py` | 1,956 | Duplicate backfill logic noted in BUG-057; very long file |
| `app/services/charts.py` | 1,936 | 28 chart types in one service; 9 unused variables (F841) |
| `app/tasks/scheduler.py` | 1,586 | 14 Celery tasks; no `print()` (fixed from comprehensive audit) |
| `app/api/routes.py` | 1,217 | 20 explicit `db.commit()` calls; 35 total double-commit violations |
| `app/api/activities.py` | 1,211 | `list_activities` has 17 parameters (PLR0913) |
| `app/services/training_plan.py` | 1,200 | Plan builder + weekly view + conformity |
| `app/services/conformity.py` | 1,035 | Plan conformity logic |

**Frontend** (6 files over 500 lines):
| File | Lines | Concern |
|------|-------|---------|
| `components/training/PlanBuilder.tsx` | 1,471 | Massive form with 7-col day grid, drag-drop |
| `components/training/WeeklyView.tsx` | 1,038 | Complex weekly planning view |
| `app/(app)/activities/page.tsx` | 977 | Activity list + filters + stream comparison |
| `app/(app)/wiki/page.tsx` | 944 | Wiki with 10 sections |
| `app/(app)/lifting/page.tsx` | 916 | Sessions, PRs, progress charts |
| `components/dashboard/WeeklyTab.tsx` | 823 | Weekly dashboard (duplication noted in BUG-041) |

### Tool: `fittrack.py`
A 1,525-line custom CLI service manager (`python fittrack.py up/down/restart/logs/migrate/exec`). It uses **only the standard library** (no external deps). **Zero test coverage.** It is the primary interface for developers to start/stop services, run migrations, tail logs, and execute commands in containers. Its complexity and lack of tests make it a high-risk single point of failure for development workflow.

---

## 2. Code Quality

### 2.1 Ruff (Backend Linting)

The project's `pyproject.toml` configures ruff with **only `target-version` and an ignore list** — no explicit `select`. Ruff's default rules (E, F, pyflakes) are used. With the project's config, **only 63 I001 (import-sorting) warnings** are reported — the codebase is clean under its own configuration.

However, enabling a broader rule set reveals significant debt:

| Rule | Count | Severity | Notes |
|------|-------|----------|-------|
| B008 | 371 | Intentional | FastAPI `Query()`/`Depends()` in default args — explicitly ignored in config |
| PLR2004 | 360 | Medium | Magic value comparisons (hardcoded numbers in conditions) |
| E501 | 320 | Low | Line too long (>88 chars) |
| C901 | 66 | High | Cyclomatic complexity > 10 |
| B904 | 63 | High | `raise` without `from` inside `except` — loses traceback context |
| PLR0912 | 48 | High | Too many branches (>12) |
| PLR0915 | 46 | High | Too many statements (>50) |
| PLR0913 | 28 | High | Too many arguments (>5) |
| RET505 | 25 | Medium | Superfluous `else` after `return` |
| FBT001/002/003 | 24 | Medium | Boolean positional args (use keyword-only instead) |
| F841 | 9 | High | Unused local variables (real bugs — see §2.3) |
| PLW2901 | 8 | Medium | Redefined loop variable |
| PLW0603 | 5 | High | `global` statement usage |
| TC003/002/001 | 17 | Low | Typing-only imports not in `TYPE_CHECKING` block |
| SIM102 | 3 | Low | Collapsible `if` — explicitly ignored in config |
| C416 | 3 | Low | Unnecessary list comprehension |

### 2.2 TypeScript / Frontend Linting

**ESLint is NOT configured for the frontend.** No `.eslintrc.*` or `eslint.config.*` file exists. Running `npx next lint` prompts for initial configuration. The CI workflow (`test.yml`) does **not** run `npm run lint` — it only runs `npm test` (vitest) and `npm run build`.

Running `tsc --noEmit --noUnusedLocals --noUnusedParameters` reveals **75 errors**:
- **68 TS6133**: Unused locals/parameters (dead code)
- **7 TS6196**: Unused imports/types

Notable dead code includes:
- `routes/page.tsx`: `handleDownloadGpx` function never called, `authFetch`, `selectedRouteIds`, `showFilters` all unused
- `routes/duplicates/page.tsx`: `Trash2`, `Check`, `authFetch`, `data`, `scoreColor` unused
- `training/page.tsx`: 6 unused error variables (`planError`, `eventsError`, `chartError`, etc.)
- `settings/page.tsx`: `loading` variable unused

The `tsconfig.json` has `strict: true` but does **not** enable `noUnusedLocals` or `noUnusedParameters`. CI does **not** run `tsc --noEmit` — type checking only happens implicitly during `npm run build`.

### 2.3 Unused Variables (Actual Bugs)

Ruff F841 detects 9 unused variables in backend production code:

| File | Line | Variable | Impact |
|------|------|----------|--------|
| `api/cycling/power.py:198` | `cutoff_90d` | 90-day cutoff computed but never used in query — date window likely incomplete |
| `services/charts.py:524` | `total_time` | Computed from zone data but never read — likely leftover refactoring |
| `services/charts.py:1046` | `std_hrv` | Std deviation of HRV computed but never used |

### 2.4 Exception Handling Anti-Patterns

**`except Exception: pass` in `llm_analysis.py`** (5 instances at lines 630, 930, 1286, 1679, 1957): Each wraps a truncation-warning check (`response.candidates[0].finish_reason`). While the swallow is technically for a non-critical logging path, it silently hides any unexpected response format changes from Gemini. Should at minimum log at `debug` level.

**`global` statements** (5 instances): `main.py` (rate-limit lazy init, Redis client), `cache.py` (Redis connection), `encryption.py` (Fernet instance). These module-level mutable singletons are fragile under concurrent access and make testing difficult.

### 2.5 Double-Commit Anti-Pattern (BUG-015 — Deferring)

`get_db()` in `database.py:29-38` auto-commits after the endpoint yields. But **35 explicit `await db.commit()` calls** across 8 endpoint files contradict this:

| File | Explicit commits |
|------|-----------------|
| `api/routes.py` | 22 |
| `api/events.py` | 4 |
| `api/connections.py` | 3 |
| `api/activities.py` | 2 |
| `api/auth.py` | 1 |
| `api/lifting.py` | 1 |
| `api/metrics.py` | 2 |
| `api/webhooks.py` | 1 |

If the first commit succeeds but an error occurs before `get_db`'s commit, behavior is unpredictable. This was identified in BUGS.md (BUG-015) and is **still deferred** due to "high regression risk." Removing the explicit commits is the cleaner fix, but requires careful testing to ensure no data is lost on exceptions that should trigger rollback.

### 2.6 Dev/POC Scripts in Production Image

`backend/app/komoot_detail_test.py` (with 92 `print()` statements) and `backend/app/komoot_poc.py` are placed in the `app/` package directory. The backend `Dockerfile` runs `COPY . .` (line 12), so these scripts are **baked into the production Docker image**. They are never imported by any production code and serve no purpose in production. They should be moved to `scripts/` or a `dev/` directory outside the package.

### 2.7 Type Hint Coverage

- **190 API endpoint functions** lack return type annotations (e.g., `list_activities` in `activities.py:85` has 17 parameters and no `->` annotation)
- **205 service functions** lack return type annotations
- No `mypy` is configured — the project relies solely on ruff's pyflakes checks

---

## 3. Testing

### 3.1 Coverage Summary

| Layer | Files | Lines | LOC Ratio |
|-------|-------|-------|-----------|
| Backend unit tests | 14 | 2,621 | 6.5% of 40,263 backend LOC |
| Backend integration tests | 22 | 6,275 | 15.6% |
| Frontend unit tests | 4 | 379 | 1.3% of 29,914 frontend LOC |
| Frontend e2e | 13 specs | ~4,500 est. | Low (only 13 specs for 13 pages + 95 components) |

### 3.2 Backend Tests

- 14 unit tests cover: cycling (TSS, power curves, FTP), conformity, deficiency, goal metrics, health analysis, lifting, merge service, nutrition, projections, retry, scheduler tasks, weather, connection health, cache
- 22 integration tests cover: activities API, backfill persistence, charts API, cycling API, dashboard API, events API, export API, goals API, health analysis service, health API, lifting API, LLM analysis API, merge service, notifications, projections API, route service, routes API, Strava sync, training plans API, webhook queue, weight/sleep API, workout planner API
- Integration tests use a **real PostgreSQL database** (via `httpx.AsyncClient` + ASGI transport) with transactional rollback isolation
- The `conftest.py` provides 17 well-structured domain fixtures (user, cycling profile, activity, streams, lifting sessions, daily metrics, sleep, weight, health alerts, events, training plans, routes, FTP history, PRs)

### 3.3 Frontend Tests

- Only **4 unit test files** (379 lines): `Chart.test.tsx`, `ErrorBoundary.test.tsx`, `fetch.test.ts`, `lifting-reference.test.ts`
- Coverage is limited to chart rendering, error boundaries, the API fetch hook, and lifting reference calculations
- **No tests** for: API clients, utility functions, sport utils, auth flow, stores, or any of the 95 components
- 13 Playwright e2e specs exist but the `e2e/fixtures/authenticated-test.ts` requires a running dev server with auth configured — these are not run in CI
- CI runs `npm test` (vitest) and `npm run build` but **not** `npm run test:e2e`

### 3.4 CI Gaps

The CI workflow (`test.yml`) runs:
1. `ruff check .` (backend only)
2. `pytest tests/ -v` (backend, requires PostgreSQL service)
3. `npm test` (frontend vitest)
4. `npm run build` (frontend build)

**Missing from CI:**
- No frontend linting (`npm run lint` not configured — no ESLint config)
- No TypeScript type checking (`tsc --noEmit` not run)
- No frontend e2e tests (`npm run test:e2e` not run)
- No backend coverage reporting
- No ruff format check (only ruff check; `ruff-format` is in pre-commit but not CI)
- No `pre-commit` hooks execution

**Pre-commit config** (`.pre-commit-config.yaml`) only runs ruff on backend — no frontend checks at all.

---

## 4. Performance

### 4.1 Large Files (Token/Read Cost)

The comprehensive audit (2026-08-20) identified 6 backend files and 3 frontend files exceeding 500 lines. Since then, new large files have emerged:

| Backend File | Lines | Status |
|---|---|---|
| `services/llm_analysis.py` | 1,996 | **New critical hotspot** — 5 duplicated analysis flows |
| `services/whoop.py` | 1,956 | Known (BUG-057 noted duplication) |
| `services/charts.py` | 1,936 | Known |
| `tasks/scheduler.py` | 1,586 | Known |
| `app/api/routes.py` | 1,217 | Known |
| `app/api/activities.py` | 1,211 | Known |
| `services/training_plan.py` | 1,200 | Known |
| `services/conformity.py` | 1,035 | Known |
| `services/strava/sync.py` | 964 | Known |

### 4.2 Caching

- Redis-backed caching exists (`services/cache.py`) with `cached()` decorator and `redis_lock()` — used for chart stream-heavy queries (5-min TTL per CODEMAP)
- No response-level caching for other expensive endpoints (TSS, training load, FTP estimation, power curves)
- React Query on the frontend uses `staleTime` on some queries but has **no global defaults** configured (no `QueryClient` default options in `Providers.tsx`)
- No `placeholderData` (keepPreviousData) on list queries — causes layout shift when paginating

### 4.3 Database

- 66 `selectinload`/`joinedload`/`subqueryload` usages — good eager-loading strategy
- 232 `.any()/.all()/.count()` usages — potential lazy-loading hotspots (need manual review)
- Connection pool: `pool_size=5, max_overflow=10` (15 max) — not configurable via env vars (noted in comprehensive audit BUG-1.5, still open)
- `echo=False` in database.py (fixed from comprehensive audit BUG-1.5)

### 4.4 N+1 Query Risks

- `merge_service.py:backfill_activity_route_links` was fixed (BUG-061) — pre-fetches routes once
- `strava.py` sync was noted as having N+1 in earlier audits — needs verification

---

## 5. Security

### 5.1 Status

The vast majority of security issues identified in BUGS.md and earlier audits have been **fixed**:

| Issue | Status | Resolution |
|-------|--------|-----------|
| BUG-001: `hmac.new()` → `hmac.HMAC()` | FIXED | `webhooks.py:31` now uses `hmac.HMAC` |
| BUG-003: `/sync-user` unauthenticated | FIXED | `INTERNAL_API_SECRET` header check added |
| BUG-004: Redis no auth | FIXED | `--requirepass` in docker-compose |
| BUG-010: Webhook POST HMAC missing | FIXED | `webhooks.py` verifies HMAC on POST |
| BUG-008/009: IDOR | FIXED | Ownership checks added |
| BUG-011: Weak Fernet key derivation | FIXED | HKDF-based key derivation |
| BUG-018: Whoop OAuth state not validated | FIXED | State stored + validated |
| BUG-019: OAuthConnection unique constraint | FIXED | `uq_oauth_user_provider` added |
| BUG-021: Missing user_id in connection lookup | FIXED | Filter by user_id added |

### 5.2 Remaining Security Concerns

| Issue | Status | Details |
|-------|--------|---------|
| BUG-025: OAuth redirect_uri client-side | **DEFERRED** | `settings/page.tsx:78-83` constructs callback URL from client env vars — architecture change needed |
| BUG-045: Live secrets in `.env` | **DEFERRED** | `.env` contains real credentials (Komoot password, Gemini key, SECRET_KEY). Manual rotation required. |
| BUG-048: Placeholder ACME email | **DEFERRED** | `admin@example.com` in production Caddyfile |
| `auth.ts:7` API_BASE_URL fallback chain | **NEW FINDING** | `process.env.INTERNAL_API_URL \|\| process.env.NEXT_PUBLIC_API_URL \|\| 'http://localhost:8000'` — if `INTERNAL_API_URL` is missing, falls back to a client-exposed env var, then to a localhost URL that won't resolve in Docker |

### 5.3 Frontend Security

- No `any` types anywhere in the codebase (verified via grep — zero matches)
- No `dangerouslySetInnerHTML` on dynamic content (BUG-042 fixed)
- JWT stored in NextAuth session (not localStorage) — good
- 39 `console.error`/`console.warn` statements — these leak error details to browser console but are acceptable for a personal project

---

## 6. Bugs (Current Status)

BUGS.md (generated 2026-08-24) tracks 85 bugs. Summary:

| Status | Count |
|--------|-------|
| Fixed | ~76 |
| Deferred | 6 |
| Investigating | 1 |
| Documented/Skip | 1 |
| Already Fixed (verified) | 1 |

### Deferred Bugs (Awaiting Remediation)

| Bug | File | Description |
|------|------|-----------|
| BUG-015 | `database.py:28-36` + 8 endpoint files | Double-commit anti-pattern (35 explicit `db.commit()` calls) — high regression risk |
| BUG-025 | `settings/page.tsx:78-83` | OAuth redirect_uri constructed client-side — needs backend-generated redirect |
| BUG-040 | `dashboard/page.tsx:263-304`, `WeeklyTab.tsx:32-73` | 30+ props drilled into `WeeklyTab` — frontend refactor needed |
| BUG-041 | `WeeklyTab.tsx`, `MonthlyTab.tsx` | 200+ lines of duplicated monthly/yearly rendering — extract shared components |
| BUG-045 | `.env` | Live secrets in working directory — manual credential rotation required |
| BUG-048 | `infra/Caddyfile:2` | Placeholder `admin@example.com` ACME email |

### Investigating

| Bug | File | Description |
|------|------|-----------|
| BUG-068 | `FuelPlanCard.tsx`, `nutrition.py` | "Could not load fuel plan" — root cause unclear from static analysis, needs live diagnosis |

### New Finding (Not in BUGS.md)

| Bug | File | Description |
|------|------|-------|
| **BUG-086** | `RouteDetailPanel.tsx:170-180`, `lib/api/routes.ts:221` | **GPX download is broken** — `RouteDetailPanel.tsx` creates a bare `<a href="/api/v1/routes/{id}/gpx">` link without the JWT Bearer token. The backend endpoint (`routes.py:1017`) requires `Depends(get_current_user)`, so the browser's request returns 401. The correct implementation (`downloadRouteGpx` in `routes.ts:221`) fetches with the token but is **never called anywhere** — dead code. `handleDownloadGpx` in `routes/page.tsx:145` is also dead code (never called). Three implementations exist; none work correctly. |

---

## 7. Frontend Issues (Detailed)

### 7.1 Broken/Orphaned Features

| Component/Feature | File | Status |
|---|---|---|
| `SuggestedCycleCard` | `components/cycling/SuggestedCycleCard.tsx` | **Orphaned** — removed from cycling page in Phase 5B; no component renders it. CODEMAP already documents as orphaned. Plan says "delete or wire up." |
| `getSuggestedCycle()` | `lib/api/cycling.ts:112` | **Dead code** — no caller |
| `SkeletonCard` / `SkeletonChart` | `components/ui/Skeleton.tsx` | **Never used** — `Skeleton` is used but these two sub-components have zero references |
| `downloadRouteGpx()` | `lib/api/routes.ts:221` | **Dead code** — see BUG-086 above |
| `handleDownloadGpx()` | `app/(app)/routes/page.tsx:145` | **Dead code** — never called |
| `authFetch` (in routes/page.tsx) | `app/(app)/routes/page.tsx:26` | **Unused** — tsc flags it |

### 7.2 Frontend Configuration Gaps

| Gap | Impact |
|-----|--------|
| No ESLint config file | No linting rules enforced; `next lint` not configured; CI doesn't run it |
| `tsconfig.json` lacks `noUnusedLocals`/`noUnusedParameters` | 68 unused variables accumulate silently; would be 75 tsc errors if enabled |
| CI doesn't run `tsc --noEmit` | Type errors only caught during `npm run build` — slower feedback |
| No global React Query defaults | `staleTime`, `retry`, `refetchOnWindowFocus` not configured globally |
| `frontend_node_modules` volume mounted but base compose doesn't | Works in dev (via `docker-compose.dev.yml`) but documented as confusing in AGENTS.md |

### 7.3 Frontend Type Safety

- **Zero `any` types** — excellent, fully typed
- **27 non-null assertions** (`!.`) — potential runtime errors if types are incorrect
- **7 `as` casts** — `as unknown as` pattern used for token access (BUG-006 original issue, now using `useAuthFetch` return)

---

## 8. Backend Issues (Detailed)

### 8.1 Duplication

| Pattern | Files | Status |
|---------|-------|--------|
| `_safe_float` | 3 files (`strava/sync.py`, `wahoo.py`, `fit_parser.py`) | **Fixed** (BUG-032) — extracted to `utils.py` as `safe_float` |
| Whoop recovery second-pass | `sync_whoop_cycles()` + `backfill_whoop_data()` | **Fixed** (BUG-057) — extracted to `_backfill_missing_recovery()` |
| LLM analysis flows | `llm_analysis.py` (1,996 lines) | **NOT FIXED** — 5 nearly-identical functions: `compile_cycling_stats`/`analyze_with_gemini`/`run_llm_analysis`, `compile_activity_context`/`analyze_activity_with_gemini`/`run_activity_ai_analysis`, `compile_lifting_session_context`/`analyze_lifting_session_with_gemini`/`run_lifting_session_ai_analysis`, `compile_health_stats`/`analyze_health_with_gemini`/`run_health_ai_analysis`, `compile_event_stats`/`analyze_event_with_gemini`/`run_event_ai_analysis`. Each triple follows the same pattern: compile context → call Gemini → log → store. The 5 `except Exception: pass` blocks are identical. |

### 8.2 Environment Configuration Drift

| Setting | `.env.example` | `config.py` default | Impact |
|---------|----------------|---------------------|--------|
| `ACTIVITY_MERGE_THRESHOLD` | `0.60` | `0.55` | Doc says "lowered from 0.60" but example not updated |
| `ROUTE_MATCH_THRESHOLD` | `0.60` | `0.55` | Same drift |
| `ACTIVITY_ROUTE_LINK_THRESHOLD` | — | `0.70` | Not in `.env.example` |

Deployers using `.env.example` as a template will get stale threshold values (0.60 instead of 0.55), causing less aggressive dedup/merge than intended.

### 8.3 Infrastructure Scripts in `app/` Package

| File | Lines | Issue |
|------|-------|-------|
| `app/komoot_detail_test.py` | ~90 | Dev/POC script with 92 `print()` statements; included in Docker image via `COPY . .` |
| `app/komoot_poc.py` | ~60 | Dev/POC script; same issue |
| `scripts/komoot_poc.py` | ~60 | Duplicate of `app/komotoom_poc.py` in `scripts/` |

These should be moved to `scripts/` and excluded from the production Docker image (add a `.dockerignore` or exclude pattern).

---

## 9. CI/CD

### 9.1 CI Workflow (`test.yml`)

**Strengths:**
- Runs ruff (backend), pytest (backend with PostgreSQL service), vitest (frontend), build (frontend)
- Uses service containers for PostgreSQL
- Branch triggers on `[main, prod]`

**Gaps:**
- No ESLint or `tsc --noEmit` for frontend
- No code coverage reporting
- No e2e test execution
- No parallel test execution (all tests run serially)
- `npm install` doesn't use `--frozen-lockfile` (could install different deps than intended)

### 9.2 Deploy Workflow (`deploy.yml`)

**Strengths:**
- Builds and pushes to GHCR
- Deploys via SSH with heredoc Caddyfile generation
- Health check verification after deploy
- Runs on `prod` branch after CI passes

**Known Issues:**
- Heredoc indentation (BUG-016 from comprehensive audit) — content is indented with 12 spaces; works because YAML block scalar strips common indentation but is fragile
- Uses `admin@example.com` placeholder email (BUG-048, deferred)
- `--no-cache: true` on all Docker builds — slower CI but correct
- The `cat > infra/Caddyfile <<CADDYEOF` uses `<<` (not `<<-`), but content uses spaces not tabs, so `<<-` wouldn't help

### 9.3 Pre-commit

Only 2 hooks defined: `ruff` and `ruff-format` on `backend/` files. **No frontend hooks.** No pre-push hooks.

---

## 10. Documentation

| Document | Status | Notes |
|----------|--------|-------|
| `AGENTS.md` | **Excellent** | 242 lines, comprehensive, well-maintained, context routing table, critical pitfalls, dev lessons |
| `docs/BUGS.md` | **Excellent** | 573 lines, 85 bugs tracked with file/line references, status, fix details |
| `backend/app/api/CODEMAP.md` | Good | API routes and endpoints reference |
| `backend/app/models/CODEMAP.md` | Good | Models and relationships |
| `backend/app/schemas/CODEMAP.md` | Good | Pydantic schemas |
| `backend/app/services/CODEMAP.md` | Good | Service functions |
| `frontend/src/CODEMAP.md` | Good | Pages, components, API clients |
| `docs/algorithms.md` | Good | Scoring, TSS/CTL/ATL, VO2max, etc. |
| `docs/DEPLOY.md` | Good | Deployment instructions |
| `docs/RUNNING.md` | Good | How to run commands, tests, migrations |
| `docs/OPENCODE.md` | Good | OpenCode TUI config |
| `docs/api-versioning.md` | Exists | Versioning strategy |
| `docs/merge-thresholds.md` | Exists | Merge/dedup thresholds |

**Gap**: No CODEMAP for `frontend/src/lib/api/` or `frontend/src/lib/lifting/` (noted in comprehensive audit §5.2, still open).

---

## 11. Dependency / Package Health

### Backend (`pyproject.toml`)
- All 27 dependencies pinned with `>=` minimum versions (not exact pins)
- 9 dev dependencies (pytest, pytest-asyncio, httpx, ruff)
- Python 3.12 required
- No unused dependencies detected

### Frontend (`package.json`)
- 23 production dependencies, 14 dev dependencies
- `next: 14.2.15` — pinned exactly (good for reproducibility)
- `react/react-dom: ^18.3.0` — caret range (allows minor bumps)
- Note: `package-lock.json` is **NOT** gitignored (BUG-047 fixed)
- 7 npm vulnerabilities reported on install: "3 moderate, 2 high, 2 critical" (from `npm install` output)

### Frontend Vulnerabilities
The `npm install` output reports 7 vulnerabilities (3 moderate, 2 high, 2 critical). Running `npm audit` would identify which packages. This should be investigated.

---

## 12. Priority Recommendations

| Status | Priority | Item | Category | Effort | Risk |
|--------|----------|------|----------|--------|------|
| DONE | P0 | Fix GPX download (BUG-086) | Bug | Small | Low |
| DONE | P0 | Enable `noUnusedLocals`/`noUnusedParameters` in tsconfig + fix 75 violations | Code Quality | Small | Low |
| DONE | P0 | Add `tsc --noEmit` to CI (no ESLint — see note below) | Code Quality | Small | Low |
| DONE | P0 | Remove `komoot_detail_test.py` and `komoot_poc.py` from `app/` | Code Quality | Trivial | Low |
| DONE | P0 | Fix `.env.example` threshold values (0.60 → 0.55) | Docs | Trivial | Low |
| DONE | P0 | Wire up `downloadRouteGpx` in `RouteDetailPanel.tsx` | Bug | Small | Low |
| DONE | P0 | Remove dead tag-creation flow in `RoutesSidebar.tsx` | Refactoring | Small | Low |
| PENDING | P1 | Fix unused variables in backend (9 F841 instances) | Bug | Small | Low |
| PENDING | P1 | Enable frontend ESLint (Next.js built-in config not installed) | Code Quality | Small | Low |
| PENDING | P1 | Run `npm audit` and address critical/high vulnerabilities | Security | Medium | Variable |
| PENDING | P2 | Refactor `llm_analysis.py` (1,996 lines) — extract duplicated analysis flow | Refactoring | Medium | Medium |
| PENDING | P2 | Remove double-commit anti-pattern (BUG-015) | Refactoring | Medium | High |
| PENDING | P2 | Remove orphaned `SuggestedCycleCard`, `getSuggestedCycle`, `SkeletonCard`/`SkeletonChart` | Refactoring | Trivial | Low |
| PENDING | P2 | Add global React Query defaults in `Providers.tsx` | Performance | Small | Low |
| PENDING | P2 | Make DB pool size configurable via env vars | Config | Trivial | Low |
| PENDING | P3 | Split large backend files (>1000 lines) | Refactoring | Large | High |
| PENDING | P3 | Split large frontend files (>1000 lines) | Refactoring | Large | High |
| PENDING | P3 | Add frontend CODEMAP for `lib/api/` and `lib/lifting/` | Docs | Small | Low |

> **Note on ESLint**: The `npm run lint` script exists (`next lint`) but ESLint is not installed as a dependency and no config file exists. Installing ESLint + `@typescript-eslint` would add ~15 packages. Since `tsc --noEmit --noUnusedLocals --noUnusedParameters` now catches structural issues in CI, ESLint is deferred. The `lint` script in package.json is left as-is for future use.

---

## 13. Audit Coverage Gaps

The following areas were NOT deeply audited (file-by-file review) due to scope:
- Individual API endpoint logic for correctness (would require running tests)
- Database query performance (would require production query analysis)
- Frontend rendering performance (would require browser profiling)
- Celery task correctness end-to-end (would require integration testing)
- OAuth integration correctness (would require live API testing)

These areas are covered by the existing test suite but were not exhaustively verified during this static audit.

---

## 14. Agent Rules & Operational Context

Extracted from `AGENTS.md` — key rules governing code changes, git workflow, and development.

### Git & Deployment Strategy

- **`main` is trunk; `prod` deploys.** Feature branches PR into `main`. `prod` only receives merges of `main`.
- Before pushing a release: `git log --oneline origin/main..origin/prod` and `git diff --stat origin/main origin/prod`.
- CI runs on `push`/`pull_request` for `[main, prod]`. If CI on `prod` push is `queued`, the deploy is blocked.
- **Only commit files from your session**: `git add` only files you modified. Check `git status` before editing to ensure no file ownership conflicts.

### Backend Conventions

- Async everywhere: `AsyncSession` + `await`. `get_db` handles commit/rollback.
- UUID PKs on all models; SQLAlchemy 2.0 ORM with `Mapped` annotations.
- Pydantic v2: `model_config = {"from_attributes": True}`, convert via `.model_validate()`.
- Service signature: `(db: AsyncSession, user_id: UUID, ...)` — services don't use FastAPI DI.
- **Celery tasks must use `asyncio.run()` with a fresh DB session** — never `async_session_factory` directly in tasks.
- **OAuth tokens are encrypted** (`EncryptedString` TypeDecorator). `decrypt_token()` falls back to raw value for pre-migration rows.
- **`/sync-user` requires `INTERNAL_API_SECRET` header** — protect this endpoint.

### Frontend Conventions

- All pages `'use client'` with React Query.
- Client fetches use relative URLs — **`API_BASE_URL` must be `''`**. Never set `NEXT_PUBLIC_API_URL` to a full URL.
- Query keys: `['lifting-sessions']`, `['activities', filters]`, etc. — string arrays, domain-prefixed.
- Add new pages in `app/(app)/yourpage/page.tsx`, add nav item in `Sidebar.tsx`.
- Add new API client in `lib/api/yourDomain.ts`, export via `lib/api/index.ts` barrel.

### Critical Pitfalls

| # | Pitfall | Impact |
|---|---------|--------|
| 1 | Celery tasks must use `asyncio.run()` | Cross-loop asyncpg pool conflicts |
| 4 | `API_BASE_URL` must be `''` | Client fetches use relative URLs |
| 5 | OAuth `redirect_uri` must match exactly | Google returns `redirect_uri_mismatch` |
| 8 | Alembic `014_add_composite_indexes.py` is a stale duplicate | Real chain is 013→…→038 |
| 11 | Check `git status` before editing (file ownership) | Concurrent session conflicts |
| 15 | `fittrack.py exec backend pytest` runs stale tests | `tests/` baked into Docker image; rebuild or run from host with `TEST_DATABASE_URL` |
| 20 | SSE backfill sessions own their commits | Must `await db.commit()` explicitly; `flush()` alone rolls back when endpoint closes |

### Quick Reference Commands

```bash
python fittrack.py up --migrate       # Start all services (dev mode)
python fittrack.py --prod up          # Start with production overrides
python fittrack.py down
python fittrack.py restart worker beat
python fittrack.py logs backend --tail 30
python fittrack.py exec backend alembic revision --autogenerate -m "desc"
python fittrack.py migrate            # Apply migrations
npm run typecheck                     # Frontend type check (tsc --noEmit)
npm test                              # Frontend vitest unit tests
npm run test:e2e                      # Playwright e2e (requires dev server + auth)
```

---

## 15. Repository Structure

```
FitnessTracker/
├── .github/workflows/
│   ├── test.yml         # CI: ruff → pytest → vitest → typecheck → build
│   └── deploy.yml       # Deploy to GHCR on prod
├── backend/
│   ├── app/
│   │   ├── api/         # FastAPI route handlers (api/CODEMAP.md)
│   │   │   ├── activities.py (1,211 lines)
│   │   │   ├── auth.py, routes.py (1,217 lines), lifting.py, ...
│   │   ├── models/      # SQLAlchemy ORM (models/CODEMAP.md)
│   │   ├── schemas/     # Pydantic models (schemas/CODEMAP.md)
│   │   ├── services/    # Business logic (services/CODEMAP.md)
│   │   ├── integrations/  # OAuth clients (strava, whoop, wahoo, komoot)
│   │   ├── tasks/       # Celery tasks (scheduler.py: 1,586 lines)
│   │   ├── database.py  # AsyncSession, get_db, task_session
│   │   ├── config.py    # Pydantic settings (thresholds, secrets)
│   │   └── main.py      # FastAPI app, middleware, exception handlers
│   ├── tests/
│   │   ├── unit/        # 14 files (ruff, cycling, charts, etc.)
│   │   └── integration/ # 22 files (API endpoints, sync, etc.)
│   ├── alembic/
│   │   └── versions/    # 38 migrations (001–038, 014 is stale dup)
│   ├── Dockerfile       # Copies entire app/ — excludes nothing
│   └── pyproject.toml   # 27 deps, ruff config (default E,F rules only)
├── frontend/
│   ├── src/
│   │   ├── app/(app)/   # 13 App Router pages (dashboard, activities, routes, ...)
│   │   ├── components/  # 95 components: ui/, charts/, cycling/, lifting/, maps/, training/
│   │   ├── lib/
│   │   │   ├── api/     # API clients (routes.ts, cycling.ts, lifting.ts, ...)
│   │   │   ├── stores/  # Zustand stores
│   │   │   ├── auth.ts  # NextAuth config, signIn callback
│   │   │   └── utils.ts
│   │   ├── __tests__/   # 4 unit tests only (Chart, ErrorBoundary, fetch, lifting-reference)
│   │   └── CODEMAP.md   # Pages, components, API clients
│   ├── e2e/             # 13 Playwright specs (not run in CI)
│   ├── Dockerfile       # Next.js standalone build
│   ├── tsconfig.json    # strict + noUnusedLocals + noUnusedParameters (enabled 2026-08-29)
│   ├── package.json     # Scripts: dev, build, lint, typecheck, test, test:e2e
│   ├── tailwind.config.js
│   └── playwright.config.ts
├── infra/
│   ├── Caddyfile         # Production (routes /api/v1/* → backend, /api/auth/* → frontend)
│   ├── docker-compose.yml        # Production services
│   ├── docker-compose.dev.yml    # Dev overrides (hot-reload, volume mounts)
│   └── Caddyfile.local           # Gitignored local dev config
├── scripts/              # Komoot PoC, etc.
├── docs/                 # BUGS.md, algorithms.md, DEPLOY.md, RUNNING.md, PROJECT-AUDIT-2026-08-29.md
├── .env.example          # Template (thresholds now match config.py defaults)
├── AGENTS.md             # Agent context guide (242 lines)
└── fittrack.py           # 1,525-line CLI service manager (no tests)
```

---

*Prepared by: Project Audit Agent*  
*Tooling: ruff v0.16.5, tsc 5.9.3, manual code review*  
*Audit date: 2026-08-29*  
*Remediation complete: 2026-08-29*