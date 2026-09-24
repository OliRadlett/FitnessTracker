/**
 * Highlight detection for the Relive auto-tour (Phase 4).
 *
 * Segments a ride into the moments worth watching — climbs, descents, the best
 * sustained sprint, and the fastest kilometre — from the replay path alone.
 * Gains/drops are derived from the (real) grade × distance so no vertical
 * exaggeration leaks in. Pure — no three/DOM — unit-tested.
 */

import type { ReplayPoint } from './replay';

export type HighlightKind = 'climb' | 'descent' | 'sprint' | 'fastest';

export interface Highlight {
  kind: HighlightKind;
  startElapsed: number;
  endElapsed: number;
  startKm: number;
  endKm: number;
  label: string;
  detail: string;
  /** bigger = more important (gain, drop, watts or km/h) */
  score: number;
}

export interface HighlightOptions {
  maxClimbs?: number;
  maxDescents?: number;
  minClimbGainM?: number;
  minClimbDistM?: number;
  minDescentDropM?: number;
  minDescentDistM?: number;
  /** sprint averaging window, seconds */
  sprintSeconds?: number;
  /** fastest-window distance, metres */
  fastestWindowM?: number;
}

const km = (m: number) => m / 1000;

interface Run {
  startIdx: number;
  endIdx: number;
  gain: number;
}

/**
 * Find contiguous stretches where `grade` stays on one side of the threshold
 * (with hysteresis) for at least `minDistM`, accumulating signed gain in metres.
 */
function findRuns(
  points: ReplayPoint[],
  sign: 1 | -1,
  minDistM: number,
  minGainM: number,
): Run[] {
  const on = 2.5 * sign;
  const off = 0.5 * sign;
  const runs: Run[] = [];
  let start = -1;
  let gain = 0;
  for (let i = 1; i < points.length; i++) {
    const g = (points[i].grade ?? 0) * sign; // positive = with the run direction
    const dd = points[i].distance - points[i - 1].distance;
    if (start < 0) {
      if (g >= on) {
        start = i - 1;
        gain = (g / 100) * dd;
      }
      continue;
    }
    gain += (g / 100) * dd;
    if (g < off) {
      const dist = points[i - 1].distance - points[start].distance;
      if (dist >= minDistM && gain >= minGainM) runs.push({ startIdx: start, endIdx: i - 1, gain });
      start = -1;
      gain = 0;
    }
  }
  if (start >= 0) {
    const dist = points[points.length - 1].distance - points[start].distance;
    if (dist >= minDistM && gain >= minGainM) runs.push({ startIdx: start, endIdx: points.length - 1, gain });
  }
  return runs;
}

/** average grade % over [a,b] using signed gain and distance */
function avgGrade(points: ReplayPoint[], a: number, b: number, gain: number): number {
  const dist = points[b].distance - points[a].distance;
  return dist > 0 ? (gain / dist) * 100 : 0;
}

/** best rolling time window by average power (null when no power data) */
function bestSprint(points: ReplayPoint[], windowS: number): { a: number; b: number; avg: number } | null {
  const hasPower = points.some((p) => p.power != null);
  if (!hasPower) return null;
  const prefix: number[] = [0];
  for (const p of points) prefix.push(prefix[prefix.length - 1] + (p.power ?? 0));
  let best: { a: number; b: number; avg: number } | null = null;
  let lo = 0;
  for (let hi = 0; hi < points.length; hi++) {
    while (points[hi].elapsed - points[lo].elapsed > windowS) lo++;
    const n = hi - lo + 1;
    if (n < 3) continue;
    const avg = (prefix[hi + 1] - prefix[lo]) / n;
    if (!best || avg > best.avg) best = { a: lo, b: hi, avg };
  }
  return best;
}

/** fastest window of `windowM` metres by elapsed time */
function bestFastest(points: ReplayPoint[], windowM: number): { a: number; b: number; kmh: number } | null {
  if (points.length < 2) return null;
  let best: { a: number; b: number; kmh: number } | null = null;
  let lo = 0;
  for (let hi = 0; hi < points.length; hi++) {
    while (points[hi].distance - points[lo].distance > windowM && lo < hi) lo++;
    const span = points[hi].distance - points[lo].distance;
    const dt = points[hi].elapsed - points[lo].elapsed;
    if (span < windowM * 0.9 || dt <= 0) continue;
    const kmh = (span / dt) * 3.6;
    if (!best || kmh > best.kmh) best = { a: lo, b: hi, kmh };
  }
  return best;
}

const clampIdx = (points: ReplayPoint[], i: number) => Math.max(0, Math.min(points.length - 1, i));

/** Detect highlights, sorted by start time (climbs/descents + sprint/fastest). */
export function detectHighlights(points: ReplayPoint[], opts: HighlightOptions = {}): Highlight[] {
  if (points.length < 2) return [];
  const maxClimbs = opts.maxClimbs ?? 4;
  const maxDescents = opts.maxDescents ?? 2;
  const out: Highlight[] = [];

  const climbs = findRuns(points, 1, opts.minClimbDistM ?? 400, opts.minClimbGainM ?? 30)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, maxClimbs);
  for (const r of climbs) {
    const a = clampIdx(points, r.startIdx);
    const b = clampIdx(points, r.endIdx);
    out.push({
      kind: 'climb',
      startElapsed: points[a].elapsed,
      endElapsed: points[b].elapsed,
      startKm: km(points[a].distance),
      endKm: km(points[b].distance),
      label: `Climb · ${km(points[a].distance).toFixed(1)}–${km(points[b].distance).toFixed(1)} km`,
      detail: `${Math.round(r.gain)} m at ${avgGrade(points, a, b, r.gain).toFixed(1)}%`,
      score: r.gain,
    });
  }

  const descents = findRuns(points, -1, opts.minDescentDistM ?? 400, opts.minDescentDropM ?? 40)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, maxDescents);
  for (const r of descents) {
    const a = clampIdx(points, r.startIdx);
    const b = clampIdx(points, r.endIdx);
    out.push({
      kind: 'descent',
      startElapsed: points[a].elapsed,
      endElapsed: points[b].elapsed,
      startKm: km(points[a].distance),
      endKm: km(points[b].distance),
      label: `Descent · ${km(points[a].distance).toFixed(1)}–${km(points[b].distance).toFixed(1)} km`,
      detail: `${Math.round(r.gain)} m at ${avgGrade(points, a, b, r.gain).toFixed(1)}%`,
      score: r.gain,
    });
  }

  const windowS = opts.sprintSeconds ?? 20;
  const sprint = bestSprint(points, windowS);
  if (sprint) {
    const a = clampIdx(points, sprint.a);
    const b = clampIdx(points, sprint.b);
    out.push({
      kind: 'sprint',
      startElapsed: points[a].elapsed,
      endElapsed: points[b].elapsed,
      startKm: km(points[a].distance),
      endKm: km(points[b].distance),
      label: `Best ${windowS}s power`,
      detail: `${Math.round(sprint.avg)} W`,
      score: sprint.avg,
    });
  }

  const fastest = bestFastest(points, opts.fastestWindowM ?? 1000);
  if (fastest) {
    const a = clampIdx(points, fastest.a);
    const b = clampIdx(points, fastest.b);
    out.push({
      kind: 'fastest',
      startElapsed: points[a].elapsed,
      endElapsed: points[b].elapsed,
      startKm: km(points[a].distance),
      endKm: km(points[b].distance),
      label: 'Fastest km',
      detail: `${fastest.kmh.toFixed(1)} km/h`,
      score: fastest.kmh,
    });
  }

  return out.sort((x, y) => x.startElapsed - y.startElapsed);
}

/** The highlight covering `elapsed`, if any (climbs/descents win over sprint/fastest). */
export function highlightAt(highlights: Highlight[], elapsed: number): Highlight | null {
  let best: Highlight | null = null;
  for (const h of highlights) {
    if (elapsed < h.startElapsed || elapsed > h.endElapsed) continue;
    if (!best) best = h;
    else if (best.kind === 'sprint' || best.kind === 'fastest') best = h;
  }
  return best;
}
