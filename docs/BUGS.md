# FitTrack Bug Report

> Generated: 2026-08-24 | Total: 61 bugs | Fixed: 43 | Deferred: 9

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
- **Status:** FIXED
- **File:** `frontend/src/app/(app)/dashboard/page.tsx`
- **Issue:** Manages `setIsAnalyzing`, `.then()`, `.catch()`, `.finally()` instead of using React Query's `useMutation`. Inconsistent with every other mutation in the codebase.
- **Fix:** Refactored to `useMutation` (`analyzeMutation`) with `onSuccess`/`onError`/`onSettled`.

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
- **Status:** FIXED
- **File:** `frontend/src/app/(app)/calendar/page.tsx`
- **Issue:** `{metricsByDate.has(dateKey) && (() => { ... })()}` uses an immediately-invoked function expression inside JSX. Runs on every render and can't be memoized.
- **Fix:** Extracted to a `DayMetricsBadges` component; moved `getRecoveryBg`/`getRecoveryColor` to module scope.

### BUG-044: `formatDuration` Inconsistency Between Pages
- **Status:** FIXED
- **File:** `frontend/src/app/(app)/calendar/page.tsx`, `frontend/src/app/(app)/activities/page.tsx`
- **Issue:** Calendar `formatDuration` drops seconds (returns `{mins}m` when hrs=0), while activities page includes seconds (`{mins}m {secs}s`). Sub-minute activities show as `0m` in calendar.
- **Fix:** Created shared `formatDuration`/`formatDistance` in `frontend/src/lib/utils.ts`; calendar and activities now import it.

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

### BUG-049: VO2max ACSM Formula Double-Divides by Body Weight
- **Status:** FIXED
- **File:** `backend/app/services/cycling/vo2max.py`
- **Issue:** `(10.8 * W) / kg + 7` already yields ml/kg/min, but code then did `(result * 1000) / kg` again — producing values ~470 that always failed the 20–90 sanity check. The power-based method (primary, confidence 0.7) never produced a result; all users only ever saw HR-based estimates.
- **Fix:** Extracted `_acsm_vo2max()` helper with correct formula; fixed at all call sites (5-min, 8-min, history). Also: selection now prefers highest-confidence estimate instead of highest value; profile fetched once per estimate; history flags `weight_defaulted` when falling back to 75kg.

### BUG-050: Whoop Respiratory Rate Backfill Misses Partial Recovery Records
- **Status:** FIXED
- **File:** `backend/app/services/whoop.py`, `backend/app/integrations/whoop_client.py`
- **Issue:** Recovery backfill pass only targeted `recovery_score IS NULL` — days where Whoop returned recovery_score but no respiratory_rate were permanently locked out of backfill. Additionally `get_recovery_for_cycle()` swallowed 500-series errors as `None`, and both `backfill_whoop_data()` and the sync second-pass had no retry logic (`logger.debug` hid failures in production).
- **Fix:** Backfill queries now match `(recovery_score IS NULL) OR (respiratory_rate IS NULL)`; client raises transient errors so caller retry/backoff logic applies; 3x rate-limit retry loops added to all recovery backfill passes; failure logs upgraded to `warning`; gap detection warns on missing days within the synced range; stale flat-response docstring corrected to nested v2 shape.

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

---

## SYNC JOBS AUDIT (2026-08-25)

### BUG-051: Celery Tasks Crash with asyncpg Cross-Loop Pool Errors
- **Status:** FIXED
- **File:** `backend/app/database.py`, `backend/app/tasks/scheduler.py`
- **Issue:** Module-level `async_session_factory` creates a connection pool bound to the first event loop. Each Celery task calls `asyncio.run()` which creates a new loop. Pooled connections from loop A get reused on loop B → `InterfaceError: another operation is in progress` / `Future attached to a different loop`. All main sync tasks (Strava/Wahoo/Whoop/routes) were failing.
- **Fix:** Added `task_session()` context manager that creates a fresh engine per invocation. All tasks updated to use it.

### BUG-052: `int(None)` Crash on Strava `moving_time`
- **Status:** FIXED
- **File:** `backend/app/services/strava/sync.py:105,213,386`, `backend/app/services/strava/webhooks.py:75`
- **Issue:** `int(sa.get("moving_time", 0))` returns `None` when key exists with JSON null (manual/indoor entries). `int(None)` → `TypeError` kills the entire user sync.
- **Fix:** Changed to `int(sa.get("moving_time") or 0)` at all 4 locations.

### BUG-053: Whoop Sync Refetches Full History Every 30 Minutes
- **Status:** FIXED
- **File:** `backend/app/services/whoop.py`, `backend/app/tasks/scheduler.py`
- **Issue:** All Whoop sync functions passed no date filter, defaulting to limit=500 records. Every 30-min run fetched up to 500 cycles + 500 sleep + 500 workouts. Recovery second-pass had no date bound, re-scanning all history forever. Took 21+ minutes per run.
- **Fix:** Added `last_synced_at` watermark to `OAuthConnection` (migration 031). Scheduler passes `start=` filters derived from watermark (−24h overlap). Recovery second-pass bounded to cycle dates fetched this run.

### BUG-054: Wahoo Sync Walks Full History Every 30 Minutes
- **Status:** FIXED
- **File:** `backend/app/services/wahoo.py`
- **Issue:** No date filter and skipped workouts don't count toward `limit`. After first run, every subsequent run paginates through entire workout history executing dedup queries per item.
- **Fix:** Added early-exit: stops after 3 consecutive pages with no new workouts.

### BUG-055: Komoot Routes Synced Per-User with Global Credentials
- **Status:** FIXED
- **File:** `backend/app/tasks/scheduler.py`
- **Issue:** Komoot uses global Basic Auth credentials but the sync ran once per user in the route-sync loop. First user owns all routes; users 2..N perform full redundant API crawls creating nothing.
- **Fix:** Moved Komoot sync outside the per-user loop — runs once using the first user for route ownership.

### BUG-056: Orphaned Streams Backfill Task Never Scheduled
- **Status:** FIXED
- **File:** `backend/app/tasks/scheduler.py`
- **Issue:** `backfill_streams_for_all_activities` task was registered but absent from `beat_schedule` and never dispatched. Dead code.
- **Fix:** Added to beat schedule: weekly Saturday 3AM UTC. Upgraded DEBUG failure logs to WARNING.

### BUG-057: Whoop Recovery Second-Pass Duplicated (Sync + Backfill)
- **Status:** FIXED
- **File:** `backend/app/services/whoop.py`
- **Issue:** Identical recovery second-pass logic copy-pasted in `sync_whoop_cycles` and `backfill_whoop_data`. Backfill copy was unbounded (no date filter) and used `or_(recovery_score IS NULL, respiratory_rate IS NULL)` making records permanently match.
- **Fix:** Extracted shared `_backfill_missing_recovery()` helper. Both callers now use it with date bounds. Dropped `respiratory_rate IS NULL` disjunct from scheduled sync.

### BUG-058: Whoop Backfill SSE Reports Success on Partial Failure
- **Status:** FIXED
- **File:** `backend/app/services/whoop.py`
- **Issue:** Failed chunks yielded `error` events but the stream still finished with `type:"complete"` and aggregate counts that silently omitted the failed chunk.
- **Fix:** Added `chunks_failed` counter to the `complete` event. Detail message now includes failure count.

### BUG-059: Cycling Page Streams Button Force-Refetches Everything
- **Status:** FIXED
- **File:** `frontend/src/app/(app)/cycling/page.tsx:262`
- **Issue:** Hardcoded `force=true&days=3650&limit=500` — every click deleted and re-downloaded up to 500 streams instead of filling gaps.
- **Fix:** Changed to `days=90&limit=50` (gap-fill mode, no force).

### BUG-060: No Concurrency Guard on Backfill Endpoints
- **Status:** FIXED
- **File:** `backend/app/api/connections.py`, `backend/app/api/activities.py`, `backend/app/api/cycling/ftp.py`
- **Issue:** Double-clicking or overlapping manual/Celery runs could produce redundant API load and race conditions.
- **Fix:** Added Redis-based distributed locks (`redis_lock`) to Whoop backfill, Strava backfill, and streams backfill endpoints.

### BUG-061: Route-Link Backfill N+1 Query
- **Status:** FIXED
- **File:** `backend/app/services/merge_service.py`
- **Issue:** `backfill_activity_route_links` called `link_activity_to_route` per activity, which re-queried all user routes each time. O(A×R) queries.
- **Fix:** Pre-fetch routes once and pass to `link_activity_to_route` via optional `routes` parameter.

---

## AUDIT REMEDIATION (2026-08-25)

### BUG-062: `redis_lock` Releases Locks It No Longer Owns
- **Status:** FIXED
- **File:** `backend/app/services/cache.py:38-56`
- **Issue:** `finally: await r.delete(key)` unconditionally deletes the lock key. If work exceeds TTL (600s–3600s), the lock expires, a successor acquires it, and the original caller's `finally` deletes the successor's lock — allowing a third caller in concurrently.
- **Fix:** Token-based release via Lua compare-and-delete script. Each acquisition stores a random `secrets.token_hex(16)` as the value; release only deletes if the stored value matches.

### BUG-063: Celery Per-User Except Blocks Never Roll Back Poisoned Sessions
- **Status:** FIXED
- **File:** `backend/app/tasks/scheduler.py` (all per-user task loops)
- **Issue:** If a user's DB operation fails mid-flush, the asyncpg session enters `PendingRollbackError` state. Subsequent users' operations all fail silently (logged as warnings). Final commit commits nothing or partial data.
- **Fix:** Added `await db.rollback()` in every per-user except block across all 6 task loops (Strava sync, Whoop sync, routes, FTP, weather, goals).

### BUG-064: Strava/Wahoo Watermarks Committed Only at Task End
- **Status:** FIXED
- **File:** `backend/app/tasks/scheduler.py` (sync_all_strava_activities, sync_all_whoop_data)
- **Issue:** `last_synced_at` watermarks set per-user but single `db.commit()` at task end. Mid-task crash rolls back all watermarks → next run re-syncs full history (API quota burn).
- **Fix:** Commit per-user after each successful sync. Watermarks now survive mid-task crashes.

### BUG-065: `compute_metric_trend` Returns Empty Trend for 9 of 13 Registry Metrics
- **Status:** FIXED
- **File:** `backend/app/services/projections.py:336-380`
- **Issue:** History branches existed only for `ftp_watts`, `body_weight`, `resting_hr`, `hrv_ms`. For `estimated_1rm`, `weekly_tss`, `vo2max`, bw-ratios, `big3_total`, `weekly_sessions`, `monthly_distance_km` — silently returned `trend: null` despite having data.
- **Fix:** Added history branches for all 13 metrics, reusing PersonalRecord queries (lifting metrics), activity aggregations (weekly/monthly), and `compute_vo2max_history` (VO2max).

### BUG-066: Exercise Library Listing Fails (422)
- **Status:** FIXED
- **File:** `backend/app/api/lifting.py:283`
- **Issue:** `GET /exercises` endpoint caps `limit` at `le=50` but frontend requests `limit=200` → 422 validation error. Listing never works; adding works because POST body is unvalidated dict.
- **Fix:** Raised cap to `le=200`, default to 50. Also fixed delete mutation sending name instead of UUID, routed ExerciseManager through `lib/api/exercises.ts` helpers.

### BUG-067: Recharts Brush Renders "undefined" and "NaN" on X-Axis
- **Status:** FIXED
- **File:** `frontend/src/components/charts/Chart.tsx:265-267, 351-354`
- **Issue:** `<Brush>` added to line/area charts with >20 data points without `ariaLabel`, `startIndex`/`endIndex`, or `tickFormatter`. Recharts Brush with category XAxis emits literal "undefined" labels and NaN scale geometry. Affects ~11 charts.
- **Fix:** Extracted `renderBrush()` helper with `ariaLabel="Zoom range"`, explicit `startIndex`/`endIndex`, and `tickFormatter` reusing `formatDateTick`. Also guarded pie percent NaN and tooltip labelFormatter undefined.

### BUG-068: Nutrition Fuel Plan "Could not load fuel plan"
- **Status:** INVESTIGATING (latent defects fixed)
- **File:** `frontend/src/components/cycling/FuelPlanCard.tsx`, `backend/app/api/nutrition.py`
- **Issue:** GET /fuel-plan/activity/{id} consistently errors. Root cause unclear from static analysis — needs live diagnosis (possible missing migration, auth edge, or serialization issue). Latent defects fixed: actuals clearing now works (empty string → null), regenerate/delete buttons added, error message now shows actual error detail, FuelPlanCard consolidated to use API helpers.
- **Fix:** Added error logging to backend endpoint, improved frontend error display, fixed actuals clearing semantics, added regenerate/delete UI.

### BUG-069: Surface Data Never Populated
- **Status:** FIXED
- **File:** `backend/app/services/komoot.py:207-223`, `backend/app/services/route_service.py:296-311`
- **Issue:** Komoot's dedicated `/surface` endpoint (`komoot_client.get_surface()`) is never called by sync. Surface data only extracted from optional `summary.surfaces` payload field. Re-sync early-return in `create_or_merge_route` prevents backfill on existing routes.
- **Fix:** Added `get_surface()` API fallback when payload lacks surface data. Added surface backfill pass at end of Komoot sync for existing routes missing `surface_profile`. Modified `create_or_merge_route` to fill `surface_profile` on existing routes when available.

### BUG-070: Route Filtering Inconsistent
- **Status:** FIXED
- **File:** `backend/app/api/routes.py:51-179`, `frontend/src/app/(app)/routes/page.tsx:216-229`
- **Issue:** `is_ridden` filter applied post-query after pagination → pages shrink unpredictably. `total_count` ignores `is_ridden`. `ride_count`/`last_ridden` sorting also post-query. Count badge shows `routes.length` instead of `X-Total-Count`.
- **Fix:** Moved ride stats computation to SQL subquery with LEFT JOIN. `is_ridden` filter now in SQL. Sorting by `ride_count`/`last_ridden` now in SQL. Count badge uses `X-Total-Count` header via `authFetchWithHeaders`.

### BUG-071: Merge Thresholds Too Strict
- **Status:** FIXED
- **File:** `backend/app/services/merge_service.py:135`, `backend/app/services/route_service.py:109`, `backend/app/config.py:72-76`
- **Issue:** Activity merge: date proximity weighted 50% (too dominant). Route merge: proximity weighted 40% (too dominant) — a >1km start-point difference caps score at 0.60 (the threshold). Near-identical rides from different devices treated as separate.
- **Fix:** Activity weights: date 40%, sport 20%, duration 20%, distance 20%. Route weights: proximity 25%, distance 25%, name 15%, shape 35%. Added 1-2km proximity tier (0.15). Lowered both thresholds from 0.60 to 0.55.
