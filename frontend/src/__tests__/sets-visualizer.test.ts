import { describe, expect, it } from 'vitest';
import type { LiftingSet } from '../lib/api';
import { groupForViz, rpeBarColor } from '../components/lifting/SetsVisualizer';

function set(partial: Partial<LiftingSet> & { id: string }): LiftingSet {
  return {
    session_id: 'session-1',
    exercise_name: 'Back Squat',
    set_number: 1,
    weight_kg: 100,
    reps: 5,
    is_warmup: false,
    is_amrap: false,
    ...partial,
  } as LiftingSet;
}

describe('rpeBarColor', () => {
  it('grades easy / grinding / maximal RPE', () => {
    expect(rpeBarColor(undefined)).toContain('muted');
    expect(rpeBarColor(6)).toContain('positive');
    expect(rpeBarColor(8)).toContain('warning');
    expect(rpeBarColor(9.5)).toContain('red');
  });
});

describe('groupForViz', () => {
  it('groups by exercise preserving first-appearance order', () => {
    const sets = [
      set({ id: 'a', exercise_name: 'Bench Press', weight_kg: 80 }),
      set({ id: 'b', exercise_name: 'Back Squat', weight_kg: 120 }),
      set({ id: 'c', exercise_name: 'Bench Press', weight_kg: 85 }),
    ];
    const groups = groupForViz(sets, new Map());
    expect(groups.map((g) => g.name)).toEqual(['Bench Press', 'Back Squat']);
    expect(groups[0].sets).toHaveLength(2);
    expect(groups[0].maxWeight).toBe(85);
  });

  it('computes % of basis via Brzycki and tracks the best e1RM', () => {
    // 100kg x 5 → e1RM ≈ 112.5; basis 120 → ≈93.75%.
    const sets = [set({ id: 'a', weight_kg: 100, reps: 5 })];
    const [group] = groupForViz(sets, new Map([['Back Squat', 120]]));
    expect(group.sets[0].pctOfBasis).toBeCloseTo(93.75, 1);
    expect(group.bestE1rm).toBeCloseTo(112.5, 1);
  });

  it('leaves pct null without a basis', () => {
    const [group] = groupForViz([set({ id: 'a' })], new Map());
    expect(group.sets[0].pctOfBasis).toBeNull();
    expect(group.bestE1rm).toBeCloseTo(112.5, 1);
  });
});
