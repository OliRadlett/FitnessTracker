// Shared day helpers for the training editor.
//
// Extracted from PlanBuilder (computedVolumeKg) and WeeklyView (planningFields,
// REST_FIELDS) so the unified `plan/DayEditor` and the day operations can share
// one source of truth. Pure functions — unit tested in
// `src/__tests__/plan-day-helpers.test.ts`.

import type {
  PlannedExercise,
  TrainingPlanDay,
  UpdateTrainingPlanDayPayload,
} from '@/lib/api';

/** Σ weight × reps × sets across exercises with a target weight. */
export function computedVolumeKg(exercises?: PlannedExercise[] | null): number | null {
  if (!exercises || exercises.length === 0) return null;
  const total = exercises.reduce(
    (sum, ex) => sum + (ex.weight_kg ?? 0) * (ex.reps || 0) * (ex.sets || 0),
    0,
  );
  return total > 0 ? Math.round(total) : null;
}

/**
 * The PATCH-able planning fields of a day — used for day→day moves/swaps
 * (only these travel; server-managed columns are never included).
 *
 * Typed on `TrainingPlanDay` so both the plan detail and the enriched
 * `TrainingWeekDay` (which extends it) can be passed.
 */
export function planningFields(day: TrainingPlanDay): UpdateTrainingPlanDayPayload {
  return {
    sport: day.sport,
    planned_type: day.planned_type,
    planned_tss: day.planned_tss,
    planned_duration_min: day.planned_duration_min,
    workout_description: day.workout_description,
    planned_focus: day.planned_focus ?? null,
    planned_exercises: day.planned_exercises ?? null,
    planned_rpe: day.planned_rpe ?? null,
    planned_power_watts: day.planned_power_watts,
    planned_zone: day.planned_zone ?? null,
    planned_route_id: day.planned_route_id ?? null,
    warmup_template_id: day.warmup_template_id ?? null,
    notes: day.notes ?? null,
  };
}

/** A rest day's planning fields — clears any planned workout. */
export const REST_FIELDS: UpdateTrainingPlanDayPayload = {
  sport: 'rest',
  planned_type: 'rest',
  planned_tss: null,
  planned_duration_min: null,
  workout_description: null,
  planned_focus: null,
  planned_exercises: null,
  planned_rpe: null,
  planned_power_watts: null,
  planned_zone: null,
  planned_route_id: null,
  warmup_template_id: null,
};
