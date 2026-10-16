import { describe, expect, it } from 'vitest';

import type { PlannedExercise, TrainingPlanDay } from '@/lib/api';
import {
  REST_FIELDS,
  computedVolumeKg,
  mergeSuggestedWeights,
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

describe('mergeSuggestedWeights', () => {
  const squat: PlannedExercise = {
    exercise: 'Back Squat',
    sets: 5,
    reps: 5,
    weight_kg: 100,
    rpe: 7,
    pct_1rm: 0.8,
    target_rpe: 8,
    note: 'belt up on the last set',
    weight_source: 'manual',
  };
  const legCurl: PlannedExercise = {
    exercise: 'Leg Curl',
    sets: 3,
    reps: 12,
    weight_kg: 40,
  };

  it('overrides the suggestion fields and keeps every field it does not set', () => {
    const merged = mergeSuggestedWeights([squat, legCurl], [
      {
        exercise_name: 'Back Squat',
        old_weight_kg: 100,
        suggested_weight_kg: 105,
        rpe: 9,
        sets: 4,
        reps: 3,
      },
    ]);

    expect(merged.map((e) => e.exercise)).toEqual(['Back Squat', 'Leg Curl']);
    expect(merged[0]).toEqual({
      exercise: 'Back Squat',
      sets: 4,
      reps: 3,
      weight_kg: 105,
      rpe: 9,
      pct_1rm: 0.8,
      target_rpe: 8,
      note: 'belt up on the last set',
      weight_source: 'manual',
    });
  });

  it('returns the existing list unchanged when there is no suggestion for it', () => {
    expect(mergeSuggestedWeights([squat, legCurl], [])).toEqual([squat, legCurl]);
  });

  it('matches names trimmed and case-insensitively, defaulting rpe to 8', () => {
    const merged = mergeSuggestedWeights([{ ...squat, exercise: '  back squat ' }], [
      {
        exercise_name: 'Back Squat',
        old_weight_kg: 100,
        suggested_weight_kg: 105,
        rpe: null,
        sets: 4,
        reps: 6,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].exercise).toBe('  back squat ');
    expect(merged[0].sets).toBe(4);
    expect(merged[0].rpe).toBe(8);
    expect(merged[0].weight_kg).toBe(105);
  });

  it('appends a suggestion that matches no existing entry', () => {
    const merged = mergeSuggestedWeights([legCurl], [
      {
        exercise_name: 'Romanian Deadlift',
        old_weight_kg: 80,
        suggested_weight_kg: 85,
        rpe: 8,
        sets: 3,
        reps: 8,
      },
    ]);

    expect(merged.map((e) => e.exercise)).toEqual(['Leg Curl', 'Romanian Deadlift']);
    expect(merged[1].weight_kg).toBe(85);
  });

  it('treats a missing list as empty', () => {
    expect(
      mergeSuggestedWeights(undefined, [
        {
          exercise_name: 'Back Squat',
          old_weight_kg: null,
          suggested_weight_kg: 105,
          rpe: 8,
          sets: 5,
          reps: 5,
        },
      ]),
    ).toEqual([
      { exercise: 'Back Squat', sets: 5, reps: 5, rpe: 8, weight_kg: 105 },
    ]);
  });
});
