import React from 'react';
import { Card } from '@/components/ui/Card';
import type { MetricTrend, MetricBenchmark } from '@/lib/api';
import { formatDuration } from '@/lib/utils';

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

function BenchmarkBadge({ benchmark }: { benchmark?: MetricBenchmark | null }) {
  if (!benchmark) return null;

  const colorMap: Record<string, string> = {
    'untrained': 'bg-gray-500/20 text-gray-400',
    'recreational': 'bg-blue-500/20 text-blue-400',
    'trained': 'bg-green-500/20 text-green-400',
    'competitive': 'bg-yellow-500/20 text-yellow-400',
    'elite': 'bg-purple-500/20 text-purple-400',
    'detraining': 'bg-red-500/20 text-red-400',
    'maintaining': 'bg-blue-500/20 text-blue-400',
    'building': 'bg-green-500/20 text-green-400',
    'high': 'bg-yellow-500/20 text-yellow-400',
    'excellent': 'bg-purple-500/20 text-purple-400',
    'good': 'bg-green-500/20 text-green-400',
    'moderate': 'bg-yellow-500/20 text-yellow-400',
    'variable': 'bg-orange-500/20 text-orange-400',
  };

  const badgeColor = colorMap[benchmark.raw_label] || 'bg-surface-light text-muted';

  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badgeColor}`}
      title={`${benchmark.label} (${benchmark.range})`}
    >
      {benchmark.label}
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
  benchmark,
}: {
  label: string;
  value: string | number | undefined | null;
  unit?: string;
  color: string;
  subtext?: string;
  tooltip?: string;
  trend?: MetricTrend | null;
  benchmark?: MetricBenchmark | null;
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
        <BenchmarkBadge benchmark={benchmark} />
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
