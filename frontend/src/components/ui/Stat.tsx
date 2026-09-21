'use client';

import React from 'react';

export type StatDeltaTone = 'positive' | 'negative' | 'neutral' | 'info' | 'caution';

const DELTA_CLASSES: Record<StatDeltaTone, string> = {
  positive: 'text-positive',
  negative: 'text-warning',
  neutral: 'text-muted',
  info: 'text-info',
  caution: 'text-caution',
};

interface StatProps {
  label: string;
  value: React.ReactNode;
  unit?: string;
  /** Short delta line, e.g. "+5% vs last week". */
  delta?: React.ReactNode;
  deltaTone?: StatDeltaTone;
  hint?: string;
}

/**
 * Single metric-stat pattern (label + tabular value + unit + delta).
 * Content-only — wrap in `Card` or a grid cell at the call site.
 */
export function Stat({ label, value, unit, delta, deltaTone = 'neutral', hint }: StatProps) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted mb-1 truncate">{label}</p>
      <p className="text-2xl font-bold text-foreground tabular-nums leading-none">
        {value}
        {unit ? <span className="text-sm font-medium text-muted ml-1">{unit}</span> : null}
      </p>
      {delta ? (
        <p className={`text-xs mt-1 tabular-nums ${DELTA_CLASSES[deltaTone]}`}>{delta}</p>
      ) : hint ? (
        <p className="text-xs text-muted mt-1">{hint}</p>
      ) : null}
    </div>
  );
}
