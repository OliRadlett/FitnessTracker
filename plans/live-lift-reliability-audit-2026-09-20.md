# Live Lift Reliability Audit (2026-09-20)

> Status: **fixes implemented + verified**. Reported symptoms field was empty, so
> this is a full reliability audit of the local-first sync engine.

## 1. System map

```
localStorage 'fittrack-live-session'  ◄────────────┐  every mutation persists
   │  (source of truth while offline)              │
   ▼                                                │
useLiveSession state ──patch/setState──► persist effect ──saveState──┘
   │
   │ scheduleFlush() / online / visibilitychange / finish-retry(4s)
   ▼
flush()  (syncingRef guard — one at a time)
   Step 1  POST /api/v1/lifting/sessions            {live_key, started_at, sets[client_id]}
   Step 2  POST /api/v1/lifting/sessions/{id}/sets  {client_id}         (idempotent)
   Step 3  DELETE /api/v1/lifting/sets/{remoteId}   (pendingDeletes)
   Step 4  PATCH /api/v1/lifting/sessions/{id}      {ended_at, rpe_session, notes, session_date}
   after each await: commit() → mergeWithStorage(working, processedDeletes) → setState + saveState
   end: if storage still has unsynced work → followUpFlush()
```

Key files: `frontend/src/lib/lifting/useLiveSession.ts` (engine),
`frontend/src/components/lifting/LiveWorkout.tsx` (active UI),
`frontend/src/app/(app)/lifting/live/page.tsx` (pre-start / orphan / finish),
`frontend/src/lib/lifting/reference.ts` (prefill/PR),
`backend/app/services/lifting.py` + `backend/app/api/lifting.py` (dedupe + CRUD).

## 2. Bug table

| Symptom | Root cause (file:line) | Fix | Test |
|---------|------------------------|-----|------|
| Undo of a synced set → `⟳ N to sync` never clears; `Sync failing — retry`; **Finish stuck on overlay** | `mergeWithStorage` unioned `working.pendingDeletes` with the stale `stored.pendingDeletes`, re-queueing a delete that had just succeeded → `404` retry loop; Step 3 threw before Step 4 (finish) | Track `processedDeletes` in the flush; `mergeWithStorage(working, processedDeletes)` removes them. Step 3 treats `404` as done; `apiFetch` attaches `err.status` (BUG-089) | `live-session-sync.test.tsx` ("no re-queue loop", "404 as done") |
| Old session resurrects and clobbers a newly started/resumed session | `mergeWithStorage` returned `working` when `stored.startedAt !== working.startedAt` (BUG-090) | Return `null` — abort the stale flush, leave storage untouched | `live-session-sync.test.tsx` (replacement written mid-flight) |
| Screen stays awake after finishing | Wake Lock never released on unmount (finish happens in-place) | Release in the effect cleanup | typecheck/build |
| Only the last set could be undone | `undoArmed` was boolean; non-last chips disabled | `removeSet(clientId)` + per-set two-tap delete | `live-session-sync.test.tsx` (remove middle set) |
| Prefill ignored on mount/resume/plan preset | `prefillFor` only called from chip taps | Apply prefill whenever the exercise changes (guarded ref) | typecheck/build |

## 3. Enhancements

Implemented:
- Per-set delete (any set, two-tap) with remote-delete queuing — reuses the idempotency contract.
- Prefill on mount / exercise change (plan preset + resumed sessions).
- Wake Lock released on unmount.
- `404`-tolerant deletes + `err.status` on API errors.

Evaluated, not added:
- **Rest countdown**: still intentionally skipped (informational count-up only per the locked product decision). A countdown implies enforcement/nags and needs a background-safe notification path; not justified without a request.
- **Set reordering / supersets / per-set edit**: supersets need a grouping data model (backend schema + migration) — deferred.

## 4. Phase 4 — implemented (all 5)

1. **Plan-day auto-checklist with set targets** — the "Load from today's plan" chip now carries `planTargets` (exercise/sets/reps) into `startSession`; `LiveWorkout` renders a checklist that ticks working sets off as they're logged and selects the exercise on tap. `PlanTarget` persists in localStorage; matched via `normaliseExerciseKey` (snake_case ↔ free text).
2. **Plate calculator** — `PlateCalculator` modal (20/15 kg bar) from a button under the steppers; pure math in `lib/lifting/plates.ts` (`computePlates`).
3. **Live e1RM projection** — `LiveWorkout` shows the projected e1RM for the current stepper values plus the session best for the exercise (accent when it's a new session best).
4. **CSV export of a finished session** — "Export CSV" on the post-finish summary; `lib/lifting/csv.ts` (`setsToCsv`, `downloadTextFile`).
5. **Rest-period adaptation from Whoop recovery** — `lib/lifting/rest.ts` (`suggestedRestSeconds`); the since-last-set pill shows `/ target` and turns green at the adapted target, and the header line notes `rest ~… (recovery N%)`.

New unit tests: `src/__tests__/lifting-features.test.ts` (12 tests).

## 5. Verification

- `npm run typecheck` — clean
- `npm test` — 138 passing (4 new sync-engine tests)
- `npm run build` — succeeds
- `python fittrack.py exec backend env TEST_DATABASE_URL=… pytest tests/integration/test_lifting_api.py -v` — 19 passed
- No migration touched.

## 6. Follow-up — stuck "Finishing…"/"Loading…" on mobile (BUG-098)

A `finishing` state could wedge forever, leaving START unreachable. Fixed:
legacy `finishing` states (pre-`finish_requested`) are backfilled so the retry
effect and `flush()` Step 4 can complete them; finish `PATCH` 404 (remote row
deleted/auto-closed) is treated as done; `startSession` adopts an active session
written by another tab instead of silently no-op'ing; the live workout /
finishing overlay / finish sheet sit at `z-50` so `MobileBottomNav` (`z-40`)
can't cover the buttons. 3 new tests in `live-session-sync.test.tsx` (201
passing). See BUG-098.
