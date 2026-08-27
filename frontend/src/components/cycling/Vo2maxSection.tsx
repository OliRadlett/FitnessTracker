'use client';

import React from 'react';
import type { Vo2maxResponse, Vo2maxHistoryResponse, ChartData } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Chart } from '@/components/charts/Chart';
import { SkeletonRow } from '@/components/ui/Skeleton';

interface Vo2maxSectionProps {
  vo2max: Vo2maxResponse | undefined;
  vo2maxHistory: Vo2maxHistoryResponse | undefined;
  chartVo2maxTrend: ChartData | undefined;
  loading?: boolean;
}

export function Vo2maxSection({ vo2max, vo2maxHistory, chartVo2maxTrend, loading }: Vo2maxSectionProps) {
  return (
    <>
      {/* VO2max Card */}
      <Card>
        <CardHeader>
          <CardTitle>🫁 VO2max Estimate</CardTitle>
        </CardHeader>
        {loading ? (
          <SkeletonRow />
        ) : vo2max ? (
          <>
            <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
              <div className="flex items-center gap-4">
                <p className="text-4xl font-bold text-positive">
                  {vo2max.vo2max.toFixed(1)}
                </p>
                <div>
                  <p className="text-sm text-muted">ml/kg/min</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    vo2max.classification === 'Superior' ? 'bg-purple-500/20 text-purple-400'
                    : vo2max.classification === 'Excellent' ? 'bg-blue-500/20 text-blue-400'
                    : vo2max.classification === 'Good' ? 'bg-green-500/20 text-positive'
                    : vo2max.classification === 'Average' ? 'bg-yellow-500/20 text-yellow-400'
                    : vo2max.classification === 'Below Average' ? 'bg-orange-500/20 text-orange-400'
                    : 'bg-red-500/20 text-warning'
                  }`}>
                    {vo2max.classification}
                  </span>
                </div>
              </div>
              <div className="text-sm text-muted">
                <p>Method: <span className="text-white">{vo2max.method}</span></p>
                <p>Confidence: <span className="text-white">{(vo2max.confidence * 100).toFixed(0)}%</span></p>
                {vo2max.all_estimates.length > 1 && (
                  <p className="mt-1 text-xs">
                    {vo2max.all_estimates.length} estimates available — showing most reliable.
                  </p>
                )}
              </div>
            </div>
            {vo2maxHistory && vo2maxHistory.data.length > 1 && (
              <div className="mt-2 text-xs text-muted">
                Trend: {vo2maxHistory.data[0].vo2max.toFixed(1)} → {vo2maxHistory.data[vo2maxHistory.data.length - 1].vo2max.toFixed(1)} ml/kg/min ({new Date(vo2maxHistory.data[0].date).toLocaleDateString()} → {new Date(vo2maxHistory.data[vo2maxHistory.data.length - 1].date).toLocaleDateString()})
              </div>
            )}
          </>
        ) : (
          <div className="py-6 flex flex-col items-center gap-2">
            <p className="text-3xl">🫁</p>
            <p className="text-sm text-muted">VO2max requires per-second power data from Strava streams</p>
            <p className="text-xs text-muted">Fetch streams above, then refresh this page</p>
          </div>
        )}
      </Card>

      {/* VO2max Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle>📈 VO2max Trend</CardTitle>
        </CardHeader>
        {chartVo2maxTrend && chartVo2maxTrend.labels.length > 0 ? (
          <Chart data={chartVo2maxTrend} height={280} />
        ) : (
          <div className="h-40 flex flex-col items-center justify-center gap-2">
            <p className="text-3xl">📈</p>
            <p className="text-sm text-muted">VO2max trend requires multiple months of cycling data with power streams</p>
            <p className="text-xs text-muted">Fetch streams and sync activities to build trend data</p>
          </div>
        )}
      </Card>
    </>
  );
}
