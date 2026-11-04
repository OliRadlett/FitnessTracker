/**
 * Activity Journal — pure helpers.
 *
 * The Journal is a chronological training diary: activities grouped by week
 * (Monday-based) then day, each session described by what it actually was
 * rather than by `Activity.name`.
 *
 * Why the description layer exists: on the real account every ride is named
 * "Cycling" and every lift "… Weight Training", and 16 of the 22 named routes
 * are literally "Cycling" because the route inherited the activity title. A row
 * built from `name` is therefore unreadable. Identity comes from the route, the
 * deterministic `ride_type`, and the top exercise of the linked lift.
 *
 * Everything here is pure and unit-tested (`__tests__/journal-grouping.test.ts`)
 * — no React, no fetching — so the page stays a thin renderer.
 */

import type { Activity } from '@/lib/api';
import { isStrengthType, sportLabel } from '@/lib/sportUtils';
import { formatDistance, getActiveLocale } from '@/lib/utils';
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

/** Provider strings disagree ("strength" vs "weighttraining"), so the journal
 *  filters by family and lets the backend map the family to its own vocabulary. */
const SPORT_GROUPS = new Set(['ride', 'lift']);

function applySportParam(params: URLSearchParams, sport: string): void {
  if (!sport) return;
  if (SPORT_GROUPS.has(sport)) params.set('sport_group', sport);
  else params.set('sport_type', sport);
}

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
  if (filters.sport) applySportParam(params, filters.sport);
  const q = filters.q.trim();
  if (q) params.set('q', q);
  return params;
}

/** Summary accepts the same filters minus sort/paging, so the totals match the list. */
export function buildSummaryParams(filters: JournalFilters, now: Date = new Date()): URLSearchParams {
  const params = new URLSearchParams({
    start_date_after: journalStartDate(filters.days, now),
  });
  if (filters.sport) applySportParam(params, filters.sport);
  const q = filters.q.trim();
  if (q) params.set('q', q);
  return params;
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** Row-primary duration: whole hours and minutes, never "1h 60m". */
export function formatRowDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '—';
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function formatVolumeKg(kg: number | null | undefined): string {
  if (!kg || kg <= 0) return '0 kg';
  return `${Math.round(kg).toLocaleString(getActiveLocale())} kg`;
}

// ── Row description ──────────────────────────────────────────────────────────

const RIDE_TYPE_LABEL: Record<string, string> = {
  recovery: 'Recovery ride',
  endurance: 'Endurance ride',
  tempo: 'Tempo ride',
  threshold: 'Threshold ride',
  vo2max: 'VO2 max ride',
};

/**
 * A route name is not reliable identity: 16 of 22 named routes in production
 * are literally "Cycling" because the route inherited the activity title. A row
 * that trusts it reproduces the bug it was meant to fix.
 */
const GENERIC_ROUTE =
  /^(cycling|ride|morning ride|evening ride|afternoon ride|lunch ride|commute|workout|weight training|training|session)$/i;

export function usableRouteName(activity: Activity): string {
  const route = activity.route_name?.trim() ?? '';
  if (!route) return '';
  if (GENERIC_ROUTE.test(route)) return '';
  if (route.toLowerCase() === activity.name.trim().toLowerCase()) return '';
  return route;
}

export type SessionGlyph =
  | { kind: 'route'; polyline: string }
  | { kind: 'lift'; weights: number[] }
  | { kind: 'none' };

export type SessionKind = 'ride' | 'lift' | 'other';

export interface JournalRow {
  id: string;
  isRide: boolean;
  /** Which layout the row belongs to. `other` covers run/swim/hike/walk. */
  kind: SessionKind;
  title: string;
  /** Time · source · (sport-specific detail). */
  meta: string[];
  primary: string;
  secondary: string;
  seconds: number;
  /** TSS for a ride, estimated TSS for a linked lift, null when unknown. */
  load: number | null;
  glyph: SessionGlyph;
}

function providerOf(activity: Activity): string {
  const provider = activity.sources?.[0]?.provider ?? activity.source ?? 'manual';
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function timeOf(activity: Activity): string {
  return new Date(activity.start_date).toLocaleTimeString(getActiveLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Describe one activity the way the diary shows it. Sport-specific metrics are
 * deliberate: a shared column set shows an em dash in every lift row, or a
 * meaningless zero.
 */
export function describeActivity(activity: Activity): JournalRow {
  const isRide = activity.sport_type === 'cycling';
  // A lift is strength work; everything else is an endurance session. The old
  // two-way branch treated a run as a lift, which titled it "Weight training"
  // and claimed it had no set log.
  const isLift = isStrengthType(activity.sport_type);
  const time = timeOf(activity);
  const source = providerOf(activity);
  const duration = formatRowDuration(activity.duration_seconds);

  if (isRide) {
    const route = usableRouteName(activity);
    const typeLabel = activity.ride_type ? RIDE_TYPE_LABEL[activity.ride_type] : undefined;
    const climb = activity.ride_context?.climbing_meters ?? activity.elevation_gain_meters;
    const tss = activity.tss ?? activity.ride_context?.tss ?? null;

    const meta = [time, source];
    if (climb && climb > 150) meta.push(`${Math.round(climb)} m climbed`);
    if (route && typeLabel) meta.push(typeLabel.replace(/ ride$/, '').toLowerCase());

    const secondary = [formatDistance(activity.distance_meters, 1)];
    if (tss) secondary.push(`${Math.round(tss)} TSS`);
    else if (activity.elevation_gain_meters) secondary.push(`${Math.round(activity.elevation_gain_meters)} m`);

    return {
      id: activity.id,
      isRide,
      kind: 'ride' as const,
      title: route || typeLabel || 'Ride',
      meta,
      primary: duration,
      secondary: secondary.join(' · '),
      seconds: activity.duration_seconds ?? 0,
      load: tss,
      glyph: activity.encoded_polyline
        ? { kind: 'route' as const, polyline: activity.encoded_polyline }
        : { kind: 'none' as const },
    };
  }

  if (!isLift) {
    // Run / swim / hike / walk: the activity's own name is usually meaningful
    // here ("Morning Run"), so it is the title rather than a derived one.
    const title = activity.name?.trim() || sportLabel(activity.sport_type);
    const secondary = [formatDistance(activity.distance_meters, 1)];
    if (activity.average_heartrate) secondary.push(`${Math.round(activity.average_heartrate)} bpm`);
    else if (activity.elevation_gain_meters) secondary.push(`${Math.round(activity.elevation_gain_meters)} m`);

    return {
      id: activity.id,
      isRide: false,
      kind: 'other' as const,
      title,
      meta: [time, source],
      primary: duration,
      secondary: secondary.join(' · '),
      seconds: activity.duration_seconds ?? 0,
      load: activity.tss ?? null,
      glyph: activity.encoded_polyline
        ? { kind: 'route' as const, polyline: activity.encoded_polyline }
        : { kind: 'none' as const },
    };
  }

  const linked = activity.linked_lifting_session ?? null;
  const focus = linked?.focus ?? null;
  const volume = linked?.total_volume_kg ?? null;
  const topExercise = linked?.top_exercise ?? null;

  const title = topExercise || (focus ? `${focus.charAt(0).toUpperCase()}${focus.slice(1)} day` : 'Weight training');
  const meta = [time, source];
  if (topExercise && focus) meta.push(`${focus} day`);
  if (!linked) meta.push('no set log');

  const secondary = linked
    ? [volume ? formatVolumeKg(volume) : null, linked.set_count ? `${linked.set_count} sets` : null]
        .filter(Boolean)
        .join(' · ')
    : activity.average_heartrate
      ? `${Math.round(activity.average_heartrate)} bpm avg`
      : `${Math.round(activity.calories ?? 0)} kcal`;

  return {
    id: activity.id,
    isRide: false,
    kind: 'lift' as const,
    title,
    meta,
    primary: duration,
    secondary,
    seconds: activity.duration_seconds ?? 0,
    load: linked?.estimated_tss ?? activity.tss ?? null,
    glyph: linked?.top_weights?.length
      ? { kind: 'lift', weights: linked.top_weights }
      : { kind: 'none' },
  };
}

// ── Grouping ─────────────────────────────────────────────────────────────────

export interface JournalDay {
  /** YYYY-MM-DD, local. */
  date: string;
  label: string;
  weekday: string;
  dayNumber: string;
  isToday: boolean;
  rows: JournalRow[];
  tss: number;
  distanceMeters: number;
  durationSeconds: number;
  volumeKg: number;
}

export interface JournalWeek {
  /** Monday of the week, YYYY-MM-DD */
  weekStart: string;
  label: string;
  weekNumber: number;
  days: JournalDay[];
  count: number;
  tss: number;
  distanceMeters: number;
  durationSeconds: number;
  volumeKg: number;
  /** Seven day buckets Mon–Sun for the week's sparkline. */
  strip: {
    day: string;
    date: string;
    seconds: number;
    sessions: number;
    isToday: boolean;
    parts: { seconds: number; isRide: boolean }[];
  }[];
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STRIP_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function distanceOf(activity: Activity): number {
  // "strength" is not in STRENGTH_TYPES but does contain the keyword; the
  // classifier is the single source of truth for what counts as a lift.
  return isStrengthType(activity.sport_type) ? 0 : activity.distance_meters ?? 0;
}

export function isoWeekNumber(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00`);
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
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
  return `${start.toLocaleDateString(getActiveLocale(), opts)} – ${end.toLocaleDateString(getActiveLocale(), opts)}`;
}

/**
 * Group a (typically newest-first) activity list into weeks → days.
 *
 * Keys are **local** calendar dates. The previous version sliced the UTC ISO
 * string, so a 23:30 local session could land in the wrong day and, at a week
 * boundary, the wrong week — while the labels next to it were local.
 */
export function groupByWeek(activities: Activity[], now: Date = new Date()): JournalWeek[] {
  const today = toDateStr(now);
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = toDateStr(yesterdayDate);

  const byWeek = new Map<string, JournalDay[]>();

  for (const activity of activities) {
    const date = new Date(activity.start_date);
    const dayKey = toDateStr(date);
    const weekStart = mondayOf(dayKey);
    if (!byWeek.has(weekStart)) byWeek.set(weekStart, []);

    const days = byWeek.get(weekStart)!;
    let day = days.find((d) => d.date === dayKey);
    if (!day) {
      day = {
        date: dayKey,
        label: dayLabel(dayKey, today, yesterday),
        weekday: WEEKDAYS[(date.getDay() + 6) % 7],
        dayNumber: String(date.getDate()),
        isToday: dayKey === today,
        rows: [],
        tss: 0,
        distanceMeters: 0,
        durationSeconds: 0,
        volumeKg: 0,
      };
      days.push(day);
    }

    day.rows.push(describeActivity(activity));
    day.tss += activity.tss ?? 0;
    day.distanceMeters += distanceOf(activity);
    day.durationSeconds += activity.duration_seconds ?? 0;
    day.volumeKg += activity.linked_lifting_session?.total_volume_kg ?? 0;
  }

  return [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([weekStart, days]) => {
      days.sort((a, b) => (a.date < b.date ? 1 : -1));

      const strip = Array.from({ length: 7 }, (_, i) => {
        const date = new Date(`${weekStart}T00:00:00`);
        date.setDate(date.getDate() + i);
        const key = toDateStr(date);
        const day = days.find((d) => d.date === key);
        return {
          day: STRIP_LETTERS[i],
          date: key,
          seconds: day?.durationSeconds ?? 0,
          sessions: day?.rows.length ?? 0,
          isToday: key === today,
          parts: (day?.rows ?? []).map((row) => ({ seconds: row.seconds, isRide: row.isRide })),
        };
      });

      return {
        weekStart,
        label: weekLabel(weekStart),
        weekNumber: isoWeekNumber(weekStart),
        days,
        count: days.reduce((n, d) => n + d.rows.length, 0),
        tss: days.reduce((n, d) => n + d.tss, 0),
        distanceMeters: days.reduce((n, d) => n + d.distanceMeters, 0),
        durationSeconds: days.reduce((n, d) => n + d.durationSeconds, 0),
        volumeKg: days.reduce((n, d) => n + d.volumeKg, 0),
        strip,
      };
    });
}

/** Week rollup line: sessions · time · load · volume, omitting what is zero. */
export function weekTotalsParts(week: JournalWeek): string[] {
  const parts = [
    `${week.count} ${week.count === 1 ? 'session' : 'sessions'}`,
    formatRowDuration(week.durationSeconds),
  ];
  if (week.tss > 0) parts.push(`${Math.round(week.tss)} TSS`);
  if (week.volumeKg > 0) parts.push(formatVolumeKg(week.volumeKg));
  return parts;
}
