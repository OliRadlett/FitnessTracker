import { describe, expect, it } from 'vitest';

import type { TrainingPlan, TrainingPlanDay } from '@/lib/api';
import { lintPlan, warmupRamp } from '@/lib/training/coaching';

function d(day_date: string, over: Partial<TrainingPlanDay> = {}): TrainingPlanDay {
  return {
    id: `d-${day_date}`,
    plan_id: 'p1',
    day_date,
    sport: 'cycle',
    planned_type: 'moderate',
    completed: false,
    ...over,
  };
}

function plan(days: TrainingPlanDay[]): TrainingPlan {
  return {
    id: 'p1',
    user_id: 'u1',
    name: 'Build',
    start_date: '2026-08-03',
    end_date: '2026-08-16',
    plan_type: 'build',
    status: 'active',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    days,
  };
}

describe('warmupRamp', () => {
  it('returns [] for a non-positive top weight', () => {
    expect(warmupRamp(0)).toEqual([]);
    expect(warmupRamp(-10)).toEqual([]);
  });

  it('ramps 45/55/65/75/85% for 5/5/3/2/1 reps', () => {
    const ramp = warmupRamp(100);
    expect(ramp.map((s) => s.reps)).toEqual([5, 5, 3, 2, 1]);
    expect(ramp.map((s) => s.kg)).toEqual([45, 55, 65, 75, 85]);
  });

  it('rounds to the nearest 2.5 kg', () => {
    expect(warmupRamp(93)[0].kg).toBe(42.5); // 41.85 → 42.5
  });
});

describe('lintPlan', () => {
  it('returns [] for no plan', () => {
    expect(lintPlan(null)).toEqual([]);
  });

  it('flags back-to-back hard days', () => {
    const f = lintPlan(plan([d('2026-08-03', { planned_type: 'hard' }), d('2026-08-04', { planned_type: 'hard' })]));
    expect(f.some((x) => /back-to-back hard/i.test(x.message))).toBe(true);
  });

  it('flags lower-body strength before a long ride', () => {
    const f = lintPlan(
      plan([
        d('2026-08-03', { sport: 'strength', planned_focus: 'squat', planned_type: 'moderate' }),
        d('2026-08-04', { sport: 'cycle', planned_duration_min: 150 }),
      ]),
    );
    expect(f.some((x) => /before a long ride/i.test(x.message))).toBe(true);
  });

  it('flags a weekly TSS ramp beyond 15%', () => {
    const f = lintPlan(
      plan([
        d('2026-08-05', { planned_tss: 100 }),
        d('2026-08-12', { planned_tss: 130 }),
      ]),
    );
    expect(f.some((x) => /cap the ramp/i.test(x.message))).toBe(true);
  });

  it('flags 7 consecutive training days', () => {
    const days = Array.from({ length: 7 }, (_, i) => d(`2026-08-0${3 + i}`));
    const f = lintPlan(plan(days));
    expect(f.some((x) => /7 consecutive training days/i.test(x.message))).toBe(true);
  });

  it('does not flag a clean week', () => {
    const f = lintPlan(
      plan([
        d('2026-08-03', { planned_type: 'easy' }),
        d('2026-08-04', { sport: 'rest', planned_type: 'rest' }),
        d('2026-08-05', { planned_type: 'hard' }),
        d('2026-08-06', { sport: 'rest', planned_type: 'rest' }),
      ]),
    );
    expect(f).toEqual([]);
  });
});
