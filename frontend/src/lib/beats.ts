/**
 * Narrative beats for the Relive auto-tour (next-level Phase B).
 *
 * Highlights (`lib/highlights.ts`) find *where* the route gets interesting;
 * beats find *what the rider did* — the attack that stuck, the comeback after
 * a lull, the closing push. All detectors average over measured (non-null)
 * power samples only, so dropout gaps neither dilute efforts nor invent them.
 * Pure — no three/DOM — unit-tested.
 */

import type { ReplayPoint } from './replay';

export type BeatKind = 'attack' | 'finale' | 'comeback';

export interface Beat {
  kind: BeatKind;
  startElapsed: number;
  endElapsed: number;
  startKm: number;
  endKm: number;
  label: string;
  detail: string;
  /** bigger = more dramatic (surge ratio, closing margin, comeback depth) */
  score: number;
}

export interface BeatOptions {
  ftpWatts?: number | null;
  maxAttacks?: number;
  maxComebacks?: number;
  /** surge window cap, seconds */
  attackWindowS?: number;
  /** baseline lookback before a surge, seconds */
  attackBaselineS?: number;
  /** surge avg must clear this multiple of baseline */
  attackRatio?: number;
}

const km = (m: number) => m / 1000;

/** prefix sums + measured-sample counts over power (nulls contribute 0/0) */
function measuredPrefix(points: ReplayPoint[]): { sum: number[]; cnt: number[] } {
  const sum: number[] = [0];
  const cnt: number[] = [0];
  for (const p of points) {
    sum.push(sum[sum.length - 1] + (p.power ?? 0));
    cnt.push(cnt[cnt.length - 1] + (p.power != null ? 1 : 0));
  }
  return { sum, cnt };
}

/** average over [lo, hi] (inclusive) or null when fewer than `minN` measured */
function windowAvg(
  sum: number[],
  cnt: number[],
  lo: number,
  hi: number,
  minN: number
): number | null {
  const m = cnt[hi + 1] - cnt[lo];
  if (m < minN) return null;
  return (sum[hi + 1] - sum[lo]) / m;
}

/** first index with elapsed >= target (points are elapsed-sorted) */
function lowerBound(points: ReplayPoint[], target: number, from = 0): number {
  let lo = from;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].elapsed < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface Attack {
  a: number;
  b: number;
  ratio: number;
  avg: number;
}

/**
 * Short surges (≤45 s) at ≥1.6× the trailing 5-minute baseline, clearing an
 * absolute floor (1.2× FTP, or 250 W without one) so café-cruise wiggles in a
 * soft ride don't qualify. Greedy top-N by ratio, non-overlapping.
 */
function findAttacks(points: ReplayPoint[], o: Required<Pick<BeatOptions, 'maxAttacks' | 'attackWindowS' | 'attackBaselineS' | 'attackRatio'>> & { ftpWatts?: number | null }): Attack[] {
  const { sum, cnt } = measuredPrefix(points);
  const floorW = o.ftpWatts ? o.ftpWatts * 1.2 : 250;
  const cands: Attack[] = [];
  let lo = 0;
  let blo = 0; // baseline window start — only ever advances (amortised O(n))
  for (let hi = 0; hi < points.length; hi++) {
    while (points[hi].elapsed - points[lo].elapsed > o.attackWindowS) lo++;
    if (points[hi].elapsed - points[lo].elapsed < 15) continue;
    const avg = windowAvg(sum, cnt, lo, hi, 5);
    if (avg == null || avg < floorW) continue;
    while (blo < lo && points[lo].elapsed - points[blo].elapsed > o.attackBaselineS) blo++;
    const bspan = points[lo].elapsed - points[blo].elapsed;
    if (bspan < 60) continue;
    const base = windowAvg(sum, cnt, blo, Math.max(blo, lo - 1), 10);
    if (base == null || base <= 0) continue;
    const ratio = avg / base;
    if (ratio >= o.attackRatio) cands.push({ a: lo, b: hi, ratio, avg });
  }
  cands.sort((x, y) => y.ratio - x.ratio);
  const picked: Attack[] = [];
  for (const c of cands) {
    if (picked.length >= o.maxAttacks) break;
    if (picked.some((p) => !(c.b < p.a || c.a > p.b))) continue;
    picked.push(c);
  }
  return picked;
}

/** The closing push: final ~5% (clamped 2–5 min) at ≥110% of ride average. */
function findFinale(
  points: ReplayPoint[],
  rideAvg: number | null
): { a: number; b: number; ratio: number; avg: number } | null {
  if (rideAvg == null || rideAvg <= 0 || points.length < 2) return null;
  const total = points[points.length - 1].elapsed - points[0].elapsed;
  if (total < 300) return null;
  const wlen = Math.max(120, Math.min(300, total * 0.05));
  const lo = lowerBound(points, points[points.length - 1].elapsed - wlen);
  const { sum, cnt } = measuredPrefix(points);
  const avg = windowAvg(sum, cnt, lo, points.length - 1, 10);
  if (avg == null) return null;
  const ratio = avg / rideAvg;
  if (ratio < 1.1) return null;
  return { a: lo, b: points.length - 1, ratio, avg };
}

interface Comeback {
  a: number;
  b: number;
  depth: number;
  recAvg: number;
}

/**
 * A lull (≥2 min under 55% of ride average) followed by recovery (≥1 min back
 * above 90%). Capped at 2, strongest first, non-overlapping.
 */
function findComebacks(
  points: ReplayPoint[],
  rideAvg: number | null,
  maxComebacks: number
): Comeback[] {
  if (rideAvg == null || rideAvg <= 0) return [];
  const { sum, cnt } = measuredPrefix(points);
  const out: Comeback[] = [];
  let lo = 0;
  while (lo < points.length - 1) {
    const hi = Math.min(points.length - 1, lowerBound(points, points[lo].elapsed + 120, lo + 1));
    if (hi <= lo + 1) break;
    const lull = windowAvg(sum, cnt, lo, hi, 20);
    if (lull == null || lull >= rideAvg * 0.55) {
      lo++;
      continue;
    }
    const rend = Math.min(points.length - 1, lowerBound(points, points[hi].elapsed + 180, hi + 1));
    if (points[rend].elapsed - points[hi].elapsed < 45) {
      lo++;
      continue;
    }
    const rec = windowAvg(sum, cnt, hi, rend, 10);
    if (rec != null && rec >= rideAvg * 0.9) {
      out.push({ a: lo, b: rend, depth: 1 - lull / rideAvg, recAvg: rec });
      lo = rend + 1;
    } else {
      lo++;
    }
  }
  out.sort((x, y) => y.depth - x.depth);
  const picked: Comeback[] = [];
  for (const c of out) {
    if (picked.length >= maxComebacks) break;
    if (picked.some((p) => !(c.b < p.a || c.a > p.b))) continue;
    picked.push(c);
  }
  return picked;
}

/** Detect narrative beats, sorted by start time. Empty without power data. */
export function detectBeats(points: ReplayPoint[], opts: BeatOptions = {}): Beat[] {
  if (points.length < 2 || !points.some((p) => p.power != null)) return [];
  const o = {
    maxAttacks: opts.maxAttacks ?? 3,
    maxComebacks: opts.maxComebacks ?? 2,
    attackWindowS: opts.attackWindowS ?? 45,
    attackBaselineS: opts.attackBaselineS ?? 300,
    attackRatio: opts.attackRatio ?? 1.6,
    ftpWatts: opts.ftpWatts ?? null,
  };
  const out: Beat[] = [];
  for (const a of findAttacks(points, o)) {
    const dur = Math.round(points[a.b].elapsed - points[a.a].elapsed);
    out.push({
      kind: 'attack',
      startElapsed: points[a.a].elapsed,
      endElapsed: points[a.b].elapsed,
      startKm: km(points[a.a].distance),
      endKm: km(points[a.b].distance),
      label: `Attack · ${km(points[a.a].distance).toFixed(1)} km`,
      detail: `${Math.round(a.avg)} W for ${dur}s (${a.ratio.toFixed(1)}× baseline)`,
      score: a.ratio,
    });
  }
  const { sum, cnt } = measuredPrefix(points);
  const rideAvg = windowAvg(sum, cnt, 0, points.length - 1, 10);
  const finale = findFinale(points, rideAvg);
  if (finale) {
    const pct = Math.round((finale.ratio - 1) * 100);
    out.push({
      kind: 'finale',
      startElapsed: points[finale.a].elapsed,
      endElapsed: points[finale.b].elapsed,
      startKm: km(points[finale.a].distance),
      endKm: km(points[finale.b].distance),
      label: 'Final push',
      detail: `+${pct}% over ride average`,
      score: finale.ratio,
    });
  }
  for (const c of findComebacks(points, rideAvg, o.maxComebacks)) {
    out.push({
      kind: 'comeback',
      startElapsed: points[c.a].elapsed,
      endElapsed: points[c.b].elapsed,
      startKm: km(points[c.a].distance),
      endKm: km(points[c.b].distance),
      label: 'Comeback',
      detail: `back to ${Math.round(c.recAvg)} W after the lull`,
      score: 1 + c.depth,
    });
  }
  return out.sort((x, y) => x.startElapsed - y.startElapsed);
}

/** The most dramatic beat covering `elapsed`, if any. */
export function beatAt(beats: Beat[], elapsed: number): Beat | null {
  let best: Beat | null = null;
  for (const b of beats) {
    if (elapsed < b.startElapsed || elapsed > b.endElapsed) continue;
    if (!best || b.score > best.score || (b.score === best.score && b.startElapsed < best.startElapsed)) {
      best = b;
    }
  }
  return best;
}
