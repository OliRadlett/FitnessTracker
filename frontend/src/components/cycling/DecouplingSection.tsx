'use client';

import React from 'react';
import type { DecouplingHistoryResponse, ChartData } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Chart } from '@/components/charts/Chart';

interface DecouplingSectionProps {
  decoupling: DecouplingHistoryResponse | undefined;
  chartDecouplingTrend: ChartData | undefined;
}

export function DecouplingSection({ decoupling, chartDecouplingTrend }: DecouplingSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>🫀 Decoupling Trend (HR vs Power)</CardTitle>
      </CardHeader>
      {decoupling && decoupling.data.length > 0 ? (
        <>
          <div className="mb-3 flex items-center gap-4 text-sm">
            <span className="text-muted">Average decoupling:</span>
            <span className={`font-bold ${
              (decoupling.avg_decoupling_pct ?? 0) < 5 ? 'text-green-400'
              : (decoupling.avg_decoupling_pct ?? 0) < 8 ? 'text-yellow-400'
              : 'text-red-400'
            }`}>
              {decoupling.avg_decoupling_pct?.toFixed(1)}%
            </span>
            {decoupling.classification && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                decoupling.classification === 'Excellent' ? 'bg-green-500/20 text-green-400'
                : decoupling.classification === 'Acceptable' ? 'bg-yellow-500/20 text-yellow-400'
                : 'bg-red-500/20 text-red-400'
              }`}>
                {decoupling.classification}
              </span>
            )}
            <span className="text-xs text-muted">
              ({decoupling.data.length} rides {'>'}60 min)
            </span>
          </div>
          {chartDecouplingTrend ? (
            <Chart data={chartDecouplingTrend} height={280} />
          ) : (
            <div className="h-40 flex items-center justify-center text-muted text-sm">
              No decoupling chart data available
            </div>
          )}
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500"></span> {'<'}5% Excellent
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-yellow-500"></span> 5-8% Acceptable
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500"></span> {'>'}8% Aerobic Deficiency
            </div>
          </div>
        </>
      ) : (
        <div className="h-40 flex flex-col items-center justify-center gap-2">
          <p className="text-3xl">🫀</p>
          <p className="text-sm text-muted">Requires rides {'>'}60 min with both power and HR stream data</p>
          <p className="text-xs text-muted">Fetch streams above to enable decoupling analysis</p>
        </div>
      )}
    </Card>
  );
}
