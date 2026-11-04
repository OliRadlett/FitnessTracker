/**
 * The stance composer.
 *
 * The dashboard's largest sentence is a claim about today. It must be built from
 * fields the page can verify, never echoed from the API — the API used to say
 * "Go ahead with today's plan." on a payload whose own `projection` engine
 * reported `reason: "no active plan"`.
 *
 * Everything here is pure and testable: given a day's numbers, produce a stance
 * word, one sentence, and the chips that back it. No React, no fetching.
 */

import type { DailyLoadPoint, EngineConsensus, TodayVerdict } from '@/lib/api';

export type Stance = 'train' | 'easy' | 'rest';

export const STANCE_LABEL: Record<Stance, string> = {
  train: 'Train',
  easy: 'Easy',
  rest: 'Rest',
};

export interface DayContext {
  date: string;
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  hrvMs: number | null;
  /**
   * Only the readiness payload carries a composite score, and only for the day
   * it was computed for. A day with no score must render "not scored", never 0%.
   */
  recoveryScore: number | null;
  isScored: boolean;
}

export interface StanceReading {
  stance: Stance;
  /** The sentence under the stance word. Composed from fields, never a fixed string. */
  reason: string;
  /** Short chips that let the reader check the sentence. */
  basis: string[];
}

export interface StanceInput {
  verdict: TodayVerdict | null | undefined;
  context: DayContext;
}

function signed(n: number, digits = 1): string {
  // U+2212 minus, not a hyphen: it aligns with digits in tabular numerals.
  return `${n >= 0 ? '+' : '\u2212'}${Math.abs(n).toFixed(digits)}`;
}

/**
 * The numbers that belong to the day being looked at.
 *
 * The load series is the source of truth for ctl/atl/tsb; `today.current_*` is
 * only a convenience for the real current day. Reading the latter for a pinned
 * date is the bug this function exists to prevent: three different days would
 * produce one verdict.
 */
export function readDayContext({
  date,
  load,
  hrvPoints,
  readiness,
}: {
  date: string;
  load: DailyLoadPoint[] | undefined;
  hrvPoints: { date: string; hrv: number | null }[] | undefined;
  readiness: { date: string; recovery_score?: number | null; hrv_ms?: number | null } | undefined;
}): DayContext {
  const point = load?.find((p) => p.date === date) ?? null;
  const hrvFromSeries = hrvPoints?.find((p) => p.date === date)?.hrv ?? null;
  const isScored = readiness?.date === date;
  return {
    date,
    ctl: point?.ctl ?? null,
    atl: point?.atl ?? null,
    tsb: point?.tsb ?? null,
    hrvMs: hrvFromSeries ?? (isScored ? (readiness?.hrv_ms ?? null) : null),
    recoveryScore: isScored ? (readiness?.recovery_score ?? null) : null,
    isScored,
  };
}

/**
 * Compose the stance.
 *
 * Deliberately conservative: a handful of rules over numbers the page already
 * shows, in a fixed order. No model, no score, no aggregation across engines —
 * the engines are *reported* next to this, not averaged into it.
 */
export function readStance({ verdict, context }: StanceInput): StanceReading {
  const tsb = context.tsb;
  const recovery = context.recoveryScore;
  const engines = verdict?.consensus ?? [];
  const contributing = engines.filter((e) => e.available).length;
  const silent = engines.length - contributing;

  const basis: string[] = [];
  if (tsb !== null) basis.push(`form ${signed(tsb)}`);
  if (recovery !== null) basis.push(`recovery ${Math.round(recovery)}%`);
  if (context.hrvMs !== null) basis.push(`HRV ${Math.round(context.hrvMs)} ms`);

  // No load data at all: say so rather than guess. A confident sentence built on
  // nothing is worse than an honest "unknown".
  if (tsb === null) {
    return {
      stance: 'train',
      reason: 'No training-load data for this day, so there is nothing to base a call on.',
      basis,
    };
  }

  let stance: Stance;
  let reason: string;

  if (verdict?.should_rest) {
    stance = 'rest';
    reason =
      verdict.reasons.length > 0
        ? `A rest signal fired: ${verdict.reasons[0]}.`
        : 'A rest signal fired.';
  } else if (tsb < -20) {
    stance = 'easy';
    reason = `Form is ${signed(tsb)} — deep enough that hard work costs more than it gives.`;
  } else if (tsb > 15) {
    stance = 'train';
    reason = `Form is ${signed(tsb)}${
      recovery !== null ? ` with ${Math.round(recovery)}% recovery` : ''
    } — there is room to load.`;
  } else {
    stance = 'train';
    reason = `Form is ${signed(tsb)}${
      recovery !== null ? ` and recovery is ${Math.round(recovery)}%` : ''
    } — a normal training day.`;
  }

  if (silent > 0) {
    reason += ` ${contributing} of ${engines.length} engines contributed; ${silent} ${
      silent === 1 ? 'is' : 'are'
    } silent.`;
  }

  return { stance, reason, basis };
}

/** True when the sentence makes a claim the page's own data contradicts. */
export function stanceMentionsAPlan(reading: StanceReading): boolean {
  return /today's plan|go ahead/i.test(reading.reason);
}

export type EngineState = 'contributing' | 'silent' | 'broken';

export interface EngineView {
  key: string;
  label: string;
  state: EngineState;
  /** Human sentence. Never a raw exception string — that is `detail` at most. */
  detail: string;
  /** The original text, for a tooltip. Never rendered as copy. */
  raw?: string;
}

const ENGINE_LABELS: Record<string, string> = {
  rest_day_suggestion: 'Rest-day',
  adaptive: 'Adaptive plan',
  deficiency: 'Weakness',
  cross_domain: 'Cross-domain',
  projection: 'Plan projection',
  session_mix: 'Session mix',
};

/**
 * A raw Python exception is not product copy.
 *
 * It is still information — the engine is broken and the athlete should see
 * that — so it becomes a `broken` row with a human sentence, and the exception
 * itself only appears in a tooltip.
 */
export function humaniseReason(reason: string | null | undefined): string {
  if (!reason) return 'said nothing';
  if (/Error|Exception|Traceback/.test(reason)) return 'engine failed — reported, not hidden';
  if (/no analysis yet/i.test(reason)) return 'no weekly run yet';
  if (/no active plan/i.test(reason)) return 'no plan running';
  if (/no classified sessions/i.test(reason)) return 'no labelled sessions';
  if (/not computed/i.test(reason)) return 'input missing';
  if (/no cross-domain/i.test(reason)) return 'no weekly run yet';
  return reason;
}

export function readEngines(verdict: TodayVerdict | null | undefined): EngineView[] {
  const engines: EngineConsensus[] = verdict?.consensus ?? [];
  return engines.map((e) => {
    const label = ENGINE_LABELS[e.engine] ?? e.engine;
    if (e.available) {
      const detail =
        e.note ??
        (e.stance
          ? `${e.stance}${e.confidence ? ` \u00b7 ${e.confidence} confidence` : ''}`
          : 'contributed');
      return { key: e.engine, label, state: 'contributing', detail };
    }
    const looksBroken = !!e.reason && /Error|Exception|Traceback/.test(e.reason);
    return {
      key: e.engine,
      label,
      state: looksBroken ? 'broken' : 'silent',
      detail: humaniseReason(e.reason),
      ...(looksBroken && e.reason ? { raw: e.reason } : {}),
    };
  });
}

/** Counts for the "n of m" line, derived rather than re-counted in JSX. */
export function engineTally(views: EngineView[]): {
  contributing: number;
  silent: number;
  broken: number;
  total: number;
} {
  return {
    contributing: views.filter((v) => v.state === 'contributing').length,
    silent: views.filter((v) => v.state === 'silent').length,
    broken: views.filter((v) => v.state === 'broken').length,
    total: views.length,
  };
}
