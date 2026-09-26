/**
 * "Race Yourself" data for the Relive overview (Phase 5 follow-up).
 *
 * When a route has more than one ride, the overview can stack every ride's
 * path as a coloured trace so you can see, at a glance, where your efforts on
 * a shared route diverge and overlap. Distance-aligned, so each trace follows
 * the same ground; colour encodes the ride (date/recency).
 *
 * Pure data — no three/DOM — so it is unit-testable. The component layer
 * (`useRaceRides`) fetches + builds these.
 */

import type { ActivityStream } from '@/lib/api';
import { buildReplay } from '@/lib/replay';
import { streamInput, VELOCITY_STREAM_TYPES } from '@/lib/streams';

/** built replay path — positions in the shared projection frame */
export interface RacePoint {
  x: number;
  y: number;
  z: number;
  distance: number;
  speed: number;
  elapsed: number;
}

export interface RaceRide {
  id: string;
  name: string;
  date: string;
  distanceMeters: number;
  durationSeconds: number | null;
  averagePower: number | null;
  tss: number | null;
  isPr: boolean;
  points: RacePoint[];
  /** hex colour assigned by the legend palette */
  color: string;
}

/** fixed legend palette; rides cycle through it by recency */
export const RACE_PALETTE = [
  '#60a5fa', // blue (most recent)
  '#f472b6', // pink
  '#34d399', // green
  '#fbbf24', // amber
  '#a78bfa', // violet
  '#fb923c', // orange,
  '#22d3ee', // cyan,
  '#f87171', // red
];

/**
 * Index of the race point whose elapsed time is closest to (not exceeding) `t`.
 * Binary search — points are sorted by elapsed. Pure.
 */
export function raceIndexAt(points: RacePoint[], t: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].elapsed <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Speed-colour ramp for Phase 3 traces: blue (slow) → green (cruise) → amber
 * (fast) → red (max). Returns [r, g, b] in 0..1. Pure.
 */
export function speedColor(speedMs: number, maxSpeedMs: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, speedMs / (maxSpeedMs || 1)));
  if (t < 0.33) {
    // blue → green
    const u = t / 0.33;
    return [0.2 + 0.0 * u, 0.4 + 0.4 * u, 0.9 - 0.4 * u];
  }
  if (t < 0.66) {
    // green → amber
    const u = (t - 0.33) / 0.33;
    return [0.2 + 0.8 * u, 0.8 - 0.1 * u, 0.5 - 0.4 * u];
  }
  // amber → red
  const u = (t - 0.66) / 0.34;
  return [1.0, 0.7 - 0.5 * u, 0.1 - 0.05 * u];
}

export interface BuildRaceRidesArgs {
  history: {
    rides: {
      activity_id: string;
      date: string;
      duration_seconds: number | null;
      distance_meters: number | null;
      average_power: number | null;
      tss: number | null;
    }[];
    personal_best: { activity_id: string } | null;
  };
  /** activity detail (streams + polyline) keyed by activity id */
  detailById: Record<
    string,
    {
      name: string;
      encoded_polyline?: string | null;
      streams?: ActivityStream[];
    }
  >;
}

/**
 * Turn route-history rides into coloured, distance-aligned replay paths.
 * Rides without a usable polyline or velocity stream are skipped. The most
 * recent ride sorts first; `isPr` flags the personal-best effort.
 */
export function buildRaceRides({
  history,
  detailById,
}: BuildRaceRidesArgs): RaceRide[] {
  const rides = history.rides
    .map((r) => {
      const detail = detailById[r.activity_id];
      if (!detail?.encoded_polyline || !detail.streams) return null;
      const polyline = detail.encoded_polyline;
      const velocity = streamInput(detail.streams, ...VELOCITY_STREAM_TYPES);
      if (!velocity) return null;
      const build = buildReplay({ polyline, velocity, maxSamples: 1500 });
      if (build.points.length < 2) return null;
      const isPr = history.personal_best?.activity_id === r.activity_id;
      return {
        id: r.activity_id,
        name: detail.name,
        date: r.date,
        distanceMeters: r.distance_meters ?? build.totalDistance,
        durationSeconds: r.duration_seconds,
        averagePower: r.average_power,
        tss: r.tss,
        isPr,
        points: build.points.map((p) => ({
          x: p.x,
          y: p.y,
          z: p.z,
          distance: p.distance,
          speed: p.speed,
          elapsed: p.elapsed,
        })),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    // most recent first
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return rides.map((r, i) => ({ ...r, color: RACE_PALETTE[i % RACE_PALETTE.length] }));
}
