/**
 * Cycling view models — pure functions from API payloads to what the page draws.
 *
 * Everything here takes data in and returns plain objects: no React, no fetching,
 * no rounding that hides a source. The page's job is to render these; the tests'
 * job is to prove the arithmetic.
 */
import type {
  Activity,
  CyclingMetricsSummary,
  DailyLoadPoint,
  MetricTrend,
  PowerCurveResponse,
  PowerDurationPoint,
  WeatherAnalysisResponse,
} from '@/lib/api';

/** A coefficient is only reported as an effect when its fit can carry it. */
export const R2_FLOOR = 0.2;

const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Dates ───────────────────────────────────────────────────────────────────

/** Parse an ISO date or date-time as UTC noon, so a timezone cannot shift the day. */
export function parseDay(iso: string): Date {
  return new Date(iso.length > 10 ? iso : `${iso}T12:00:00Z`);
}

/** "31 Oct" */
export function formatShortDate(iso: string): string {
  const d = parseDay(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Fri 31 Oct" */
export function formatDayDate(iso: string): string {
  const d = parseDay(iso);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Whole days between `iso` and `now` (positive when `iso` is in the past). */
export function daysBetween(iso: string, now: Date): number {
  return Math.round((now.getTime() - parseDay(iso).getTime()) / DAY_MS);
}

/** "3h 12" / "48m" — hours only when there is at least one. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}` : `${m}m`;
}

// ── Form ────────────────────────────────────────────────────────────────────

/** The app's own TSB wording (LoadSummary): >3 Fresh, <-10 Heavy, else Moderate. */
export function tsbWord(tsb: number): 'Fresh' | 'Heavy' | 'Moderate' {
  if (tsb > 3) return 'Fresh';
  if (tsb < -10) return 'Heavy';
  return 'Moderate';
}

/** Change in CTL over the last `days` points of the series, with % of the start. */
export function ctlChange(
  points: DailyLoadPoint[],
  days: number,
): { delta: number; pct: number; fromISO: string } | null {
  if (points.length < days || days < 2) return null;
  const from = points[points.length - days];
  const to = points[points.length - 1];
  const delta = to.ctl - from.ctl;
  return { delta, pct: from.ctl ? (delta / from.ctl) * 100 : 0, fromISO: from.date };
}

export interface WeekStat {
  label: string;
  value: string;
  sub: string | null;
  direction: 'up' | 'down' | 'flat' | null;
}

const trendDirection = (t?: MetricTrend): WeekStat['direction'] => {
  if (!t || t.current_value == null || t.baseline_value == null) return null;
  const delta = t.current_value - t.baseline_value;
  if (Math.abs(delta) / (Math.abs(t.baseline_value) || 1) < 0.02) return 'flat';
  return delta > 0 ? 'up' : 'down';
};

/** The 7-day totals, each with the backend's own 4-week baseline beside it. */
export function weekStats(metrics: CyclingMetricsSummary): WeekStat[] {
  const stat = (
    label: string,
    value: string,
    trend: MetricTrend | undefined,
    formatBaseline: (v: number) => string,
  ): WeekStat => ({
    label,
    value,
    sub: trend?.baseline_value != null ? `4-wk avg ${formatBaseline(trend.baseline_value)}` : null,
    direction: trendDirection(trend),
  });

  return [
    stat('TSS', String(Math.round(metrics.recent_tss)), metrics.tss_trend, (v) => String(Math.round(v))),
    stat('Rides', String(metrics.recent_rides), metrics.rides_trend, (v) => String(Math.round(v))),
    stat('Distance', `${Math.round(metrics.recent_distance_km)} km`, metrics.distance_trend, (v) => `${Math.round(v)} km`),
    stat('Time', `${metrics.recent_time_hours.toFixed(1)} h`, metrics.time_trend, (v) => `${v.toFixed(1)} h`),
  ];
}

// ── Rides ───────────────────────────────────────────────────────────────────

export interface RideRow {
  id: string;
  date: string;
  name: string;
  distanceKm: number | null;
  movingSeconds: number | null;
  elevationM: number | null;
  avgPower: number | null;
  tss: number | null;
  rideType: string | null;
  hasStreams: boolean;
}

export function toRideRow(a: Activity): RideRow {
  return {
    id: a.id,
    date: a.start_date,
    name: a.name,
    distanceKm: a.distance_meters != null ? a.distance_meters / 1000 : null,
    movingSeconds: a.duration_seconds ?? null,
    elevationM: a.elevation_gain_meters ?? null,
    avgPower: a.average_power ?? null,
    tss: a.tss ?? null,
    rideType: a.ride_type ?? null,
    hasStreams: a.has_streams ?? false,
  };
}

/** Newest first — the order every ride list on the page uses. */
export function rideRows(activities: Activity[]): RideRow[] {
  return activities
    .filter((a) => /ride|cycl|bike/i.test(a.sport_type ?? ''))
    .map(toRideRow)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function ridesInLastDays(rows: RideRow[], days: number, now: Date): RideRow[] {
  return rows.filter((r) => daysBetween(r.date, now) < days);
}

export interface WeekBucket {
  startISO: string;
  label: string;
  total: number;
  byType: Record<string, number>;
}

/**
 * Rides per calendar week for the last `weeks` weeks, **including** weeks with no
 * rides. Dropping empty weeks compresses the time axis and makes a quiet month
 * look busy — the defect this replaces.
 */
export function weeklyBuckets(rows: RideRow[], weeks: number, now: Date): WeekBucket[] {
  // Start of the current week, at midnight UTC. Keeping `now`'s time-of-day here
  // would put the week boundary at noon and drop a Monday-morning ride.
  const monday = new Date(now);
  monday.setUTCHours(0, 0, 0, 0);
  const dow = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - dow);

  const buckets: WeekBucket[] = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = new Date(monday);
    start.setUTCDate(start.getUTCDate() - i * 7);
    const next = new Date(start);
    next.setUTCDate(next.getUTCDate() + 7);

    const inWeek = rows.filter((r) => {
      const d = parseDay(r.date);
      return d >= start && d < next;
    });
    const byType: Record<string, number> = {};
    for (const r of inWeek) {
      const key = r.rideType ?? 'unclassified';
      byType[key] = (byType[key] ?? 0) + 1;
    }
    buckets.push({
      startISO: start.toISOString().slice(0, 10),
      label: `${start.getUTCDate()} ${MONTHS[start.getUTCMonth()]}`,
      total: inWeek.length,
      byType,
    });
  }
  return buckets;
}

/** Count of rides per type, commonest first. */
export function typeMix(rows: RideRow[]): { type: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = r.rideType ?? 'unclassified';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

// ── Power ───────────────────────────────────────────────────────────────────

export interface DurationRow {
  label: string;
  seconds: number;
  bestWindow: number | null;
  bestLong: number | null;
  /** When the window best was set (from the same computation — see below). */
  achievedOn: string | null;
  wkg: number | null;
  pctFtp: number | null;
  deltaPct: number | null;
}

/**
 * One row per duration, from the **same** computation at two windows.
 *
 * Deliberately not merged with `lifetime_pbs` or `cycling_power_records`: those
 * are different pipelines that disagree (20 min read 214.4 / 236.4 / 262 W on the
 * same page). Showing one measured pipeline is honest; showing three was not.
 */
export function durationRows(
  windowCurve: PowerCurveResponse | undefined,
  longCurve: PowerCurveResponse | undefined,
  ftp: number | null,
  weightKg: number | null,
): DurationRow[] {
  const bySeconds = new Map<number, PowerDurationPoint>(
    (longCurve?.data ?? []).map((r) => [r.duration_seconds, r]),
  );

  return (windowCurve?.data ?? []).map((r) => {
    const best = r.best_power_watts ?? null;
    const long = bySeconds.get(r.duration_seconds)?.best_power_watts ?? null;
    return {
      label: r.duration_label,
      seconds: r.duration_seconds,
      bestWindow: best,
      bestLong: long,
      achievedOn: r.date_achieved ?? null,
      wkg: best != null && weightKg ? best / weightKg : null,
      pctFtp: best != null && ftp ? (best / ftp) * 100 : null,
      deltaPct: best != null && long ? ((best - long) / long) * 100 : null,
    };
  });
}

// ── Honest statistics ───────────────────────────────────────────────────────

export interface WeatherRow {
  label: string;
  value: string;
  detail: string;
  supported: boolean;
}

const signed = (v: number, digits: number, suffix: string) =>
  `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}${suffix}`;

/**
 * Weather coefficients with their fit. A row below `floor` is still returned —
 * with its R² and n — so the page can print the number and say it is not a
 * finding, rather than either hiding it or dressing it up as one.
 */
export function weatherRows(
  weather: WeatherAnalysisResponse | null | undefined,
  floor = R2_FLOOR,
): WeatherRow[] {
  if (!weather) return [];
  const rows: WeatherRow[] = [];
  const num = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

  if (weather.power_vs_temp) {
    const { slope_per_celsius, r_squared, data_points } = weather.power_vs_temp;
    if (num(slope_per_celsius) && num(r_squared)) {
      rows.push({
        label: 'Power vs temperature',
        value: signed(slope_per_celsius, 2, ' W/°C'),
        detail: `R² ${r_squared.toFixed(3)} · n=${data_points ?? 0}`,
        supported: r_squared >= floor,
      });
    }
  }
  if (weather.hr_vs_temp) {
    const { slope_bpm_per_celsius, r_squared, data_points } = weather.hr_vs_temp;
    if (num(slope_bpm_per_celsius) && num(r_squared)) {
      rows.push({
        label: 'Heart rate vs temperature',
        value: signed(slope_bpm_per_celsius, 2, ' bpm/°C'),
        detail: `R² ${r_squared.toFixed(3)} · n=${data_points ?? 0}`,
        supported: r_squared >= floor,
      });
    }
  }
  if (weather.power_vs_wind) {
    const {
      headwind_penalty_pct,
      tailwind_boost_pct,
      crosswind_penalty_pct,
      power_vs_speed_r_squared,
      data_points,
    } = weather.power_vs_wind;
    const complete =
      num(headwind_penalty_pct) && num(tailwind_boost_pct) && num(crosswind_penalty_pct) && num(power_vs_speed_r_squared);
    if (complete) {
      const n = Object.values(data_points ?? {}).reduce((a, b) => a + (num(b) ? b : 0), 0);
      rows.push({
        label: 'Wind (head / tail / cross)',
        value: `−${headwind_penalty_pct.toFixed(1)}% / +${tailwind_boost_pct.toFixed(1)}% / −${crosswind_penalty_pct.toFixed(1)}%`,
        detail: `R² ${power_vs_speed_r_squared.toFixed(3)} · n=${n}`,
        supported: power_vs_speed_r_squared >= floor,
      });
    }
  }
  return rows;
}
