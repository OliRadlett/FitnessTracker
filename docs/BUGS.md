# FitTrack Bug Report — Active Bugs

> **Updated**: 2026-09-29 | Total tracked: 98 | **Open: 5** | Fixed: 82 (archived, see `BUGS-archive.md` and git history)

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
