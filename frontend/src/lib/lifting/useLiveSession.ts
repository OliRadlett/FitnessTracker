'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addSetToSession,
  createLiftingSession,
  deleteLiftingSet,
  updateLiftingSession,
} from '@/lib/api/lifting';
import type { AddSetPayload } from '@/lib/api/types';

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
    return state;
  } catch {
    return null;
  }
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

function toPayload(set: LoggedSet): AddSetPayload {
  return {
    exercise_name: set.exercise_name,
    set_number: set.set_number,
    weight_kg: set.weight_kg,
    reps: set.reps,
    rpe: set.rpe,
    is_warmup: set.is_warmup,
    is_amrap: set.is_amrap,
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
        const created = await createLiftingSession(authFetch, {
          session_date: new Date(working.startedAt).toISOString().slice(0, 10),
          program_name: working.programName,
          focus: working.focus,
          started_at: working.startedAt,
          sets: working.sets.filter((s) => !s.remoteId).map(toPayload),
        });
        working = {
          ...working,
          sessionId: created.id,
          sets: working.sets.map((s) => ({ ...s, remoteId: s.remoteId ?? 'synced' })),
        };
        saveState(working);
      }

      // Step 2: push unsynced sets individually
      const unsynced = working.sets.filter((s) => !s.remoteId);
      for (const set of unsynced) {
        try {
          const remote = await addSetToSession(authFetch, working.sessionId!, toPayload(set));
          working = {
            ...working,
            sets: working.sets.map((s) =>
              s.clientId === set.clientId ? { ...s, remoteId: remote.id } : s
            ),
          };
          saveState(working);
        } catch {
          throw new Error('add-set-failed');
        }
      }

      // Step 3: push pending deletes
      for (const remoteId of [...working.pendingDeletes]) {
        await deleteLiftingSet(authFetch, remoteId);
        working = {
          ...working,
          pendingDeletes: working.pendingDeletes.filter((id) => id !== remoteId),
        };
        saveState(working);
      }

      // Step 4: finish flow
      if (working.phase === 'finishing') {
        const durationSeconds = Math.max(
          0,
          Math.round((Date.now() - new Date(working.startedAt).getTime()) / 1000)
        );
        await updateLiftingSession(authFetch, working.sessionId!, {
          ended_at: new Date().toISOString(),
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
      syncingRef.current = false;
      return { finished: false };
    } catch {
      // Network/API failure — keep everything queued, retry on next trigger
      setSyncError(true);
      syncingRef.current = false;
      return { finished: false };
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      void flush();
    }, 1500);
  }, [flush]);

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
          last.remoteId && last.remoteId !== 'synced'
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
        .filter((s) => s.remoteId && s.remoteId !== 'synced')
        .map((s) => s.remoteId!);
      try {
        for (const id of ids) await deleteLiftingSet(authFetch, id);
        await updateLiftingSession(authFetch, current.sessionId, { ended_at: new Date().toISOString(), notes: '(discarded)' });
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
      };
      saveState(finishing);
      setState(finishing);
      const result = await flush();
      return !!result?.finished;
    },
    [flush]
  );

  const retrySync = useCallback(() => {
    void flush();
  }, [flush]);

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
    setsForExercise,
    nextSetNumberFor,
  };
}
