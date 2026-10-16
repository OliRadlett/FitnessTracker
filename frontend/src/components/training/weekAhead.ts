/**
 * The Week-ahead card's display model, derived from the C3 weekly review.
 *
 * Pure so the formatting and the null-section handling can be tested without a
 * renderer. Each review section degrades to null independently on the backend,
 * so the model carries a per-section null rather than assuming all three are
 * present.
 */

import type { PlanReviewLoad, PlanReviewResponse } from '@/lib/api/types';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export interface WeekAheadModel {
  weekLabel: string;
  /** e.g. "CTL 48 · ATL 43 · TSB +5"; null when the load section degraded. */
  loadLabel: string | null;
  /** e.g. "72% · stable"; null when the conformity section degraded. */
  conformityLabel: string | null;
  adaptiveSummary: string | null;
  missedDays: number;
  /** e.g. "5 Aug, 7 Aug"; null when nothing was missed. */
  missedDatesLabel: string | null;
  upcomingDays: number;
  activeGoals: number;
  /** Section names that degraded, so their absence is not read as "all clear". */
  unavailable: string[];
}

// The date strings are calendar dates, not instants: `new Date('2026-08-03')`
// parses as UTC midnight and would shift a day in a negative-offset locale.
function splitIsoDate(iso: string): [number, number, number] | null {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return [parts[0], parts[1], parts[2]];
}

/** "2026-08-03" → "Week of 3 Aug 2026". */
export function formatWeekLabel(weekStart: string): string {
  const date = splitIsoDate(weekStart);
  if (!date) return weekStart;
  const [year, month, day] = date;
  return `Week of ${day} ${MONTHS[month - 1] ?? month} ${year}`;
}

/** "2026-08-03" → "3 Aug". */
export function formatShortDate(iso: string): string {
  const date = splitIsoDate(iso);
  if (!date) return iso;
  const [, month, day] = date;
  return `${day} ${MONTHS[month - 1] ?? month}`;
}

/** "CTL 48 · ATL 43 · TSB +5" — TSB keeps its sign, it is a balance. */
export function formatLoadLabel(load: PlanReviewLoad): string {
  const tsb = `${load.tsb >= 0 ? '+' : ''}${Math.round(load.tsb)}`;
  return `CTL ${Math.round(load.ctl)} · ATL ${Math.round(load.atl)} · TSB ${tsb}`;
}

export function buildWeekAheadModel(review: PlanReviewResponse): WeekAheadModel {
  const unavailable: string[] = [];
  if (!review.load) unavailable.push('load');
  if (!review.conformity) unavailable.push('conformity');
  if (!review.adaptive) unavailable.push('adaptive advice');

  let conformityLabel: string | null = null;
  if (review.conformity) {
    const pct =
      review.conformity.overall_pct != null
        ? `${Math.round(review.conformity.overall_pct)}%`
        : 'not scored';
    conformityLabel = review.conformity.trend
      ? `${pct} · ${review.conformity.trend}`
      : pct;
  }

  const missedDates = review.missed_dates.map(formatShortDate);
  const truncated = review.missed_days > missedDates.length;

  return {
    weekLabel: formatWeekLabel(review.week_start),
    loadLabel: review.load ? formatLoadLabel(review.load) : null,
    conformityLabel,
    adaptiveSummary: review.adaptive?.summary ?? null,
    missedDays: review.missed_days,
    missedDatesLabel: missedDates.length
      ? `${missedDates.join(', ')}${truncated ? '…' : ''}`
      : null,
    upcomingDays: review.upcoming_days,
    activeGoals: review.active_goals,
    unavailable,
  };
}
