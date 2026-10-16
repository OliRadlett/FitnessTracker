'use client';

/**
 * Multi-sport day grouping.
 *
 * A plan date may hold more than one session (a morning ride and an evening
 * lift), so the week payload is a flat list of sessions that the grid groups by
 * date: `Map<date, TrainingWeekDay[]>`. Within a date, sessions are distinct by
 * sport and `rest` never shares the date.
 *
 * Kept free of React so the grouping, the chip cap and the "add session"
 * choices can be unit tested directly.
 */

import type { CreateTrainingPlanDayPayload, PlanSport, TrainingWeekDay } from '@/lib/api';

/** Sports a second session can be added in. `rest` is never one of them. */
export const ADDABLE_SPORTS: PlanSport[] = ['cycle', 'strength'];

/** Chips a day cell shows before the "+N" overflow indicator. */
export const SESSION_CHIP_CAP = 2;

/** Group the week payload by calendar date, keeping payload order within a date. */
export function groupSessionsByDate(
  days: TrainingWeekDay[],
): Map<string, TrainingWeekDay[]> {
  const map = new Map<string, TrainingWeekDay[]>();
  for (const day of days) {
    const date = day.day_date.slice(0, 10);
    const sessions = map.get(date);
    if (sessions) sessions.push(day);
    else map.set(date, [day]);
  }
  return map;
}

/** Index the week payload by session id — the grid's handle on one session. */
export function indexSessionsById(
  days: TrainingWeekDay[],
): Map<string, TrainingWeekDay> {
  return new Map(days.map((d) => [d.id, d]));
}

/** Chips to render for a date, plus how many sessions are hidden behind "+N". */
export function visibleSessions(
  sessions: TrainingWeekDay[],
  cap: number = SESSION_CHIP_CAP,
): { shown: TrainingWeekDay[]; overflow: number } {
  return {
    shown: sessions.slice(0, cap),
    overflow: Math.max(0, sessions.length - cap),
  };
}

/**
 * Sports a session could still be added in on this date.
 *
 * Empty when the date is a rest day (rest is exclusive) or already holds every
 * addable sport.
 */
export function addableSports(sessions: TrainingWeekDay[]): PlanSport[] {
  if (sessions.some((s) => s.sport === 'rest')) return [];
  return ADDABLE_SPORTS.filter((sport) => !sessions.some((s) => s.sport === sport));
}

/** Payload for a new session of `sport` on `date`, with the editor's defaults. */
export function newSessionPayload(
  date: string,
  sport: PlanSport,
): CreateTrainingPlanDayPayload {
  if (sport === 'rest') {
    return { day_date: date, sport, planned_type: 'rest' };
  }
  if (sport === 'strength') {
    return { day_date: date, sport, planned_type: 'moderate', planned_focus: 'squat' };
  }
  return { day_date: date, sport, planned_type: 'easy' };
}
