# FitTrack — Open Issues & Known Problems

> Working document for tracking issues discovered during documentation audit (2026-08-23).
> Items are ordered by severity. Add new items as they are found.

---

## High Priority

### 1. `frontend/src/lib/api/routes.ts` violates Pitfall #4 (NEXT_PUBLIC_API_URL)
**File:** `frontend/src/lib/api/routes.ts:45`
**Issue:** `downloadRouteGpx()` uses `process.env.NEXT_PUBLIC_API_URL` to construct the backend URL, directly contradicting AGENTS.md Critical Pitfall #4 which states "Never set `NEXT_PUBLIC_API_URL` to a full URL". All other API clients use relative URLs via `apiFetch`.
**Fix:** Use relative URL `/api/v1/routes/${routeId}/gpx` like other API clients.
**Status:** Fixed in this audit.

### 2. Local Caddyfile has `@nextauth` redirect rule; production Caddyfile does not
**File:** `infra/Caddyfile` (local), `.github/workflows/deploy.yml` (production template)
**Issue:** The local Caddyfile includes a `@nextauth` redirect rule that catches `/api/auth` and redirects to `/fittrack{uri}`. The production Caddyfile template (in deploy.yml) does not include this rule. This means NextAuth error redirects may break in production.
**Fix:** Add the `@nextauth` redirect rule to the production Caddyfile template in `.github/workflows/deploy.yml`.
**Status:** Fixed — deploy.yml:157-158 now includes the rule.

### 3. `cleanup_old_data` Celery task is a no-op
**File:** `backend/app/tasks/scheduler.py:447`
**Issue:** The task returns `{"deleted_streams": 0, "note": "Stream cleanup disabled"}` without doing any cleanup. The AGENTS.md table says "Streams older than 90 days" which is misleading — streams are retained indefinitely.
**Fix:** Either implement the cleanup or update the AGENTS.md table to reflect the current behaviour.
**Status:** Open — needs decision (implement or document).

---

## Medium Priority

### 4. `start.sh` references `fittrack.py` but `start.ps1` may not exist
**File:** `start.sh`, `start.ps1`
**Issue:** `start.sh` is a thin wrapper around `fittrack.py`. The README and DEPLOY.md reference `./start.sh` for Linux/macOS/WSL and `.\start.ps1` for Windows PowerShell. Need to verify `start.ps1` exists and is functional.
**Status:** Verified — both exist and delegate to `fittrack.py`.

### 5. `docker-compose.prod.yml` uses hardcoded GHCR image names
**File:** `docker-compose.prod.yml`
**Issue:** The prod compose file hardcodes `ghcr.io/oliradlett/fitnesstracker/...` image names. This is case-sensitive and fragile. The deploy workflow uses `oliradlett/fitnesstracker` (lowercase 'f'). If the GitHub org/repo name changes, these break.
**Status:** Known limitation — documented in file comments.

### 6. OAuth callback for fitness integrations uses "most recent user" fallback
**File:** `backend/app/api/auth.py:279`
**Issue:** When a fitness integration (Strava/Whoop/Wahoo) OAuth callback arrives and no existing OAuthConnection exists, the code falls back to finding "the most recent user" by `created_at desc`. This is fragile in multi-user scenarios — the wrong user could get the connection.
**Fix:** The frontend should pass the user's JWT or session identifier in the redirect. Currently relies on the user already being logged in via NextAuth.
**Status:** Open — known fragility.

### 7. `.env.example` had misleading Komoot OAuth variables
**File:** `.env.example`
**Issue:** The example file previously listed `KOMOOT_CLIENT_ID` and `KOMOOT_CLIENT_SECRET`, but Komoot uses Basic Auth (email + password), not OAuth. This would mislead users into thinking Komoot uses OAuth.
**Status:** Fixed in this audit.

### 8. `.env.example` threshold values were stale
**File:** `.env.example`
**Issue:** `ACTIVITY_MERGE_THRESHOLD` was set to `0.65` in the example, but the actual default in `config.py` is `0.60`. The `ROUTE_MATCH_THRESHOLD` variable was missing entirely from the example.
**Status:** Fixed in this audit.

---

## Low Priority / Documentation

### 9. AGENTS.md table count was stale
**File:** `AGENTS.md`
**Issue:** The Database section said "25 tables" but the actual count is 23 (verified by counting all model classes inheriting from `Base`).
**Status:** Fixed in this audit.

### 10. AGENTS.md Celery table was incomplete
**File:** `AGENTS.md`
**Issue:** The Celery Tasks table was missing `sync_all_whoop_data` and `backfill_streams_for_all_activities`. The `cleanup_old_data` note was misleading ("Streams older than 90 days" vs actual "disabled").
**Status:** Fixed in this audit.

### 11. AGENTS.md Alembic chain was truncated
**File:** `AGENTS.md`
**Issue:** The Alembic numbering pitfall only went to `019`, but the actual chain extends to `023`.
**Status:** Fixed in this audit.

### 12. README.md used `docker compose` instead of `fittrack.py`
**File:** `README.md`
**Issue:** The Quick Start section used `docker compose up -d` but the project uses `fittrack.py` as the primary CLI. The README also referenced outdated `plans/` structure (phase-1 through phase-4 only, but actual plans include many more files).
**Status:** Fixed in this audit.

### 13. DEPLOY.md Python version requirement was outdated
**File:** `docs/DEPLOY.md`
**Issue:** The deploy guide said "Python 3.10+" but `pyproject.toml` requires `>=3.12`. The install commands were also duplicated.
**Status:** Fixed in this audit.

### 14. DEPLOY.md Caddyfile section had duplicated content
**File:** `docs/DEPLOY.md`
**Issue:** The Caddyfile configuration section was duplicated, showing the same `DOMAIN` instructions and `> **Note**` block twice.
**Status:** Fixed in this audit.

### 15. No `health` endpoint in production Caddyfile
**File:** `.github/workflows/deploy.yml`
**Issue:** The production Caddyfile template lacks a `/health` route. The local Caddyfile has `handle /health { reverse_proxy backend:8000 }` but the deploy template omits it. The deploy workflow does a health check via `curl` but if Caddy doesn't route `/health`, the check fails.
**Status:** Fixed — deploy.yml:163 now includes the `/health` route.

---

## Notes

- All thresholds are configurable via environment variables in `config.py`.
- The `EncryptedString` TypeDecorator transparently encrypts/decrypts OAuth tokens at the SQLAlchemy layer.
- The merge priority is Strava (3) > Wahoo (2) > Komoot (1). Lower-priority sources only fill NULL fields.
- Celery tasks use `asyncio.run()` to bridge synchronous Celery workers with async SQLAlchemy sessions.
- The frontend uses relative URLs for all API calls — Caddy or Next.js rewrites handle routing to the backend.