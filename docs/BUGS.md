# FitTrack Bug Report

> Generated: 2026-08-24 | Total: 48 bugs | Fixed: 39 | Deferred: 9

---

## CRITICAL

### BUG-001: Strava Webhook HMAC Verification Crashes
- **Status:** FIXED
- **File:** `backend/app/api/webhooks.py:24`
- **Issue:** `hmac.new()` should be `hmac.HMAC()`. All Strava webhook POST events crash with `AttributeError: module 'hmac' has no attribute 'new'`. Webhook sync is completely broken — only Celery backfill works.
- **Fix:** Replace `hmac.new(...)` with `hmac.HMAC(...)`.

### BUG-002: OAuth Callback Assigns Connections to Wrong User
- **Status:** FIXED
- **File:** `backend/app/api/auth.py:279-282`
- **Issue:** When a new OAuth connection is created (Strava, Whoop, Wahoo), the code falls back to "the most recent user" (`User.order_by(User.created_at.desc()).limit(1)`) instead of the authenticated user. In multi-user deployments, fitness data links to the wrong account.
- **Fix:** Embed user_id in a signed OAuth state parameter during authorize, verify it in callback.

### BUG-003: `/sync-user` Endpoint Has No Authentication
- **Status:** FIXED
- **File:** `backend/app/api/auth.py:40-101`
- **Issue:** `POST /api/v1/auth/sync-user` is called by NextAuth's `signIn` callback but has no auth check. Any anonymous HTTP request can call it with arbitrary email/name/provider_user_id and receive a valid JWT.
- **Fix:** Require a signed token from the NextAuth callback, use a shared secret, or ensure the endpoint is only reachable from within the Docker network.

### BUG-004: Redis Has No Authentication
- **Status:** FIXED
- **File:** `docker-compose.yml:18-26`
- **Issue:** Redis starts without a password and port 6379 is published to the host. Anyone on the network can connect, read session data, write arbitrary data, or inject malicious Celery tasks via the broker URL.
- **Fix:** Add `--requirepass` to Redis command, set `REDIS_PASSWORD` in environment, use `redis://:password@redis:6379/0` for connection URLs, remove port publish in production.

---

## HIGH

### BUG-005: OAuth Error Messages Hardcoded as "Whoop" for All Providers
- **Status:** FIXED
- **File:** `backend/app/api/auth.py:192, 198, 208, 234, 240`
- **Issue:** All error redirect messages say "Whoop" even when the provider is Strava or Wahoo. Misleading user-facing errors and debug logs.
- **Fix:** Replace hardcoded "Whoop" with `provider.capitalize()` or `provider.title()`.

### BUG-006: GPX Download Broken — `__token` Accessor Always Undefined
- **Status:** FIXED
- **File:** `frontend/src/lib/api/routes.ts:47`
- **Issue:** `const token = (authFetchFn as unknown as { __token?: string }).__token` casts the function to access a non-existent property. Token is always `undefined`, so the Authorization header is never set. GPX download returns 401.
- **Fix:** Accept `token` as a separate parameter from `useAuthFetch()` return value.

### BUG-007: Routes Page Uses Absolute URLs (Pitfall #4 Violation)
- **Status:** FIXED
- **File:** `frontend/src/app/(app)/routes/page.tsx:114, 148`
- **Issue:** Both `handleDownloadGpx` and `handleUploadGpx` use `const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'`. Violates Critical Pitfall #4. Breaks in production behind Caddy.
- **Fix:** Use relative URLs (`/api/v1/routes/...`) and get token from `useAuthFetch()`.

### BUG-008: Missing Ownership Check in Decoupling Endpoint (IDOR)
- **Status:** FIXED
- **File:** `backend/app/api/cycling/vo2max.py:149-154`
- **Issue:** `get_decoupling_for_activity` accepts any `activity_id` without verifying it belongs to `current_user`. Any authenticated user can analyze another user's activity data.
- **Fix:** Add ownership check before calling the service function.

### BUG-009: Strava Webhook Doesn't Verify Activity Ownership (IDOR)
- **Status:** FIXED
- **File:** `backend/app/services/strava/webhooks.py:159-175`
- **Issue:** `_handle_activity_update` searches by `provider_activity_id` alone, without filtering by user_id. If multiple users have the same provider_activity_id, a webhook could modify the wrong user's activity. Same issue in `_handle_activity_delete` (line 182).
- **Fix:** Filter by `connection.user_id` from the connection lookup earlier in the flow.

### BUG-010: Strava Webhook POST Skips HMAC Signature Verification
- **Status:** ALREADY FIXED (verified)
- **File:** `backend/app/api/webhooks.py:56-72`
- **Issue:** The POST endpoint accepts the event body and calls `handle_strava_event` without verifying the HMAC signature. Only the GET (challenge verification) checks signatures. Anyone who knows the endpoint URL can forge webhook events.
- **Fix:** Call `_verify_strava_signature` for POST events as well. Extract raw body and `x-hub-signature` header.

### BUG-011: Weak Fernet Key Derivation
- **Status:** FIXED
- **File:** `backend/app/services/encryption.py:31-33`
- **Issue:** Fernet key derived via `settings.secret_key[:32].encode().ljust(32, b"=")`. Short keys are padded with `=`, long keys are truncated. Two different secret keys sharing the first 32 chars produce the same encryption key.
- **Fix:** Use a proper KDF (HKDF, PBKDF2, or `hashlib.sha256(secret_key.encode()).digest()`).

### BUG-012: `backup_database` Celery Task Silently Fails
- **Status:** FIXED
- **File:** `backend/app/tasks/scheduler.py:659-778`
- **Issue:** Task calls `pg_dump` as a subprocess directly, but the backend container uses `python:3.12-slim` which does NOT include `postgresql-client`. Every scheduled backup fails with `FileNotFoundError`.
- **Fix:** Install `postgresql-client` in the backend Dockerfile, or change the task to run `pg_dump` inside the `db` container via `docker exec`.

### BUG-013: Alembic Migration Revision Mismatch
- **Status:** DOCUMENTED (skip — naming only)
- **File:** `backend/alembic/versions/003_add_pr_notes.py`
- **Issue:** File is named `003_add_pr_notes.py` but contains `revision = "004"` and `down_revision = "002"`. Revision `003` is missing from the versions directory. Confusing and indicates a deleted or never-created migration.
- **Fix:** Rename file to `004_add_pr_notes.py` to match revision ID, or create a stub `003` migration.

---

## MEDIUM

### BUG-014: Event Update Doesn't Validate `event_type`
- **Status:** FIXED
- **File:** `backend/app/api/events.py:118-119`
- **Issue:** `update_event` applies `data.model_dump(exclude_unset=True)` without validating `event_type` against `VALID_EVENT_TYPES`. Create validates, but update accepts arbitrary values.
- **Fix:** Add validation for `event_type` if present in the update payload.

### BUG-015: Double-Commit Anti-Pattern
- **Status:** DEFERRED (25 files — high regression risk)
- **Files:** `backend/app/database.py:28-36` + 34 API endpoint files
- **Issue:** `get_db()` auto-commits after endpoint yields. 34+ endpoints also call `await db.commit()` explicitly, causing two commits per request. If the first commit succeeds but something fails before `get_db`'s commit, behavior is unpredictable.
- **Fix:** Remove explicit `await db.commit()` from endpoints and let `get_db` handle all commits. Or remove auto-commit from `get_db` and use explicit commits everywhere.

### BUG-016: Monthly Summary Breaks When `months=1`
- **Status:** FIXED
- **File:** `backend/app/api/dashboard/weekly.py:270-273`
- **Issue:** When `months=1`, `range(months - 2)` produces `range(-1)` (no iterations), making `start_month` yesterday. Then `start_date = start_month.replace(day=1)` yields 1-2 months of data instead of exactly 1.
- **Fix:** Refactor date calculation: iterate `months - 1` times, each time going to the first of the previous month.

### BUG-017: File Upload Endpoints Have No Size Limits
- **Status:** FIXED
- **Files:** `backend/app/api/activities.py:510-598`, `backend/app/api/routes.py:308-348`
- **Issue:** All file upload endpoints read the entire file into memory with `await file.read()` without checking file size. A multi-gigabyte upload causes memory exhaustion.
- **Fix:** Add file size validation before reading. Check `file.size` or limit the read.

### BUG-018: Whoop OAuth State Parameter Not Validated
- **Status:** FIXED
- **File:** `backend/app/api/auth.py:135-148` (authorize), `126-132` (callback)
- **Issue:** The Whoop `get_authorize_url` generates a `state` parameter but it is never stored server-side or validated on callback. An attacker could forge a callback URL with a crafted `code` parameter.
- **Fix:** Store the state in a signed cookie or session during authorize, verify it matches in callback.

### BUG-019: OAuthConnection Lacks Unique Constraint
- **Status:** FIXED
- **File:** `backend/app/models/user.py:78-107`
- **Issue:** No unique constraint on `(user_id, provider)`. Race conditions in concurrent requests can create duplicate connections, leading to duplicate sync operations and conflicting data.
- **Fix:** Add `UniqueConstraint("user_id", "provider", name="uq_oauth_user_provider")` to `__table_args__`.

### BUG-020: Database Session Leak in Whoop Backfill Streaming
- **Status:** FIXED
- **File:** `backend/app/api/connections.py:187-212`
- **Issue:** `backfill_whoop` creates a `StreamingResponse` with an `async_session_factory()` session inside the generator. If the client disconnects mid-stream, the session may not be properly closed.
- **Fix:** Add a `finally` block in the generator to ensure session closure.

### BUG-021: Missing `user_id` Filter in OAuth Callback Connection Lookup
- **Status:** FIXED
- **File:** `backend/app/api/auth.py:257-263`
- **Issue:** Existing connection lookup filters by `provider` and `provider_user_id` but NOT by `user_id`. If two users have the same `provider_user_id`, updating one user's tokens could affect the other.
- **Fix:** Also filter by the authenticated user's ID when available.

### BUG-022: Lifting Date Input Fires Mutation on Every Keystroke
- **Status:** FIXED
- **File:** `frontend/src/app/(app)/lifting/page.tsx:520`
- **Issue:** Session date input uses `onChange` to immediately fire `updateSessionMutation.mutate(...)`. Focus and Notes inputs correctly use `onBlur`. Every keystroke/date-picker change fires a separate PATCH request.
- **Fix:** Change to `onBlur` like the other inputs, or add a debounce/save button.

### BUG-023: Calendar Fetches ALL Lifting Sessions
- **Status:** FIXED
- **File:** `frontend/src/app/(app)/calendar/page.tsx:193-199`
- **Issue:** `authFetch<LiftingSession[]>('/api/v1/lifting/sessions')` fetches every lifting session, then filters client-side. Wasteful and slow with many sessions.
- **Fix:** Add `?session_date=YYYY-MM-DD` query parameter to the backend and use it in the query.

### BUG-024: Stale Closure in Settings `loadConnections` useEffect
- **Status:** FIXED
- **File:** `frontend/src/app/(app)/settings/page.tsx:63-65`
- **Issue:** `useEffect(() => { loadConnections(); }, [])` captures `authFetch` at initial render. If the token changes, the stale `authFetch` with the old token will be used.
- **Fix:** Add `authFetch` to the dependency array, or use a ref to hold the latest `authFetch`.

### BUG-025: OAuth `redirect_uri` Constructed Client-Side
- **Status:** DEFERRED (needs architecture change)
- **File:** `frontend/src/app/(app)/settings/page.tsx:78-83`
- **Issue:** The `callbackUrl` for OAuth is constructed using client-side env vars. If these don't match the backend's `settings.public_url` exactly, the OAuth callback will be rejected by the provider (Critical Pitfall #5).
- **Fix:** Have the backend generate the redirect_uri server-side and return it in the authorize response.

### BUG-026: Cycling Page `setTimeout` Not Cleaned Up on Unmount
- **Status:** FIXED
- **File:** `frontend/src/app/(app)/cycling/page.tsx:207, 211, 235, 239`
- **Issue:** Four `setTimeout(() => setSaveMessage(null), 3000/5000)` calls don't store timeout IDs and don't clear them on component unmount. Causes React state warnings.
- **Fix:** Store timeout IDs in a `useRef` and return a cleanup function from a `useEffect` to clear them.

### BUG-027: Deprecated `datetime.utcnow()` Usage
- **Status:** FIXED
- **File:** `backend/app/tasks/scheduler.py:680, 758`
- **Issue:** `datetime.utcnow()` is deprecated since Python 3.12. Returns naive datetime without timezone info, which can cause comparison bugs with timezone-aware datetimes.
- **Fix:** Use `datetime.now(datetime.UTC)` or `datetime.now(timezone.utc)`.

### BUG-028: Streak Calculation Breaks for Trained-Yesterday Users
- **Status:** FIXED
- **File:** `backend/app/api/dashboard/weekly.py:436-447`
- **Issue:** Initializes `check_date = today`. If user trained yesterday (sorted_dates[0] == today - 1), `d != check_date` is True and `d < check_date` is also True, causing immediate break with `current_streak = 0`. Should be >= 1.
- **Fix:** Initialize `check_date` based on `sorted_dates[0]` instead of `today`.

### BUG-029: Division by Zero in Brzycki SQL Expression
- **Status:** FIXED
- **File:** `backend/app/services/lifting.py:506`
- **Issue:** `(LiftingSet.weight_kg * (36.0 / (37 - LiftingSet.reps))).desc()` crashes when `reps >= 37`. The Python `brzycki_1rm` function guards this, but the SQL expression does not.
- **Fix:** Add a SQL `CASE WHEN` guard or filter out sets with `reps >= 37` in the query.

### BUG-030: Route Merge Ownership Not Verified Pre-Service
- **Status:** VERIFIED (service already checks ownership)
- **File:** `backend/app/api/routes.py:351-370`
- **Issue:** `merge_routes` passes `body.primary_route_id` and `body.duplicate_route_id` directly to the service without first verifying both routes belong to the current user. The service does verify, but this is defense-in-depth only.
- **Fix:** Add an ownership check before calling the service function.

---

## LOW

### BUG-031: Boolean Comparison Anti-Pattern in SQLAlchemy Queries
- **Status:** FIXED
- **Files:** `backend/app/api/dashboard/yearly.py:317`, `backend/app/services/lifting.py:502, 788`, `backend/app/services/charts.py:800`
- **Issue:** Uses `LiftingSet.is_warmup == False` instead of the idiomatic `LiftingSet.is_warmup.is_(False)`. Linter flag E712. Can generate incorrect SQL in edge cases.
- **Fix:** Replace with `.is_(False)`.

### BUG-032: `_safe_float` Duplicated Across 3 Files
- **Status:** FIXED
- **Files:** `backend/app/services/strava/sync.py:24`, `backend/app/services/wahoo.py:27`, `backend/app/services/fit_parser.py:31`
- **Issue:** Identical `_safe_float` function defined in three separate service files. DRY violation.
- **Fix:** Extract to a shared utility module (e.g., `app/utils.py`).

### BUG-033: Komoot `sources.any()` Uses Legacy Syntax
- **Status:** FIXED
- **File:** `backend/app/services/komoot.py:252`
- **Issue:** `Route.sources.any(provider="komoot", ...)` uses legacy `relationship.any()` syntax which can produce incorrect SQL with async sessions.
- **Fix:** Use a subquery or `Route.sources.any(RouteSource.provider == "komoot")`.

### BUG-034: Weekly Report Cardio TSS Doesn't Filter Out Wahoo
- **Status:** FIXED
- **File:** `backend/app/api/dashboard/weekly.py:73-86`
- **Issue:** Cardio TSS query filters by sport type but does NOT exclude `Activity.source == "wahoo"`. Inconsistent with other dashboard queries that exclude Wahoo sources.
- **Fix:** Add `Activity.source != "wahoo"` to the filter conditions.

### BUG-035: Whoop Backfill Sleep Uses select+update Instead of Upsert
- **Status:** FIXED
- **File:** `backend/app/services/whoop.py:1376-1410`
- **Issue:** Uses select-then-update/insert instead of `pg_insert().on_conflict_do_update()` used by `sync_whoop_sleep`. Creates race condition on concurrent backfills.
- **Fix:** Use the same `pg_insert(SleepLog).on_conflict_do_update()` pattern.

### BUG-036: `backfill_whoop_chunked` Calls `db.commit()` Directly
- **Status:** FIXED
- **File:** `backend/app/services/whoop.py:1626`
- **Issue:** The async generator calls `await db.commit()` directly, conflicting with `get_db` dependency's auto-commit behavior. Redundant and could cause issues if generator is interrupted.
- **Fix:** Remove the explicit commit and let `get_db` handle it.

### BUG-037: LLM Analysis Uses Potentially Invalid Model Name
- **Status:** FIXED
- **File:** `backend/app/services/llm_analysis.py:19`
- **Issue:** `GEMINI_MODEL = "gemini-3.6-flash"` may not exist. Google's Gemini models follow different naming (e.g., `gemini-2.0-flash`). LLM analysis calls may fail.
- **Fix:** Verify the correct model name with Gemini API documentation.

### BUG-038: Komoot `_ensure_basic_token` References Uninitialized Attributes
- **Status:** FIXED
- **File:** `backend/app/integrations/komoot_client.py:73-89`
- **Issue:** `_ensure_basic_token()` references `self._basic_token` and `self._basic_token_expires`, but `__init__` only initializes `_session_token`, `_session_token_expires`, and `_user_id`. Would crash with `AttributeError` if called. Currently dead code.
- **Fix:** Initialize `self._basic_token` and `self._basic_token_expires` in `__init__`, or remove the dead method.

### BUG-039: `handleAnalyze` Uses Manual Promise Chain Instead of `useMutation`
- **Status:** DEFERRED (frontend refactor)
- **File:** `frontend/src/app/(app)/dashboard/page.tsx:177-187`
- **Issue:** Manages `setIsAnalyzing`, `.then()`, `.catch()`, `.finally()` instead of using React Query's `useMutation`. Inconsistent with every other mutation in the codebase.
- **Fix:** Refactor to use `useMutation` like the `llmMutation` on line 136.

### BUG-040: 30+ Props Drilled into `WeeklyTab`
- **Status:** DEFERRED (frontend refactor)
- **File:** `frontend/src/app/(app)/dashboard/page.tsx:263-304`, `frontend/src/components/dashboard/WeeklyTab.tsx:32-73`
- **Issue:** `WeeklyTab` has a 30+ property interface. Fragile and hard to maintain. Many props could be encapsulated in their own components or React Context.
- **Fix:** Split into smaller self-contained components or use a DashboardContext.

### BUG-041: 200+ Lines of Duplicated Monthly/Yearly Rendering
- **Status:** DEFERRED (frontend refactor)
- **Files:** `frontend/src/components/dashboard/WeeklyTab.tsx`, `frontend/src/components/dashboard/MonthlyTab.tsx`
- **Issue:** Monthly summary card rendering, yearly summary, year-over-year badges, highlight cards, and PR highlights table are nearly identical between the two components.
- **Fix:** Extract shared monthly/yearly rendering into reusable components.

### BUG-042: `dangerouslySetInnerHTML` Used for Plain Strings
- **Status:** FIXED
- **File:** `frontend/src/app/(app)/wiki/page.tsx:236`
- **Issue:** `<span dangerouslySetInnerHTML={{ __html: f }} />` renders feature list items that are plain strings with no HTML content. Unnecessary and a security anti-pattern.
- **Fix:** Replace with `{f}`.

### BUG-043: IIFE in JSX for Health Metric Badges
- **Status:** DEFERRED (frontend refactor)
- **File:** `frontend/src/app/(app)/calendar/page.tsx:908`
- **Issue:** `{metricsByDate.has(dateKey) && (() => { ... })()}` uses an immediately-invoked function expression inside JSX. Runs on every render and can't be memoized.
- **Fix:** Extract to a `DayMetricsBadges` component.

### BUG-044: `formatDuration` Inconsistency Between Pages
- **Status:** DEFERRED (frontend refactor)
- **File:** `frontend/src/app/(app)/calendar/page.tsx:115-120`
- **Issue:** Calendar `formatDuration` drops seconds (returns `{mins}m` when hrs=0), while activities page includes seconds (`{mins}m {secs}s`). Sub-minute activities show as `0m` in calendar.
- **Fix:** Unify to a single shared `formatDuration` utility.

### BUG-045: Live Secrets in Working Directory `.env`
- **Status:** DEFERRED (manual rotation required)
- **File:** `.env`
- **Issue:** Contains real credentials: Komoot password (`Java12345`), Gemini API key, SECRET_KEY, NEXTAUTH_SECRET. While gitignored, this file should never contain production credentials on a shared machine.
- **Fix:** Rotate all exposed credentials immediately. Use a secrets manager or only store credentials on the production server.

### BUG-046: Deploy Caddyfile Missing `@nextauth` Redirect Rule
- **Status:** FIXED
- **File:** `.github/workflows/deploy.yml:142-165`
- **Issue:** The production deploy script generates a Caddyfile that does NOT include the `@nextauth` redirect rule from the dev Caddyfile. NextAuth error callbacks will show a blank page or 404.
- **Fix:** Add the `redir @nextauth /fittrack{uri} permanent` rule to the heredoc Caddyfile.

### BUG-047: `package-lock.json` Gitignored
- **Status:** FIXED
- **File:** `.gitignore:14`
- **Issue:** `frontend/package-lock.json` is explicitly gitignored. Dependency resolution is not reproducible across environments. CI workflow tries to cache based on this file but it may not exist.
- **Fix:** Remove `frontend/package-lock.json` from `.gitignore` and commit it.

### BUG-048: Caddyfile Placeholder Email for ACME
- **Status:** DEFERRED (deployment-specific — should be set per-deploy)
- **File:** `infra/Caddyfile:2`
- **Issue:** `email admin@example.com` is a placeholder. When deploying to a real domain, Caddy will attempt ACME challenges using this unreachable email. No certificate expiry warnings.
- **Fix:** Use the actual domain owner's email in the deploy script.

---

## Priority Fix Order

### Immediate (security/data integrity)
1. BUG-001 — `hmac.new()` → `hmac.HMAC()` (Strava webhooks broken)
2. BUG-003 — Protect `/sync-user` endpoint
3. BUG-002 — Fix OAuth callback user assignment
4. BUG-004 — Add Redis authentication
5. BUG-010 — Add HMAC verification to webhook POST
6. BUG-008, BUG-009 — Fix IDOR vulnerabilities

### Next sprint
7. BUG-006, BUG-007 — Fix routes page GPX download/auth
8. BUG-012 — Fix backup task
9. BUG-011 — Improve encryption key derivation
10. BUG-014 through BUG-030 — Medium severity fixes

### Backlog
11. BUG-031 through BUG-048 — Low severity / code quality
