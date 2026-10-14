/**
 * Activity Journal — pure helpers.
 *
 * The Journal is a chronological training diary: activities grouped by week
 * (Monday-based, matching `@/lib/training/week`) and then by day, with a
 * per-week TSS "rhythm" so the page reads as training, not a flat card stream.
 *
 * Everything here is pure and unit-tested (`src/__tests__/journal-grouping.test.ts`)
 * — no React, no fetching — so the page component stays a thin renderer.
 */

import type { Activity } from '@/lib/api';
import { STRENGTH_TYPES } from '@/lib/sportUtils';
import { getActiveLocale } from '@/lib/utils';
import { mondayOf, toDateStr } from '@/lib/training/week';

// ── Filters ──────────────────────────────────────────────────────────────────

export interface JournalPeriod {
  label: string;
  /** Look-back window in days; 0 means "all time". */
  days: number;
}

export const JOURNAL_PERIODS: JournalPeriod[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'All', days: 0 },
];

export type JournalSort = 'date' | 'distance' | 'duration' | 'tss' | 'power';

export const JOURNAL_SORTS: { value: JournalSort; label: string }[] = [
  { value: 'date', label: 'Newest' },
  { value: 'distance', label: 'Distance' },
  { value: 'duration', label: 'Time' },
  { value: 'tss', label: 'TSS' },
  { value: 'power', label: 'Power' },
];

/** Journal sort → backend `sort_by` field (must match `ACTIVITY_SORT_FIELDS`). */
const SORT_FIELDS: Record<JournalSort, string> = {
  date: 'start_date',
  distance: 'distance',
  duration: 'duration',
  tss: 'tss',
  power: 'average_power',
};

export interface JournalFilters {
  days: number;
  sport: string;
  q: string;
  sort: JournalSort;
}

export const DEFAULT_JOURNAL_FILTERS: JournalFilters = {
  days: 30,
  sport: '',
  q: '',
  sort: 'date',
};

/** All-time uses a wide window rather than omitting the bound (the API default is unbounded anyway). */
const ALL_TIME_DAYS = 3650;

export function journalStartDate(days: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - (days > 0 ? days : ALL_TIME_DAYS));
  return toDateStr(d);
}

export function buildListParams(
  filters: JournalFilters,
  limit: number,
  offset: number,
  now: Date = new Date(),
): URLSearchParams {
  const params = new URLSearchParams({
    start_date_after: journalStartDate(filters.days, now),
    limit: String(limit),
    offset: String(offset),
    sort_by: SORT_FIELDS[filters.sort],
    sort_order: 'desc',
  });
  if (filters.sport) params.set('sport_type', filters.sport);
  const q = filters.q.trim();
  if (q) params.set('q', q);
  return params;
}

/** Summary accepts the same filters minus sort/paging, so the totals match the list. */
export function buildSummaryParams(filters: JournalFilters, now: Date = new Date()): URLSearchParams {
  const params = new URLSearchParams({
    start_date_after: journalStartDate(filters.days, now),
  });
  if (filters.sport) params.set('sport_type', filters.sport);
  const q = filters.q.trim();
  if (q) params.set('q', q);
  return params;
}

// ── Grouping ─────────────────────────────────────────────────────────────────

export interface JournalDay {
  /** YYYY-MM-DD */
  date: string;
  label: string;
  activities: Activity[];
  tss: number;
  /** Strength sessions contribute no distance (mirrors the backend summary). */
  distanceMeters: number;
  durationSeconds: number;
}

export interface JournalWeek {
  /** Monday of the week, YYYY-MM-DD */
  weekStart: string;
  label: string;
  days: JournalDay[];
  count: number;
  tss: number;
  distanceMeters: number;
  durationSeconds: number;
  /** TSS per weekday, Monday-first (index 0 = Monday … 6 = Sunday). */
  rhythm: number[];
}

function distanceOf(a: Activity): number {
  return STRENGTH_TYPES.includes(a.sport_type) ? 0 : a.distance_meters ?? 0;
}

function sum<T>(items: T[], value: (item: T) => number): number {
  return items.reduce((total, item) => total + value(item), 0);
}

function dayLabel(date: string, today: string, yesterday: string): string {
  if (date === today) return 'Today';
  if (date === yesterday) return 'Yesterday';
  return new Date(`${date}T00:00:00`).toLocaleDateString(getActiveLocale(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function weekLabel(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  return `${start.toLocaleDateString(getActiveLocale(), opts)} – ${end.toLocaleDateString(
    getActiveLocale(),
    opts,
  )}`;
}

/**
 * Group a (typically newest-first) activity list into weeks → days.
 * Weeks are Monday-based; within a week days are newest-first.
 */
export function groupByWeek(activities: Activity[], now: Date = new Date()): JournalWeek[] {
  const today = toDateStr(now);
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = toDateStr(yesterdayDate);

  const byWeek = new Map<string, Activity[]>();
  for (const activity of activities) {
    const date = activity.start_date.slice(0, 10);
    const week = mondayOf(date);
    const bucket = byWeek.get(week);
    if (bucket) bucket.push(activity);
    else byWeek.set(week, [activity]);
  }

  return Array.from(byWeek.entries())
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([weekStart, weekActivities]) => {
      const byDay = new Map<string, Activity[]>();
      for (const activity of weekActivities) {
        const date = activity.start_date.slice(0, 10);
        const bucket = byDay.get(date);
        if (bucket) bucket.push(activity);
        else byDay.set(date, [activity]);
      }

      const days: JournalDay[] = Array.from(byDay.entries())
        .sort(([a], [b]) => (a < b ? 1 : -1))
        .map(([date, dayActivities]) => ({
          date,
          label: dayLabel(date, today, yesterday),
          activities: dayActivities,
          tss: sum(dayActivities, (a) => a.tss ?? 0),
          distanceMeters: sum(dayActivities, distanceOf),
          durationSeconds: sum(dayActivities, (a) => a.duration_seconds ?? 0),
        }));

      const rhythm = [0, 0, 0, 0, 0, 0, 0];
      for (const activity of weekActivities) {
        const date = activity.start_date.slice(0, 10);
        const weekday = (new Date(`${date}T00:00:00`).getDay() + 6) % 7; // Mon=0
        rhythm[weekday] += activity.tss ?? 0;
      }

      return {
        weekStart,
        label: weekLabel(weekStart),
        days,
        count: weekActivities.length,
        tss: sum(weekActivities, (a) => a.tss ?? 0),
        distanceMeters: sum(weekActivities, distanceOf),
        durationSeconds: sum(weekActivities, (a) => a.duration_seconds ?? 0),
        rhythm,
      };
    });
}
