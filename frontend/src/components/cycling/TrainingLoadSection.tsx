'use client';

import React from 'react';
import type { ChartData, TrainingLoadResponse } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Chart } from '@/components/charts/Chart';

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
      {isLoading ? (
        <div className="h-80 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-accent"></div>
        </div>
      ) : chartTrainingLoad ? (
        <Chart data={chartTrainingLoad} height={320} />
      ) : (
        <div className="h-80 flex items-center justify-center text-muted">
          No training load data available. Set your FTP and sync activities.
        </div>
      )}
    </Card>
  );
}
