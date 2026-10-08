'use client';

import React, { useMemo } from 'react';
import { getActiveLocale } from '@/lib/utils';
import type { PersonalRecord } from '@/lib/api';

export interface RepRangeBest {
  label: string;
  minReps: number;
  maxReps: number | null;
  best: PersonalRecord | null;
}

export interface BestByRepRangeStripProps {
  records?: PersonalRecord[];
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const BUCKETS: Array<{ label: string; minReps: number; maxReps: number | null }> = [
  { label: '1RM', minReps: 1, maxReps: 1 },
  { label: '2–3', minReps: 2, maxReps: 3 },
  { label: '4–6', minReps: 4, maxReps: 6 },
  { label: '7–12', minReps: 7, maxReps: 12 },
  { label: '12+', minReps: 13, maxReps: null },
];

function strengthOf(pr: PersonalRecord): number {
  return pr.estimated_1rm ?? pr.weight_kg;
}

/**
 * Best-by-rep-range strip for the PRs tab (t4 enhancement batch).
 *
 * Pure presentational over existing `PersonalRecord` types: buckets PRs by
 * rep range and shows the strongest (by estimated 1RM, falling back to
 * weight) in each. Loading / error / empty states match the page's existing
 * PR section conventions (`role="status"` / `role="alert"`).
 */
export function BestByRepRangeStrip({ records, isLoading, error, onRetry }: BestByRepRangeStripProps) {
  const bests: RepRangeBest[] = useMemo(() => {
    return BUCKETS.map((b) => {
      let best: PersonalRecord | null = null;
      for (const pr of records ?? []) {
        if (pr.reps < b.minReps) continue;
        if (b.maxReps != null && pr.reps > b.maxReps) continue;
        if (!best || strengthOf(pr) > strengthOf(best)) best = pr;
      }
      return { ...b, best };
    });
  }, [records]);

  if (isLoading) {
    return (
      <div
        className="flex gap-2 overflow-hidden py-1"
        role="status"
        aria-label="Loading best lifts by rep range"
      >
        {BUCKETS.map((b) => (
          <div
            key={b.label}
            className="h-[76px] w-32 shrink-0 animate-pulse rounded-lg bg-surface-light/50 motion-reduce:animate-none"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3" role="alert">
        <p className="text-sm text-muted flex-1">Couldn’t load rep-range bests: {error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-[44px] px-3 text-sm font-medium text-foreground hover:text-accent transition-colors motion-reduce:transition-none"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  if (!records || records.length === 0) {
    return (
      <div className="rounded-lg border border-surface-light/30 px-4 py-5 text-center" role="status">
        <p className="text-sm text-muted">No PRs yet — log a session and your best by rep range will appear here.</p>
      </div>
    );
  }

  return (
    <div
      className="flex gap-2 overflow-x-auto py-1"
      role="group"
      aria-label="Best lifts by rep range"
    >
      {bests.map(({ label, best }) => (
        <div
          key={label}
          className="w-32 shrink-0 rounded-lg border border-surface-light/30 bg-surface-light/20 px-3 py-2.5 text-center"
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
          {best ? (
            <>
              <p className="mt-1 text-base font-bold text-foreground tabular-nums">
                {best.weight_kg} kg
              </p>
              <p className="text-xs text-muted truncate" title={best.exercise_name}>
                {best.exercise_name} × {best.reps}
              </p>
              <p className="text-[11px] text-muted">
                {new Date(best.achieved_date).toLocaleDateString(getActiveLocale(), {
                  month: 'short',
                  day: 'numeric',
                })}
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-muted py-2">—</p>
          )}
        </div>
      ))}
    </div>
  );
}
