'use client';

import React from 'react';
import type { RestDaySuggestion } from '@/lib/api';
import { formatTSB } from '@/lib/utils';

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

export function RestDayBanner({ suggestion, action, sleepDebtHours }: RestDayBannerProps) {
  const isWarning = suggestion.should_rest;
  const hasSleepDebt = (sleepDebtHours ?? 0) >= 2;
  const isCaution = !isWarning && hasSleepDebt;
  const title = isWarning
    ? 'Consider a rest day today'
    : isCaution
      ? 'Proceed with care — sleep debt says hold back.'
      : 'Training readiness looks good';
  return (
    <div className={`rounded-xl p-4 flex items-start gap-3 border ${
      isWarning || isCaution
        ? 'bg-amber-900/30 border-amber-500/30'
        : 'bg-surface border-surface-light/50'
    }`}>
      <span className="text-2xl">{isWarning || isCaution ? '💡' : '✅'}</span>
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
        {isCaution && suggestion.reasons.length === 0 && (
          <ul className="mt-2 space-y-0.5">
            <li className="text-sm text-amber-300/80">• Sleep debt is building — protect tonight&apos;s bedtime.</li>
          </ul>
        )}
        {suggestion.reasons.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {suggestion.reasons.map((reason, i) => (
              <li key={i} className={`text-sm ${isWarning || isCaution ? 'text-amber-300/80' : 'text-muted'}`}>• {reason}</li>
            ))}
          </ul>
        )}
        {action}
      </div>
    </div>
  );
}
