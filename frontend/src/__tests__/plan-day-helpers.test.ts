import { describe, expect, it } from 'vitest';

import type { TrainingPlanDay } from '@/lib/api';
import {
  REST_FIELDS,
  computedVolumeKg,
  planningFields,
} from '@/lib/training/planDayHelpers';

function planDay(over: Partial<TrainingPlanDay> = {}): TrainingPlanDay {
  return {
    id: 'd1',
    plan_id: 'p1',
    day_date: '2026-08-05',
    sport: 'strength',
    planned_type: 'moderate',
    completed: false,
    ...over,
  };
}

describe('computedVolumeKg', () => {
  it('returns null for undefined or empty lists', () => {
    expect(computedVolumeKg(undefined)).toBeNull();
    expect(computedVolumeKg(null)).toBeNull();
    expect(computedVolumeKg([])).toBeNull();
  });

  it('sums weight × reps × sets across exercises', () => {
    expect(
      computedVolumeKg([
        { exercise: 'squat', sets: 5, reps: 5, weight_kg: 100 },
        { exercise: 'bench', sets: 3, reps: 8, weight_kg: 60 },
      ]),
    ).toBe(2500 + 1440);
  });

  it('returns null when no exercise has a weight', () => {
    expect(
      computedVolumeKg([
        { exercise: 'squat', sets: 5, reps: 5, weight_kg: null },
        { exercise: 'bench', sets: 3, reps: 8 },
      ]),
    ).toBeNull();
  });

  it('rounds to the nearest kg', () => {
    expect(computedVolumeKg([{ exercise: 'squat', sets: 3, reps: 3, weight_kg: 101.3 }])).toBe(912);
  });
});

describe('planningFields', () => {
  it('maps the planning fields and coerces undefined to null', () => {
    const day = planDay({
      sport: 'cycle',
      planned_type: 'hard',
      planned_tss: 80,
      planned_duration_min: 60,
      planned_power_watts: 210,
    });
    const payload = planningFields(day);
    expect(payload.sport).toBe('cycle');
    expect(payload.planned_type).toBe('hard');
    expect(payload.planned_tss).toBe(80);
    expect(payload.planned_duration_min).toBe(60);
    expect(payload.planned_power_watts).toBe(210);
    // Absent optionals become explicit nulls (so a move clears them server-side).
    expect(payload.planned_focus).toBeNull();
    expect(payload.planned_exercises).toBeNull();
    expect(payload.planned_route_id).toBeNull();
    expect(payload.notes).toBeNull();
  });

  it('accepts an enriched week day (extends TrainingPlanDay)', () => {
    const weekDay = { ...planDay(), day_status: 'pending' as const, targets_stale: false };
    expect(planningFields(weekDay).sport).toBe('strength');
  });
});

describe('REST_FIELDS', () => {
  it('is a rest day that clears every planned target', () => {
    expect(REST_FIELDS.sport).toBe('rest');
    expect(REST_FIELDS.planned_type).toBe('rest');
    expect(REST_FIELDS.planned_tss).toBeNull();
    expect(REST_FIELDS.planned_duration_min).toBeNull();
    expect(REST_FIELDS.planned_exercises).toBeNull();
    expect(REST_FIELDS.planned_route_id).toBeNull();
    expect(REST_FIELDS.workout_description).toBeNull();
  });
});
