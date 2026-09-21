// Feature 5 / B-16 — morning-brief verdict engine (deterministic, pure).
//
// Blends recovery + freshness (TSB) + sleep debt into one train-today call.
// Every contributing signal is returned with its reasoning so the UI can
// show its work — the verdict is a coach even when overridden.

export type Verdict = 'green' | 'yellow' | 'red';

export interface VerdictSignal {
  label: string;
  value: string;
  reasoning: string;
  level: Verdict;
}

export interface BriefVerdict {
  verdict: Verdict;
  headline: string;
  signals: VerdictSignal[];
}

export interface VerdictInputs {
  recoveryScore: number | null;
  tsb: number | null;
  sleepDebtHours: number | null;
}

const rank: Record<Verdict, number> = { green: 0, yellow: 1, red: 2 };

export function computeVerdict(inputs: VerdictInputs): BriefVerdict {
  const signals: VerdictSignal[] = [];

  if (inputs.recoveryScore != null) {
    const r = inputs.recoveryScore;
    signals.push({
      label: 'Recovery',
      value: `${r.toFixed(0)}%`,
      reasoning:
        r >= 70 ? 'Well recovered — ready for quality work.'
        : r >= 55 ? 'Moderately recovered — keep intensity in check.'
        : r >= 40 ? 'Low recovery — favour easy aerobic volume.'
        : 'Very low recovery — rest or a walk only.',
      level: r >= 65 ? 'green' : r >= 40 ? 'yellow' : 'red',
    });
  }

  if (inputs.tsb != null) {
    const t = inputs.tsb;
    signals.push({
      label: 'Form (TSB)',
      value: t >= 0 ? `+${t.toFixed(1)}` : t.toFixed(1),
      reasoning:
        t > 10 ? 'Fresh — good day for a hard session or a test.'
        : t >= -10 ? 'Neutral — train as planned.'
        : t > -30 ? 'Carrying fatigue — productive, but avoid maximal efforts.'
        : 'Deep fatigue — endurance is being built; race efforts will feel flat.',
      level: t >= -10 ? 'green' : t > -30 ? 'yellow' : 'red',
    });
  }

  if (inputs.sleepDebtHours != null) {
    const d = inputs.sleepDebtHours;
    signals.push({
      label: 'Sleep debt',
      value: d <= 0 ? 'Caught up' : `-${d.toFixed(1)}h`,
      reasoning:
        d < 2 ? 'Sleep bank is healthy.'
        : d < 5 ? 'Sleep debt is building — protect tonight’s bedtime.'
        : 'High sleep debt — reaction time and RPE will suffer; go easy.',
      level: d < 2 ? 'green' : d < 5 ? 'yellow' : 'red',
    });
  }

  if (signals.length === 0) {
    return {
      verdict: 'yellow',
      headline: 'Not enough data yet — train by feel.',
      signals: [],
    };
  }

  const worst = signals.reduce((a, b) => (rank[b.level] > rank[a.level] ? b : a));
  const headline =
    worst.level === 'green'
      ? 'Green light — train as planned.'
      : worst.level === 'yellow'
        ? `Proceed with care — ${worst.label.toLowerCase()} says hold back.`
        : `Take it easy today — ${worst.label.toLowerCase()} is the limiter.`;

  return { verdict: worst.level, headline, signals };
}

export interface BriefInsight {
  insight_type: string;
  confidence: string;
  sample_size: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any> | null;
}

/**
 * Pick the top insight for this morning: highest confidence wins, with a
 * contextual nudge toward sleep insights when sleep debt is high.
 */
export function pickTopInsight(
  insights: BriefInsight[],
  sleepDebtHours: number | null,
): BriefInsight | null {
  if (insights.length === 0) return null;
  if (sleepDebtHours != null && sleepDebtHours >= 2) {
    const sleep = insights.find((i) => i.insight_type === 'sleep_performance');
    if (sleep && sleep.confidence !== 'collecting') return sleep;
  }
  const rankConf = (c: string) =>
    c === 'high' ? 3 : c === 'medium' ? 2 : c === 'low' ? 1 : 0;
  return [...insights].sort(
    (a, b) => rankConf(b.confidence) - rankConf(a.confidence) || b.sample_size - a.sample_size,
  )[0];
}

/** One-line contextual summary for an insight card on the brief. */
export function insightOneLiner(insight: BriefInsight): string {
  const d = insight.data ?? {};
  switch (insight.insight_type) {
    case 'sleep_performance': {
      const best = (d.bands ?? []).find(
        (b: { avg_np_ftp: number | null }) => b.avg_np_ftp != null,
      );
      return best
        ? `Your best power comes after ${best.band} nights (${best.avg_np_ftp} NP/FTP).`
        : 'Sleep vs power pattern still forming.';
    }
    case 'recovery_cost': {
      const worst = (d.buckets ?? []).sort(
        (a: { avg_recovery_delta: number | null }, b: { avg_recovery_delta: number | null }) =>
          (a.avg_recovery_delta ?? 0) - (b.avg_recovery_delta ?? 0),
      )[0];
      return worst
        ? `${worst.bucket} costs ~${Math.abs(worst.avg_recovery_delta ?? 0).toFixed(0)} recovery points for 2 days.`
        : 'Recovery-cost pattern still forming.';
    }
    case 'power_norms':
      return d.best_band
        ? `Your best power lands in ${d.best_band} conditions.`
        : 'Temperature vs power pattern still forming.';
    case 'tsb_peak':
      return d.peak_band
        ? `You express peak power ${d.peak_band}.`
        : 'Freshness vs power pattern still forming.';
    case 'load_readiness':
      return d.pearson_strength_share_recovery != null
        ? `Strength-share↔recovery correlation r = ${d.pearson_strength_share_recovery}.`
        : 'Load-split pattern still forming.';
    case 'pr_clustering':
      return d.n_prs
        ? `${d.n_prs} PRs mapped against pre-PR recovery markers.`
        : 'No PRs mapped yet.';
    default:
      return '';
  }
}
