'use client';

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getWeightHistory, useAuthFetch } from '@/lib/api';
import type { ChartData, WeightEntry } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ChartBody } from '@/components/charts/Chart';
import { dots } from '@/lib/lifting/standards';
import { TrendingUp } from 'lucide-react';

/**
 * Join Big-3 total history with bodyweight history into a Dots timeline.
 * Bodyweight is step-carried: each total date uses the latest weigh-in on or
 * before it. Dates with no prior weigh-in are gaps (no backfill guessing).
 * Pure — unit-tested in `src/__tests__/dots-progression.test.ts`.
 */
export function joinDotsProgression(
  labels: string[],
  totals: (number | null)[],
  entries: WeightEntry[],
): { labels: string[]; data: (number | null)[] } {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const outLabels: string[] = [];
  const outData: (number | null)[] = [];
  for (let i = 0; i < labels.length; i++) {
    const total = totals[i];
    if (total == null) continue;
    let bw: number | null = null;
    for (const e of sorted) {
      if (e.date <= labels[i]) bw = e.weight_kg;
      else break;
    }
    if (bw == null) continue;
    const score = dots(total, bw);
    if (score == null) continue;
    outLabels.push(labels[i]);
    outData.push(Math.round(score * 10) / 10);
  }
  return { labels: outLabels, data: outData };
}

/**
 * Dots-over-time on the PRs tab: Big-3 total series joined to weigh-ins.
 * Male formula only (stated on the scorecard). Returns null when there is no
 * total history yet — the scorecard already covers that empty state.
 */
export function DotsProgressionCard({
  totalChart,
  isLoading,
}: {
  totalChart?: ChartData;
  isLoading?: boolean;
}) {
  const { authFetch, token } = useAuthFetch();
  const { data: weightHistory } = useQuery({
    queryKey: ['weight-history', 365],
    queryFn: () => getWeightHistory(authFetch, 365),
    enabled: !!token,
    staleTime: 300_000,
  });

  const { chart, insight } = useMemo(() => {
    const totalSeries = totalChart?.series.find((s) => s.name === 'Total');
    if (!totalChart || !totalSeries || !weightHistory) {
      return { chart: undefined, insight: null as string | null };
    }
    const { labels, data } = joinDotsProgression(
      totalChart.labels,
      totalSeries.data,
      weightHistory.entries,
    );
    if (labels.length === 0) return { chart: undefined, insight: null };
    const first = data[0] as number;
    const last = data[data.length - 1] as number;
    const delta = last - first;
    return {
      chart: {
        chart_type: 'line' as const,
        title: 'Dots Progression',
        labels,
        series: [{ name: 'Dots', data }],
        x_label: 'Date',
        y_label: 'Dots',
      } satisfies ChartData,
      insight:
        data.length >= 2
          ? `${last.toFixed(1)} Dots (${delta >= 0 ? '+' : ''}${delta.toFixed(1)} across the window)`
          : null,
    };
  }, [totalChart, weightHistory]);

  if (!totalChart || (totalChart.labels ?? []).length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4" aria-hidden />
            Dots Progression
          </span>
        </CardTitle>
      </CardHeader>
      <ChartBody
        isLoading={!!isLoading}
        data={chart}
        emptyMessage="Log weigh-ins to see Dots over time"
        height={260}
      />
      {insight && <p className="text-[11px] text-muted mt-1">--- {insight}</p>}
    </Card>
  );
}
