# Bulletproof Streams — cycling pages

Deep dive: 2026-09-18. P0 implemented same day (frontend fetch gating + error states).
P1 + P2 implemented 2026-09-18. Status: **complete** — this doc is now the record.
Backend integration tests could not run here (test Postgres unreachable from one-off containers — connection refused at fixture setup); backend changes verified via import check, query-compile check, in-memory `_enrich` check, and `tsc` + full Vitest suite (134 passed).

## 1. Goal

Every cycling page must end in exactly one of three visible states — **data**, **loading**, or an **explained empty/error** — never a silent blank. Concretely:

- No request fires without a JWT (no pre-token 401s cached into React Query).
- List pagination preserves `ride_context` badges on all pages.
- A failed fetch never renders the same copy as a genuinely empty ride.
- After a backfill, all stream-derived queries refetch.
- 3D replay explains *why* it is unavailable instead of rendering nothing.

Backend is out of scope (pipeline verified solid — §2). All remaining work is frontend + one webhook parity call.

## 2. End-to-end data flow

### 2.1 Storage

- `Activity` 1→N `ActivityStream` (`backend/app/models/activity.py:154-183`). One row per `stream_type`, `data` always the `{"data": [...]}` envelope, unique on `(activity_id, stream_type)`.
- `Activity.context` JSONB (`activity.py:84-88`) — §1.3 precomputed cache (zones, decoupling, climbing, top speed, TSS breakdown). Load position (ATL/CTL/TSB) is deliberately **never** cached (moving window).

### 2.2 Write path (backend — verified, no changes needed)

| Source | Code | Behaviour |
|---|---|---|
| Incremental Strava sync | `services/strava/sync.py:299-350` | Cycling-only guard (`:301`). Streams best-effort (`except: pass`, `:322`). Then `ensure_activity_contexts` (`:346`), TSS, PRs. |
| Full backfill (SSE) | `sync.py:534-583`, commit `:732` | Per-activity `continue` on failure. Final commit owns the generator session (BUG-074 fix). Context via `ensure_activity_contexts_by_id` (`:589`). |
| Gap-fill service | `sync.py:765-860` | Candidates: `cycling AND provider_activity_id NOT NULL AND NOT EXISTS(streams)`. Per-user token, per-activity `continue`, commit per user. |
| Webhook create | `services/strava/webhooks.py:119-142` | Same fetch/insert pattern — but **no `ensure_activity_contexts` call** (only caller missing it; verified by grep — `sync.py:346,589` + `scheduler.py:1168` are the three call sites). → P1-3. |
| FIT upload | `api/activities.py:800-902` | Builds `heartrate/power/cadence/altitude/enhanced_speed/lat-long`. |
| Wahoo | `services/wahoo.py` | Zero streams by design (no `Stream` match in file). Only `ActivitySource`. |
| Celery | `tasks/scheduler.py` | `backfill_streams_for_all_activities` Sat 3AM, `backfill_activity_context` Sun 3:30AM healer. `cleanup_old_data` retains streams indefinitely. |

### 2.3 Read path (backend — verified, no changes needed)

| Endpoint | Code | Semantics |
|---|---|---|
| `GET /activities?include_context=true` | `api/activities.py:97-218` | Serves cached `activity.context` inline, zero extra queries. Never recomputes (FTP staleness not checked here). |
| `GET /activities/{id}` | `:1255-1284` | `selectinload(streams)` — the streams carrier for the expanded view. |
| `GET /activities/{id}/streams` | `:1287-1309` | `[]` when empty (404 only if activity missing). Compare modal uses this. |
| `GET /activities/{id}/context` | `:994-1249` | Recomputes when missing or `context.ftp_watts != profile.ftp_watts`. ATL/CTL/TSB always on-demand. |
| `POST /cycling/backfill-streams` | `api/cycling/ftp.py:157-296` | Gap-fill by default; `force=true` deletes-after-fetch. Redis lock. |

### 2.4 Stream-type spelling matrix (the perennial trap)

| Concept | Strava | FIT import | Readers must try |
|---|---|---|---|
| Power | `watts` | `power` | both ✅ (all readers do) |
| Speed | `velocity_smooth` | `velocity` / `enhanced_speed` | all three (replay: only first two — `enhanced_speed` gap, see P2-1) |
| Heart rate | `heartrate` | `heartrate` | `heartrate` only — `hr`/`heart_rate` silently missed (P2-1) |
| Altitude | `altitude` | `altitude` | ✅ |
| Cadence | `cadence` | `cadence` | ✅ |

### 2.5 Frontend consumption

- `activities/page.tsx` — expanded detail: `ActivityDetail.streams` (`:560`), context (`:466`), analysis (`:135`), FTP profile (`:202`). Replay builder (`:162-187`) **requires `velocity`/`velocity_smooth`** or returns `null` → 3D section not rendered.
- `CompareActivitiesModal.tsx:31-41` — `/streams` for A+B, power/HR overlay + side-by-side 3D.
- `cycling/page.tsx` — aggregate derivatives only (`power-curve`, `stream_power_curve`, zones, vo2max, decoupling). Never touches raw streams; all breakage here is fetch gating, not data.

## 3. Failure modes (all verified in code before P0)

| # | Symptom | Evidence | Impact | Status |
|---|---|---|---|---|
| F1 | Pre-token 401s cached | Queries without `enabled: !!token` fire with `token===undefined`; `apiFetch` omits `Authorization`. Was: `activities/page.tsx:135,202,455,466,560,577,652,666`, `cycling/page.tsx:99-115,145-155,189-193,202-206,278-282` | Intermittent empty charts/badges on first load, self-heals on refetch — the classic "streams sometimes don't load" | **Fixed P0** |
| F2 | Page 2+ loses badges | First page set `include_context=true` (`:450`); `loadMore()` (`:486-499`) did not | IF/VI/decoupling badges silently missing past 50 rows | **Fixed P0** |
| F3 | IO-gated sections never fetch | `vo2max/decoupling/ftp` require `visibleSections.has(...)` (`cycling/page.tsx:208-276`); short page / hidden ancestor / no-IO env → never attempt | "Fetch streams" empty text with no fetch ever tried | Open → P1-2 |
| F4 | 3D silently absent | `replayBuild===null` when non-cycling / no polyline / no streams / no velocity (`activities/page:163,175-176`, `Compare:77-78`); section not rendered, no message | HR/power-only rides look broken | Open → P1-1 |
| F5 | Webhook rides lack context | No `ensure_activity_contexts` in `webhooks.py` (verified §2.2) | New webhook rides show no badges until Sun healer or on-read recompute | Open → P1-3 (backend, one call) |
| F6 | Wahoo rides indistinguishable from failures | Zero streams by design, same "No stream data" copy | Users retry/reconnect a healthy connection | Open → P1-1 (copy per source) |
| F7 | Errors rendered as empty | `isError` never read in expanded detail or compare | Auth/outage looks like "no data" | **Fixed P0** (detail + compare) |
| F8 | Stale empties after backfill | `backfillStreamsMutation` invalidated 5 keys, missed 11 | Backfill succeeds but charts stay empty until manual refresh | **Fixed P0** |

## 4. P0 changelog (2026-09-18, done)

- `enabled: !!token` on all 8 activities-page queries + 2 expanded-detail sub-queries + all 17 cycling-page queries (combined with existing IO/profile gates via `&&`).
- `include_context=true` added to `loadMore()`.
- `ActivityExpanded` takes `detailLoading`/`detailError`: skeleton while loading, warning copy on error, existing empty copy only when fetch succeeded with zero streams.
- Compare modal: `!!activity.id` guards + `streamsError` → warning copy vs neutral empty copy.
- Backfill `onSuccess` invalidates 16 keys total (added `chart-wkg-power-curve`, `chart-power-duration-percentile`, `power-vs-hr`, `vo2max`, `vo2max-history`, `chart-vo2max-trend`, `decoupling-history`, `chart-decoupling-trend`, `cycling-prs`, `activity-streams`, `activities`).
- Verification: `npx tsc --noEmit` clean. (`npm run lint` prompts for ESLint setup — skipped.)

## 5. P1 spec (next — all small, independently shippable)

> Implemented 2026-09-18. Spec retained below as the record.

### P1-1 Explain-why 3D / empty states

**Files:** `activities/page.tsx` (`ActivityExpanded` stream + 3D sections), `CompareActivitiesModal.tsx` (3D tab + empty block).

- When `isCycling && encoded_polyline && streams?.length` but no velocity → render: "3D replay needs a speed stream — this ride has N stream(s) (list types) but no velocity."
- When `isCycling && !encoded_polyline` → "No route attached — 3D needs GPS."
- When activity `source === 'wahoo'` and zero streams → "Wahoo sync doesn't include per-second streams yet — summary metrics still work."
- Non-cycling with streams → keep current behaviour (chart tabs only, no 3D mention).
- Acceptance: each of the four cases renders its message; rides with velocity render 3D as today (no regression).

### P1-2 IO-gate fallback

**File:** `cycling/page.tsx:48-89` (observer) + gated queries.

- Add a 3s fallback timer: any section not yet visible after 3s is added to `visibleSections` anyway (queries still need `!!token`, already in place). Observer stays as the fast path.
- Remove the dead `powerCurveRef`/`'powerCurve'` observer entry (no query consumes it — power-curve queries are eager).
- Acceptance: with JS IO disabled (or a short viewport), vo2max/decoupling/ftp sections fetch within ~3s; with IO present, behaviour unchanged (loads ~200px before visible).

### P1-3 Webhook context parity (backend, one call)

**File:** `backend/app/services/strava/webhooks.py` (~after stream insert, mirroring `sync.py:344-350`).

- Call `ensure_activity_contexts(db, [activity])` best-effort (try/except, never fail the webhook) after streams are flushed.
- Acceptance: a webhook-created cycling ride has non-null `Activity.context` without waiting for the Sunday healer; webhook still 200s when context compute throws.

## 6. P2 spec (structural — do when touching nearby code)

> Implemented 2026-09-18 (no migration needed — `has_streams` is computed from an
> id-only `selectinload`, not a denormalized column). Spec retained as the record.

- **P2-1 Shared stream accessor.** Extract `getStreamValues()`/`streamInput()` (currently duplicated in `ActivityExpanded` + `CompareActivitiesModal`) into `frontend/src/lib/streams.ts` with the full spelling matrix (`watts|power`, `velocity|velocity_smooth|enhanced_speed`, `heartrate|hr|heart_rate`). Note: adding `enhanced_speed` to the replay path changes 3D eligibility for FIT rides — verify with a FIT-uploaded ride before/after.
- **P2-2 `has_streams` status.** Backend: expose per-activity `has_streams: bool` (cheap `EXISTS` or denormalized flag) in list responses so the UI can distinguish "never fetched — offer backfill" from "fetched and empty". Needs migration + backfill if denormalized; prefer `EXISTS` subquery first, measure.
- **P2-3 `selectedStream` reset.** `ActivityExpanded.selectedStream` (`useState('')`) persists when React reuses the fiber across rows → blank chart until re-pick. Reset on `activity.id` change (same pattern as the replay-timer reset at `:195-199`). One line, do with P1-1.

## 7. Test plan

- **Manual (dev, `https://dev.oliradlett.co.uk/fittrack`):** cold load cycling page → no 401s in Network tab before session resolves; expand a ride → skeleton then streams; block `/streams` (devtools) → warning copy (not "no data"); `Load More` → page-2 badges present; backfill → all sections refetch (check `vo2max`, `decoupling`, `wkg` network calls).
- **Automated:** Vitest for `lib/streams.ts` once P2-1 lands (spelling matrix incl. `enhanced_speed`, `hr`); Playwright E2E still deferred (no harness for login + sync yet — see roadmap).
- **Backend (P1-3 only):** existing webhook tests + one new case asserting `context` non-null after webhook create; `ruff check` + pytest smoke.

## 8. Open questions

1. Should Wahoo ever get streams (polling workout samples), or is "no per-second data" permanent? Answer decides whether P1-1 Wahoo copy is temporary or permanent.
2. `EXISTS` subquery vs denormalized `has_streams` for P2-2 — check list-endpoint latency first (Phase B kept it at zero extra queries; don't regress that).
3. Do we want a user-facing "Retry streams fetch" button on the error state, or is reopen sufficient? (P0 ships reopen-only copy.)

## 9. Key files index

- Frontend: `src/app/(app)/activities/page.tsx`, `src/app/(app)/cycling/page.tsx`, `src/components/activities/CompareActivitiesModal.tsx`, `src/lib/replay.ts`, `src/components/charts/Chart.tsx`, `src/components/maps/RouteMap.tsx`
- Backend: `app/models/activity.py`, `app/services/strava/sync.py`, `app/services/strava/webhooks.py`, `app/services/activity_context.py`, `app/api/activities.py`, `app/api/cycling/ftp.py`, `app/tasks/scheduler.py`
- History: `docs/BUGS.md` (BUG-056/059/060/074 fixed), `docs/algorithms.md` (§1.3), `plans/3d-ride-view-enhancements.md`, `plans/future-enhancements.md:159` (distance-stream alignment)
