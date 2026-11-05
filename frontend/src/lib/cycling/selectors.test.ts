import { describe, expect, it } from 'vitest';
import type {
  Activity,
  CyclingMetricsSummary,
  DailyLoadPoint,
  PowerCurveResponse,
  WeatherAnalysisResponse,
} from '@/lib/api';
import {
  R2_FLOOR,
  ctlChange,
  daysBetween,
  durationRows,
  formatDayDate,
  formatDuration,
  formatShortDate,
  rideRows,
  ridesInLastDays,
  toRideRow,
  tsbWord,
  typeMix,
  weatherRows,
  weekStats,
  weeklyBuckets,
  type RideRow,
} from './selectors';

const NOW = new Date('2026-06-18T12:00:00Z');

const activity = (over: Partial<Activity>): Activity =>
  ({
    id: 'a1',
    name: 'Ride',
    source: 'strava',
    sport_type: 'cycling',
    start_date: '2026-06-17T08:00:00Z',
    duration_seconds: 3600,
    distance_meters: 30000,
    elevation_gain_meters: 200,
    average_power: 150,
    tss: 60,
    ride_type: 'endurance',
    has_streams: true,
    ...over,
  }) as Activity;

const load = (ctl: number, date: string): DailyLoadPoint => ({ date, tss: 0, ctl, atl: ctl - 1, tsb: 1 });

const metrics = (over: Partial<CyclingMetricsSummary> = {}): CyclingMetricsSummary =>
  ({
    recent_tss: 203.6,
    recent_distance_km: 106.8,
    recent_time_hours: 6.4,
    recent_elevation_m: 1993,
    recent_rides: 2,
    ...over,
  }) as CyclingMetricsSummary;

describe('tsbWord', () => {
  it('uses the app-wide thresholds', () => {
    expect(tsbWord(3)).toBe('Moderate');
    expect(tsbWord(3.1)).toBe('Fresh');
    expect(tsbWord(-10)).toBe('Moderate');
    expect(tsbWord(-10.1)).toBe('Heavy');
  });
});

describe('ctlChange', () => {
  const points = [
    load(40, '2026-01-01'),
    load(36, '2026-01-02'),
    load(30, '2026-01-03'),
  ];

  it('measures from the first point of the window to the last', () => {
    expect(ctlChange(points, 3)).toEqual({ delta: -10, pct: -25, fromISO: '2026-01-01' });
  });

  it('returns null when the series is shorter than the window', () => {
    expect(ctlChange(points, 4)).toBeNull();
    expect(ctlChange(points, 1)).toBeNull();
  });

  it('does not divide by a zero baseline', () => {
    expect(ctlChange([load(0, '2026-01-01'), load(5, '2026-01-02')], 2)?.pct).toBe(0);
  });
});

describe('weekStats', () => {
  it('carries the backend baseline and direction, and formats units', () => {
    const stats = weekStats(
      metrics({
        tss_trend: { current_value: 204, baseline_value: 120, direction: 'up' },
        rides_trend: { current_value: 2, baseline_value: 2, direction: 'stable' },
        distance_trend: { current_value: 107, baseline_value: 83, direction: 'up' },
        time_trend: { current_value: 6.4, baseline_value: 4.05, direction: 'up' },
      }),
    );

    expect(stats.map((s) => s.label)).toEqual(['TSS', 'Rides', 'Distance', 'Time']);
    expect(stats[0]).toMatchObject({ value: '204', sub: '4-wk avg 120', direction: 'up' });
    expect(stats[1].direction).toBe('flat'); // 0% change reads as flat, not neutral
    expect(stats[2]).toMatchObject({ value: '107 km', sub: '4-wk avg 83 km' });
    expect(stats[3].value).toBe('6.4 h');
  });

  it('leaves the baseline out when the backend sends none', () => {
    const stats = weekStats(metrics({ tss_trend: { current_value: 100, baseline_value: null, direction: 'up' } }));
    expect(stats[0].sub).toBeNull();
    expect(stats[0].direction).toBeNull();
  });
});

describe('rideRows', () => {
  it('keeps cycling only and sorts newest first', () => {
    const rows = rideRows([
      activity({ id: 'run', sport_type: 'running' }),
      activity({ id: 'old', start_date: '2026-06-01T08:00:00Z' }),
      activity({ id: 'new', start_date: '2026-06-17T08:00:00Z' }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('projects units and turns missing values into null, not zero', () => {
    const row = toRideRow(
      activity({ distance_meters: undefined, elevation_gain_meters: undefined, tss: undefined, ride_type: null }),
    );
    expect(row.distanceKm).toBeNull();
    expect(row.elevationM).toBeNull();
    expect(row.tss).toBeNull();
    expect(row.rideType).toBeNull();
    expect(toRideRow(activity({})).distanceKm).toBeCloseTo(30);
  });
});

describe('ridesInLastDays', () => {
  it('uses a rolling window ending today', () => {
    const rows = [
      { ...({ id: 'today', date: '2026-06-18T08:00:00Z' } as RideRow) },
      { ...({ id: 'week', date: '2026-06-12T08:00:00Z' } as RideRow) },
      { ...({ id: 'old', date: '2026-06-01T08:00:00Z' } as RideRow) },
    ];
    expect(ridesInLastDays(rows, 7, NOW).map((r) => r.id)).toEqual(['today', 'week']);
  });
});

describe('weeklyBuckets', () => {
  it('includes empty weeks so the time axis cannot compress', () => {
    const rows = rideRows([activity({ id: 'a', start_date: '2026-06-17T08:00:00Z' })]);
    const buckets = weeklyBuckets(rows, 4, NOW);

    expect(buckets).toHaveLength(4);
    expect(buckets.reduce((a, b) => a + b.total, 0)).toBe(1);
    expect(buckets.filter((b) => b.total === 0)).toHaveLength(3);
    expect(buckets[buckets.length - 1].total).toBe(1);
  });

  it('starts weeks on Monday and counts by type', () => {
    const rows = rideRows([
      activity({ id: 'a', start_date: '2026-06-17T08:00:00Z', ride_type: 'threshold' }),
      activity({ id: 'b', start_date: '2026-06-16T08:00:00Z', ride_type: 'threshold' }),
      activity({ id: 'c', start_date: '2026-06-15T08:00:00Z', ride_type: null }),
    ]);
    const [week] = weeklyBuckets(rows, 1, NOW);
    expect(week.startISO).toBe('2026-06-15'); // Monday
    expect(week.total).toBe(3);
    expect(week.byType).toEqual({ threshold: 2, unclassified: 1 });
  });
});

describe('typeMix', () => {
  it('sorts by count, then alphabetically, and names the gap', () => {
    const rows = rideRows([
      activity({ id: '1', ride_type: 'tempo' }),
      activity({ id: '2', ride_type: null }),
      activity({ id: '3', ride_type: 'tempo' }),
      activity({ id: '4', ride_type: 'endurance' }),
    ]);
    expect(typeMix(rows)).toEqual([
      { type: 'tempo', count: 2 },
      { type: 'endurance', count: 1 },
      { type: 'unclassified', count: 1 },
    ]);
  });
});

describe('durationRows', () => {
  const curve = (rows: [number, string, number | undefined][]): PowerCurveResponse =>
    ({
      data: rows.map(([seconds, label, best]) => ({
        duration_seconds: seconds,
        duration_label: label,
        best_power_watts: best,
      })),
    }) as PowerCurveResponse;

  it('reads both windows from the same computation', () => {
    const rows = durationRows(
      curve([
        [300, '5min', 300],
        [1200, '20min', 200],
      ]),
      curve([
        [300, '5min', 320],
        [1200, '20min', 200],
      ]),
      200,
      80,
    );

    expect(rows[0]).toMatchObject({ label: '5min', bestWindow: 300, bestLong: 320, pctFtp: 150, wkg: 3.75 });
    expect(rows[0].deltaPct).toBeCloseTo(-6.25);
    expect(rows[1].deltaPct).toBe(0);
  });

  it('leaves the comparison empty rather than guessing when a window is missing', () => {
    const rows = durationRows(curve([[3600, '60min', 180]]), undefined, 200, 80);
    expect(rows[0].bestLong).toBeNull();
    expect(rows[0].deltaPct).toBeNull();
  });

  it('does not invent W/kg or %FTP without a threshold or a weight', () => {
    const rows = durationRows(curve([[300, '5min', 300]]), undefined, null, null);
    expect(rows[0].wkg).toBeNull();
    expect(rows[0].pctFtp).toBeNull();
  });

  it('returns nothing when the window is missing', () => {
    expect(durationRows(undefined, undefined, 200, 80)).toEqual([]);
  });
});

describe('weatherRows', () => {
  const weather = (over: Partial<WeatherAnalysisResponse>): WeatherAnalysisResponse =>
    ({
      power_vs_temp: null,
      power_vs_wind: null,
      decoupling_vs_temp: null,
      hr_vs_temp: null,
      weather_coefficients: null,
      personalized_insights: [],
      analyzed_at: null,
      ...over,
    }) as WeatherAnalysisResponse;

  it('keeps a weak coefficient but marks it unsupported', () => {
    const [row] = weatherRows(
      weather({
        power_vs_temp: {
          slope_per_celsius: 0.9,
          intercept: 145,
          r_squared: 0.03,
          data_points: 101,
          optimal_range_c: [24, 27],
        },
      }),
    );
    expect(row.value).toBe('+0.90 W/°C');
    expect(row.detail).toBe('R² 0.030 · n=101');
    expect(row.supported).toBe(false);
  });

  it('supports a coefficient that clears the floor, and flags the sign', () => {
    const [row] = weatherRows(
      weather({ hr_vs_temp: { slope_bpm_per_celsius: -0.21, intercept: 145, r_squared: R2_FLOOR, data_points: 40 } }),
    );
    expect(row.value).toBe('−0.21 bpm/°C');
    expect(row.supported).toBe(true);
  });

  it('skips a coefficient the backend left null instead of printing NaN', () => {
    expect(
      weatherRows(
        weather({
          power_vs_temp: {
            slope_per_celsius: null,
            intercept: null,
            r_squared: null,
            data_points: null,
            optimal_range_c: null,
          } as never,
        }),
      ),
    ).toEqual([]);
  });

  it('returns nothing for a missing payload', () => {
    expect(weatherRows(null)).toEqual([]);
  });
});

describe('date helpers', () => {
  it('formats without consulting the host locale', () => {
    expect(formatShortDate('2026-10-31')).toBe('31 Oct');
    expect(formatDayDate('2026-10-31')).toBe('Sat 31 Oct');
    expect(formatDayDate('2026-10-31T09:15:00Z')).toBe('Sat 31 Oct');
  });

  it('counts whole days to a reference date', () => {
    expect(daysBetween('2026-06-17', NOW)).toBe(1);
    expect(daysBetween('2026-06-18', NOW)).toBe(0);
  });

  it('formats durations with hours only when they exist', () => {
    expect(formatDuration(3720)).toBe('1h 02');
    expect(formatDuration(2880)).toBe('48m');
    expect(formatDuration(null)).toBe('—');
  });
});
