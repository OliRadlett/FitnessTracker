'use client';

import React from 'react';
import { Card } from '@/components/ui/Card';
import type { MetricTrend, MetricBenchmark } from '@/lib/api';

interface MetricCardProps {
  label: string;
  value: string | number | undefined | null;
  color: string;
  unit?: string;
  icon?: string;
  subtitle?: string;
  subtext?: string;
  tooltip?: string;
  trend?: MetricTrend | 'up' | 'down' | 'stable' | null;
  benchmark?: MetricBenchmark | null;
}

function TrendIndicator({ trend }: { trend?: MetricTrend | 'up' | 'down' | 'stable' | null }) {
  if (!trend) return null;

  // Simple string trend (dashboard style)
  if (typeof trend === 'string') {
    if (trend === 'stable') return <span className="text-muted">→</span>;
    if (trend === 'up') return <span className="text-positive">↑</span>;
    return <span className="text-warning">↓</span>;
  }

  // Complex MetricTrend (cycling style)
  if (trend.direction === 'stable') return null;
  const arrow = trend.direction === 'up' ? '↑' : '↓';
  const color = trend.direction === 'up' ? 'text-positive' : 'text-warning';
  const label = trend.baseline_value != null ? `vs ${trend.baseline_value}` : 'vs 4wk avg';

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
    'trained': 'bg-green-500/20 text-positive',
    'competitive': 'bg-yellow-500/20 text-yellow-400',
    'elite': 'bg-purple-500/20 text-purple-400',
    'detraining': 'bg-red-500/20 text-warning',
    'maintaining': 'bg-blue-500/20 text-blue-400',
    'building': 'bg-green-500/20 text-positive',
    'high': 'bg-yellow-500/20 text-yellow-400',
    'excellent': 'bg-purple-500/20 text-purple-400',
    'good': 'bg-green-500/20 text-positive',
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
  color,
  unit,
  icon,
  subtitle,
  subtext,
  tooltip,
  trend,
  benchmark,
}: MetricCardProps) {
  const displayText = subtitle || subtext;

  return (
    <Card className="group relative">
      <div className="flex items-center gap-1 mb-1">
        {icon && <span className="text-base">{icon}</span>}
        <p className="text-sm text-muted">{label}</p>
        {tooltip && (
          <span className="text-muted/50 text-xs cursor-help" title={tooltip}>ⓘ</span>
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
      {displayText && <p className="text-xs text-muted mt-1">{displayText}</p>}
      {tooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-800 text-xs text-slate-200 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-normal w-56 z-50 border border-surface-light/50">
          {tooltip}
        </div>
      )}
    </Card>
  );
}
