'use client';

import type { RespiratoryRateResponse } from '@/lib/api/types';

interface RespiratoryRateCardProps {
  data: RespiratoryRateResponse;
}

export function RespiratoryRateCard({ data }: RespiratoryRateCardProps) {
  const trendColor = data.trend === 'elevated' ? 'text-warning' : data.trend === 'low' ? 'text-blue-400' : 'text-positive';
  const trendArrow = data.trend === 'elevated' ? '↑' : data.trend === 'low' ? '↓' : '→';

  return (
    <div className="bg-surface rounded-xl border border-surface-light/50 p-4">
      <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">🫁 Resp. Rate</p>
      <div className="flex items-baseline gap-2">
        <p className={`text-2xl font-bold ${trendColor} leading-none`}>
          {data.current_rr?.toFixed(1) ?? '—'}
        </p>
        <span className={`text-lg ${trendColor}`}>{trendArrow}</span>
      </div>
      <p className="text-xs text-muted mt-1.5">
        {data.baseline_avg_rr
          ? `Baseline: ${data.baseline_avg_rr.toFixed(1)} bpm`
          : 'Collecting baseline...'}
      </p>
      {data.trend === 'elevated' && (
        <p className="text-xs text-warning mt-1">⚠️ Above normal range</p>
      )}
    </div>
  );
}
