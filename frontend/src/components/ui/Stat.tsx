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
  /**
   * Honest-empty override (ui-redesign-v2 §4 moment 4): shown — muted, 12px+
   * floor — when `value` is null/undefined/''/'—'. Defaults to "No data yet".
   * Backward compatible: no caller edits needed.
   */
  emptyText?: React.ReactNode;
}

/** Presentational only: 0 is real data; missing or a bare '—' placeholder is not. */
function isEmptyValue(value: React.ReactNode): boolean {
  return value === undefined || value === null || value === '' || value === '—';
}

/**
 * Single metric-stat pattern (label + tabular value + unit + delta).
 * Content-only — wrap in `Card` or a grid cell at the call site.
 */
export function Stat({ label, value, unit, delta, deltaTone = 'neutral', hint, emptyText }: StatProps) {
  const empty = isEmptyValue(value);
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted mb-1 truncate">{label}</p>
      <p className="text-2xl font-bold text-foreground tabular-nums leading-none">
        {empty ? (
          <span className="text-sm font-medium text-muted">{emptyText ?? 'No data yet'}</span>
        ) : (
          value
        )}
        {!empty && unit ? <span className="text-sm font-medium text-muted ml-1">{unit}</span> : null}
      </p>
      {delta ? (
        <p className={`text-xs mt-1 tabular-nums ${DELTA_CLASSES[deltaTone]}`}>{delta}</p>
      ) : hint ? (
        <p className="text-xs text-muted mt-1">{hint}</p>
      ) : null}
    </div>
  );
}
