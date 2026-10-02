import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// The flush engine used to collapse every set-add failure into one string and
// rethrow, which aborted the WHOLE flush. Steps 3 (queued deletes) and 4 (the
// session finish) sit below the set loop, so a single permanently-invalid set
// stranded every later set as local-only, never drained a delete, and left the
// finishing overlay retrying every 4s forever — with a "Retry now" button that
// failed identically each time.
//
// Most reachable trigger: a stray letter in a numeric input yields NaN,
// JSON.stringify turns NaN into null, and Pydantic 422s the body on every
// attempt. The set is persisted to localStorage, so the poison survives reload.

const api = vi.hoisted(() => ({
  createLiftingSession: vi.fn(),
  addSetToSession: vi.fn(),
  deleteLiftingSet: vi.fn(),
  updateLiftingSession: vi.fn(),
}));

vi.mock('@/lib/api/lifting', () => api);

import { useLiveSession } from '@/lib/lifting/useLiveSession';

const STORAGE_KEY = 'fittrack-live-session';

/** An error shaped like the one authFetch throws for a given HTTP status. */
function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

function remoteFromCreatePayload(payload: {
  session_date: string;
  sets?: { client_id?: string }[];
}) {
  return {
    id: 'r-session',
    session_date: payload.session_date,
    sets: (payload.sets ?? []).map((s, i) => ({
      id: `r-set-${i}`,
      session_id: 'r-session',
      client_id: s.client_id,
      exercise_name: 'Squat',
      set_number: i + 1,
      weight_kg: 100,
      reps: 5,
      is_warmup: false,
      is_amrap: false,
    })),
  };
}

/** Drain timers until the queue stops changing. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20000);
  });
}

describe('useLiveSession flush liveness', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    api.createLiftingSession.mockReset();
    api.addSetToSession.mockReset();
    api.deleteLiftingSet.mockReset();
    api.updateLiftingSession.mockReset();
    api.createLiftingSession.mockImplementation(async (_af, payload) =>
      remoteFromCreatePayload(payload)
    );
    api.addSetToSession.mockImplementation(async (_af, sessionId, payload) => ({
      id: `added-${payload.client_id}`,
      session_id: sessionId,
      ...payload,
    }));
    api.deleteLiftingSet.mockResolvedValue(undefined);
    api.updateLiftingSession.mockResolvedValue({ id: 'r-session' });
    // The browser is online by default; individual tests override per case.
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── The poison pill: validation before persisting ────────────────────────

  describe('rejects unsyncable input before it is queued', () => {
    it('refuses a NaN weight and never persists it', async () => {
      const { result } = renderHook(() => useLiveSession(vi.fn() as never));
      act(() => result.current.startSession({}));

      let logged = true;
      act(() => {
        logged = result.current.logSet({
          exercise_name: 'Squat',
          weight_kg: Number.NaN, // what parseFloat('80kg') yields
          reps: 5,
        });
      });

      expect(logged).toBe(false);
      expect(result.current.validationError).toMatch(/must be numbers/i);
      // Never entered the queue, so it can never wedge the flush.
      expect(result.current.state?.sets).toHaveLength(0);
      expect(result.current.failedSets).toHaveLength(0);

      await settle();
      expect(api.addSetToSession).not.toHaveBeenCalled();
    });

    it('refuses Infinity and a non-finite rep count', async () => {
      const { result } = renderHook(() => useLiveSession(vi.fn() as never));
      act(() => result.current.startSession({}));

      act(() => {
        result.current.logSet({ exercise_name: 'Squat', weight_kg: Infinity, reps: 5 });
      });
      expect(result.current.state?.sets).toHaveLength(0);

      act(() => {
        result.current.logSet({ exercise_name: 'Squat', weight_kg: 100, reps: Number.NaN });
      });
      expect(result.current.state?.sets).toHaveLength(0);
    });

    it('clears the validation error once a valid set is logged', async () => {
      const { result } = renderHook(() => useLiveSession(vi.fn() as never));
      act(() => result.current.startSession({}));

      act(() => {
        result.current.logSet({ exercise_name: 'Squat', weight_kg: Number.NaN, reps: 5 });
      });
      expect(result.current.validationError).toBeTruthy();

      act(() => {
        result.current.logSet({ exercise_name: 'Squat', weight_kg: 100, reps: 5 });
      });
      expect(result.current.validationError).toBeNull();
      expect(result.current.state?.sets).toHaveLength(1);
    });

    it('logs a valid set and returns true', async () => {
      const { result } = renderHook(() => useLiveSession(vi.fn() as never));
      act(() => result.current.startSession({}));

      let logged = false;
      act(() => {
        logged = result.current.logSet({ exercise_name: 'Squat', weight_kg: 100, reps: 5 });
      });
      expect(logged).toBe(true);
    });
  });

  // ── The core regression: one bad set must not strand the session ─────────

  describe('a permanently-rejected set does not wedge the session', () => {
    /**
     * Logs one set and lets it sync, so the remote session exists and later
     * sets go through addSetToSession (Step 2) rather than being batched into
     * the initial create. That is the realistic shape: the typo happens
     * mid-workout, not in the first flush.
     */
    async function startWithOneSyncedSet() {
      const { result } = renderHook(() => useLiveSession(vi.fn() as never));
      act(() => result.current.startSession({}));
      act(() => {
        result.current.logSet({ exercise_name: 'Bench Press', weight_kg: 100, reps: 5 });
      });
      await settle();
      expect(result.current.state?.sessionId).toBe('r-session');
      return result;
    }

    it('still syncs the sets after the rejected one', async () => {
      const result = await startWithOneSyncedSet();

      // The server now rejects everything, standing in for any permanently
      // invalid payload (this exercises the dead-letter path itself, which the
      // input guard would otherwise prevent).
      api.addSetToSession.mockImplementation(async () => {
        throw httpError(422);
      });
      act(() => {
        result.current.logSet({ exercise_name: 'Row', weight_kg: 60, reps: 8 });
      });
      act(() => {
        result.current.logSet({ exercise_name: 'Deadlift', weight_kg: 180, reps: 3 });
      });
      await settle();

      // Both rejected and dead-lettered, rather than one aborting the flush and
      // leaving the other stranded.
      expect(result.current.failedSets).toHaveLength(2);
      expect(result.current.syncStatus).toBe('blocked');
    });

    it('keeps syncing good sets around a rejected one', async () => {
      const result = await startWithOneSyncedSet();

      // Reject only the Row set; Deadlift must still land.
      api.addSetToSession.mockImplementation(async (_af, sessionId, payload) => {
        if (payload.exercise_name === 'Row') throw httpError(422);
        return { id: `added-${payload.client_id}`, session_id: sessionId, ...payload };
      });

      act(() => {
        result.current.logSet({ exercise_name: 'Row', weight_kg: 60, reps: 8 });
      });
      act(() => {
        result.current.logSet({ exercise_name: 'Deadlift', weight_kg: 180, reps: 3 });
      });
      await settle();

      const deadlift = result.current.state?.sets.find((s) => s.exercise_name === 'Deadlift');
      expect(deadlift?.remoteId).toBeTruthy();
      expect(result.current.failedSets.map((s) => s.exercise_name)).toEqual(['Row']);
    });

    it('still drains queued deletes', async () => {
      const result = await startWithOneSyncedSet();
      api.addSetToSession.mockImplementation(async () => {
        throw httpError(422);
      });
      act(() => {
        result.current.logSet({ exercise_name: 'Row', weight_kg: 60, reps: 8 });
      });
      await settle();
      expect(result.current.failedSets).toHaveLength(1);

      // Removing the already-synced first set queues a delete; the poisoned
      // sibling must not stop it draining.
      act(() => result.current.removeSet(result.current.state!.sets[0].clientId));
      await settle();

      expect(api.deleteLiftingSet).toHaveBeenCalled();
      expect(result.current.state?.pendingDeletes ?? []).toHaveLength(0);
    });

    it('still completes the session finish', async () => {
      const result = await startWithOneSyncedSet();
      api.addSetToSession.mockImplementation(async () => {
        throw httpError(422);
      });
      act(() => {
        result.current.logSet({ exercise_name: 'Row', weight_kg: 50, reps: 10 });
      });
      await settle();
      expect(result.current.failedSets).toHaveLength(1);

      await act(async () => {
        await result.current.requestFinish({ rpe_session: 7 });
      });
      await settle();

      // The finish PATCH ran — the session closed rather than hanging on a set
      // that can never sync.
      expect(api.updateLiftingSession).toHaveBeenCalled();
    });

    it('reports the reason and names the exercise', async () => {
      const result = await startWithOneSyncedSet();
      api.addSetToSession.mockImplementation(async () => {
        throw httpError(422);
      });
      act(() => {
        result.current.logSet({ exercise_name: 'Row', weight_kg: 50, reps: 10 });
      });
      await settle();

      const failed = result.current.failedSets;
      expect(failed).toHaveLength(1);
      // Named, so the user knows which set and which field to fix.
      expect(failed[0].exercise_name).toBe('Row');
      expect(failed[0].failedReason).toMatch(/check weight and reps/i);
    });

    it('can be recovered by removing the rejected set', async () => {
      const result = await startWithOneSyncedSet();
      api.addSetToSession.mockImplementation(async () => {
        throw httpError(422);
      });
      act(() => {
        result.current.logSet({ exercise_name: 'Row', weight_kg: 50, reps: 10 });
      });
      await settle();
      expect(result.current.failedSets).toHaveLength(1);

      act(() => result.current.removeSet(result.current.failedSets[0].clientId));

      // Recovery is one action — this is the affordance that was missing.
      expect(result.current.failedSets).toHaveLength(0);
      expect(result.current.syncStatus).not.toBe('blocked');
    });
  });

  // ── Transient failures must still retry ─────────────────────────────────

  describe('transient failures still retry', () => {
    it('requeues on a 500 and syncs once the server recovers', async () => {
      const { result } = renderHook(() => useLiveSession(vi.fn() as never));
      act(() => result.current.startSession({}));

      let failNext = true;
      api.addSetToSession.mockImplementation(async (_af, sessionId, payload) => {
        if (failNext) throw httpError(500);
        return { id: `added-${payload.client_id}`, session_id: sessionId, ...payload };
      });

      act(() => {
        result.current.logSet({ exercise_name: 'Squat', weight_kg: 100, reps: 5 });
      });
      await settle();
      // Not dead-lettered: a 500 is worth retrying.
      expect(result.current.failedSets).toHaveLength(0);

      failNext = false;
      await settle();

      expect(result.current.state?.sets[0].remoteId).toBeTruthy();
    });

    it('a network error is not dead-lettered', async () => {
      const { result } = renderHook(() => useLiveSession(vi.fn() as never));
      act(() => result.current.startSession({}));

      // Fail the *create* so the set never gets a remote id, rather than the
      // add-set call the first flush may not reach.
      api.createLiftingSession.mockRejectedValue(new TypeError('Failed to fetch'));
      act(() => {
        result.current.logSet({ exercise_name: 'Squat', weight_kg: 100, reps: 5 });
      });
      await settle();

      expect(result.current.failedSets).toHaveLength(0);
      expect(result.current.state?.sets[0].remoteId).toBeNull();
    });
  });

  // ── A 404 on the session is not a set-level failure ─────────────────────

  describe('a vanished remote session re-creates instead of wedging', () => {
    it('clears the session id so the next pass re-creates', async () => {
      const { result } = renderHook(() => useLiveSession(vi.fn() as never));
      act(() => result.current.startSession({}));
      act(() => {
        result.current.logSet({ exercise_name: 'Squat', weight_kg: 100, reps: 5 });
      });
      await settle();
      expect(result.current.state?.sessionId).toBe('r-session');

      // Next set-add 404s: the session row is gone server-side.
      api.addSetToSession.mockImplementation(async () => {
        throw httpError(404);
      });
      act(() => {
        result.current.logSet({ exercise_name: 'Row', weight_kg: 60, reps: 8 });
      });
      await settle();

      // The 404 is a session problem, not a per-set rejection.
      expect(result.current.failedSets).toHaveLength(0);
      // Session id dropped so Step 1 re-creates on the following pass.
      expect(api.createLiftingSession.mock.calls.length).toBeGreaterThan(1);
    });

    it('reuses the same liveKey so re-creation collapses', async () => {
      const { result } = renderHook(() => useLiveSession(vi.fn() as never));
      act(() => result.current.startSession({}));
      act(() => {
        result.current.logSet({ exercise_name: 'Squat', weight_kg: 100, reps: 5 });
      });
      await settle();

      api.addSetToSession.mockImplementation(async () => {
        throw httpError(404);
      });
      act(() => {
        result.current.logSet({ exercise_name: 'Row', weight_kg: 60, reps: 8 });
      });
      await settle();

      // Every create must carry one stable liveKey, or re-creation mints a new
      // session each time and orphans the previous one.
      const keys = api.createLiftingSession.mock.calls.map(([, payload]) => payload.live_key);
      expect(keys.length).toBeGreaterThan(1);
      expect(new Set(keys).size).toBe(1);
    });
  });

  // ── The retry loop is bounded ───────────────────────────────────────────

  describe('retry loop terminates', () => {
    it('gives up on a set after repeated transient failures', async () => {
      const { result } = renderHook(() => useLiveSession(vi.fn() as never));
      act(() => result.current.startSession({}));

      // One set must sync first, so the failing set goes through addSetToSession
      // (Step 2) rather than being batched into the initial create.
      act(() => {
        result.current.logSet({ exercise_name: 'Bench', weight_kg: 100, reps: 5 });
      });
      await settle();
      expect(result.current.state?.sessionId).toBe('r-session');

      api.addSetToSession.mockImplementation(async () => {
        throw httpError(503);
      });
      act(() => {
        result.current.logSet({ exercise_name: 'Squat', weight_kg: 100, reps: 5 });
      });

      // Drive the retry loop long enough to exhaust the cap. The online-failure
      // backoff is 8s, so the 8-attempt bound needs well over a minute of
      // virtual time — a shorter window only proves the loop is still running.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(180_000);
      });

      // Dead-lettered rather than retried forever, so the overlay can settle.
      expect(result.current.failedSets).toHaveLength(1);
      // Bounded: the loop gave up rather than hammering indefinitely.
      const attempts = api.addSetToSession.mock.calls.length;
      expect(attempts).toBeLessThanOrEqual(10);
      expect(result.current.state?.sets[1].attempts).toBeLessThanOrEqual(9);
    });
  });

  // ── set_number must not drift on resume ─────────────────────────────────

  describe('set_number continues from max, not count', () => {
    it('does not reuse a number already present in a resumed session', () => {
      // A resumed session adopts the server's set_number verbatim, and those are
      // not guaranteed contiguous (Section 6 §1.3 — 1, 1, 3 is legal today).
      const resumed = {
        id: 'r-session',
        started_at: new Date().toISOString(),
        sets: [
          { id: 'a', client_id: 'c1', exercise_name: 'Squat', set_number: 1, weight_kg: 100, reps: 5, is_warmup: false, is_amrap: false },
          { id: 'b', client_id: 'c2', exercise_name: 'Squat', set_number: 1, weight_kg: 100, reps: 5, is_warmup: false, is_amrap: false },
          { id: 'c', client_id: 'c3', exercise_name: 'Squat', set_number: 3, weight_kg: 100, reps: 5, is_warmup: false, is_amrap: false },
        ],
      };

      const { result } = renderHook(() => useLiveSession(vi.fn() as never));
      act(() => result.current.resumeSession(resumed as never));

      // count+1 would yield 4 here by luck; the real gap case is 1,1,2 -> 3 vs 4.
      const next = result.current.nextSetNumberFor('Squat');
      expect(next).toBe(4);

      act(() => {
        result.current.logSet({ exercise_name: 'Squat', weight_kg: 100, reps: 5 });
      });
      expect(result.current.state?.sets.at(-1)?.set_number).toBe(4);
    });

    it('starts at 1 for a fresh exercise', () => {
      const { result } = renderHook(() => useLiveSession(vi.fn() as never));
      act(() => result.current.startSession({}));
      act(() => {
        result.current.logSet({ exercise_name: 'Squat', weight_kg: 100, reps: 5 });
      });
      act(() => {
        result.current.logSet({ exercise_name: 'Squat', weight_kg: 100, reps: 5 });
      });
      act(() => {
        result.current.logSet({ exercise_name: 'Bench', weight_kg: 80, reps: 5 });
      });

      expect(result.current.state?.sets.map((s) => s.set_number)).toEqual([1, 2, 1]);
    });
  });

  // ── Existing persistence guarantees must not regress ───────────────────

  it('persists a dead-lettered set so the reason survives a reload', async () => {
    const { result } = renderHook(() => useLiveSession(vi.fn() as never));
    act(() => result.current.startSession({}));
    act(() => {
      result.current.logSet({ exercise_name: 'Row', weight_kg: 50, reps: 10 });
    });
    await settle();

    api.addSetToSession.mockImplementation(async () => {
      throw httpError(422);
    });
    act(() => {
      result.current.logSet({ exercise_name: 'Row', weight_kg: 55, reps: 10 });
    });
    await settle();

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    const failed = (stored.sets ?? []).filter((s: { failedReason?: string }) => s.failedReason);
    expect(failed).toHaveLength(1);
  });
});
