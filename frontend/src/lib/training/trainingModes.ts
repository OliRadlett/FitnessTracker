// Pure training-page shell helpers — no React, no hooks, so they are directly
// unit-testable and importable from non-client code.

import type { TrainingPlanSummary } from '@/lib/api';

/**
 * The training page's modes. Build and Week were merged into Plan (one editor);
 * `plans` is a surface reached from the plan switcher, not a switch button.
 */
export type TrainingMode = 'plan' | 'review' | 'peaks' | 'plans';

/** Modes shown in the mode switch (the Plans surface is separate). */
export const TRAINING_MODES: readonly TrainingMode[] = ['plan', 'review', 'peaks'] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a valid `YYYY-MM-DD` string (used to validate `?day=`). */
export function isIsoDate(value: string | null | undefined): boolean {
  return !!value && ISO_DATE.test(value);
}

/** Parse `?mode=` into a known mode (unknown/absent → 'plan'). */
export function parseTrainingMode(value: string | null | undefined): TrainingMode {
  return value === 'review' || value === 'peaks' || value === 'plans' ? value : 'plan';
}

/**
 * The plan to auto-select when `?plan=` names nothing: the most recently
 * updated `active` plan, else null — so the page shows its create-first-plan
 * state rather than silently picking a draft.
 */
export function pickActivePlan(
  plans: TrainingPlanSummary[],
): TrainingPlanSummary | null {
  const active = plans.filter((p) => p.status === 'active');
  if (active.length === 0) return null;
  const stamp = (p: TrainingPlanSummary) =>
    new Date(p.updated_at ?? p.start_date).getTime();
  return [...active].sort((a, b) => stamp(b) - stamp(a))[0];
}
