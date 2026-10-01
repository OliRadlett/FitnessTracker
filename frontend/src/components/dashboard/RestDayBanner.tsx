'use client';

import React from 'react';
import type { RestDaySuggestion, TodayVerdict } from '@/lib/api';
import { formatTSB } from '@/lib/utils';
import { DomainIcon } from '@/components/ui/DomainIcon';

interface RestDayBannerProps {
  suggestion: RestDaySuggestion;
  /** Optional one-tap adaptive action row (QW3) — rendered below the reasons.
   *  WeeklyTab passes nothing, so its banner is unchanged. */
  action?: React.ReactNode;
  /** Sleep debt in hours owed (>=0). When set and >=2 while should_rest is
   *  false, the banner downgrades to a cautious yellow state so Dashboard
   *  matches Today's Brief verdict (0.1 unification; interim until
   *  GET /dashboard/coach-call exists). */
  sleepDebtHours?: number | null;
}

/** Engine label → what it means, so a vote is legible without a lookup. */
const ENGINE_LABELS: Record<string, string> = {
  rest_day_suggestion: 'Load & recovery',
  tsb: 'Form (TSB)',
  adaptive: 'Adaptive plan',
  deficiency: 'Weakness scan',
  cross_domain: 'Sleep & cross-sport',
  projection: 'Week ahead',
};

const STANCE_LABELS: Record<string, string> = {
  train: 'train',
  cut: 'cut back',
  rest: 'rest',
  add: 'add load',
};

const STANCE_STYLES: Record<string, string> = {
  train: 'text-positive',
  cut: 'text-amber-400',
  rest: 'text-warning',
  add: 'text-blue-400',
};

/**
 * The consensus table: every engine that had a say, and every one that did not.
 *
 * Rendering the unavailable rows is the point. Cross-domain analysis runs
 * weekly, so for most users it has never run; before this it reached `/today`
 * only by *not* raising a 404, which meant its absence was indistinguishable
 * from unanimity. Showing "not run yet" tells the reader the verdict is
 * partial, which it is.
 */
function VerdictConsensus({ verdict }: { verdict: TodayVerdict }) {
  if (verdict.consensus.length === 0) return null;
  return (
    <details className="mt-3 group">
      <summary className="cursor-pointer text-xs text-muted hover:text-foreground min-h-[44px] flex items-center">
        Why — {verdict.consensus.filter((c) => c.available).length} of{' '}
        {verdict.consensus.length} signals
      </summary>
      <ul className="mt-1.5 space-y-1">
        {verdict.consensus.map((row) => (
          <li
            key={row.engine}
            className="text-xs flex items-start justify-between gap-3"
          >
            <span className="text-muted">
              {ENGINE_LABELS[row.engine] ?? row.engine}
            </span>
            {row.available && row.stance ? (
              <span className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`font-medium ${STANCE_STYLES[row.stance] ?? 'text-muted'}`}
                >
                  {STANCE_LABELS[row.stance] ?? row.stance}
                </span>
                {row.confidence && row.confidence !== 'low' && (
                  <span className="text-muted">{row.confidence}</span>
                )}
              </span>
            ) : (
              <span className="text-muted italic shrink-0">
                {row.reason ?? 'no signal'}
              </span>
            )}
          </li>
        ))}
      </ul>
      {verdict.consensus.some((c) => c.available && c.note) && (
        <ul className="mt-1.5 space-y-0.5">
          {verdict.consensus
            .filter((c) => c.available && c.note)
            .map((c) => (
              <li key={`${c.engine}-note`} className="text-xs text-muted">
                {ENGINE_LABELS[c.engine] ?? c.engine}: {c.note}
              </li>
            ))}
        </ul>
      )}
    </details>
  );
}

/** The forward look — planned CTL/ATL/TSB for the days that have a plan. */
function ProjectedLoadStrip({
  points,
}: {
  points: TodayVerdict['projected_load'];
}) {
  if (points.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs text-muted uppercase tracking-wider mb-1">
        Week ahead
      </p>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {points.map((p) => (
          <li
            key={p.date}
            className="shrink-0 text-[10px] text-center border border-surface-light/50 rounded px-2 py-1"
          >
            <span className="block text-muted">
              {new Date(p.date).toLocaleDateString(undefined, {
                weekday: 'short',
                day: 'numeric',
              })}
            </span>
            <span
              className={`block font-mono font-bold ${
                (p.tsb ?? 0) < -20
                  ? 'text-warning'
                  : (p.tsb ?? 0) > 10
                    ? 'text-positive'
                    : 'text-foreground'
              }`}
            >
              {p.tsb == null ? '—' : Math.round(p.tsb)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RestDayBanner({
  suggestion,
  action,
  sleepDebtHours,
  verdict,
}: RestDayBannerProps & { verdict?: TodayVerdict | null }) {
  const isWarning = verdict ? verdict.should_rest : suggestion.should_rest;
  const hasSleepDebt = (sleepDebtHours ?? 0) >= 2;
  const isCaution = !isWarning && hasSleepDebt;
  // The server's headline when there is one: it knows about four engines this
  // component does not, so preferring the local title would throw that away.
  const title =
    verdict?.headline ??
    (isWarning
      ? 'Consider a rest day today'
      : isCaution
        ? 'Proceed with care — sleep debt says hold back.'
        : 'Training readiness looks good');
  const reasons = verdict?.reasons ?? suggestion.reasons;
  return (
    <div className={`rounded-xl p-4 flex items-start gap-3 border ${
      isWarning || isCaution
        ? 'bg-amber-900/30 border-amber-500/30'
        : 'bg-surface border-surface-light/50'
    }`}>
      <span className="leading-none"><DomainIcon domain="readiness" className={`w-6 h-6 ${isWarning || isCaution ? 'text-amber-300' : 'text-green-300'}`} /></span>
      <div className="flex-1">
        <p className={`font-medium ${isWarning || isCaution ? 'text-amber-200' : 'text-green-300'}`}>
          {title}
        </p>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <p className="text-muted uppercase tracking-wider">TSB (Form)</p>
            <p className={`font-mono font-bold ${
              (suggestion.current_tsb ?? 0) < -30 ? 'text-warning'
              : (suggestion.current_tsb ?? 0) < -10 ? 'text-amber-400'
              : (suggestion.current_tsb ?? 0) > 10 ? 'text-positive'
              : 'text-blue-400'
            }`}>
              {formatTSB(suggestion.current_tsb)}
            </p>
          </div>
          <div>
            <p className="text-muted uppercase tracking-wider">Recovery</p>
            <p className={`font-mono font-bold ${
              (suggestion.latest_recovery ?? 0) >= 70 ? 'text-positive'
              : (suggestion.latest_recovery ?? 0) >= 50 ? 'text-amber-400'
              : 'text-warning'
            }`}>
              {suggestion.latest_recovery?.toFixed(0) ?? '—'}%
            </p>
          </div>
          <div>
            <p className="text-muted uppercase tracking-wider">Consecutive Days</p>
            <p className={`font-mono font-bold ${
              suggestion.consecutive_training_days >= 7 ? 'text-warning'
              : suggestion.consecutive_training_days >= 4 ? 'text-amber-400'
              : 'text-positive'
            }`}>
              {suggestion.consecutive_training_days}
            </p>
          </div>
        </div>
        {isCaution && reasons.length === 0 && (
          <ul className="mt-2 space-y-0.5">
            <li className="text-sm text-amber-300/80">• Sleep debt is building — protect tonight&apos;s bedtime.</li>
          </ul>
        )}
        {reasons.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {reasons.map((reason, i) => (
              <li key={i} className={`text-sm ${isWarning || isCaution ? 'text-amber-300/80' : 'text-muted'}`}>• {reason}</li>
            ))}
          </ul>
        )}
        {verdict ? <VerdictConsensus verdict={verdict} /> : null}
        {verdict ? (
          <ProjectedLoadStrip points={verdict.projected_load} />
        ) : null}
        {action}
      </div>
    </div>
  );
}
