/**
 * 3D ride-replay math (§3.16) — pure helpers, unit-testable without WebGL.
 *
 * Builds a time-synchronised flight path: the ride's polyline is projected
 * onto a local metric plane (equirectangular around the centroid) and the
 * per-second velocity stream is integrated into cumulative distance, which is
 * then mapped back onto the projected polyline so every sample gets an
 * (x, y, z, distance, elapsed) position. Power/HR ride along for the overlay.
 */

import { decodePolyline } from './polyline';

export const M_PER_DEG_LAT = 111320;

export interface ReplayPoint {
  /** seconds from ride start */
  elapsed: number;
  /** cumulative travel distance, meters */
  distance: number;
  /** projected plane coordinates, meters */
  x: number;
  y: number;
  /** altitude above the ride's minimum, vertically exaggerated for 3D */
  z: number;
  /** instantaneous speed, m/s */
  speed: number;
  power: number | null;
  hr: number | null;
  /** pedalling cadence, rpm */
  cadence: number | null;
  /** segment gradient %, derived from altitude ÷ distance (null when unknown) */
  grade: number | null;
}

export interface StreamInput {
  values: number[];
  resolution?: number | null;
}

/** local equirectangular projection of lat/lng pairs around their centroid */
export function projectPolyline(
  coords: [number, number][]
): { xs: number[]; ys: number[]; lat0: number; lng0: number } {
  const n = coords.length;
  if (n === 0) return { xs: [], ys: [], lat0: 0, lng0: 0 };
  const lat0 = coords.reduce((s, c) => s + c[0], 0) / n;
  const lng0 = coords.reduce((s, c) => s + c[1], 0) / n;
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  const xs = coords.map(([, lng]) => (lng - lng0) * mPerDegLng);
  const ys = coords.map(([lat]) => (lat - lat0) * M_PER_DEG_LAT);
  return { xs, ys, lat0, lng0 };
}

/** cumulative polyline length in meters at each coordinate */
export function cumulativePolyline(
  coords: [number, number][],
  xs?: number[],
  ys?: number[]
): number[] {
  const n = coords.length;
  if (n === 0) return [];
  const cum = [0];
  for (let i = 1; i < n; i++) {
    if (xs && ys) {
      const dx = xs[i] - xs[i - 1];
      const dy = ys[i] - ys[i - 1];
      cum.push(cum[i - 1] + Math.hypot(dx, dy));
    } else {
      const [la, ln] = coords[i - 1];
      const [lb, lnb] = coords[i];
      const dLat = (lb - la) * M_PER_DEG_LAT;
      const dLng = (lnb - ln) * M_PER_DEG_LAT * Math.cos((la * Math.PI) / 180);
      cum.push(cum[i - 1] + Math.hypot(dLat, dLng));
    }
  }
  return cum;
}

/** integrate a velocity (m/s) stream × resolution(seconds) into cumulative meters */
export function cumulativeFromVelocity(
  velocity: number[],
  resolution = 1
): number[] {
  const cum = [0];
  for (let i = 1; i < velocity.length; i++) {
    const v = velocity[i];
    cum.push(cum[i - 1] + (Number.isFinite(v) ? v : 0) * resolution);
  }
  return cum;
}

/** resample a per-second array onto M samples proportional to cumulative distance */
export function resampleByDistance(
  values: number[],
  distances: number[],
  targetDistances: number[]
): (number | null)[] {
  if (values.length === 0) return targetDistances.map(() => null);
  const out: (number | null)[] = [];
  const total = distances.length > 0 ? distances[distances.length - 1] : 0;
  for (const d of targetDistances) {
    if (total <= 0) {
      out.push(null);
      continue;
    }
    const frac = Math.max(0, Math.min(1, d / total));
    const idx = Math.max(0, Math.min(values.length - 1, Math.round(frac * (values.length - 1))));
    const v = values[idx];
    out.push(Number.isFinite(v) ? v : null);
  }
  return out;
}

export interface ReplayBuildOptions {
  polyline: string;
  velocity?: StreamInput;
  altitude?: StreamInput;
  power?: StreamInput;
  hr?: StreamInput;
  cadence?: StreamInput;
  /** vertical exaggeration applied to altitude */
  zScale?: number;
  /** max output samples (path decimation for the GPU) */
  maxSamples?: number;
}

export interface ReplayBuildResult {
  points: ReplayPoint[];
  totalTime: number;
  totalDistance: number;
  maxSpeed: number;
  /** projection centroid (see projectPolyline) — aligns external meshes (DEM) */
  lat0: number;
  lng0: number;
  /** altitude base + exaggeration used for z (for DEM mesh alignment) */
  altMin: number;
  zScale: number;
}

/**
 * Build the time-synchronised 3D flight path for a ride.
 * Pure — no DOM/three dependencies; unit-testable.
 */
export function buildReplay(
  opts: ReplayBuildOptions
): ReplayBuildResult {
  const coords = decodePolyline(opts.polyline);
  const { xs, ys, lat0, lng0 } = projectPolyline(coords);
  const polyDist = cumulativePolyline(coords, xs, ys);

  const velocity = opts.velocity?.values ?? [];
  const resid = opts.velocity?.resolution ?? 1;
  const sampleDist = cumulativeFromVelocity(velocity, resid);

  const totalTime = velocity.length > 0 ? velocity.length * resid : 0;
  let totalDistance = sampleDist.length > 0 ? sampleDist[sampleDist.length - 1] : 0;
  if (totalDistance <= 0 && polyDist.length > 0) totalDistance = polyDist[polyDist.length - 1];

  // Represent the ride as distance-stepped samples so velocity/power/hr are
  // one-to-one with the projected polyline positions. Choose ≤ maxSamples
  // samples spread across the cumulative-distance curve.
  const maxSamples = Math.max(2, opts.maxSamples ?? 800);
  const step = Math.max(1, Math.ceil(velocity.length / maxSamples) || 1);
  const indices: number[] = [];
  for (let i = 0; i < velocity.length; i += step) indices.push(i);
  if (indices[indices.length - 1] !== velocity.length - 1) {
    indices.push(velocity.length - 1);
  }

  const altValues = opts.altitude?.values ?? [];
  const powerValues = opts.power?.values ?? [];
  const hrValues = opts.hr?.values ?? [];
  const cadenceValues = opts.cadence?.values ?? [];
  const altByDist = resampleByDistance(altValues, sampleDist, sampleDist);
  const powerByDist = resampleByDistance(powerValues, sampleDist, sampleDist);
  const hrByDist = resampleByDistance(hrValues, sampleDist, sampleDist);
  const cadenceByDist = resampleByDistance(cadenceValues, sampleDist, sampleDist);

  // Altitude min for z-normalisation.
  const alts = altByDist.filter((v): v is number => v != null);
  const altMin = alts.length ? Math.min(...alts) : 0;
  const altSpan = alts.length ? Math.max(...alts) - altMin : 0;
  const extentX = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const zScale =
    opts.zScale ??
    (altSpan > 0 ? Math.min(10, Math.max(2, extentX / (altSpan || 1) * 0.12)) : 1);

  // Map cumulative distance → polyline fraction for (x, y).
  const polylineFracAtDist = (d: number): number => {
    if (polyDist.length === 0) return 0;
    const total = polyDist[polyDist.length - 1];
    if (total <= 0) return 0;
    const target = Math.max(0, Math.min(total, d));
    let lo = 0;
    let hi = polyDist.length - 1;
    for (let guard = 0; guard < 32 && hi - lo > 1; guard++) {
      const mid = (lo + hi) >> 1;
      if (polyDist[mid] <= target) lo = mid;
      else hi = mid;
    }
    const a = polyDist[lo];
    const b = polyDist[hi];
    const denom = b - a || 1;
    return lo / (polyDist.length - 1) + ((target - a) / denom) * (1 / (polyDist.length - 1));
  };

  const points: ReplayPoint[] = indices.map((k, n) => {
    const distance = sampleDist[k] ?? 0;
    const polyFrac = polylineFracAtDist(distance);
    const px = xs.length ? interp(xs, polyFrac) : 0;
    const py = ys.length ? interp(ys, polyFrac) : 0;
    const rawAlt = altByDist[k];
    const z = rawAlt == null ? 0 : (rawAlt - altMin) * zScale;
    const speed = velocity[k] ?? 0;
    // Gradient between consecutive output samples (stride-averaged when decimated).
    let grade: number | null = null;
    if (n > 0) {
      const pk = indices[n - 1];
      const a0 = altByDist[pk];
      const a1 = altByDist[k];
      const dd = (sampleDist[k] ?? 0) - (sampleDist[pk] ?? 0);
      if (a0 != null && a1 != null && dd > 0) grade = ((a1 - a0) / dd) * 100;
    }
    return {
      elapsed: k * resid,
      distance,
      x: px,
      y: py,
      z,
      speed: Number.isFinite(speed) ? speed : 0,
      power: powerByDist[k],
      hr: hrByDist[k],
      cadence: cadenceByDist[k],
      grade,
    };
  });

  let maxSpeed = 0;
  for (const p of points) maxSpeed = Math.max(maxSpeed, p.speed);
  return {
    points,
    totalTime,
    totalDistance,
    maxSpeed,
    lat0,
    lng0,
    altMin,
    zScale,
  };
}

/** Coggan classic power-zone UPPER bounds in watts (last entry Infinity) */
export function powerZoneBounds(ftpWatts: number): number[] {
  return [0.55, 0.75, 0.9, 1.05, 1.2, 1.5].map((f) => f * ftpWatts).concat(Infinity);
}

/** path colour modes for the replay line (Phase D) */
export type ReplayColorMode = 'speed' | 'power' | 'hr' | 'grade';

const METRIC_SLOW: [number, number, number] = [0.231, 0.51, 0.965]; // #3b82f6
const METRIC_FAST: [number, number, number] = [0.937, 0.267, 0.267]; // #ef4444
/** missing samples render as slate gaps, never as false zeros */
const METRIC_GAP: [number, number, number] = [0.392, 0.475, 0.545]; // #64748b

export function replayMetricValue(p: ReplayPoint, mode: ReplayColorMode): number | null {
  switch (mode) {
    case 'speed':
      return p.speed;
    case 'power':
      return p.power;
    case 'hr':
      return p.hr;
    case 'grade':
      return p.grade;
  }
}

/** normalisation max for a mode (grade uses the fixed ±12 % ramp scale) */
export function replayMetricMax(points: ReplayPoint[], mode: ReplayColorMode): number {
  if (mode === 'grade') return 12;
  let m = 0;
  for (const p of points) {
    const v = replayMetricValue(p, mode);
    if (v != null && v > m) m = v;
  }
  return m > 0 ? m : 1;
}

/** blue→red intensity colour for a metric value (grade is coloured by the caller via slopeColor) */
export function replayMetricColor(value: number | null, max: number): [number, number, number] {
  if (value == null) return METRIC_GAP;
  const t = Math.max(0, Math.min(1, value / (max || 1)));
  return [
    METRIC_SLOW[0] + (METRIC_FAST[0] - METRIC_SLOW[0]) * t,
    METRIC_SLOW[1] + (METRIC_FAST[1] - METRIC_SLOW[1]) * t,
    METRIC_SLOW[2] + (METRIC_FAST[2] - METRIC_SLOW[2]) * t,
  ];
}

function interp(values: number[], frac: number): number {
  const n = values.length;
  if (n === 1) return values[0];
  const pos = frac * (n - 1);
  const i0 = Math.max(0, Math.min(n - 2, Math.floor(pos)));
  const i1 = i0 + 1;
  const t = pos - i0;
  return values[i0] + (values[i1] - values[i0]) * t;
}

/** "m:ss" / "h:mm:ss" formatting for the scrubber readout */
export function timeFmt(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}