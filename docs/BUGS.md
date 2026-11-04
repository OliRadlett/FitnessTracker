# FitTrack Bug Report — Active Bugs

> **Updated**: 2026-11-04 | Total tracked: 99 | **Open: 5** | Fixed: 84 (archived, see `BUGS-archive.md` and git history)
>
> BUG-013 (the file is `004_add_pr_notes.py` with `revision = "004"`) and BUG-015
> (double-commit removed) were fixed long ago; they are no longer listed as open.

## Open Bugs

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
- **Fix:** Hoist the rest loop out of the `factor` gate so rest advice carries actions, and decide there whether it offers one action or one per upcoming day (the suggestion's own detail says "the next non-rest session"). The hoist must also re-add the guard the dead path carried: a date holding more than one session gets no rest action, because the action's intent is to rest a *day* and the apply endpoint would refuse it with a 409 (`update_plan_day` finds the other session and raises `PlanDayConflictError`). That guard was removed along with the rest of the unreachable path, so nothing re-adds it for you.
