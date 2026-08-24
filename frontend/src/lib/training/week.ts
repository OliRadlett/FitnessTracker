/**
 * Shared week-math helpers for training plans.
 *
 * Week numbering mirrors the backend exactly:
 *   week1_start = plan.start_date − weekday(plan.start_date)
 *   total_weeks = ((end − week1_start).days // 7) + 1
 */

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export function diffDays(a: string, b: string): number {
  return Math.round(
    (new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000,
  );
}

export function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return toDateStr(d);
}

/** Week 1 start = Monday on or before plan.start_date. */
export function getWeek1Start(startDate: string): string {
  return mondayOf(startDate);
}

export function getTotalWeeks(startDate: string, endDate: string): number {
  if (!endDate) return 1;
  return Math.max(1, Math.floor(diffDays(getWeek1Start(startDate), endDate) / 7) + 1);
}

/** Current 1-based week number clamped to [1, totalWeeks]. */
export function getCurrentWeek(startDate: string, endDate: string): number {
  const total = getTotalWeeks(startDate, endDate);
  const today = toDateStr(new Date());
  const raw = Math.floor(diffDays(getWeek1Start(startDate), today) / 7) + 1;
  return Math.min(total, Math.max(1, raw));
}
