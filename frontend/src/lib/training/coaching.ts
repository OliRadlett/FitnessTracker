// Coaching aids (S4) — pure helpers, unit tested.
//
//   warmupRamp   — a Rippetoe-style ramp from the day's top set
//   lintPlan     — non-blocking programming warnings over the plan's days

import type { TrainingPlan, TrainingPlanDay } from '@/lib/api';
import { addDays, diffDays, getTotalWeeks, getWeek1Start } from './week';

export interface WarmupStep {
  pct: number;
  kg: number;
  reps: number;
}

/**
 * A warm-up ramp up to (but not including) the top working set:
 * 45/55/65/75/85% for 5/5/3/2/1 reps, rounded to the nearest 2.5 kg (a plate
 * jump). Returns [] for a non-positive top weight.
 */
export function warmupRamp(topKg: number): WarmupStep[] {
  if (!(topKg > 0)) return [];
  const steps: Array<[number, number]> = [
    [0.45, 5],
    [0.55, 5],
    [0.65, 3],
    [0.75, 2],
    [0.85, 1],
  ];
  return steps.map(([pct, reps]) => ({
    pct,
    reps,
    kg: Math.round((topKg * pct) / 2.5) * 2.5,
  }));
}

export type LintLevel = 'warning' | 'info';

export interface LintFinding {
  level: LintLevel;
  message: string;
  date?: string;
}

const day = (d: TrainingPlanDay) => d.day_date.slice(0, 10);

/**
 * Non-blocking programming lint over a plan's days:
 *   - back-to-back `hard` days
 *   - lower-body strength the day before a long ride (≥120 min)
 *   - a week-over-week planned-TSS ramp beyond 15%
 *   - ≥7 consecutive training days
 */
export function lintPlan(plan: TrainingPlan | null | undefined): LintFinding[] {
  if (!plan) return [];
  const days = [...(plan.days ?? [])].sort((a, b) => day(a).localeCompare(day(b)));
  const findings: LintFinding[] = [];

  // Back-to-back hard days.
  for (let i = 1; i < days.length; i++) {
    const a = days[i - 1];
    const b = days[i];
    if (
      a.planned_type === 'hard' &&
      b.planned_type === 'hard' &&
      diffDays(day(a), day(b)) === 1
    ) {
      findings.push({
        level: 'warning',
        message: `Back-to-back hard days (${day(a)} → ${day(b)})`,
        date: day(b),
      });
    }
  }

  // Lower-body strength before a long ride.
  for (let i = 1; i < days.length; i++) {
    const a = days[i - 1];
    const b = days[i];
    const lower =
      a.sport === 'strength' && ['squat', 'legs', 'lower'].includes(String(a.planned_focus));
    const longRide = b.sport === 'cycle' && (b.planned_duration_min ?? 0) >= 120;
    if (lower && longRide && diffDays(day(a), day(b)) === 1) {
      findings.push({
        level: 'warning',
        message: `Lower-body strength the day before a long ride (${day(b)})`,
        date: day(b),
      });
    }
  }

  // Week-over-week planned-TSS ramp.
  const totalWeeks = getTotalWeeks(plan.start_date, plan.end_date);
  const week1 = getWeek1Start(plan.start_date);
  const weekly = Array.from({ length: totalWeeks }, (_, wi) => {
    const start = addDays(week1, wi * 7);
    const end = addDays(start, 6);
    return days
      .filter((d) => day(d) >= start && day(d) <= end)
      .reduce((s, d) => s + (d.planned_tss || 0), 0);
  });
  for (let i = 1; i < weekly.length; i++) {
    if (weekly[i - 1] > 0 && weekly[i] > weekly[i - 1] * 1.15) {
      findings.push({
        level: 'warning',
        message: `Week ${i + 1} planned TSS is ${Math.round(
          (weekly[i] / weekly[i - 1] - 1) * 100,
        )}% above week ${i} — cap the ramp at ~10–15%`,
      });
    }
  }

  // ≥7 consecutive training days.
  let run = 0;
  for (const d of days) {
    if (d.sport !== 'rest' && d.planned_type !== 'rest') {
      run += 1;
      if (run === 7) {
        findings.push({
          level: 'info',
          message: `7 consecutive training days up to ${day(d)}`,
          date: day(d),
        });
      }
    } else {
      run = 0;
    }
  }

  return findings;
}
