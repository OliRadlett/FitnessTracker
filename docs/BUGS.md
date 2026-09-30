# FitTrack Bug Report — Active Bugs

> **Updated**: 2026-09-30 | Total tracked: 101 | **Open: 8** | Fixed: 82 (archived, see `BUGS-archive.md` and git history)

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
  3. Separately, make sure something alerts. Prometheus has a 5xx-rate rule (`infra/prometheus/alerts.yml`) whose matcher is correct — see BUG-071 for the verified reason — but **no alerting exists in production at all right now**. Monitoring is an opt-in overlay that has never been brought up.

### BUG-070: No Access Logs in Production — 500s Are Unauditable
- **Status:** DOCUMENTED (found during the 087 deploy failure, 2026-09-29)
- **File:** `docker-compose.prod.yml:40`, `backend/Dockerfile:13`
- **Issue:** Neither uvicorn invocation passes `--access-log`. `docker-compose.prod.yml:40` runs `uvicorn app.main:app --host 0.0.0.0 --port 8000`, and the image `CMD` matches. The backend log on the Droplet totalled **6 lines** — no request or response lines at all.
- **Impact:** Combined with BUG-069, a 500 loop is nearly invisible in the logs. Post-incident verification of the 087 outage rested on the verification agent issuing its own requests; the container had been recreated and the failed deploy's logs were gone, so the original 500s could not be audited. Note that uvicorn access logging appears to be off by default in this setup rather than deliberately disabled — worth confirming before treating the current state as intentional.
- **Fix:** Add `--access-log` to the prod `command:` in `docker-compose.prod.yml`. Prefer structured output over uvicorn's plain-text access lines: the project already emits JSON in production and attaches correlation IDs via middleware, so route through the existing logger rather than adding a second, differently-formatted stream. If plain `--access-log` is the lower-risk first step, enable it and note the format split as follow-up. Watch the backend's `mem_limit: 250m` after enabling — access logs are write-bound and should not move it, but verify.

### BUG-071: No Metrics and No Alerting in Production — Monitoring Is an Opt-In Overlay Never Brought Up
- **Status:** DOCUMENTED (confirmed against the live Droplet, 2026-09-30)
- **File:** `infra/prometheus/`, `docker-compose.monitoring.yml`, `infra/alertmanager/alertmanager.yml`, `backend/app/main.py:183-186`
- **Issue:** All three links in the alerting chain are missing in production. (1) `ENABLE_METRICS` is **absent** from the Droplet `.env` — the backend container's full environment was dumped and it is not there, despite `docs/DEPLOY.md` documenting it. (2) Consequently `/metrics` returns **HTTP 404** (confirmed on both `127.0.0.1:8000` and `http://backend:8000/metrics` from the caddy container): `should_respect_env_var=True` means the route is never even registered when the var is unset. (3) Prometheus and Alertmanager **do not exist at all** — no containers, no systemd units, nothing listening on 9090/9093. Monitoring is an opt-in overlay (`docker-compose.monitoring.yml`, whose own header says "not part of the default stack") requiring a manual three-file compose command, and `.github/workflows/deploy.yml` contains no reference to it, so it has never been started and would not survive a redeploy if it were.
- **Impact:** Production has **no alerting whatsoever**. This is worse than "monitoring is misconfigured" — nothing would have woken anyone for the 087 outage, and nothing will for the next one. `docs/DEPLOY.md` and `alerts.yml` both read as though alerting is in place, which is the more dangerous failure: the false-green `/health` (BUG-069) plus an absent Prometheus means a complete outage is invisible from every angle at once.
- **Fix:** In order — steps 3 and 4 are what make it real; doing only step 2 leaves you silently un-alerted.
  1. Add `ENABLE_METRICS=true` to the Droplet `.env`. This reaches the container (the backend service uses `env_file: .env`) and a `docker compose up -d backend` recreate picks it up. Consistent with the existing SEC-01 loopback-only policy, so no auth work needed.
  2. Bring up the overlay **and add it to `deploy.yml`**, or the containers will be torn down on the next deploy:
     `docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.monitoring.yml up -d prometheus alertmanager`
  3. Wire a real Alertmanager receiver. `infra/alertmanager/alertmanager.yml` is `receiver: 'log-only'` with a `TODO: add Slack api_url (or SMTP)` — a firing alert currently only prints to container logs. Do not treat `severity: critical` as paging until a real receiver is configured. There is also no Grafana container despite `infra/grafana/` existing.
  4. Consider a smoke test that asserts `/metrics` returns exposition text with a non-zero `http_requests_total`, so the chain is verified by CI or a post-deploy step rather than assumed.

- **Non-bug, verified — do not "fix" this:** the `status="5xx"` matcher in `alerts.yml` is **correct**. `should_group_status_codes` defaults to `True` in `prometheus-fastapi-instrumentator` 8.1.0 and `main.py` never overrides it, so status labels are grouped. Verified empirically: a request returning 500 produces `http_requests_total{handler="…",method="GET",status="5xx"} 1.0` and a 200 produces `status="2xx"`. Note the trap — with `ENABLE_METRICS` unset the instrumentator records *nothing at all* (an empty exposition, not ungrouped labels), which can easily be misread as "the matcher is broken".
