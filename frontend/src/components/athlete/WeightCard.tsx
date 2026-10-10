'use client';

/**
 * Phase 1 (plans/ui-redesign-v2.md §1) — `WeightCard`.
 *
 * The single home for body-weight display (manual + Withings sources):
 * identical props in every slot (cycling + health — guardrail §1.3).
 * Read-only display — logging stays in the existing `WeightPanel`.
 * Data-maximalism: latest + rolling average + source + recent history all
 * render; composition fields show when the backend sent them.
 */

import React from 'react';
import type { WeightHistoryResponse } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { SkeletonMetric } from '@/components/ui/Skeleton';
import { formatDateDMY, formatWeight } from '@/lib/utils';

export interface WeightCardProps {
  history?: WeightHistoryResponse | null;
  isLoading?: boolean;
  isError?: boolean;
  /** How many recent entries to list. Defaults to 5. */
  recentCount?: number;
}

export function WeightCard({ history, isLoading, isError, recentCount = 5 }: WeightCardProps) {
  if (isLoading) {
    return (
      <Card>
        <div role="status" aria-label="Loading body weight">
          <SkeletonMetric />
        </div>
      </Card>
    );
  }

  const entries = history?.entries ?? [];
  const latest = entries.length > 0 ? entries[entries.length - 1] : null;
  const rollingAvg = history?.rolling_avg ?? [];
  const latestAvg = rollingAvg.length > 0 ? rollingAvg[rollingAvg.length - 1] : null;
  const recent = entries.slice(-recentCount).reverse();

  if (isError || !latest) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Body weight</CardTitle>
        </CardHeader>
        <p className="text-sm text-muted">
          {isError
            ? 'Weight data failed to load.'
            : 'No weigh-ins yet — log one to start your trend.'}
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Body weight</CardTitle>
      </CardHeader>
      <div className="flex items-baseline gap-3">
        <p className="text-2xl font-bold tabular-nums text-foreground">
          {formatWeight(latest.weight_kg)}
        </p>
        <p className="text-xs text-muted">
          via {latest.source} · {formatDateDMY(latest.date)}
        </p>
      </div>
      {latestAvg && (
        <p className="mt-1 text-xs tabular-nums text-muted">
          7-day avg {formatWeight(latestAvg.weight_kg)}
        </p>
      )}
      {latest.body_fat_percent != null && (
        <p className="mt-1 text-xs tabular-nums text-muted">
          Body fat {latest.body_fat_percent.toFixed(1)}%
          {latest.muscle_mass_kg != null ? ` · Muscle ${formatWeight(latest.muscle_mass_kg)}` : ''}
        </p>
      )}
      {recent.length > 1 && (
        <ul className="mt-3 space-y-1 border-t border-surface-light/50 pt-2" aria-label="Recent weigh-ins">
          {recent.map((e) => (
            <li key={e.id} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-muted">{formatDateDMY(e.date)}</span>
              <span className="font-mono tabular-nums text-foreground">
                {formatWeight(e.weight_kg)}
              </span>
              <span className="shrink-0 text-muted">via {e.source}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
