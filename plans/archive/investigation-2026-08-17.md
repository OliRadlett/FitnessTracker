# Investigation Document — 2026-08-17

> **Scope**: Misc bugs, networking review, performance, data issues, science questions, and broader codebase analysis after reaching ~100 files and 12k+ lines.

---

## 1. Calendar — Recovery Not Showing on Some Days

### Problem
Days with Whoop data in the calendar grid show no recovery badge even though the backend has `DailyMetric` records with `recovery_score` for those dates.

### Root Cause Analysis

The calendar endpoint [`get_activities_calendar()`](backend/app/api/activities.py:100) fetches daily metrics correctly and deduplicates by date (preferring `whoop` source). The frontend renders recovery badges when `dm.recovery_score != null` at [`calendar/page.tsx:743-764`](frontend/src/app/(app)/calendar/page.tsx:743).

**The issue is the deduplication logic at [`activities.py:164-169`](backend/app/api/activities.py:164):**

```python
metrics_by_date: dict = {}
for dm in daily_metrics_raw:
    d = dm.metric_date
    if d not in metrics_by_date or dm.source == "whoop":
        metrics_by_date[d] = dm
```

This overwrites any existing record when `dm.source == "whoop"`. However, the Whoop cycle sync creates `DailyMetric` records where `recovery_score` can be `None` if the recovery endpoint returned no data (e.g. cycle not yet scored, or recovery fetch failed). When a sleep-only `DailyMetric` exists for a date (created by [`sync_whoop_sleep()`](backend/app/services/whoop.py:373) with `raw_data={"sleep_only": True}`), it has `recovery_score=None` but may overwrite a non-whoop source that had a recovery score.

More commonly: **Whoop sync creates a cycle record first** (with `recovery_score=None` if recovery isn't ready yet), then **a second sync fetches recovery**. But if the recovery fetch fails silently (line 308-312 catches exceptions and logs a warning), the `DailyMetric` persists with `recovery_score=None` even though a recovery score exists.

Additionally, `sync_whoop_sleep()` at line 508-528 creates **a separate `DailyMetric`** with `raw_data={"sleep_only": True}` for dates that don't have a cycle metric yet. This uses `pg_insert().on_conflict_do_update()` which only updates `sleep_duration_minutes` and `sleep_efficiency` — it does NOT preserve `recovery_score` from the existing cycle record. The conflict resolution set clause:
```python
set_={
    "sleep_duration_minutes": ...,
    "sleep_efficiency": ...,
    "updated_at": ...,
}
```
This is correct — it only updates sleep fields. But if the **order is reversed** (sleep sync runs before cycle sync for a given date), and then cycle sync runs, the cycle upsert at line 324-355 uses:
```python
set_={
    "strain": ...,
    "calories": ...,
    "recovery_score": recovery_score,  # could be None
    ...
}
```
If `recovery_score` is `None` (recovery fetch failed), this **overwrites** the existing record with NULL recovery.

### Fix

**A. Fix cycle sync to not overwrite recovery with NULL** — in the `on_conflict_do_update` at [`whoop.py:341-353`](backend/app/services/whoop.py:341), only update `recovery_score` if the new value is not None:

```python
set_={
    "strain": float(strain) if strain else None,
    "calories": calories,
    "recovery_score": recovery_score if recovery_score is not None else existing_recovery,
    ...
}
```

This requires reading the existing record first, or using a SQL `COALESCE`/`CASE` expression. The simplest approach is to conditionally include the field.

**B. Fix the calendar dedup to prefer the record with the most data** — not just `whoop` source:

```python
def _pick_better_metric(existing: DailyMetric, candidate: DailyMetric) -> DailyMetric:
    """Prefer the metric with more non-null fields."""
    existing_score = sum(1 for f in ['recovery_score','hrv_ms','strain','sleep_duration_minutes'] if getattr(existing, f) is not None)
    candidate_score = sum(1 for f in ['recovery_score','hrv_ms','strain','sleep_duration_minutes'] if getattr(candidate, f) is not None)
    return candidate if candidate_score > existing_score else existing
```

### Priority
**HIGH** — directly affects user-visible data on the calendar.

---

## 2. Activities Page — Only Showing 50

### Problem
Activities page shows only 50 activities despite ~1000 being backfilled.

### Root Cause

The activities page has pagination implemented at [`activities/page.tsx:286-338`](frontend/src/app/(app)/activities/page.tsx:286) with `PAGE_SIZE = 50` and a `loadMore()` function. The initial query fetches `limit=50&offset=0`, and `loadMore()` increments the offset.

**The bug is that `loadMore()` is never triggered automatically.** The page renders a "Load More" button pattern (if one exists), but looking at lines 498-534, the page just renders `displayActivities` without any visible load-more trigger at the bottom.

Looking more carefully at the render code at line 498-500, there IS no "Load More" button in the rendered JSX. The `loadMore` function exists but is never called by any UI element. The user sees only the first 50 and has no way to load more.

### Fix

Add a "Load More" button or infinite scroll trigger at the bottom of the activity list:

```tsx
{/* Load More */}
{displayActivities.length >= PAGE_SIZE && (
  <div className="flex justify-center py-4">
    <button
      onClick={loadMore}
      disabled={loadingMore}
      className="px-6 py-2 bg-surface-light hover:bg-surface text-muted hover:text-white 
                 text-sm font-medium rounded-lg border border-surface-light transition-colors disabled:opacity-50"
    >
      {loadingMore ? 'Loading...' : `Load More (${displayActivities.length} of ???)`}
    </button>
  </div>
)}
```

Also consider returning a total count from the backend so the UI can show "Showing 50 of 987".

### Backend Enhancement

Add a `total_count` response header or include it in the response. Currently [`activities.py:57-97`](backend/app/api/activities.py:57) returns a plain list with no count metadata.

### Priority
**HIGH** — core UX issue. Users can't access most of their data.

---

## 3. Strain vs Next-Day Recovery Chart — Weird Data

### Problem
The "Strain vs Next-Day Recovery" scatter chart on the dashboard shows weird data points.

### Root Cause

The chart is rendered at [`dashboard/page.tsx:555-562`](frontend/src/app/(app)/dashboard/page.tsx:555) and the data comes from [`ChartService.strain_vs_recovery()`](backend/app/services/charts.py:677).

**Issue 1: Scatter chart rendering in Chart.tsx**

At [`Chart.tsx:134-153`](frontend/src/components/charts/Chart.tsx:134), the scatter chart renders:

```tsx
<Scatter
  data={(data.labels ?? []).map((label, j) => ({ x: Number(label), y: s.data[j] ?? 0 }))}
/>
```

The `data.labels` are set at [`charts.py:754`](backend/app/services/charts.py:754) as `all_strains` (unique sorted strain values), but `s.data` contains the **strain values** (x-axis), not the recovery scores (y-axis). The `y` value is `s.data[j]` which is a strain value, not a recovery value.

**The backend sends strain values as BOTH the label/x-axis AND the series data.** The y-axis should be recovery scores, but the series data only contains strain values (lines 733-736):

```python
series_list.append(ChartSeries(name="High Recovery (≥67%)", data=[p[0] for p in green], color="#22c55e"))
```

`p[0]` is the strain value. `p[1]` would be the recovery score. The series data should include both x and y, but ChartData only has a single `data` array per series.

**This is a fundamental data structure mismatch.** The scatter chart expects `{x, y}` pairs but ChartSeries only provides a 1D `data` array. The Chart.tsx scatter renderer uses `labels` as x and `data` as y, but the backend puts strain in both.

**Issue 2: The scatter renderer uses `Number(label)` for x**, which converts strain strings to numbers — this works. But `s.data[j]` is the strain value (same as x), not recovery. The chart effectively plots `strain vs strain` — a diagonal line.

### Fix

**Option A**: Change the scatter chart to use a different data format. For scatter charts, encode `{x, y}` pairs in the series data:

```python
# In strain_vs_recovery():
series_list.append(ChartSeries(
    name="High Recovery (≥67%)",
    data=[r for s, r in green],  # recovery values (y)
    color="#22c55e"
))
# Use strain values as labels (x-axis)
all_strains = sorted(set(s for s, _ in points))
labels = [str(s) for s in all_strains]
```

But this loses the pairing — we need strain→recovery mapping per point.

**Option B (recommended)**: For scatter charts, pack the data differently. Use the labels as x-values (strain) and series data as y-values (recovery), ensuring they're paired correctly:

```python
# Build paired data
green_strains = [s for s, r in green]
green_recoveries = [r for s, r in green]

series_list.append(ChartSeries(
    name="High Recovery (≥67%)",
    data=green_recoveries,
    color="#22c55e"
))
# But labels must match — need to use all points' strain as labels
```

Actually the real fix is to restructure the scatter to pass `{x, y}` tuples. The simplest approach:

```python
# Use all points as a single series with x,y encoding in labels+data
labels = [str(p[0]) for p in points]  # strain values
series_list = [ChartSeries(
    name="Recovery",
    data=[p[1] for p in points],  # recovery values
    color=None  # use color from point metadata
)]
```

Then fix the Chart.tsx scatter renderer to handle this correctly. The current renderer at line 146:
```tsx
data={(data.labels ?? []).map((label, j) => ({ x: Number(label), y: s.data[j] ?? 0 }))}
```
This would work if `labels` = strain values and `data` = recovery values.

### Priority
**MEDIUM** — chart shows wrong data, but it's on the dashboard, not a core feature.

---

## 4. Networking Review

### Architecture

```
Browser → Caddy (80/443) → Frontend (3000) / Backend (8000)
```

### Findings

#### 4a. Settings page uses `API_BASE_URL` for OAuth redirects — CORRECT but fragile

At [`settings/page.tsx:10-11`](frontend/src/app/(app)/settings/page.tsx:10):
```tsx
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const PUBLIC_URL = process.env.NEXT_PUBLIC_PUBLIC_URL || 'https://localhost';
```

The OAuth connect button at line 78-80:
```tsx
const baseUrl = HTTPS_PROVIDERS.includes(provider) ? PUBLIC_URL : API_BASE_URL;
const callbackUrl = `${baseUrl}/api/v1/auth/oauth/${provider}/callback`;
window.location.href = `${API_BASE_URL}/api/v1/auth/oauth/${provider}/authorize?redirect_uri=${encodeURIComponent(callbackUrl)}`;
```

**Issue**: `API_BASE_URL` defaults to `http://localhost:8000` which bypasses Caddy. The authorize URL goes directly to the backend, but the backend redirects to the OAuth provider with `redirect_uri` pointing to the callback. The callback then redirects to `{_frontend_url}/settings` using `settings.public_url`.

**Problem**: If the user accesses via `https://localhost` (through Caddy), the authorize URL still goes to `http://localhost:8000` (direct backend). This works because the backend handles the authorize redirect regardless of how it's reached. BUT the `redirect_uri` in the callback must match what was registered with the OAuth provider. The backend uses `settings.public_url` for the default redirect_uri (line 109 of auth.py), which is `https://localhost`. So:

- Strava authorize: `redirect_uri = https://localhost/api/v1/auth/oauth/strava/callback` ✓
- But the authorize URL itself is `http://localhost:8000/api/v1/auth/oauth/strava/authorize?redirect_uri=...` — this goes to the backend directly, bypassing Caddy's TLS.

**This works fine for local dev** but is confusing. For production, `API_BASE_URL` should be empty (relative URLs through Caddy).

#### 4b. Frontend `fetch.ts` hardcodes relative URLs — CORRECT

At [`fetch.ts:6`](frontend/src/lib/api/fetch.ts:6): `const API_BASE_URL = ''`. All API calls from React components go through Next.js rewrites (via `next.config.js`) or Caddy. This is correct.

#### 4c. `next.config.js` rewrites to localhost:8000 — POTENTIAL ISSUE IN DOCKER

At [`next.config.js:9`](frontend/next.config.js:9):
```js
destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/v1/:path*`
```

In Docker, the frontend container's `localhost:8000` is NOT the backend container. The rewrite should use the Docker service name: `http://backend:8000`. 

**BUT**: The Caddy container handles routing, so when the browser hits `https://localhost/api/v1/*`, Caddy proxies to `backend:8000`. The Next.js rewrite is only used for SSR requests (when Next.js itself makes the request). Since all pages are `'use client'`, SSR is minimal, so this may not matter in practice.

**Fix**: Set `NEXT_PUBLIC_API_URL=http://backend:8000` in the Docker `.env` or `docker-compose.yml` for the frontend service.

#### 4d. CORS configuration — CORRECT

At [`main.py:67-73`](backend/app/main.py:67), CORS allows `settings.allowed_origins` (default: `http://localhost:3000,https://localhost`). This covers both the dev server and Caddy-proxied access.

#### 4e. Caddy routing — CORRECT

At [`Caddyfile`](infra/Caddyfile):
- `/api/auth/*` → frontend (NextAuth)
- `/api/v1/*` → backend
- `/_next/*` → frontend
- Everything else → frontend

This correctly separates NextAuth routes from backend API routes.

#### 4f. Auth bridge — `pendingBackendToken` race condition

At [`auth.ts:9`](frontend/src/lib/auth.ts:9): `let pendingBackendToken: string | undefined;` is module-level state. If two users sign in simultaneously (or one user signs in twice quickly), the second sign-in overwrites the first's token. This is documented in AGENTS.md pitfall #2.

### Priority
**LOW** — networking works for local dev. The `NEXT_PUBLIC_API_URL` issue only matters in Docker SSR scenarios.

---

## 5. Whoop Data for LTHR Estimation

### Question
Does Whoop provide enough data to estimate LTHR (Lactate Threshold Heart Rate)? Should we split into LT1 and LT2?

### Analysis

**What Whoop provides** (from [`whoop_client.py`](backend/app/integrations/whoop_client.py)):

| Data Point | Source | Available |
|-----------|--------|-----------|
| Resting HR | Cycle/recovery | ✓ |
| Max HR | Cycle score | ✓ |
| Average HR | Cycle/workout score | ✓ |
| HRV (RMSSD) | Recovery | ✓ |
| Respiratory Rate | Recovery | ✓ |
| Strain (0-21) | Cycle score | ✓ |
| HR stream (per-second) | **Not available** | ✗ |
| HR zones breakdown | **Not available** | ✗ |
| LTHR | **Not available** | ✗ |

**Whoop does NOT provide:**
1. Per-second HR stream data (needed for LTHR estimation via DFA α1 or HR drift)
2. Pre-computed LTHR or threshold HR values
3. HR zone distribution data

### Can We Estimate LTHR from Whoop Data?

**Short answer: No, not reliably.**

Standard LTHR estimation methods require:

1. **20-minute time trial** — requires HR stream data during a maximal effort. Whoop's cycle data gives average HR but not the time-series needed to verify a steady-state effort.

2. **DFA α1 analysis** — requires per-second HR data to compute the Detrended Fluctuation Analysis alpha-1 coefficient. The transition from α1 > 0.75 to α1 < 0.50 indicates the aerobic-to-anaerobic threshold. **Whoop does not provide HR streams.**

3. **HR drift method** — requires monitoring HR drift during a steady-state effort. Again needs per-second data.

4. **Correlation with power data** — if we have both HR streams (from Strava) and power streams (from Strava), we can estimate LTHR from the HR vs Power relationship at threshold intensity. **This is possible** using Strava data (which we already store as `ActivityStream` with `stream_type: "heartrate"`).

### Recommendation

**Use Strava HR+power stream data for LTHR estimation**, not Whoop. We already have:
- HR streams from Strava (`ActivityStream.stream_type == "heartrate"`)
- Power streams from Strava (`ActivityStream.stream_type == "watts"`)
- The `lactate_threshold_hr` field on [`CyclingProfile`](backend/app/models/cycling.py:25) (already exists, migration 012)
- HR zone computation using LTHR at [`cycling.py:258-330`](backend/app/services/cycling.py:258)

**LTHR estimation algorithm using existing data:**
1. For each ride with both HR and power streams, compute the average HR during the highest 20-minute power effort
2. The HR at threshold power ≈ LTHR
3. Average across multiple rides for reliability
4. Alternative: use the average HR from rides where IF (Intensity Factor) is 0.95-1.05 (threshold efforts)

### LT1 vs LT2 Split

**LT1** (Aerobic Threshold / First Ventilatory Threshold): ~75-80% of LTHR  
**LT2** (Anaerobic Threshold / Lactate Threshold): = LTHR  

For the existing HR zones at [`cycling.py:248-255`](backend/app/services/cycling.py:248):
- Z1-Z2 boundary ≈ LT1 (currently at 68% of LTHR — slightly low, could be 75%)
- Z4 boundary ≈ LT2 (currently at 95% of LTHR — correct, this IS LTHR by definition)

**We should consider splitting zones into LT1-based (Z1-Z3) and LT2-based (Z4-Z6)**. The current Coggan model already effectively does this:
- Z1-Z3: Below LT2 (aerobic)
- Z4: At LT2 (threshold)
- Z5-Z6: Above LT2 (anaerobic)

For LT1 detection, we'd need either:
- Blood lactate testing (not available)
- DFA α1 from HR streams (possible with Strava data, but complex)
- Ventilatory equivalent estimation (not available)

**Practical recommendation**: Add a `lt1_hr` field to `CyclingProfile` (defaulting to `lthr * 0.80`) and use it to split zones. Allow manual override. Don't try to auto-estimate LT1 from data — it's not reliable without DFA α1 analysis.

### Priority
**LOW** — LTHR is already settable manually. Auto-estimation from Strava streams would be a nice enhancement.

---

## 6. Broader Codebase Analysis

### 6a. Performance Issues

#### N+1 Queries in Backfill

At [`strava.py:682-705`](backend/app/services/strava.py:682), `backfill_all_activities()` loads ALL Strava activities for a user then loops through each to call `link_activity_to_lifting_sessions()` and `link_activity_to_route()`. Each of these makes additional DB queries.

**Impact**: For a user with 1000 activities, this could make 2000+ additional queries during backfill.

**Fix**: Batch the linking operations — load all lifting sessions and routes once, then match in Python.

#### Power Curve Computation is O(n·m)

At [`cycling.py:380-450`](backend/app/services/cycling.py:380), `compute_power_curve_from_streams()` loads all power streams into memory, then for each stream and each duration bucket, computes a rolling average. For 100 streams × 14 buckets × ~3600 data points each, this is ~5M operations.

**Impact**: Acceptable for now, but will slow down as data grows.

**Fix**: Consider computing power curve incrementally during sync (store best power per duration in a new table).

#### Calendar Endpoint Loads All Activities for Month

At [`activities.py:113-136`](backend/app/api/activities.py:113), the calendar endpoint does a `SELECT ... outerjoin(LiftingSession)` for the entire month range. This loads all activities including the join to lifting sessions. For users with many activities per month, this is fine. But the query doesn't use `selectinload` — it uses a raw SQL join, which means it returns one row per activity×session combination (if any). The `.all()` call at line 136 returns all rows.

**This is actually efficient** — it's a single query with a LEFT JOIN. No issue here.

### 6b. Code Quality Issues

#### `db_execute` Helper Missing

In [`charts.py`](backend/app/services/charts.py), there's a reference to `db_execute(self.db, ...)` at line 61, but this function is not imported or defined in the visible code. Looking at the file, it's likely defined later in the file (after line 800). This is a utility that wraps `self.db.execute()` — if it's just a pass-through, it's unnecessary indirection.

#### Inconsistent Error Handling in Celery Tasks

At [`scheduler.py:98`](backend/app/tasks/scheduler.py:98): `print(f"Failed to sync for user {conn.user_id}: {e}")` — uses `print()` instead of `logging`. All task error handlers use `print()`. Should use `logger.error()` for proper log level control.

#### `asyncio.run()` in Celery Tasks — Correct but Fragile

All Celery tasks use `asyncio.run()` to bridge sync Celery with async SQLAlchemy. This is correct per AGENTS.md pitfall #1. However, each task creates a new event loop and session factory. If a task is killed mid-execution, the session may not be cleaned up properly.

#### Settings Page Uses Direct `fetch()` for Export

At [`settings/page.tsx:84-86`](frontend/src/app/(app)/settings/page.tsx:84), the export handler uses `fetch()` directly instead of `authFetch()`:
```tsx
const response = await fetch(`${API_BASE_URL}${apiPath}`, {
  headers: session?.backendToken ? { Authorization: `Bearer ${session.backendToken}` } : {},
  credentials: 'include',
});
```

This works but bypasses the centralized error handling in `apiFetch()`. It also uses `API_BASE_URL` (which is `http://localhost:8000`), making it incompatible with Caddy-based access in production.

### 6c. Missing Features / Gaps

#### No Total Count on List Endpoints

Activities, lifting sessions, routes, and PRs all return paginated lists without a total count. The frontend can't show "Page 1 of N" or "Showing 50 of 987".

**Fix**: Add `X-Total-Count` response header or return `{data: [...], total: N}` wrapper.

#### No Activity Deletion

There's no `DELETE /api/v1/activities/{id}` endpoint. Activities can only be deleted via the Strava webhook (delete event). If a user manually creates or imports an activity, they can't remove it.

#### SleepLog Missing Unique Constraint

The `SleepLog` model at [`sleep.py`](backend/app/models/sleep.py) has NO unique constraint (unlike `DailyMetric` which has `uq_daily_metric_user_date_source`). The `sync_whoop_sleep()` function at [`whoop.py:453-460`](backend/app/services/whoop.py:453) does a manual check-and-update to avoid duplicates, but race conditions could create duplicates.

**Fix**: Add unique constraint `(user_id, sleep_date, source)` to `sleep_logs` table and use `pg_insert().on_conflict_do_update()` like the cycle sync does.

#### No Retry Logic for External API Calls

Integration clients (`strava_client`, `whoop_client`, `wahoo_client`, `komoot_client`) make HTTP requests without retry logic. A single transient failure causes the entire sync to fail.

**Fix**: Add `httpx` retry transport or use `tenacity` for retry with exponential backoff.

#### Frontend TypeScript Strictness

The frontend uses `any` in several places:
- [`auth.ts:65`](frontend/src/lib/auth.ts:65): `async jwt({ token }: any)`
- [`auth.ts:73`](frontend/src/lib/auth.ts:73): `async session({ session, token }: any)`
- [`dashboard/page.tsx:144`](frontend/src/app/(app)/dashboard/page.tsx:144): `analysisResults: any[] | null`

These should be properly typed.

### 6d. Security Concerns

#### Secret Key Default

At [`config.py:13`](backend/app/config.py:13): `secret_key: str = "change-me-to-a-random-secret-key"`. If `.env` doesn't set this, JWTs are signed with a known key.

**Fix**: Add validation in `Settings.model_post_init()` that raises if `secret_key` matches the default.

#### No Rate Limiting on API

No rate limiting on any endpoints. The Strava webhook endpoint at [`webhooks.py:30`](backend/app/api/webhooks.py:30) accepts POST requests without verifying the Strava signature.

#### Whoop Token Stored in Plain Text

OAuth tokens (including Whoop bearer tokens) are stored in plain text in the `oauth_connections` table. For a personal project this is acceptable, but worth noting.

### 6e. Database Optimization Opportunities

#### Missing Indexes

- `activities(user_id, start_date)` — the composite index would help the calendar and dashboard queries that filter by both user and date range. Currently only `user_id` and `start_date` have individual indexes.
- `daily_metrics(user_id, metric_date, source)` — already has a unique constraint, which serves as an index.
- `lifting_sessions(user_id, session_date)` — composite would help the volume trend queries.

#### JSONB Column Sizes

`raw_data` on `Activity`, `DailyMetric`, and `SleepLog` stores full API responses. For Strava activities, this can be 5-10KB each. With 1000 activities, that's 5-10MB of JSONB data.

The `cleanup_old_data` task at [`scheduler.py:375`](backend/app/tasks/scheduler.py:375) only deletes old `ActivityStream` records. Consider also trimming `raw_data` from old activities.

---

## Summary — Priority Action Items

| # | Issue | Severity | Effort |
|---|-------|----------|--------|
| 1 | **Activities page: no "Load More" button** — users see only 50 of ~1000 | HIGH | Small |
| 2 | **Calendar recovery missing** — Whoop cycle upsert can overwrite recovery with NULL | HIGH | Small |
| 3 | **Strain vs Recovery chart** — scatter plots strain vs strain (not recovery) | MEDIUM | Small |
| 4 | **SleepLog missing unique constraint** — potential duplicate sleep records | MEDIUM | Small |
| 5 | **Celery tasks use `print()` not `logging`** — can't control log levels | LOW | Small |
| 6 | **No retry on external API calls** — transient failures break sync | MEDIUM | Medium |
| 7 | **Next.js rewrite uses localhost:8000 in Docker** — SSR would fail | LOW | Small |
| 8 | **Settings export bypasses authFetch** — inconsistent error handling | LOW | Small |
| 9 | **LTHR estimation from Strava streams** — can auto-estimate from existing data | LOW | Medium |
| 10 | **LT1/LT2 zone split** — add LT1 field, allow manual or auto-estimate | LOW | Medium |
| 11 | **Backfill N+1 queries** — batch linking operations | LOW | Medium |
| 12 | **Add total count to list endpoints** — needed for proper pagination UX | MEDIUM | Small |
| 13 | **Add `SECRET_KEY` validation** — prevent default key in production | MEDIUM | Tiny |
| 14 | **Composite indexes** — (user_id, start_date) on activities | LOW | Small |

---

## Recommended Implementation Order

1. **Fix activities "Load More"** (item 1) — immediate UX fix
2. **Fix calendar recovery** (item 2) — immediate data correctness
3. **Fix strain vs recovery chart** (item 3) — chart is showing wrong data
4. **Add SleepLog unique constraint** (item 4) — data integrity
5. **Add SECRET_KEY validation** (item 13) — security
6. **Add total count to list endpoints** (item 12) — pagination UX
7. **Switch Celery print to logging** (item 5) — operational hygiene
8. **Add API retry logic** (item 6) — reliability
9. **LTHR auto-estimation** (item 9) — nice-to-have science feature
10. **LT1/LT2 zone split** (item 10) — nice-to-have science feature
