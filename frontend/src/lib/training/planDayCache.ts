// Pure cache-patch helpers for the training editor's optimistic updates.
//
// Deliberately free of React so they can be unit tested directly: the
// optimistic mutation in `useInstantDayEdit`/`usePlanDayOps` is just these
// functions applied to React Query cache entries. Each returns the *same
// reference* when there is nothing to change, so callers can skip a write.

import type {
  TrainingPlan,
  TrainingWeekDay,
  TrainingWeekResponse,
  UpdateTrainingPlanDayPayload,
} from '@/lib/api';

/** Merge a partial day payload into one day, keeping the day's own type. */
function mergeDay<T extends { id: string }>(
  day: T,
  dayId: string,
  patch: UpdateTrainingPlanDayPayload,
): T {
  return day.id === dayId ? ({ ...day, ...patch } as T) : day;
}

/** Apply a field patch to one day inside a week payload. */
export function patchDayInWeek(
  week: TrainingWeekResponse | undefined,
  dayId: string,
  patch: UpdateTrainingPlanDayPayload,
): TrainingWeekResponse | undefined {
  if (!week) return week;
  return { ...week, days: week.days.map((d) => mergeDay(d, dayId, patch)) };
}

/** Apply a field patch to one day inside a plan payload. */
export function patchDayInPlan(
  plan: TrainingPlan | undefined,
  dayId: string,
  patch: UpdateTrainingPlanDayPayload,
): TrainingPlan | undefined {
  if (!plan) return plan;
  return { ...plan, days: plan.days.map((d) => mergeDay(d, dayId, patch)) };
}

/**
 * Exchange `day_date` between two days in a week payload.
 *
 * No-op (same reference) when either day is absent — the pair may not both be
 * in the currently-visible week.
 */
export function swapDaysInWeek(
  week: TrainingWeekResponse | undefined,
  dayId: string,
  targetDayId: string,
): TrainingWeekResponse | undefined {
  if (!week) return week;
  const a = week.days.find((d) => d.id === dayId);
  const b = week.days.find((d) => d.id === targetDayId);
  if (!a || !b) return week;
  const aDate = a.day_date;
  const bDate = b.day_date;
  return {
    ...week,
    days: week.days.map((d) => {
      if (d.id === dayId) return { ...d, day_date: bDate };
      if (d.id === targetDayId) return { ...d, day_date: aDate };
      return d;
    }),
  };
}

/** Drop a day from a week payload. */
export function removeDayFromWeek(
  week: TrainingWeekResponse | undefined,
  dayId: string,
): TrainingWeekResponse | undefined {
  if (!week) return week;
  return { ...week, days: week.days.filter((d) => d.id !== dayId) };
}

/**
 * Insert or replace a day in a week payload, keeping `days` ordered by
 * `day_date` (the day grid assumes chronological order).
 */
export function upsertDayInWeek(
  week: TrainingWeekResponse | undefined,
  day: TrainingWeekDay,
): TrainingWeekResponse | undefined {
  if (!week) return week;
  const others = week.days.filter((d) => d.id !== day.id);
  const days = [...others, day].sort((a, b) =>
    a.day_date < b.day_date ? -1 : a.day_date > b.day_date ? 1 : 0,
  );
  return { ...week, days };
}
