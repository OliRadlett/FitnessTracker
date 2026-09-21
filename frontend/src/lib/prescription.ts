// Feature 6 / B-17 — deterministic prescriptions (pure functions).
//
// Three coaching surfaces, all explainable: next-session suggestion (from the
// Brief verdict), strength autoregulation (RPE → load adjustment), and
// what-if timelines (linear extrapolation of the MetricTrend slope).

import type { BriefVerdict } from './brief';

export interface SessionSuggestion {
  title: string;
  detail: string;
  reasons: string[];
}

export interface SuggestionContext {
  verdict: BriefVerdict;
  sleepDebtHours: number | null;
  windy: boolean;
  hot: boolean;
  plannedSport: string | null;
  plannedTss: number | null;
}

export function nextSessionSuggestion(ctx: SuggestionContext): SessionSuggestion {
  const reasons = ctx.verdict.signals.map((s) => `${s.label} ${s.value} — ${s.reasoning}`);
  const v = ctx.verdict.verdict;

  if (v === 'red') {
    return {
      title: 'Rest or very easy spin today',
      detail:
        'Skip quality work. If you must move, 30–45 min easy' +
        (ctx.windy ? ' indoors (windy out)' : '') +
        '.',
      reasons,
    };
  }

  let detail = '';
  if (ctx.plannedSport === 'rest' || ctx.plannedSport == null) {
    detail = 'No hard session planned — 60–90 min Z2 keeps the aerobic engine ticking.';
  } else if (ctx.plannedSport === 'strength') {
    detail = 'Lift as planned, then cap it: stop accessories if bar speed drops.';
  } else {
    detail = `Ride as planned${ctx.plannedTss ? ` (~${ctx.plannedTss} TSS)` : ''}.`;
  }
  if (ctx.windy) detail += ' Windy — pick a flat/sheltered route, or ride indoors.';
  if (ctx.hot) detail += ' Hot — start hydrated, bring extra bottles.';
  if (ctx.sleepDebtHours != null && ctx.sleepDebtHours >= 2) {
    const cut = Math.min(25, Math.round(ctx.sleepDebtHours * 5));
    detail += ` Cut volume ~${cut}% on the sleep debt.`;
  }
  if (v === 'yellow') detail += ' Keep one gear in reserve — no maximal efforts.';

  return {
    title: v === 'green' ? 'Train as planned' : 'Train, but trim the edges',
    detail,
    reasons,
  };
}

export interface ExerciseState {
  name: string;
  lastWeightKg: number | null;
  lastReps: number | null;
  lastRpe: number | null;
}

export interface Autoregulation {
  name: string;
  suggestedWeightKg: number | null;
  deltaKg: number;
  reason: string;
}

/** RPE ≤7 → +2.5kg, RPE ≥9 → −2.5kg, else hold. Null-safe (no data → hold). */
export function autoregulate(ex: ExerciseState): Autoregulation {
  if (ex.lastWeightKg == null || ex.lastRpe == null) {
    return {
      name: ex.name,
      suggestedWeightKg: ex.lastWeightKg,
      deltaKg: 0,
      reason: 'No recent RPE — hold last weight.',
    };
  }
  if (ex.lastRpe <= 7) {
    return {
      name: ex.name,
      suggestedWeightKg: Math.round((ex.lastWeightKg + 2.5) * 2) / 2,
      deltaKg: 2.5,
      reason: `Last felt easy (RPE ${ex.lastRpe}) — add 2.5 kg.`,
    };
  }
  if (ex.lastRpe >= 9) {
    return {
      name: ex.name,
      suggestedWeightKg: Math.max(0, Math.round((ex.lastWeightKg - 2.5) * 2) / 2),
      deltaKg: -2.5,
      reason: `Last was a grinder (RPE ${ex.lastRpe}) — drop 2.5 kg.`,
    };
  }
  return {
    name: ex.name,
    suggestedWeightKg: ex.lastWeightKg,
    deltaKg: 0,
    reason: `Last RPE ${ex.lastRpe} was on target — hold.`,
  };
}

/**
 * Weeks to reach `target` from `current` at `slopePerWeek`, or null when the
 * trend points the wrong way or is flat. Direction-aware for decrease goals
 * (weight) as well as increase goals (FTP/1RM/VO2max).
 */
export function whatIfWeeks(
  current: number,
  target: number,
  slopePerWeek: number,
): number | null {
  const gap = target - current;
  if (Math.abs(gap) < 1e-9) return 0;
  if (Math.abs(slopePerWeek) < 1e-9) return null;
  if (Math.sign(gap) !== Math.sign(slopePerWeek)) return null;
  return gap / slopePerWeek;
}
