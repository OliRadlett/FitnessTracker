'use client';

import React from 'react';
import type { RestDaySuggestion } from '@/lib/api';

interface RestDayBannerProps {
  suggestion: RestDaySuggestion;
}

export function RestDayBanner({ suggestion }: RestDayBannerProps) {
  const isWarning = suggestion.should_rest;
  return (
    <div className={`rounded-xl p-4 flex items-start gap-3 border ${
      isWarning
        ? 'bg-amber-900/30 border-amber-500/30'
        : 'bg-surface border-surface-light/50'
    }`}>
      <span className="text-2xl">{isWarning ? '💡' : '✅'}</span>
      <div className="flex-1">
        <p className={`font-medium ${isWarning ? 'text-amber-200' : 'text-green-300'}`}>
          {isWarning ? 'Consider a rest day today' : 'Training readiness looks good'}
        </p>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <p className="text-muted uppercase tracking-wider">TSB (Form)</p>
            <p className={`font-mono font-bold ${
              (suggestion.current_tsb ?? 0) < -30 ? 'text-red-400'
              : (suggestion.current_tsb ?? 0) < -10 ? 'text-amber-400'
              : (suggestion.current_tsb ?? 0) > 10 ? 'text-green-400'
              : 'text-blue-400'
            }`}>
              {suggestion.current_tsb?.toFixed(0) ?? '—'}
            </p>
          </div>
          <div>
            <p className="text-muted uppercase tracking-wider">Recovery</p>
            <p className={`font-mono font-bold ${
              (suggestion.latest_recovery ?? 0) >= 70 ? 'text-green-400'
              : (suggestion.latest_recovery ?? 0) >= 50 ? 'text-amber-400'
              : 'text-red-400'
            }`}>
              {suggestion.latest_recovery?.toFixed(0) ?? '—'}%
            </p>
          </div>
          <div>
            <p className="text-muted uppercase tracking-wider">Consecutive Days</p>
            <p className={`font-mono font-bold ${
              suggestion.consecutive_training_days >= 7 ? 'text-red-400'
              : suggestion.consecutive_training_days >= 4 ? 'text-amber-400'
              : 'text-green-400'
            }`}>
              {suggestion.consecutive_training_days}
            </p>
          </div>
        </div>
        {suggestion.reasons.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {suggestion.reasons.map((reason, i) => (
              <li key={i} className={`text-sm ${isWarning ? 'text-amber-300/80' : 'text-muted'}`}>• {reason}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
