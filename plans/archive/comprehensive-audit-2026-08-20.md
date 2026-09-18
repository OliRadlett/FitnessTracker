# Comprehensive Audit — 2026-08-20

> **Scope**: Optimisations, improvements, new features, bug fixes, agentic workflow, token optimisation
> **Status**: Pending Approval

---

## 1. Bug Fixes

### 1.1 Caddyfile `tls internal` contradiction

**File**: [`infra/Caddyfile`](infra/Caddyfile:37)

The Caddyfile contains `tls internal` on line 37, but AGENTS.md explicitly warns against this (Pitfall #12). The deploy workflow regenerates the Caddyfile without it, so this only affects local dev — but it contradicts the documented rule and will cause confusion.

**Fix**: Remove `tls internal` from the committed Caddyfile. Caddy auto-detects localhost → self-signed certs without it.

### 1.2 `frontend_node_modules` volume declared but never mounted

**File**: [`docker-compose.yml`](docker-compose.yml:127)

The `frontend_node_modules` volume is declared at line 127 but never referenced in the `frontend` service volume mounts. This means `npm install` runs on every container start (line 103: `sh -c "npm install && npm run dev"`), reinstalling all dependencies from scratch each time.

**Fix**: Mount the volume:
```yaml
volumes:
  - frontend_node_modules:/app/node_modules
```

### 1.3 `pendingBackendToken` race condition

**File**: [`frontend/src/lib/auth.ts`](frontend/src/lib/auth.ts:16)

Module-level `let pendingBackendToken` is fragile — if two users sign in concurrently on the server (or the module is re-imported), tokens can leak between sessions. This is a documented pitfall (#2 in AGENTS.md) but has never been fixed.

**Fix**: Move token passing into the JWT callback directly using the `account`/`profile` parameters, or use a short-lived in-memory store keyed by session ID.

### 1.4 Health check creates new Redis connection per request

**File**: [`backend/app/main.py`](backend/app/main.py:139)

Every `/health` call creates a new `aioredis` connection, pings, then closes. Under monitoring (Prometheus scraping every 15s), this creates unnecessary connection churn.

**Fix**: Use a module-level Redis connection pool, or reuse the Celery broker connection.

### 1.5 SQL echo in debug mode floods logs

**File**: [`backend/app/database.py`](backend/app/database.py:12)

`echo=settings.debug` logs every SQL statement. In debug mode with React Query refetching, this produces thousands of log lines per minute, making real debugging impossible.

**Fix**: Set `echo=False` always. Use `logging.getLogger("sqlalchemy.engine").setLevel(logging.DEBUG)` selectively when needed (already done in [`logging_config.py`](backend/app/logging_config.py:74)).

### 1.6 Deploy workflow Caddyfile heredoc indentation

**File**: [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml:52)

The heredoc content is indented with YAML indentation spaces, which will be included in the generated Caddyfile. Caddy will fail to parse it.

**Fix**: Use `<<-CADDYEOF` (strip leading tabs) or dedent the heredoc content to column 0.

---

## 2. Performance Optimisations

### 2.1 Backend — Large file decomposition

Several files exceed 500 lines, making them hard to maintain and increasing agent token consumption when read:

| File | Lines | Suggested Split |
|------|-------|-----------------|
| [`backend/app/api/dashboard.py`](backend/app/api/dashboard.py:1) | 1,249 | `dashboard_summary.py`, `weekly_report.py`, `today.py`, `yearly.py` |
| [`backend/app/api/cycling.py`](backend/app/api/cycling.py:1) | 973 | `profile.py`, `training_load.py`, `power.py`, `vo2max.py` |
| [`backend/app/services/strava.py`](backend/app/services/strava.py:1) | 1,019 | `strava_sync.py`, `strava_linking.py`, `strava_webhooks.py` |
| [`backend/app/services/cycling.py`](backend/app/services/cycling.py:1) | 1,335 | `tss.py`, `power_curve.py`, `zones.py`, `vo2max.py` |
| [`backend/app/services/health_analysis.py`](backend/app/services/health_analysis.py:1) | 748 | `overtraining.py`, `injury.py`, `illness.py` |

### 2.2 Frontend — Large file decomposition

| File | Lines | Suggested Split |
|------|-------|-----------------|
| [`frontend/src/app/(app)/dashboard/page.tsx`](frontend/src/app/(app)/dashboard/page.tsx:1) | 1,811 | Extract tab content into separate components |
| [`frontend/src/app/(app)/cycling/page.tsx`](frontend/src/app/(app)/cycling/page.tsx:1) | 940 | Extract sections into `TrainingLoadSection`, `PowerCurveSection`, etc. |
| [`frontend/src/lib/api/types.ts`](frontend/src/lib/api/types.ts:1) | 1,168 | Split by domain: `activity.ts`, `cycling.ts`, `lifting.ts`, `dashboard.ts`, etc. |

### 2.3 React Query tuning

**Current state**: Most queries use `staleTime` (good), but no global defaults are configured.

**Improvements**:
- Add global `QueryClient` defaults in [`Providers.tsx`](frontend/src/components/Providers.tsx): `staleTime: 60_000`, `retry: 2`, `refetchOnWindowFocus: false`
- Add `placeholderData` (formerly `keepPreviousData`) for list queries to prevent layout shift
- Add error retry with exponential backoff for transient failures

### 2.4 Database connection pool tuning

**File**: [`backend/app/database.py`](backend/app/database.py:10)

Current: `pool_size=5, max_overflow=10` (15 max connections). For a single-user app this is fine, but the values should be environment-configurable.

**Improvement**: Make pool settings configurable via `config.py`:
```python
db_pool_size: int = 5
db_max_overflow: int = 10
```

### 2.5 API response caching

Expensive endpoints recompute on every request:
- `GET /api/v1/cycling/training-load` — EWMA over 90 days
- `GET /api/v1/cycling/power-curve` — scans all streams
- `GET /api/v1/charts/{chart_name}` — varies by chart

**Improvement**: Add Redis-backed response caching with short TTLs (60-300s) for these endpoints. Use `ETag`/`If-None-Match` headers for client-side caching.

---

## 3. Improvements

### 3.1 Frontend test infrastructure

**Current state**: Zero frontend tests. No test runner configured.

**Action**:
- Add `vitest` + `@testing-library/react` + `@testing-library/jest-dom`
- Add `vitest.config.ts`
- Start with critical path tests: auth flow, API fetch hook, Chart component, ErrorBoundary

### 3.2 Backend test coverage

**Current state**: [`conftest.py`](backend/tests/conftest.py) is empty (1 line). Only 3 test files exist.

**Action**:
- Add shared fixtures (test DB session, test user, mock OAuth connection)
- Add integration tests for: activity sync → merge → route linking pipeline, health alert generation, workout planner
- Add API endpoint tests for auth flow, CRUD operations

### 3.3 Frontend CODEMAP

Backend has 4 CODEMAP files. Frontend has none.

**Action**: Create [`frontend/src/CODEMAP.md`](frontend/src/CODEMAP.md) covering:
- Page structure and routing
- Component hierarchy
- API client organization
- State management patterns (React Query keys)

### 3.4 Loading state consistency

Some pages have skeleton loaders ([`Skeleton.tsx`](frontend/src/components/ui/Skeleton.tsx)), others show spinners or nothing. Standardize on skeleton loaders everywhere.

### 3.5 Error handling consistency

[`ErrorBoundary`](frontend/src/components/ui/ErrorBoundary.tsx) wraps the app layout, but individual query errors are handled inconsistently. Add a global `onError` handler to the QueryClient that shows a toast notification.

### 3.6 Accessibility improvements

- Add `aria-label` attributes to icon-only buttons (sidebar toggle, mobile menu)
- Add `role="navigation"` to sidebar
- Ensure color contrast meets WCAG AA for the dark theme
- Add keyboard navigation for tabs (Dashboard Today/Weekly/Monthly)

### 3.7 Docker Compose — frontend hot-reload reliability

**File**: [`docker-compose.yml`](docker-compose.yml:103)

`npm install && npm run dev` means every restart reinstalls deps. With the node_modules volume fix (Bug 1.2), this becomes `npm install` (fast, cached) + `npm run dev`.

**Additional**: Add `CHOKIDAR_USEPOLLING=true` alongside `WATCHPACK_POLLING=true` for reliable file watching in Docker.

---

## 4. New Feature Suggestions

### 4.1 Activity Comparison Tool

Compare two activities side-by-side (power curves, HR zones, speed, elevation). Useful for tracking progress on the same route over time.

**Scope**: New API endpoint `GET /api/v1/activities/compare?ids=a,b`, new frontend component.

### 4.2 Gear Tracking

Track bike components (chain, cassette, tires) with mileage-based replacement alerts. Strava already has gear concepts.

**Scope**: New model `Gear`, new API, new settings section.

### 4.3 Weather Integration

Overlay weather data (temperature, wind, precipitation) on ride activities. Improves training context and explains performance variations.

**Scope**: OpenWeatherMap or similar free API, stored in `Activity.raw_data` or new field.

### 4.4 Notification System

Push notifications or in-app alerts for:
- Health alerts (overtraining, illness)
- PR celebrations
- Goal milestones
- Training plan reminders

**Scope**: WebSocket or Server-Sent Events for real-time, plus a notification bell in the header.

### 4.5 PWA Support

Make the frontend a Progressive Web App for mobile home screen installation and offline dashboard viewing.

**Scope**: Add `manifest.json`, service worker, offline fallback page.

### 4.6 PDF Report Generation

The [`pdf_report.py`](backend/app/services/pdf_report.py) service already exists. Wire it up to an API endpoint and frontend download button for weekly/monthly training reports.

**Scope**: `GET /api/v1/export/report?type=weekly&date=2026-08-18`, frontend download button on dashboard.

### 4.7 Training Plan Adherence Tracking

Track whether the user actually followed their training plan (compare planned vs actual activities per day).

**Scope**: New endpoint, new dashboard widget, extend `TrainingPlanDay` model.

---

## 5. Agentic Workflow Optimisations

### 5.1 Frontend AGENTS.md section

The current AGENTS.md has a "Conventions > Frontend" section but it's brief. Add:
- React Query key naming conventions
- Component file naming patterns
- How to add a new page (route group, layout, loading)
- How to add a new API client module

### 5.2 CODEMAP for frontend services

Create [`frontend/src/lib/api/CODEMAP.md`](frontend/src/lib/api/CODEMAP.md) mapping each API client file to its endpoints and types.

### 5.3 Task-scoped context routing

AGENTS.md already has a "Context Routing" table — this is excellent. Extend it with:
- "Adding a new chart" → read `charts.py`, `Chart.tsx`, `CHART_REGISTRY`
- "Adding a new API endpoint" → read relevant CODEMAP, `auth.py` for DI pattern
- "Modifying health alerts" → read `health_analysis.py`, `health-monitor-tuning.md`

### 5.4 Reduce speculative file reads

Add to AGENTS.md Agent Efficiency Rules:
> 6. **Use CODEMAP before reading source**: Always check the relevant CODEMAP file before reading implementation files. CODEMAPs contain the key functions and relationships you need.

### 5.5 Test-first guidance

Add to AGENTS.md:
> 7. **Verify before and after**: Before making changes, run the relevant test or hit the endpoint. After changes, verify again. Don't assume changes work.

---

## 6. Token Optimisation

### 6.1 Current state assessment

The [token-optimization plan](plans/archive/token-optimization.md) from 2026-08-18 has been largely implemented:
- AGENTS.md is compact (~150 lines with context routing)
- Completed plans archived
- CODEMAP files exist for backend
- Anti-loop rules added

### 6.2 Remaining opportunities

| Opportunity | Current Cost | Savings |
|-------------|-------------|---------|
| Frontend types.ts (1,168 lines) read by agents | ~4K tokens per read | Split by domain — agents read only relevant types |
| Dashboard page.tsx (1,811 lines) read when modifying dashboard | ~6K tokens | Extract components — agents read only the relevant section |
| Cycling page.tsx (940 lines) | ~3K tokens | Same — extract sections |
| strava.py (1,019 lines) read for any Strava work | ~3.5K tokens | Split into sync/linking/webhooks |
| No frontend CODEMAP | Agents read multiple files to orient | CODEMAP eliminates 2-3 file reads per task |

### 6.3 AGENTS.md further compression

The Database section (relationships table) is already compact. The Key Algorithms section could be moved to a separate `docs/algorithms.md` file, referenced by AGENTS.md. This would save ~20 lines (~600 tokens) per prompt injection since algorithms are only relevant for specific tasks.

### 6.4 Plan file hygiene

Active plans in `plans/`:
- `health-monitor-tuning.md` (396 lines) — ready to implement
- `misc-features-and-fixes.md` (287 lines) — pending approval
- `phase-6.md` (517 lines) — partially implemented (health analysis done)
- `phase-7.md` (288 lines) — not started
- `testing-guide-2026-08-18.md` — reference
- `workout-planner.md` — likely completed

**Action**: Archive `phase-6.md` (health analysis is implemented), `workout-planner.md` (implemented), and `testing-guide-2026-08-18.md` (reference). Keep only active plans.

---

## Priority Matrix

| # | Item | Category | Impact | Effort |
|---|------|----------|--------|--------|
| 1 | Fix `frontend_node_modules` volume | Bug | High | Trivial |
| 2 | Remove `tls internal` from Caddyfile | Bug | Medium | Trivial |
| 3 | Fix SQL echo in debug mode | Bug | Medium | Trivial |
| 4 | Fix deploy heredoc indentation | Bug | High | Trivial |
| 5 | Fix `pendingBackendToken` race | Bug | Medium | Small |
| 6 | Health check Redis pooling | Perf | Low | Small |
| 7 | React Query global defaults | Perf | Medium | Small |
| 8 | Frontend CODEMAP | Agent/Token | Medium | Small |
| 9 | Archive stale plans | Token | Low | Trivial |
| 10 | Split frontend types.ts | Token/Perf | Medium | Medium |
| 11 | Split large backend files | Token/Perf | High | Large |
| 12 | Split large frontend pages | Token/Perf | High | Large |
| 13 | Frontend test infrastructure | Quality | High | Medium |
| 14 | Backend test fixtures + coverage | Quality | High | Medium |
| 15 | PDF report wiring | Feature | Medium | Small |
| 16 | Activity comparison tool | Feature | Medium | Medium |
| 17 | Gear tracking | Feature | Low | Medium |
| 18 | Weather integration | Feature | Low | Medium |
| 19 | Notification system | Feature | Medium | Large |
| 20 | PWA support | Feature | Low | Medium |
| 21 | AGENTS.md frontend section | Agent | Medium | Small |
| 22 | Move algorithms to docs/ | Token | Low | Trivial |
| 23 | API response caching | Perf | Medium | Medium |
| 24 | Accessibility audit | Quality | Medium | Medium |
| 25 | Training plan adherence | Feature | Low | Medium |

---

## Recommended Execution Order

**Phase A — Quick wins (trivial effort, immediate impact)**:
1. Fix `frontend_node_modules` volume mount
2. Remove `tls internal` from Caddyfile
3. Set `echo=False` in database.py
4. Fix deploy heredoc indentation
5. Archive stale plans
6. Move algorithms to `docs/algorithms.md`

**Phase B — Small improvements (small effort, medium impact)**:
7. Fix `pendingBackendToken` race condition
8. Add React Query global defaults
9. Create frontend CODEMAP
10. Add AGENTS.md frontend conventions section
11. Health check Redis connection reuse
12. Wire up PDF report endpoint

**Phase C — Structural improvements (medium effort, high impact)**:
13. Split `frontend/src/lib/api/types.ts` by domain
14. Add frontend test infrastructure (Vitest + RTL)
15. Add backend test fixtures and coverage
16. Add API response caching for expensive endpoints
17. Accessibility improvements

**Phase D — Large refactors (large effort, high impact)**:
18. Split large backend files (dashboard, cycling, strava)
19. Split large frontend pages (dashboard, cycling)
20. Activity comparison tool
21. Notification system
