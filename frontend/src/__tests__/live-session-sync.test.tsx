import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// Mock the lifting API module before importing the hook that uses it.
const api = vi.hoisted(() => ({
  createLiftingSession: vi.fn(),
  addSetToSession: vi.fn(),
  deleteLiftingSet: vi.fn(),
  updateLiftingSession: vi.fn(),
}));

vi.mock('@/lib/api/lifting', () => api);

import { useLiveSession } from '@/lib/lifting/useLiveSession';

const STORAGE_KEY = 'fittrack-live-session';

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

describe('useLiveSession sync engine', () => {
  beforeEach(() => {
    window.localStorage.clear();
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears synced-state after undo of a synced set (no re-queue loop)', async () => {
    vi.useFakeTimers();
    const authFetch = vi.fn();
    const { result } = renderHook(() => useLiveSession(authFetch as never));

    expect(result.current.hydrated).toBe(true);

    act(() => result.current.startSession({}));
    act(() =>
      result.current.logSet({ exercise_name: 'Squat', weight_kg: 100, reps: 5 })
    );

    // Let the scheduled flush (and any follow-ups) run.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(api.createLiftingSession).toHaveBeenCalledTimes(1);
    expect(result.current.pendingCount).toBe(0);

    const created = await api.createLiftingSession.mock.results[0].value;

    // Undo the set that already synced, then let the delete flush run.
    act(() => result.current.undoLastSet());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(api.deleteLiftingSet).toHaveBeenCalledTimes(1);
    expect(api.deleteLiftingSet).toHaveBeenCalledWith(
      authFetch,
      created.sets[0].id
    );
    // Regression target: the delete must not be re-queued forever.
    expect(result.current.pendingCount).toBe(0);
  });

  it('removes a specific (non-last) set and queues its remote delete', async () => {
    vi.useFakeTimers();
    const authFetch = vi.fn();
    const { result } = renderHook(() => useLiveSession(authFetch as never));

    act(() => result.current.startSession({}));
    act(() =>
      result.current.logSet({ exercise_name: 'Squat', weight_kg: 100, reps: 5 })
    );
    act(() =>
      result.current.logSet({ exercise_name: 'Squat', weight_kg: 105, reps: 3 })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    const created = await api.createLiftingSession.mock.results[0].value;
    expect(created.sets).toHaveLength(2);

    // Delete the FIRST set, not the last.
    act(() => result.current.removeSet(created.sets[0].client_id));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(api.deleteLiftingSet).toHaveBeenCalledTimes(1);
    expect(api.deleteLiftingSet).toHaveBeenCalledWith(
      authFetch,
      created.sets[0].id
    );
    expect(result.current.pendingCount).toBe(0);
  });

  it('treats a 404 on delete as done instead of retrying forever', async () => {
    vi.useFakeTimers();
    const authFetch = vi.fn();
    const { result } = renderHook(() => useLiveSession(authFetch as never));

    act(() => result.current.startSession({}));
    act(() =>
      result.current.logSet({ exercise_name: 'Squat', weight_kg: 100, reps: 5 })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    // The remote row is already gone (deleted from another device/tab).
    const notFound = Object.assign(new Error('Set not found'), { status: 404 });
    api.deleteLiftingSet.mockRejectedValue(notFound);

    act(() => result.current.undoLastSet());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(api.deleteLiftingSet).toHaveBeenCalledTimes(1);
    expect(result.current.pendingCount).toBe(0);
    expect(result.current.syncStatus).not.toBe('error');
  });

  it('stops syncing a stale snapshot instead of clobbering a newly started session', async () => {
    vi.useFakeTimers();
    const authFetch = vi.fn();
    let resolveCreate: ((value: unknown) => void) | undefined;

    // Hold the create response open so we can replace the stored session while
    // the flush is mid-flight (exactly the discard/resume-while-syncing race).
    api.createLiftingSession.mockImplementationOnce(
      (_af, payload) =>
        new Promise((resolve) => {
          resolveCreate = () => resolve(remoteFromCreatePayload(payload));
        })
    );

    const { result } = renderHook(() => useLiveSession(authFetch as never));

    act(() => result.current.startSession({}));
    act(() =>
      result.current.logSet({ exercise_name: 'Squat', weight_kg: 100, reps: 5 })
    );

    // Fire the scheduled flush; it now blocks on the pending create.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(resolveCreate).toBeDefined();

    // A different session replaces the old one while its create is in flight.
    const replacement = {
      phase: 'active',
      sessionId: 'new-session',
      liveKey: 'new-key',
      startedAt: new Date(Date.now() + 60_000).toISOString(),
      currentExercise: 'Bench',
      sets: [],
      pendingDeletes: [],
      lastSetAt: null,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(replacement));

    await act(async () => {
      resolveCreate?.(undefined);
      await vi.advanceTimersByTimeAsync(6000);
    });

    // The flush must not resurrect the old session over the new one.
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    expect(stored?.sessionId).toBe('new-session');
  });
});
