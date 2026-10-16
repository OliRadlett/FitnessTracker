# FitTrack Bug Report — Active Bugs

> **Updated**: 2026-10-16 | Total tracked: 99 | **Open: 6** | Fixed: 82 (archived, see `BUGS-archive.md` and git history)

## Open Bugs

### BUG-013: Alembic Migration Revision Filename Mismatch
- **Status:** DOCUMENTED (skip — naming only)
- **File:** `backend/alembic/versions/003_add_pr_notes.py`
- **Issue:** File is named `003_add_pr_notes.py` but contains `revision = "004"` and `down_revision = "002"`. Revision `003` is missing from the versions directory. Confusing and indicates a deleted or never-created migration.
- **Fix:** Rename file to `004_add_pr_notes.py` to match revision ID, or create a stub `003` migration.

### BUG-015: Double-Commit Anti-Pattern
- **Status:** FIXED (2026-09-30 — one documented carve-out remains)
- **Files:** `backend/app/database.py:28-36` + `backend/app/api/webhooks.py:105`
- **Issue:** `get_db()` auto-commits after endpoint yields. 34+ endpoints also called `await db.commit()` explicitly, causing two commits per request.
- **Fix:** Removed explicit commits across all endpoints (pilot #196 + follow-ups). The sole remainder is the Strava webhook receiver, which uses a manually-created `async_session_factory()` session (not `get_db`) and must durably queue one row before returning 200 — documented carve-out in code.

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

### BUG-099: Adaptive Rest-Day Advice Carries No Apply Action
- **Status:** OPEN (the emission is guarded; the fix needs a product call)
- **File:** `backend/app/services/adaptive.py` (`generate_adaptive_suggestions`)
- **Issue:** The `rest_day` suggestion's actions are attached inside `if factor is not None and upcoming:`, but `rest_day` is emitted only when recovery is below `RECOVERY_LOW`, and that same low recovery suppresses the load axis, which is the only source of an `intensity_cut` / `intensity_raise` suggestion. So `factor` is always `None` whenever a rest day is advised, and the loop that fills `actions` never runs — both cards (`AdaptiveSuggestionsCard`, `TodayAdaptiveAction`) show rest advice with no button. The action was live for one day after it landed (2026-09-08) and stopped when the load axis gained its `not recovery_low` gate (`904d267`, 2026-09-09). No test covered it, so nothing went red.
- **Fix:** Hoist the rest loop out of the `factor` gate so rest advice carries actions, and decide there whether it offers one action or one per upcoming day (the suggestion's own detail says "the next non-rest session"). `_actions_for(force_rest=True)` already skips a date holding more than one session, which is what the apply endpoint would refuse with a 409.
