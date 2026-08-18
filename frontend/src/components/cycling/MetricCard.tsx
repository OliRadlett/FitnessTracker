import React from 'react';
import { Card } from '@/components/ui/Card';
import type { MetricTrend } from '@/lib/api';

function TrendIndicator({ trend }: { trend?: MetricTrend | null }) {
  if (!trend || trend.direction === 'stable') return null;

  const arrow = trend.direction === 'up' ? '↑' : '↓';
  const color = trend.direction === 'up' ? 'text-positive' : 'text-warning';
  const label = trend.baseline_value != null
    ? `vs ${trend.baseline_value}`
    : 'vs 4wk avg';

  return (
    <span
      className={`text-xs ${color} flex items-center gap-0.5`}
      title={trend.baseline_value != null ? `4wk avg: ${trend.baseline_value}` : undefined}
    >
      {arrow}
      <span className="text-muted/50 text-[10px]">{label}</span>
    </span>
  );
}

export function MetricCard({
  label,
  value,
  unit,
  color,
  subtext,
  tooltip,
  trend,
}: {
  label: string;
  value: string | number | undefined | null;
  unit?: string;
  color: string;
  subtext?: string;
  tooltip?: string;
  trend?: MetricTrend | null;
}) {
  return (
    <Card className="group relative">
      <div className="flex items-center gap-1">
        <p className="text-sm text-muted mb-1">{label}</p>
        {tooltip && (
          <span className="text-muted/50 text-xs cursor-help mb-1" title={tooltip}>ⓘ</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <p className={`text-2xl font-bold ${color}`}>
          {value !== undefined && value !== null ? value : '—'}
          {unit && <span className="text-sm font-normal text-muted ml-1">{unit}</span>}
        </p>
        <TrendIndicator trend={trend} />
      </div>
      {subtext && <p className="text-xs text-muted mt-1">{subtext}</p>}
      {tooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-800 text-xs text-slate-200 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-normal w-56 z-50 border border-surface-light/50">
          {tooltip}
        </div>
      )}
    </Card>
  );
}

export function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}
