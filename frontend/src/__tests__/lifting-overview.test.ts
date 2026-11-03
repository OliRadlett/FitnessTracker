import { describe, expect, it } from 'vitest';
import type { LiftingSession, LiftingSet, PersonalRecord } from '@/lib/api/types/lifting';
import {
  big3Total,
  dotsScore,
  focusOf,
  groupSets,
  mondayOf,
  previousSameFocus,
  sessionsInRange,
  topSet,
  volumeDeltaPct,
  weekBounds,
} from '@/lib/lifting/overview';

const set = (over: Partial<LiftingSet>): LiftingSet => ({
  id: over.id ?? 'set',
  session_id: 'session',
  exercise_name: 'Back Squat',
  set_number: 1,
  weight_kg: 100,
  reps: 5,
  is_warmup: false,
  is_amrap: false,
  ...over,
});

const session = (over: Partial<LiftingSession>): LiftingSession => ({
  id: over.id ?? 'session',
  user_id: 'user',
  session_date: '2026-10-15',
  focus: 'Legs',
  sets: [],
  created_at: '2026-10-15T18:00:00Z',
  updated_at: '2026-10-15T18:00:00Z',
  ...over,
});

const pr = (over: Partial<PersonalRecord>): PersonalRecord => ({
  id: over.exercise_name ?? 'pr',
  user_id: 'user',
  exercise_name: 'Back Squat',
  record_type: '1rm',
  weight_kg: 125,
  reps: 6,
  estimated_1rm: 145,
  achieved_date: '2026-10-15',
  created_at: '2026-10-15T18:00:00Z',
  ...over,
});

describe('lifting overview selectors', () => {
  it('buckets weeks on Monday', () => {
    expect(mondayOf('2026-10-15')).toBe('2026-10-12');
    expect(weekBounds('2026-10-15')).toEqual({ start: '2026-10-12', end: '2026-10-18' });
  });

  it('filters sessions by inclusive range', () => {
    const list = [
      session({ id: 'a', session_date: '2026-10-11' }),
      session({ id: 'b', session_date: '2026-10-12' }),
      session({ id: 'c', session_date: '2026-10-18' }),
      session({ id: 'd', session_date: '2026-10-19' }),
    ];
    expect(sessionsInRange(list, '2026-10-12', '2026-10-18').map((s) => s.id)).toEqual(['b', 'c']);
  });

  it('trims focus and falls back', () => {
    expect(focusOf(session({ focus: '  Legs ' }))).toBe('Legs');
    expect(focusOf(session({ focus: undefined }))).toBe('Session');
  });

  it('top set ignores warm-ups', () => {
    const s = session({
      sets: [
        set({ id: 'w', weight_kg: 200, is_warmup: true }),
        set({ id: 'a', weight_kg: 120 }),
        set({ id: 'b', weight_kg: 125 }),
      ],
    });
    expect(topSet(s)?.id).toBe('b');
  });

  it('groups sets in order_index order', () => {
    const s = session({
      sets: [
        set({ id: 'b', exercise_name: 'Bench', order_index: 2 }),
        set({ id: 'a', exercise_name: 'Bench', order_index: 1 }),
        set({ id: 'c', exercise_name: 'Squat', order_index: 0 }),
      ],
    });
    expect(groupSets(s).map((g) => g.name)).toEqual(['Bench', 'Squat']);
    expect(groupSets(s)[0].sets.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('compares volume to the previous same-focus session', () => {
    const prev = session({ id: 'prev', session_date: '2026-10-07', total_volume_kg: 7369 });
    const current = session({ id: 'cur', session_date: '2026-10-15', total_volume_kg: 11250 });
    expect(previousSameFocus(current, [current, prev])?.id).toBe('prev');
    expect(volumeDeltaPct(current, [current, prev])).toBeCloseTo(52.7, 1);
  });

  it('computes the Big-3 from competition lifts only', () => {
    const prs = [
      pr({ exercise_name: 'Back Squat', estimated_1rm: 145.2 }),
      pr({ exercise_name: 'Belt Squat', estimated_1rm: 180 }),
      pr({ exercise_name: 'Bench Press', estimated_1rm: 112.5, weight_kg: 112.5, reps: 1 }),
      pr({ exercise_name: 'Deadlift', estimated_1rm: 190, weight_kg: 190, reps: 1 }),
    ];
    expect(big3Total(prs)).toBeCloseTo(447.7, 1);
    expect(dotsScore(447.7, 88.907)).toBeCloseTo(291.3, 0);
  });
});
