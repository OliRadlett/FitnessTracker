import { describe, expect, it } from 'vitest';
import {
  brzycki1rm,
  buildLastSessionMap,
  detectPr,
  recentExerciseNames,
} from '../lib/lifting/reference';
import type { LiftingSession, LiftingSet, PersonalRecord } from '../lib/api/types';

function makeSet(overrides: Partial<LiftingSet>): LiftingSet {
  return {
    id: Math.random().toString(),
    session_id: 's1',
    exercise_name: 'Squat',
    set_number: 1,
    weight_kg: 100,
    reps: 5,
    is_warmup: false,
    is_amrap: false,
    ...overrides,
  } as LiftingSet;
}

describe('brzycki1rm', () => {
  it('estimates 1RM for a standard set', () => {
    // 100kg x 5 → weight × 36/(37−reps) = 112.5kg
    expect(brzycki1rm(100, 5)).toBeCloseTo(112.5, 1);
  });

  it('returns null for degenerate inputs', () => {
    expect(brzycki1rm(0, 5)).toBeNull();
    expect(brzycki1rm(100, 0)).toBeNull();
    expect(brzycki1rm(100, 40)).toBeNull(); // outside formula range
  });
});

describe('buildLastSessionMap', () => {
  const sessions = [
    {
      id: 'new',
      session_date: '2026-08-24',
      sets: [
        makeSet({ exercise_name: 'Squat', weight_kg: 105, reps: 5 }),
        makeSet({ exercise_name: 'Squat', weight_kg: 105, reps: 5 }), // duplicate prescription
        makeSet({ exercise_name: 'Bench', weight_kg: 80, reps: 5 }),
        makeSet({ exercise_name: 'Warmup', weight_kg: 40, reps: 8, is_warmup: true }),
      ],
    },
    {
      id: 'old',
      session_date: '2026-08-17',
      sets: [makeSet({ exercise_name: 'Deadlift', weight_kg: 140, reps: 3 })],
    },
  ] as unknown as LiftingSession[];

  it('keeps the newest session per exercise and drops warmups/duplicates', () => {
    const map = buildLastSessionMap(sessions);
    expect(Object.keys(map).sort()).toEqual(['Bench', 'Deadlift', 'Squat']);
    expect(map.Squat.date).toBe('2026-08-24');
    expect(map.Squat.sets).toHaveLength(1); // duplicate prescription collapsed
  });

  it('can exclude the in-progress session itself', () => {
    const map = buildLastSessionMap(sessions, 'new');
    expect(map.Squat).toBeUndefined();
    expect(map.Deadlift).toBeDefined();
  });

  it('tracks the true last set for prefill (repeated pairs still resolve)', () => {
    const map = buildLastSessionMap(sessions);
    expect(map.Squat.lastSet).toEqual({ weight_kg: 105, reps: 5 });
    expect(map.Bench.lastSet).toEqual({ weight_kg: 80, reps: 5 });
    expect(map.Deadlift.lastSet).toEqual({ weight_kg: 140, reps: 3 });
  });

  it('caps the display list by heaviest sets, not encounter order', () => {
    const sets = Array.from({ length: 12 }, (_, i) =>
      makeSet({ exercise_name: 'Squat', weight_kg: 40 + i * 5, reps: 5 })
    );
    const s = [
      { id: 'cap', session_date: '2026-08-24', sets },
    ] as unknown as LiftingSession[];
    const map = buildLastSessionMap(s);
    expect(map.Squat.sets).toHaveLength(8);
    // The heaviest sets (95, 90, 85, 80, 75, 70, 65, 60) survive the cap, not
    // merely the first 8 encountered (40..75).
    const topWeights = map.Squat.sets.map((x) => x.weight_kg);
    expect(Math.max(...topWeights)).toBe(95);
    expect(Math.min(...topWeights)).toBe(60);
  });

  it('ignores sessions older than the 12-week reference window', () => {
    const isoDaysAgo = (days: number) => {
      const d = new Date();
      d.setDate(d.getDate() - days);
      return d.toISOString().slice(0, 10);
    };
    const old = {
      id: 'stale',
      session_date: isoDaysAgo(200),
      sets: [makeSet({ exercise_name: 'Squat', weight_kg: 200, reps: 5 })],
    } as unknown as LiftingSession;
    const recent = {
      id: 'recent',
      session_date: isoDaysAgo(10),
      sets: [makeSet({ exercise_name: 'Squat', weight_kg: 105, reps: 5 })],
    } as unknown as LiftingSession;
    // Stale-only → no reference at all (falls back to nothing, not the old weight)
    expect(buildLastSessionMap([old])).toEqual({});
    // Recent wins over stale even with a very tight custom window
    const tight = buildLastSessionMap([old, recent], undefined, 30);
    expect(tight.Squat?.lastSet.weight_kg).toBe(105);
  });
});

describe('detectPr', () => {
  const prs = [
    { estimated_1rm: 110, weight_kg: 97.5, reps: 5, exercise_name: 'Squat' },
  ] as unknown as PersonalRecord[];

  it('fires when e1RM beats the stored PR', () => {
    expect(detectPr('Squat', 102.5, 5, prs, [])).toContain('PR!');
  });

  it('does not fire below the PR', () => {
    expect(detectPr('Squat', 95, 5, prs, [])).toBeNull();
  });

  it('must also beat sets already logged this session', () => {
    expect(
      detectPr('Squat', 102.5, 5, prs, [{ weight_kg: 105, reps: 5 }])
    ).toBeNull();
  });

  it('treats missing PR history as first-session PR', () => {
    expect(detectPr('Squat', 60, 5, [], [])).toContain('PR!');
  });
});

describe('recentExerciseNames', () => {
  it('returns unique names newest-first up to the limit', () => {
    const sessions = [
      { sets: [makeSet({ exercise_name: 'Squat' }), makeSet({ exercise_name: 'Bench' })] },
      { sets: [makeSet({ exercise_name: 'Squat' }), makeSet({ exercise_name: 'Row' })] },
    ] as unknown as LiftingSession[];
    expect(recentExerciseNames(sessions, 3)).toEqual(['Squat', 'Bench', 'Row']);
  });
});
