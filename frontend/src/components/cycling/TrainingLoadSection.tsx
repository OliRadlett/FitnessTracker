'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ChartData, TrainingLoadResponse } from '@/lib/api';
import { useAuthFetch } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ChartBody } from '@/components/charts/Chart';

interface TrainingLoadSectionProps {
  trainingLoad: TrainingLoadResponse | undefined;
  chartTrainingLoad: ChartData | undefined;
  isLoading: boolean;
  loadDays: number;
  setLoadDays: (days: number) => void;
}

export function TrainingLoadSection({
  trainingLoad,
  chartTrainingLoad,
  isLoading,
  loadDays,
  setLoadDays,
}: TrainingLoadSectionProps) {
  const { authFetch, token } = useAuthFetch();

  const { data: rampRateChart, isLoading: rampLoading } = useQuery<ChartData>({
    queryKey: ['chart-ramp-rate', 16],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/ramp_rate?weeks=16'),
    staleTime: 300_000,
    enabled: !!token,
  });

  const { data: loadBalanceChart, isLoading: loadBalanceLoading } = useQuery<ChartData>({
    queryKey: ['chart-training-load-balance', 16],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/training_load_balance?weeks=16'),
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
      />

      {trainingLoad && (
        <>
          <h4 className="text-sm font-medium text-muted mt-6 mb-2">Ramp Rate — Weekly CTL Change</h4>
          <ChartBody
            isLoading={rampLoading}
            data={rampRateChart}
            emptyMessage="No ramp rate data available yet"
            height={240}
          />

          <h4 className="text-sm font-medium text-muted mt-6 mb-2">Load Balance — TSS vs Lifting vs Strain</h4>
          <ChartBody
            isLoading={loadBalanceLoading}
            data={loadBalanceChart}
            emptyMessage="No load balance data available yet"
            height={240}
          />
        </>
      )}
    </Card>
  );
}
