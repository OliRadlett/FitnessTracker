# Live Lift Hardening (2026-09-05)

Reliability pass addressing four production complaints:

| Reported issue | Root cause | Fix |
|----------------|-----------|-----|
| Repeated login after screen-off | NextAuth `useSession` reports `unauthenticated` on a transient wake-fetch failure; `(app)/layout.tsx` bounced straight to `/`. Backend JWT expiry also forced re-login when the silent refresh was suppressed | Layout no longer ejects on a transient `unauthenticated` — only redirects when the `next-auth.session-token` cookie is genuinely gone (grace window + cookie presence check); dead backend token triggers an expedited 60s refresh instead of the 1-hour backoff; `SyncHealthBanner` surfaces an expired backend token with a Reconnect button |
| Sessions not saving | Create/PATCH/finish 401s on a stale backend token; finish retry was gated on `sessionId` so a failed create was never retried; `ended_at` computed at sync time not finish time; sets mutated mid-flush were never re-pushed | Persist `endedAt` at `requestFinish`; retry effect runs even without `sessionId`; follow-up flush schedules a pass when storage still has unsynced work after a flush; session_date uses local timezone |
| Sessions not starting | A stuck `finishing` state blocked START with no escape | Discard button on the finishing overlay; pre-start screen surfaces and can close an orphaned server-side active session via `GET /sessions/active`; `startSession` clears stale `syncError` |
| Wrong last-session weights | Prefill chose highest volume, not the last logged set; the 8-set reference cap sliced in encounter order dropping the top working set; `['lifting-sessions']` never invalidated after finish | `ExerciseReference.lastSet` tracks the true last working set and is the prefill source; cap keeps the heaviest sets; finish invalidates `['lifting-sessions']` + `['personal-records']` |

Also fixed:
- **Stale `authFetch` closure**: network callbacks with `[]` deps captured the mount-time `authFetch`, so after a token refresh every sync kept 401ing with the old token. Now reads `authFetchRef.current`.
- **B1 undo-race resurrection**: a set undone while its create was mid-flight was re-added by `mergeWithStorage`. Now the newly-learned remote id is queued for deletion instead.
- **B2 discard-race**: discarding while a flush was in flight resurrected the session. `mergeWithStorage` returns `null` when storage is gone; `commit()` aborts the sync.
- **B3 UTC session_date**: late-evening sessions could land on the wrong date. `localDateStr()` derives the date in the user's timezone and is also re-sent on finish to heal UTC-misassigned rows.

## Verification

- `npm run typecheck` — clean
- `npm test` — 33 passing (2 new tests: `lastSet` tracking, heaviest-set cap)
- `npm run build` — succeeds
- Backend unchanged (hardening pass); `GET /sessions/active`, `PATCH /sessions/{id}` (`ended_at`/`session_date`) already support the flow

## Files touched

- `frontend/src/app/(app)/layout.tsx` — no-eject on transient unauthenticated
- `frontend/src/lib/auth.ts` — expedited dead-token refresh, `backendTokenExpired` surface
- `frontend/src/components/sync/SyncHealthBanner.tsx` — session-expired reconnect banner
- `frontend/src/lib/lifting/useLiveSession.ts` — finish/retry/merge/discard/session_date hardening
- `frontend/src/app/(app)/lifting/live/page.tsx` — discard on overlay, orphan cleanup, query invalidation
- `frontend/src/lib/lifting/reference.ts` — `lastSet` + heaviest-set cap
- `frontend/src/components/lifting/LiveWorkout.tsx` — prefill from `lastSet`
- `frontend/src/__tests__/lifting-reference.test.ts` — new tests
- `plans/live-lift-tracker.md` — changelog note

---

# Enhancement pass (2026-09-06) — post-hardening

Follow-up feature round chosen by user (E1–E8). B4 (rest countdown) intentionally
skipped — the plan doc's informational-only decision stands.

| # | Item | Implementation |
|---|------|----------------|
| E8 | Refetch on token change | `BackendTokenWatcher` in `Providers.tsx` invalidates all React Query queries when `session.backendToken` changes, so pages that 401'd on a dead token recover immediately after silent refresh instead of after `staleTime` |
| E4 | 12-week reference window | `buildLastSessionMap` filters by `session_date >= today−84d`; out-of-window sessions contribute nothing (no stale-weight prefill). 2 new tests (13 total) |
| E3 | Post-finish summary screen | Snapshot captured at `handleFinish`; "Session saved ✓" screen with duration/volume/sets/RPE, exercises, "View session log" deep link, "Start another session" |
| E6 | Honest sync pill | LiveWorkout shows `⟳ N to sync` (unsynced sets + pending deletes) instead of a binary ✓ when the queue is non-empty; offline pill unchanged |
| E7 | Delete-session escape hatch | New `deleteLiftingSession` API client fn; lifting page delete mutation now uses it (feature existed, canonicalized) |
| E1 | Same-device resume | New `resumeSession(remote: LiftingSession)` in `useLiveSession.ts` rebuilds state from `GET /sessions/active` (sets mapped to remote ids); the pre-start orphan box now offers **Resume session** alongside Close it — only when local state is empty |
| E2 | Load from today's plan (suggest-only) | `['live-plan-today']` query finds today's active + strength plan day; chip on pre-start prefills focus + first planned exercise on tap; nothing auto-applies; manual focus selection clears the preset |
| E5 | Orphan auto-heal (backend) | `cleanup_old_data` (weekly Sun 3AM) now closes `started_at < now−24h AND ended_at IS NULL` sessions: `ended_at = started_at + 5min`, sets `duration_seconds`, appends `(auto-closed — orphaned live session)` note |

## Verification

- `npm run typecheck` — clean
- `npm test` — 34 passing (2 new window tests on top of yesterday's 32)
- `npm run build` — succeeds
- `backend`: `python -m py_compile app/tasks/scheduler.py` — clean (ruff/container run pending)

## Files touched (enhancement pass)

- `frontend/src/components/Providers.tsx` — E8 token watcher
- `frontend/src/lib/lifting/reference.ts` + `frontend/src/__tests__/lifting-reference.test.ts` — E4
- `frontend/src/app/(app)/lifting/live/page.tsx` — E3 summary screen, E1 resume prompt, E2 plan chip
- `frontend/src/components/lifting/LiveWorkout.tsx` — E6 sync pill
- `frontend/src/lib/api/lifting.ts` + `frontend/src/app/(app)/lifting/page.tsx` — E7
- `frontend/src/lib/lifting/useLiveSession.ts` — E1 `resumeSession`
- `backend/app/tasks/scheduler.py` — E5 orphan heal

## Follow-ups flagged (not part of this pass)

- **AGENTS.md** incorporates the other session's uncommitted edits — the
  `cleanup_old_data` Celery-table row and any Planned/Incomplete notes should be
  updated once that session lands.
- **B1 planned-exercise prefill (auto-apply)** and **B4 rest countdown** remain
  out of scope by decision.