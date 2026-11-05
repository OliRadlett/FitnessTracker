/**
 * Chart scale helpers — the geometry decisions the shared `Chart` renderer
 * cannot make for us.
 *
 * The production `Chart` delegates its y-domain to Recharts, which derives it
 * from the data: a flat 212 W FTP line on a 0–260 axis, or a 42.6 VO₂max on a
 * 0–60 axis, is a straight line at the top of an empty box. These helpers fix
 * the domain to something readable — 1/2/5 steps, anchored at zero only when
 * zero is meaningful — and keep ticks on round numbers.
 *
 * Pure functions, no React: unit-tested in chartScale.test.ts.
 */

export interface Pt {
  x: number;
  y: number | null;
}

export interface Series {
  name: string;
  color: string;
  points: Pt[];
  dashed?: boolean;
  width?: number;
}

/** 1, 2 or 5 × 10^n — so axis ticks read as round numbers. */
export function niceStep(rough: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(rough) || 1)));
  const norm = Math.abs(rough) / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return mult * mag;
}

/**
 * Fitted domain: pad 8%, round outward to a readable 1/2/5 step.
 *
 * `zero: true` means zero is meaningful for this axis (a load chart, a count):
 * anchor to it and never pad below it, so the plot does not spend a quarter of
 * its height on negative TSS.
 */
export function fitDomain(
  values: number[],
  opts: { zero?: boolean; pad?: number } = {},
): readonly [number, number] {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) return [0, 1] as const;
  const pad = opts.pad ?? 0.08;
  let lo = Math.min(...clean);
  let hi = Math.max(...clean);
  const span = hi - lo || Math.abs(hi) || 1;
  if (opts.zero) {
    lo = 0;
  } else {
    lo -= span * pad;
  }
  hi += span * pad;
  const step = niceStep((hi - lo) / 4);
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step] as const;
}

/** Evenly spaced ticks on `step` boundaries, always including zero when in range. */
export function axisTicks([lo, hi]: readonly [number, number], count = 4): number[] {
  const span = hi - lo || 1;
  const step = niceStep(span / count);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 0.001; v += step) {
    out.push(Math.abs(v) < step * 0.001 ? 0 : v);
  }
  return out;
}

/**
 * Which x labels to draw: every `every`-th index, plus the last one — because an
 * axis that does not name its own end makes a series look like it stops early.
 * An interior tick that would collide with the end tick yields.
 */
export function visibleTicks(
  count: number,
  every: number,
  gapPx: (a: number, b: number) => number,
  minGap = 60,
): number[] {
  const last = count - 1;
  const ticks: number[] = [];
  for (let i = 0; i < count; i += every) if (i !== last) ticks.push(i);
  // The end tick always wins: drop interior ticks that would collide with it.
  while (ticks.length && Math.abs(gapPx(last, ticks[ticks.length - 1])) < minGap) ticks.pop();
  ticks.push(last);
  return ticks;
}

/** Round to 2dp for SVG coordinates — keeps the DOM small and diffs stable. */
export const round = (v: number) => Math.round(v * 100) / 100;
