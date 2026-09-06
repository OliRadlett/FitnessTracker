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
}

export interface LiveSessionState {
  phase: 'active' | 'finishing';
  sessionId: string | null;
  /** Stable id generated at start — makes session creation idempotent server-side */
  liveKey: string;
  startedAt: string;
  programName?: string;
  focus?: string;
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
    return state;
  } catch {
    return null;
  }
}

/**
 * Merge flush-progress (`working`, snapshotted when the flush began) into the
 * freshest storage state. Logging a set while a request is in flight (or from
 * another tab) mutates storage directly; saving `working` alone would clobber
 * those mutations. Sync progress always wins for remoteIds; user data wins
 * from storage.
 */
function mergeWithStorage(working: LiveSessionState): LiveSessionState | null {
  const stored = loadState();
  // The session was discarded mid-flush — stop syncing it and never resurrect
  // it locally (B2). Any remote rows this flush already created are orphaned,
  // which is acceptable; the local state is authoritative.
  if (!stored) return null;
  if (stored.startedAt !== working.startedAt) return working;

  const workingById = new Map(working.sets.map((s) => [s.clientId, s]));
  // Newest set data from storage; overlay any remoteId learned during the flush
  const sets = stored.sets.map((s) => {
    const w = workingById.get(s.clientId);
    if (!w) return s;
    return w.remoteId && !s.remoteId ? { ...s, remoteId: w.remoteId } : s;
  });
  // Sets the flush snapshot knew about but storage lost. If the user removed a
  // set while its create was mid-flight (undo raced the sync), the server may
  // have already persisted it — do NOT resurrect the set locally; instead queue
  // the newly-learned remote id for deletion so the server copy is cleaned up.
  const pendingDeletes = new Set([...working.pendingDeletes, ...stored.pendingDeletes]);
  for (const w of working.sets) {
    if (sets.some((s) => s.clientId === w.clientId)) continue;
    if (w.remoteId) pendingDeletes.add(w.remoteId);
  }

  return {
    ...stored,
    sessionId: working.sessionId ?? stored.sessionId,
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
  const [prEvents, setPrEvents] = useState<{ id: string; exercise_name: string; text: string }[]>([]);

  const syncingRef = useRef(false);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    // Fold sync progress into the freshest storage state (which may have been
    // mutated mid-flight) and mirror it into React state. The extra spread
    // guarantees a new reference so setState always re-renders. Returns false
    // if the session was discarded mid-flush — the sync must stop.
    const commit = (): boolean => {
      const merged = mergeWithStorage(working);
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

      // Step 2: push unsynced sets individually (idempotent via client_id)
      const unsynced = working.sets.filter((s) => !s.remoteId);
      for (const set of unsynced) {
        try {
          const remote = await addSetToSession(authFetchRef.current, working.sessionId!, toPayload(set));
          const target = working.sets.find((s) => s.clientId === set.clientId);
          if (target && !target.remoteId) target.remoteId = remote.id;
          if (!commit()) return { finished: false };
        } catch {
          throw new Error('add-set-failed');
        }
      }

      // Step 3: push pending deletes
      for (const remoteId of [...working.pendingDeletes]) {
        await deleteLiftingSet(authFetchRef.current, remoteId);
        working.pendingDeletes = working.pendingDeletes.filter((id) => id !== remoteId);
        if (!commit()) return { finished: false };
      }

      // Step 4: finish flow — gated on the durable finish_requested flag so a
      // flush that started before requestFinish (snapshot had phase='active')
      // still applies ended_at/rpe/notes from the persisted intent.
      if (working.finish_requested) {
        const endedAt = working.endedAt ?? new Date().toISOString();
        const durationSeconds = Math.max(
          0,
          Math.round((new Date(endedAt).getTime() - new Date(working.startedAt).getTime()) / 1000)
        );
        await updateLiftingSession(authFetchRef.current, working.sessionId!, {
          session_date: localDateStr(working.startedAt),
          ended_at: endedAt,
          duration_seconds: durationSeconds,
          rpe_session: working.rpe_session,
          notes: working.notes,
        });
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
      // Use a long delay here (not the tight 1.5s follow-up) so a dead backend
      // token or offline network isn't hammered while the finish is pending;
      // the finish-retry effect (4s) and online/visibility listeners also
      // trigger retries.
      setSyncError(true);
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
    (opts: { programName?: string; focus?: string }) => {
      const existing = loadState();
      if (existing && existing.phase !== 'finishing') return; // never clobber an active session
      const fresh: LiveSessionState = {
        phase: 'active',
        sessionId: null,
        liveKey: newClientId(),
        startedAt: new Date().toISOString(),
        programName: opts.programName || undefined,
        focus: opts.focus || undefined,
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
    ) => {
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
            exercise_name: input.exercise_name,
            // Derived from latest persisted state, never a stale closure
            set_number:
              prev.sets.filter((s) => s.exercise_name === input.exercise_name).length + 1,
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
      exercise_name: s.exercise_name,
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
  useEffect(() => {
    if (!state?.finish_requested) return;
    if (syncingRef.current) return;

    const timer = setTimeout(() => {
      void flush();
    }, 4000);

    return () => clearTimeout(timer);
  }, [state?.finish_requested, state?.sessionId, state?.endedAt, flush]);

  // Derived helpers
  const setsForExercise = useCallback(
    (exerciseName: string | null) =>
      state?.sets.filter((s) => s.exercise_name === exerciseName) ?? [],
    [state]
  );

  const nextSetNumberFor = useCallback(
    (exerciseName: string | null) =>
      (exerciseName ? (state?.sets.filter((s) => s.exercise_name === exerciseName).length ?? 0) : 0) + 1,
    [state]
  );

  const totalVolume =
    state?.sets.reduce((sum, s) => sum + s.weight_kg * s.reps, 0) ?? 0;

  const exercises = Array.from(
    new Set((state?.sets ?? []).map((s) => s.exercise_name))
  );

  return {
    state,
    hydrated,
    syncError,
    prEvents,
    totalVolume,
    exercises,
    startSession,
    logSet,
    undoLastSet,
    setCurrentExercise,
    discardSession,
    requestFinish,
    retrySync,
    resumeSession,
    setsForExercise,
    nextSetNumberFor,
  };
}
