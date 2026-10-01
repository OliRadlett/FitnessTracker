'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addSetToSession,
  createLiftingSession,
  deleteLiftingSet,
  updateLiftingSession,
} from '@/lib/api/lifting';
import type { AddSetPayload, LiftingSession } from '@/lib/api/types';

type AuthFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LoggedSet {
  clientId: string;
  exercise_name: string;
  set_number: number;
  weight_kg: number;
  reps: number;
  rpe?: number;
  is_warmup: boolean;
  is_amrap: boolean;
  /** null while unsynced */
  remoteId: string | null;
  /**
   * Why this set can never sync, or null. Set only for a permanent rejection
   * (400/422) so the set is dead-lettered rather than retried forever. Never
   * set for a transient failure — those stay queued and retry.
   */
  failedReason: string | null;
  /** Sync attempts so far; used to bound the retry loop. */
  attempts: number;
}

/** A planned exercise target carried from today's training plan. */
export interface PlanTarget {
  exercise: string;
  sets: number;
  reps: number;
}

export interface LiveSessionState {
  phase: 'active' | 'finishing';
  sessionId: string | null;
  /** Stable id generated at start — makes session creation idempotent server-side */
  liveKey: string;
  startedAt: string;
  programName?: string;
  focus?: string;
  /** Today's plan targets (suggest-only checklist); survives reload. */
  planTargets?: PlanTarget[];
  currentExercise: string | null;
  sets: LoggedSet[];
  /** Remote set ids queued for deletion (undo of already-synced sets) */
  pendingDeletes: string[];
  lastSetAt: string | null;
  /** Staged by requestFinish, consumed by the syncer */
  rpe_session?: number;
  notes?: string;
  /** Persisted by requestFinish so a flush that started pre-Finish still lands it */
  finish_requested?: boolean;
  /** Wall-clock end time fixed at requestFinish — not recomputed at sync time,
   *  so a delayed retry still records the true end of the session. */
  endedAt?: string;
}

export interface FinishMeta {
  rpe_session?: number;
  notes?: string;
}

const STORAGE_KEY = 'fittrack-live-session';

function loadState(): LiveSessionState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as LiveSessionState;
    if (!state || typeof state.startedAt !== 'string') return null;
    // States persisted before idempotency keys existed get one retroactively
    if (!state.liveKey) state.liveKey = newClientId();
    // Legacy `finishing` states predate the durable `finish_requested` flag.
    // Neither the retry effect nor flush()'s finish step would ever run for
    // them, so the user was wedged on the finishing overlay forever with no
    // way to start a new session. Backfill the intent so it can complete.
    if (state.phase === 'finishing' && !state.finish_requested) {
      state.finish_requested = true;
      if (!state.endedAt) state.endedAt = new Date().toISOString();
    }
    return state;
  } catch {
    return null;
  }
}

const EMPTY_DELETE_SET: ReadonlySet<string> = new Set();

/**
 * Give up on a set after this many attempts.
 *
 * Reached only when the server is genuinely flapping — a permanently-rejected
 * set is dead-lettered on the first 400/422 rather than consuming attempts.
 */
const MAX_SYNC_ATTEMPTS = 8;

/**
 * Classify a sync failure so the flush can tell "retry later" from "never".
 *
 * The old loop collapsed every error into one string and rethrew, so a single
 * permanently-invalid set aborted the whole flush: every later set stayed
 * local-only, every queued delete stayed queued, and the session finish (Step 4)
 * never ran. The finishing overlay then retried every 4s forever, and the one
 * control the user had — "retry" — failed identically each time.
 *
 * - `permanent` → the request will never succeed as-is. Dead-letter the set,
 *   skip it, and keep going. Never silently: it surfaces in the UI.
 * - `session-gone` → the server no longer has this session (404). Not a
 *   set-level failure: clear the session id so the next pass re-creates.
 * - `transient` → keep the current behaviour and let the backoff handle it.
 */
type SyncFailure = 'permanent' | 'session-gone' | 'transient';

function classifySyncFailure(err: unknown): SyncFailure {
  const status = (err as { status?: number } | null)?.status;
  if (status === 404) return 'session-gone';
  // 400/422 are validation failures — replaying the identical body cannot help.
  if (status === 400 || status === 422) return 'permanent';
  return 'transient';
}

/** Human-readable reason for a dead-lettered set, naming the likely bad field. */
function describePermanentFailure(err: unknown): string {
  const status = (err as { status?: number } | null)?.status;
  if (status === 422) return 'the server rejected these values — check weight and reps';
  if (status === 400) return 'the server rejected this set';
  return `the server rejected this set (HTTP ${status ?? 'unknown'})`;
}

/** Non-finite numbers become `null` through JSON.stringify, so Pydantic 422s forever. */
function isSyncableNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Next `set_number` for an exercise within a session.
 *
 * `max + 1` rather than `count + 1`: `resumeSession` adopts the server's
 * `set_number` verbatim, and those are not guaranteed contiguous, so counting
 * would silently skip numbers on a resumed session. Shared by `logSet` and
 * `nextSetNumberFor` so the two cannot drift.
 */
function nextSetNumber(exerciseName: string, sets: readonly LoggedSet[]): number {
  const numbers = sets
    .filter((s) => s.exercise_name === exerciseName)
    .map((s) => s.set_number);
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

/**
 * Merge flush-progress (`working`, snapshotted when the flush began) into the
 * freshest storage state. Logging a set while a request is in flight (or from
 * another tab) mutates storage directly; saving `working` alone would clobber
 * those mutations. Sync progress always wins for remoteIds; user data wins
 * from storage.
 *
 * `processedDeletes` lists remote ids this flush has already deleted. They must
 * be removed from the merged queue even though storage still holds them (storage
 * isn't touched until the next commit), otherwise every completed delete would
 * be re-queued and re-issued forever.
 */
export function mergeWithStorage(
  working: LiveSessionState,
  processedDeletes: ReadonlySet<string> = EMPTY_DELETE_SET,
  /**
   * True when this flush determined the remote session no longer exists (a 404
   * on set-add). Storage still holds the old id, and the normal
   * `working.sessionId ?? stored.sessionId` would restore it — defeating the
   * clear and wedging every later flush on a session that is gone. So an
   * explicit invalidation is passed through rather than inferred.
   */
  sessionInvalidated = false
): LiveSessionState | null {
  const stored = loadState();
  // The session was discarded mid-flush — stop syncing it and never resurrect
  // it locally (B2). Any remote rows this flush already created are orphaned,
  // which is acceptable; the local state is authoritative.
  if (!stored) return null;
  // A *different* session replaced this one mid-flush (discard + start, or a
  // resume). The snapshot is stale: stop syncing it and leave the replacement's
  // storage untouched. Returning `working` here would clobber the new session
  // with the old one.
  if (stored.startedAt !== working.startedAt) return null;

  const workingById = new Map(working.sets.map((s) => [s.clientId, s]));
  // Newest set data from storage; overlay sync progress learned during the flush.
  //
  // `remoteId`, `failedReason` and `attempts` are all *sync* progress rather
  // than user data, so they merge in from `working` exactly like remoteId does.
  // Leaving failedReason out would silently discard every dead-letter decision
  // this flush made — the set would be retried forever, which is the original
  // bug.
  const sets = stored.sets.map((s) => {
    const w = workingById.get(s.clientId);
    if (!w) return s;
    const next = { ...s };
    if (w.remoteId && !s.remoteId) next.remoteId = w.remoteId;
    if (w.failedReason && !s.failedReason) next.failedReason = w.failedReason;
    // Monotonic counter: take whichever snapshot is further along.
    if (w.attempts > (s.attempts ?? 0)) next.attempts = w.attempts;
    return next;
  });
  // Sets the flush snapshot knew about but storage lost. If the user removed a
  // set while its create was mid-flight (undo raced the sync), the server may
  // have already persisted it — do NOT resurrect the set locally; instead queue
  // the newly-learned remote id for deletion so the server copy is cleaned up.
  const pendingDeletes = new Set([...working.pendingDeletes, ...stored.pendingDeletes]);
  // Completed deletes are done — never re-queue them from stale storage.
  for (const id of processedDeletes) pendingDeletes.delete(id);
  for (const w of working.sets) {
    if (sets.some((s) => s.clientId === w.clientId)) continue;
    if (w.remoteId) pendingDeletes.add(w.remoteId);
  }

  return {
    ...stored,
    sessionId: sessionInvalidated ? null : (working.sessionId ?? stored.sessionId),
    sets,
    pendingDeletes: Array.from(pendingDeletes),
  };
}

function saveState(state: LiveSessionState | null) {
  if (typeof window === 'undefined') return;
  try {
    if (state) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage full/unavailable — session continues in memory only
  }
}

function newClientId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Calendar date in the user's LOCAL timezone (not UTC). Using UTC shifts a
 *  late-evening session onto the wrong date when the clock crosses midnight. */
function localDateStr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toPayload(set: LoggedSet): AddSetPayload {
  return {
    exercise_name: set.exercise_name,
    set_number: set.set_number,
    weight_kg: set.weight_kg,
    reps: set.reps,
    rpe: set.rpe,
    is_warmup: set.is_warmup,
    is_amrap: set.is_amrap,
    client_id: set.clientId,
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useLiveSession(authFetch: AuthFetch) {
  const [state, setState] = useState<LiveSessionState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  /** Inline message for a set rejected before it was ever queued. */
  const [validationError, setValidationError] = useState<string | null>(null);
  const [prEvents, setPrEvents] = useState<{ id: string; exercise_name: string; text: string }[]>([]);

  const syncingRef = useRef(false);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Explicit offline mode: the browser's own connectivity signal. Distinct from
  // `syncError` (which also fires on API failure / bad token while online) so
  // the UI can promise "logging locally, syncs on reconnect" instead of "will retry".
  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // `authFetch` is recreated by useAuthFetch whenever the backend token changes
  // (re-login, silent refresh). Network callbacks with [] deps must read the
  // latest one via this ref, otherwise a refreshed token is never picked up and
  // every sync 401s with the stale closure.
  const authFetchRef = useRef(authFetch);
  authFetchRef.current = authFetch;

  // Hydrate from localStorage once
  useEffect(() => {
    setState(loadState());
    setHydrated(true);
  }, []);

  // Persist on every change
  useEffect(() => {
    if (hydrated) saveState(state);
  }, [state, hydrated]);

  const patch = useCallback((updater: (prev: LiveSessionState) => LiveSessionState) => {
    setState((prev) => (prev ? updater(prev) : prev));
  }, []);

  // ── Sync engine ──
  //
  // Local set log is the source of truth. The syncer lazily creates the remote
  // session (with all accumulated sets), then pushes unsynced sets / deletes.
  // Never throws — failures just leave items queued for the next attempt.

  const flush = useCallback(async () => {
    const current = loadState();
    if (!current || syncingRef.current) return;
    syncingRef.current = true;

    let working = current;
    // Remote ids this flush has successfully deleted. Without this, commit()'s
    // merge would re-queue them from the not-yet-updated storage snapshot and
    // the flush would re-issue the same DELETE forever (404 → retry loop).
    const processedDeletes = new Set<string>();
    // Set when a 404 proves the remote session is gone, so the clear survives
    // the merge (storage still holds the stale id).
    let sessionInvalidated = false;
    // Fold sync progress into the freshest storage state (which may have been
    // mutated mid-flight) and mirror it into React state. The extra spread
    // guarantees a new reference so setState always re-renders. Returns false
    // if the session was discarded/replaced mid-flush — the sync must stop.
    const commit = (): boolean => {
      const merged = mergeWithStorage(working, processedDeletes, sessionInvalidated);
      if (merged === null) {
        syncingRef.current = false;
        return false;
      }
      working = { ...merged };
      setState(working);
      saveState(working);
      return true;
    };
    try {
      // Step 1: create remote session if needed
      if (!working.sessionId) {
        if (working.sets.length === 0 && working.phase === 'active') {
          // Nothing to create yet — wait for first set (avoids empty sessions
          // if user starts then abandons before logging anything)
          syncingRef.current = false;
          setSyncError(false);
          return;
        }
        const created = await createLiftingSession(authFetchRef.current, {
          session_date: localDateStr(working.startedAt),
          program_name: working.programName,
          focus: working.focus,
          started_at: working.startedAt,
          live_key: working.liveKey,
          sets: working.sets.filter((s) => !s.remoteId).map(toPayload),
        });
        // Map real remote ids via the echoed client_ids — never fake markers,
        // so undoing one of these sets deletes it remotely. If the server had
        // already created this session (retry/duplicate flush), the deduped
        // response includes those sets too and they resolve here instead of
        // being re-created.
        for (const s of working.sets) {
          if (!s.remoteId) {
            s.remoteId = created.sets.find((r) => r.client_id === s.clientId)?.id ?? null;
          }
        }
        // CRITICAL: capture the remote session id. Without this every subsequent
        // flush re-enters Step 1 (dedup returns the existing session) and Step
        // 2/4 call PATCH/POST /sessions/null → 422, leaving the finish stuck.
        working.sessionId = created.id;
        if (!commit()) return { finished: false };
      }

      // Step 2: push unsynced sets individually (idempotent via client_id).
      //
      // A failure here must not abandon the rest of the flush: Steps 3 (deletes)
      // and 4 (finish) sit below this loop, so throwing strands them forever
      // behind one bad set.
      const unsynced = working.sets.filter((s) => !s.remoteId && !s.failedReason);
      for (const set of unsynced) {
        // Bounded: a set that keeps failing transiently is dead-lettered rather
        // than retried without limit.
        if (set.attempts >= MAX_SYNC_ATTEMPTS) {
          set.failedReason = 'gave up after repeated sync failures';
          if (!commit()) return { finished: false };
          continue;
        }
        set.attempts += 1;
        try {
          const remote = await addSetToSession(authFetchRef.current, working.sessionId!, toPayload(set));
          const target = working.sets.find((s) => s.clientId === set.clientId);
          if (target && !target.remoteId) target.remoteId = remote.id;
          if (!commit()) return { finished: false };
        } catch (err) {
          const failure = classifySyncFailure(err);

          if (failure === 'session-gone') {
            // The remote session no longer exists. Not this set's fault — drop the
            // id so Step 1 re-creates on the next pass. Re-creation is idempotent
            // because it reuses the SAME liveKey (never a fresh one), so
            // create_session collapses instead of minting a duplicate.
            working.sessionId = null;
            sessionInvalidated = true;
            if (!commit()) return { finished: false };
            // Release the in-flight guard before scheduling. commit()'s success
            // path does not clear it (only the tail of the try block does), so
            // without this the follow-up flush would see syncingRef still true
            // and return immediately — the session id would stay cleared with
            // nothing retrying it.
            syncingRef.current = false;
            // Bailing out here skips the "still pending?" check at the end of
            // the try block, so schedule the re-create explicitly.
            void followUpFlush(500);
            return { finished: false };
          }

          if (failure === 'permanent') {
            // Dead-letter this set and carry on. Deliberately not silent: it is
            // surfaced via syncStatus/pendingCount and can be removed from the
            // finishing overlay, so this is recoverable rather than a wedge.
            const target = working.sets.find((s) => s.clientId === set.clientId);
            if (target) target.failedReason = describePermanentFailure(err);
            if (!commit()) return { finished: false };
            continue;
          }

          // Transient — rethrow so the outer catch backs off and retries, but
          // commit first: `attempts` was incremented above and the throw
          // abandons this flush, so without persisting it the counter never
          // survives and the bound below can never be reached.
          if (!commit()) return { finished: false };
          throw new Error('add-set-failed');
        }
      }

      // Step 3: push pending deletes
      for (const remoteId of [...working.pendingDeletes]) {
        try {
          await deleteLiftingSet(authFetchRef.current, remoteId);
        } catch (err) {
          // A set already deleted elsewhere (another tab/device) returns 404.
          // Treat it as done so a stale id can never wedge the queue (and the
          // finish step behind it) in a permanent retry loop.
          if ((err as { status?: number } | null)?.status !== 404) throw err;
        }
        working.pendingDeletes = working.pendingDeletes.filter((id) => id !== remoteId);
        processedDeletes.add(remoteId);
        if (!commit()) return { finished: false };
      }

      // Step 4: finish flow — gated on the durable finish_requested flag so a
      // flush that started before requestFinish (snapshot had phase='active')
      // still applies ended_at/rpe/notes from the persisted intent. Also runs
      // for any `finishing` state so a legacy snapshot (pre-flag) completes.
      //
      // Reached even when a set was dead-lettered in Step 2: the session should
      // close with the sets that DID sync, not be held open by one that never
      // can. The dead-lettered set stays visible and removable.
      if (working.finish_requested || working.phase === 'finishing') {
        // A `finishing` state with no remote session has nothing to persist —
        // clear it locally rather than PATCHing /sessions/null forever.
        if (!working.sessionId) {
          setState(null);
          saveState(null);
          setSyncError(false);
          syncingRef.current = false;
          return { finished: true };
        }
        const endedAt = working.endedAt ?? new Date().toISOString();
        const durationSeconds = Math.max(
          0,
          Math.round((new Date(endedAt).getTime() - new Date(working.startedAt).getTime()) / 1000)
        );
        try {
          await updateLiftingSession(authFetchRef.current, working.sessionId, {
            session_date: localDateStr(working.startedAt),
            ended_at: endedAt,
            duration_seconds: durationSeconds,
            rpe_session: working.rpe_session,
            notes: working.notes,
          });
        } catch (err) {
          // The remote session was deleted/auto-closed while this finish was
          // queued. It's already gone — treat the finish as done instead of
          // retrying a 404 forever (which wedged START behind the overlay).
          if ((err as { status?: number } | null)?.status !== 404) throw err;
        }
        setState(null);
        saveState(null);
        setSyncError(false);
        syncingRef.current = false;
        return { finished: true };
      }

      setSyncError(false);
      // If the user mutated sets while this flush was in flight (B4), those
      // mutations are in storage but were not in our snapshot — schedule one
      // more pass so they actually reach the server rather than lingering as
      // "unsynced" until the next online/visibility trigger.
      const fresh = loadState();
      const stillPending =
        fresh &&
        ((fresh.sets ?? []).some((s) => !s.remoteId) ||
          (fresh.pendingDeletes && fresh.pendingDeletes.length > 0) ||
          fresh.finish_requested);
      if (stillPending) void followUpFlush();
      syncingRef.current = false;
      return { finished: false };
    } catch {
      // Network/API failure — keep everything queued, retry on next trigger.
      // If the BROWSER says we're offline, don't schedule timer retries that are
      // just going to fail again — the 'online' event listener flushes the backlog
      // the moment connectivity returns, so logging stays responsive and quiet.
      setSyncError(true);
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        syncingRef.current = false;
        return { finished: false };
      }
      // Online but failing — use a long delay here (not the tight 1.5s follow-up)
      // so a dead backend token or flaky network isn't hammered while the finish
      // is pending; the finish-retry effect (4s) and visibility listeners retry too.
      void followUpFlush(8000);
      syncingRef.current = false;
      return { finished: false };
    }
  }, []);

  // Stable handle for the current scheduleFlush so `flush` can schedule a
  // follow-up pass without a circular useCallback dependency.
  const followUpFlush = useCallback((delayMs = 1500) => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      void flushRef.current();
    }, delayMs);
  }, []);

  const flushRef = useRef<() => Promise<{ finished: boolean } | undefined>>(async () => undefined);
  flushRef.current = flush;

  const scheduleFlush = useCallback(() => {
    // Deterministically offline → skip the attempt; the 'online' event flush
    // is already wired and replays everything queued. This keeps the "to sync"
    // meter honest about how much is waiting without firing doomed requests.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    followUpFlush();
  }, [followUpFlush]);

  // Retry on reconnect / app foreground
  useEffect(() => {
    const onOnline = () => void flush();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void flush();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [flush]);

  // ── Mutations ──

  const startSession = useCallback(
    (opts: { programName?: string; focus?: string; planTargets?: PlanTarget[] }) => {
      const existing = loadState();
      if (existing && existing.phase !== 'finishing') {
        // Another tab (or a stale mount) already owns an active session. Adopt
        // it into React state instead of silently ignoring the tap — a no-op
        // here makes START look dead ("not starting a session").
        setState(existing);
        return;
      }
      const fresh: LiveSessionState = {
        phase: 'active',
        sessionId: null,
        liveKey: newClientId(),
        startedAt: new Date().toISOString(),
        programName: opts.programName || undefined,
        focus: opts.focus || undefined,
        planTargets: opts.planTargets?.length ? opts.planTargets : undefined,
        currentExercise: null,
        sets: [],
        pendingDeletes: [],
        lastSetAt: null,
      };
      setState(fresh);
      saveState(fresh);
      setSyncError(false);
    },
    []
  );

  const logSet = useCallback(
    (
      input: {
        exercise_name: string;
        weight_kg: number;
        reps: number;
        rpe?: number;
        is_warmup?: boolean;
        is_amrap?: boolean;
      },
      prText?: string
    ): boolean => {
      // Refuse a set that can never sync. A stray letter in a numeric field
      // yields NaN, JSON.stringify turns NaN into null, and Pydantic rejects
      // the body with 422 on every attempt — a poison pill that persisted to
      // localStorage and blocked the whole flush. Cheap to stop here.
      if (!isSyncableNumber(input.weight_kg) || !isSyncableNumber(input.reps)) {
        setValidationError(
          'Weight and reps must be numbers. Set not logged.'
        );
        return false;
      }
      setValidationError(null);

      const clientId = newClientId();
      patch((prev) => ({
        ...prev,
        currentExercise: input.exercise_name,
        lastSetAt: new Date().toISOString(),
        sets: [
          ...prev.sets,
          {
            clientId,
            remoteId: null,
            failedReason: null,
            attempts: 0,
            exercise_name: input.exercise_name,
            // max+1, not count+1: a resumed session adopts the server's
            // set_number verbatim and those are not guaranteed contiguous, so
            // counting would silently skip numbers.
            set_number: nextSetNumber(input.exercise_name, prev.sets),
            weight_kg: input.weight_kg,
            reps: input.reps,
            rpe: input.rpe,
            is_warmup: input.is_warmup ?? false,
            is_amrap: input.is_amrap ?? false,
          },
        ],
      }));
      if (prText) {
        const evt = { id: clientId, exercise_name: input.exercise_name, text: prText };
        setPrEvents((prev) => [...prev, evt]);
        setTimeout(() => {
          setPrEvents((prev) => prev.filter((e) => e.id !== evt.id));
        }, 5000);
      }
      scheduleFlush();
      return true;
    },
    [patch, scheduleFlush]
  );

  const undoLastSet = useCallback(() => {
    patch((prev) => {
      if (prev.sets.length === 0) return prev;
      const last = prev.sets[prev.sets.length - 1];
      return {
        ...prev,
        sets: prev.sets.filter((s) => s.clientId !== last.clientId),
        pendingDeletes:
          last.remoteId
            ? [...prev.pendingDeletes, last.remoteId]
            : prev.pendingDeletes,
      };
    });
    scheduleFlush();
  }, [patch, scheduleFlush]);

  /** Delete a specific set (not just the last) — e.g. a mis-tapped middle set.
   *  A synced set's remote id is queued for deletion, same as undo. */
  const removeSet = useCallback(
    (clientId: string) => {
      patch((prev) => {
        const target = prev.sets.find((s) => s.clientId === clientId);
        if (!target) return prev;
        return {
          ...prev,
          sets: prev.sets.filter((s) => s.clientId !== clientId),
          pendingDeletes: target.remoteId
            ? [...prev.pendingDeletes, target.remoteId]
            : prev.pendingDeletes,
        };
      });
      scheduleFlush();
    },
    [patch, scheduleFlush]
  );

  const setCurrentExercise = useCallback(
    (name: string) => {
      patch((prev) => ({ ...prev, currentExercise: name }));
    },
    [patch]
  );

  const discardSession = useCallback(async () => {
    // Best-effort cleanup of any remote artifacts, but never block discard
    const current = loadState();
    saveState(null);
    setState(null);
    setSyncError(false);
    if (current?.sessionId) {
      const ids = current.sets
        .filter((s) => s.remoteId)
        .map((s) => s.remoteId!);
      try {
        for (const id of ids) await deleteLiftingSet(authFetchRef.current, id);
        await updateLiftingSession(authFetchRef.current, current.sessionId, { ended_at: new Date().toISOString(), notes: '(discarded)' });
      } catch {
        // orphaned remote rows are acceptable; local state is authoritative
      }
    }
  }, []);

  const requestFinish = useCallback(
    async (meta: FinishMeta): Promise<boolean> => {
      const current = loadState();
      if (!current) return false;
      if (!current.sessionId && current.sets.length === 0) {
        // Nothing was ever logged — no remote artifacts to clean up
        saveState(null);
        setState(null);
        return true;
      }
      const finishing: LiveSessionState = {
        ...current,
        phase: 'finishing',
        rpe_session: meta.rpe_session,
        notes: meta.notes,
        finish_requested: true,
        // Capture the wall-clock end now so a delayed retry records the true
        // end of the workout rather than whatever time the sync finally lands.
        endedAt: new Date().toISOString(),
      };
      saveState(finishing);
      setState(finishing);
      // Await the flush so the caller (sheet) knows whether finish landed.
      // If a scheduled flush is already in-flight (syncingRef), flush() returns
      // early — the in-flight flush's commit() picks up finish_requested via
      // mergeWithStorage, and the background retry effect catches any remaining
      // case. Treat that as "progressing" (not a failure) so the sheet closes
      // and the finishing overlay shows the retry state.
      const result = await flush();
      if (result !== undefined) return !!result.finished;
      return true;
    },
    [flush]
  );

  const retrySync = useCallback(() => {
    void flush();
  }, [flush]);

  /**
   * Rebuild a live session from a server-side unfinished session (localStorage
   * was cleared/lost on this device, e.g. after a killed tab). Sets already have
   * remote ids, so nothing re-creates; new logging appends to the same session.
   */
  const resumeSession = useCallback((remote: LiftingSession) => {
    if (state && state.phase !== 'finishing') return; // never clobber a live session
    const sets: LoggedSet[] = (remote.sets ?? []).map((s) => ({
      clientId: s.client_id ?? `resume-${s.id}`,
      remoteId: s.id,
      failedReason: null,
      attempts: 0,
      exercise_name: s.exercise_name,
      // Adopted verbatim; nextSetNumber() takes max+1 so a gap here is not
      // carried into a collision.
      set_number: s.set_number,
      weight_kg: s.weight_kg,
      reps: s.reps,
      rpe: s.rpe,
      is_warmup: s.is_warmup,
      is_amrap: s.is_amrap,
    }));
    const firstSetIsWarmup = sets.find((s) => !s.is_warmup) ?? sets[0];
    const fresh: LiveSessionState = {
      phase: 'active',
      sessionId: remote.id,
      liveKey: newClientId(),
      startedAt: remote.started_at ?? remote.created_at,
      programName: remote.program_name || undefined,
      focus: remote.focus,
      currentExercise: firstSetIsWarmup?.exercise_name ?? null,
      sets,
      pendingDeletes: [],
      lastSetAt: null,
    };
    setState(fresh);
    saveState(fresh);
    setSyncError(false);
  }, [state]);

  // Background retry for the finishing state. If flush() can't run (busy) or
  // fails (network/API), keep retrying with capped backoff so a finish that
  // failed mid-flight never leaves the user stuck on the overlay. Note this
  // runs even when `sessionId` is still null — a create that failed (e.g. dead
  // backend token) must be retried too, not abandoned.
  const finishing = state?.phase === 'finishing' || !!state?.finish_requested;

  // Stop retrying once there is provably nothing left that a retry can fix.
  // The loop previously had no termination condition, so a permanently-rejected
  // set meant an unbounded 4s re-push against the backend for as long as the
  // overlay was open. Dead-lettered sets and exhausted attempts both mean
  // "retrying is pointless"; transient-pending work still retries.
  // A finish still has to be flushed even when no sets are pending — Step 4
  // PATCHes the session's ended_at/duration, which is the whole point of
  // finishing. So gate only on retryable *sets* and deletes, never on the
  // absence of a sessionId: a legacy `finishing` snapshot (persisted before
  // finish_requested existed) and a 404-cleared session both look "nothing to
  // sync" otherwise, and would never complete.
  //
  // The bound on the loop is per-set (MAX_SYNC_ATTEMPTS in Step 2), not here:
  // a dead-lettered set is skipped outright rather than re-attempted, so this
  // effect converges as soon as the finish PATCH lands and state clears.
  useEffect(() => {
    if (!finishing) return;
    if (syncingRef.current) return;

    const timer = setTimeout(() => {
      void flush();
    }, 4000);

    return () => clearTimeout(timer);
  }, [finishing, state?.sessionId, state?.endedAt, flush]);

  // Derived helpers
  const setsForExercise = useCallback(
    (exerciseName: string | null) =>
      state?.sets.filter((s) => s.exercise_name === exerciseName) ?? [],
    [state]
  );

  const nextSetNumberFor = useCallback(
    (exerciseName: string | null) =>
      exerciseName && state ? nextSetNumber(exerciseName, state.sets) : 0,
    [state]
  );

  const totalVolume =
    state?.sets.reduce((sum, s) => sum + s.weight_kg * s.reps, 0) ?? 0;

  const exercises = Array.from(
    new Set((state?.sets ?? []).map((s) => s.exercise_name))
  );

  // Sets the server rejected permanently. Surfaced so a dead-lettered set is
  // visible and removable rather than silently dropped — swallowing it would
  // trade a loud wedge for quiet data loss.
  const failedSets = (state?.sets ?? []).filter((s) => s.failedReason);

  // Sets + deletes not yet confirmed by the server — the "to sync" meter.
  // A dead-lettered set is still unsynced, so it counts here too: it is work the
  // session has not successfully pushed.
  const pendingCount =
    (state?.sets ?? []).filter((s) => !s.remoteId).length +
    (state?.pendingDeletes?.length ?? 0);

  // Deterministic ordering. 'blocked' outranks the transient states: a
  // permanently-rejected set needs a decision from the user, and retrying will
  // not fix it.
  type LiveSyncStatus = 'synced' | 'pending' | 'offline' | 'error' | 'blocked';
  const syncStatus: LiveSyncStatus = isOffline
    ? 'offline'
    : failedSets.length > 0
      ? 'blocked'
      : syncError
        ? 'error'
        : pendingCount > 0
          ? 'pending'
          : 'synced';

  return {
    state,
    hydrated,
    syncError,
    isOffline,
    pendingCount,
    syncStatus,
    /** Permanently-rejected sets, with the reason, so the UI can offer recovery. */
    failedSets,
    /** Inline message for a set rejected before it was queued (bad input). */
    validationError,
    prEvents,
    totalVolume,
    exercises,
    startSession,
    logSet,
    undoLastSet,
    removeSet,
    setCurrentExercise,
    discardSession,
    requestFinish,
    retrySync,
    resumeSession,
    setsForExercise,
    nextSetNumberFor,
  };
}
