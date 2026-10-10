'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ChartData, TrainingLoadResponse } from '@/lib/api';
import { useAuthFetch } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ChartBody } from '@/components/charts/Chart';
import { timeRangeWeeks, useTimeRange } from '@/lib/time-range';

interface TrainingLoadSectionProps {
  trainingLoad: TrainingLoadResponse | undefined;
  chartTrainingLoad: ChartData | undefined;
  isLoading: boolean;
  loadDays: number;
  setLoadDays: (days: number) => void;
  /** Degraded state: `true` for a plain badge, string for badge detail. */
  stale?: boolean | string;
}

export function TrainingLoadSection({
  trainingLoad,
  chartTrainingLoad,
  isLoading,
  loadDays,
  setLoadDays,
  stale,
}: TrainingLoadSectionProps) {
  const { authFetch, token } = useAuthFetch();

  /* ── Shared REVIEW time-range (ui-redesign-v2 §2.1): one picker drives every
     cycling chart together. Week spans are clamped to the backend `?weeks=`
     cap (≤52) inside timeRangeWeeks. Display only — no computation changes
     (docs/algorithms.md authoritative). ─────────────────────────────────── */
  const { start: rangeStart, end: rangeEnd } = useTimeRange();
  const chartWeeks = timeRangeWeeks(rangeStart, rangeEnd);

  const { data: rampRateChart, isLoading: rampLoading } = useQuery<ChartData>({
    queryKey: ['chart-ramp-rate', chartWeeks],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/ramp_rate?weeks=${chartWeeks}`),
    staleTime: 300_000,
    enabled: !!token,
  });

  const { data: loadBalanceChart, isLoading: loadBalanceLoading } = useQuery<ChartData>({
    queryKey: ['chart-training-load-balance', chartWeeks],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/training_load_balance?weeks=${chartWeeks}`),
    staleTime: 300_000,
    enabled: !!token,
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between w-full">
          <CardTitle>Training Load — CTL / ATL / TSB</CardTitle>
          <div className="flex gap-2">
            {[30, 60, 90, 180].map((d) => (
              <button
                key={d}
                onClick={() => setLoadDays(d)}
                className={`px-2 py-1 text-xs rounded border transition-colors ${
                  loadDays === d
                    ? 'bg-accent/20 text-accent border-accent/30'
                    : 'text-muted border-surface-light hover:border-accent/30'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <ChartBody
        isLoading={isLoading}
        data={chartTrainingLoad}
        emptyMessage="No training load data available. Set your FTP and sync activities."
        height={320}
        stale={stale}
      />

      {trainingLoad && (
        <>
          <h4 className="text-sm font-medium text-muted mt-6 mb-2">Ramp Rate — Weekly CTL Change</h4>
          <ChartBody
            isLoading={rampLoading}
            data={rampRateChart}
            emptyMessage="No ramp rate data available yet"
            height={240}
            stale={stale}
          />

          <h4 className="text-sm font-medium text-muted mt-6 mb-2">Load Balance — TSS vs Lifting vs Strain</h4>
          <ChartBody
            isLoading={loadBalanceLoading}
            data={loadBalanceChart}
            emptyMessage="No load balance data available yet"
            height={240}
            stale={stale}
          />
        </>
      )}
    </Card>
  );
}
