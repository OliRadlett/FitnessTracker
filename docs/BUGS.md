# FitTrack Bug Report — Active Bugs

> **Updated**: 2026-09-30 | Total tracked: 100 | **Open: 7** | Fixed: 82 (archived, see `BUGS-archive.md` and git history)

## Open Bugs

### BUG-013: Alembic Migration Revision Filename Mismatch
- **Status:** DOCUMENTED (skip — naming only)
- **File:** `backend/alembic/versions/003_add_pr_notes.py`
- **Issue:** File is named `003_add_pr_notes.py` but contains `revision = "004"` and `down_revision = "002"`. Revision `003` is missing from the versions directory. Confusing and indicates a deleted or never-created migration.
- **Fix:** Rename file to `004_add_pr_notes.py` to match revision ID, or create a stub `003` migration.

### BUG-015: Double-Commit Anti-Pattern
- **Status:** DEFERRED (25 files — high regression risk)
- **Files:** `backend/app/database.py:28-36` + 34 API endpoint files
- **Issue:** `get_db()` auto-commits after endpoint yields. 34+ endpoints also call `await db.commit()` explicitly, causing two commits per request. If the first commit succeeds but something fails before `get_db`'s commit, behavior is unpredictable.
- **Fix:** Remove explicit `await db.commit()` from endpoints and let `get_db` handle all commits. Or remove auto-commit from `get_db` and use explicit commits everywhere.

### BUG-025: OAuth `redirect_uri` Constructed Client-Side
- **Status:** DEFERRED (needs architecture change)
- **File:** `frontend/src/app/(app)/settings/page.tsx`
- **Issue:** The `callbackUrl` for OAuth is constructed using client-side env vars. If these don't match the backend's `settings.public_url` exactly, the OAuth callback will be rejected by the provider (Pitfall #5).
- **Fix:** Have the backend generate the redirect_uri server-side and return it in the authorize response.

### BUG-045: Live Secrets in Working Directory `.env`
- **Status:** DEFERRED (manual rotation required)
- **File:** `.env`
- **Issue:** Contains real credentials: Komoot password, Gemini API key, SECRET_KEY, NEXTAUTH_SECRET. While gitignored, this file should never contain production credentials on a shared machine.
- **Fix:** Rotate all exposed credentials immediately. Use a secrets manager or only store credentials on the production server.

### BUG-048: Caddyfile Placeholder Email for ACME
- **Status:** DEFERRED (deployment-specific — should be set per-deploy)
- **File:** `infra/Caddyfile`
- **Issue:** `email admin@example.com` is a placeholder. When deploying to a real domain, Caddy will attempt ACME challenges using this unreachable email. No certificate expiry warnings.
- **Fix:** Use the actual domain owner's email in the deploy script.

### BUG-068: Nutrition Fuel Plan "Could not load fuel plan"
- **Status:** INVESTIGATING (latent defects fixed)
- **File:** `frontend/src/components/cycling/FuelPlanCard.tsx`, `backend/app/api/nutrition.py`
- **Issue:** GET /fuel-plan/activity/{id} consistently errors. Root cause unclear from static analysis — needs live diagnosis (possible missing migration, auth edge, or serialization issue). Latent defects fixed: actuals clearing now works (empty string → null), regenerate/delete buttons added, error message now shows actual error detail, FuelPlanCard consolidated to use API helpers.
- **Fix:** Added error logging to backend endpoint, improved frontend error display, fixed actuals clearing semantics, added regenerate/delete UI.

### BUG-069: `/health` Reports OK While Every Activity Query 500s
- **Status:** DOCUMENTED (found during the 087 deploy failure, 2026-09-29)
- **File:** `backend/app/main.py:41-60` (lifespan), `backend/app/main.py:145-177` (`/health`)
- **Issue:** Migration 087 crashed `alembic upgrade head` on `sa.JSONB()` (`AttributeError` — JSONB is a `sqlalchemy.dialects.postgresql` type, absent from the top-level namespace). Two things combined to hide it. (1) The lifespan handler catches the failure, logs `ERROR "Alembic migration failed"`, and **continues startup** — it never re-raises, so the container comes up healthy. (2) `/health` only pings `SELECT 1` plus Redis, which both succeed against the *old* schema. Result: `/health` returned `200 {"status":"ok","db":"ok","redis":"ok"}` while every endpoint touching the Activity model raised `UndefinedColumn` and returned 500 — new code against a schema missing `activities.road_match` / `road_embedding` / `road_match_version`. Caddy's healthcheck and any uptime monitor saw a green service.
- **Impact:** Production was fully broken with a green health signal. Detection relied entirely on someone reading GitHub Actions logs, and the error only surfaced there because the deploy workflow's alembic step exits non-zero — the app itself never objected.
- **Fix:** Two independent changes; neither alone is sufficient.
  1. Make the migration outcome *observable*. Record the result in a module-level `MIGRATION_STATE` dict (`{"ok": bool, "error": str | None, "revision": str | None}`) set inside the existing `try`/`except` in `lifespan`. Do **not** re-raise — failing startup on any migration error turns a partial deploy into a crash-loop that hides the original error, which is what `restart: unless-stopped` would turn into.
  2. Have `/health` report it. Add a `migrations` key to both the ok and degraded payloads (`"ok"`, or `"failed: <last line of stderr>"`) and return `503` when the migration did not succeed. Keep `/health` unauthenticated — required by Caddy and the `infra/` monitors (see `docs/DEPLOY.md` "Endpoint access policy") — but truncate the error to a single line so an alembic traceback cannot flood the response body.
  3. Separately, make sure something alerts. Prometheus already has a 5xx-rate rule (`infra/prometheus/alerts.yml`) that would have caught this, but only once `ENABLE_METRICS=true` is set on the Droplet. Verify that flag is actually set: monitoring that is documented but not enabled is the same false-green failure in a different costume.

### BUG-070: No Access Logs in Production — 500s Are Unauditable
- **Status:** DOCUMENTED (found during the 087 deploy failure, 2026-09-29)
- **File:** `docker-compose.prod.yml:40`, `backend/Dockerfile:13`
- **Issue:** Neither uvicorn invocation passes `--access-log`. `docker-compose.prod.yml:40` runs `uvicorn app.main:app --host 0.0.0.0 --port 8000`, and the image `CMD` matches. The backend log on the Droplet totalled **6 lines** — no request or response lines at all.
- **Impact:** Combined with BUG-069, a 500 loop is nearly invisible in the logs. Post-incident verification of the 087 outage rested on the verification agent issuing its own requests; the container had been recreated and the failed deploy's logs were gone, so the original 500s could not be audited. Note that uvicorn access logging appears to be off by default in this setup rather than deliberately disabled — worth confirming before treating the current state as intentional.
- **Fix:** Add `--access-log` to the prod `command:` in `docker-compose.prod.yml`. Prefer structured output over uvicorn's plain-text access lines: the project already emits JSON in production and attaches correlation IDs via middleware, so route through the existing logger rather than adding a second, differently-formatted stream. If plain `--access-log` is the lower-risk first step, enable it and note the format split as follow-up. Watch the backend's `mem_limit: 250m` after enabling — access logs are write-bound and should not move it, but verify.
