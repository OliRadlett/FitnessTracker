'use client';

import React from 'react';
import type { RideAnalysis, ChartData } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Chart } from '@/components/charts/Chart';

interface RideAnalysisCardProps {
  analysis: RideAnalysis;
}

const ZONE_COLORS: Record<string, string> = {
  Z1: '#6b7280', // grey
  Z2: '#3b82f6', // blue
  Z3: '#22c55e', // green
  Z4: '#eab308', // yellow
  Z5: '#f97316', // orange
  Z6: '#ef4444', // red
  Z7: '#a855f7', // purple
};

function decouplingColor(pct: number): string {
  if (pct < 3) return 'text-positive';
  if (pct < 5) return 'text-warning';
  return 'text-red-400';
}

function StatBadge({ label, value, className = '' }: { label: string; value: string | number | undefined; className?: string }) {
  if (value == null) return null;
  return (
    <div className="bg-surface-light/30 rounded-lg px-4 py-3 text-center">
      <p className="text-xs text-muted uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-semibold text-white mt-1 ${className}`}>{value}</p>
    </div>
  );
}

export function RideAnalysisCard({ analysis }: RideAnalysisCardProps) {
  // Power Zones — bar chart with zone colors
  const zoneChartData: ChartData = {
    chart_type: 'bar',
    title: 'Power Zones',
    labels: analysis.power_zones.map((z) => z.zone_label || z.zone_name),
    y_label: 'Time (s)',
    series: [
      {
        name: 'Time',
        data: analysis.power_zones.map((z) => z.seconds),
      },
    ],
  };

  // Power Distribution — histogram bar chart
  const distChartData: ChartData = {
    chart_type: 'bar',
    title: 'Power Distribution',
    labels: analysis.power_distribution.map((b) => b.range_label),
    y_label: 'Count',
    series: [
      {
        name: 'Samples',
        data: analysis.power_distribution.map((b) => b.count),
      },
    ],
  };

  // Pacing Analysis — line chart of avg power per segment
  const pacingSegments = analysis.pacing_analysis.segments;
  const pacingChartData: ChartData = {
    chart_type: 'line',
    title: 'Pacing Analysis',
    labels: pacingSegments.map((s) => `${s.pct_start}–${s.pct_end}%`),
    x_label: 'Ride Progress',
    y_label: 'Avg Power (W)',
    series: [
      {
        name: 'Avg Power',
        data: pacingSegments.map((s) => s.avg_power ?? null),
      },
      ...(pacingSegments.some((s) => s.avg_hr != null)
        ? [
            {
              name: 'Avg HR',
              data: pacingSegments.map((s) => s.avg_hr ?? null),
              color: '#ef4444',
            },
          ]
        : []),
    ],
  };

  // Climbing time breakdown for display
  const climbing = analysis.climbing_analysis;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ride Analysis</CardTitle>
      </CardHeader>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {analysis.variability_index != null && (
          <StatBadge
            label="VI"
            value={analysis.variability_index.toFixed(2)}
          />
        )}
        {analysis.intensity_factor != null && (
          <StatBadge
            label="IF"
            value={analysis.intensity_factor.toFixed(2)}
          />
        )}
        {analysis.efficiency_factor != null && (
          <StatBadge
            label="EF"
            value={analysis.efficiency_factor.toFixed(2)}
          />
        )}
        {analysis.vam != null && (
          <StatBadge
            label="VAM"
            value={`${analysis.vam.toFixed(0)} m/h`}
          />
        )}
        {analysis.tss_breakdown.tss_per_hour != null && (
          <StatBadge
            label="TSS/hr"
            value={analysis.tss_breakdown.tss_per_hour.toFixed(1)}
          />
        )}
      </div>

      {/* Power Zones */}
      {analysis.power_zones.length > 0 && (
        <div className="mb-6">
          <Chart data={zoneChartData} height={280} />
        </div>
      )}

      {/* Power Distribution */}
      {analysis.power_distribution.length > 0 && (
        <div className="mb-6">
          <Chart data={distChartData} height={280} />
        </div>
      )}

      {/* Pacing Analysis */}
      {pacingSegments.length > 0 && (
        <div className="mb-6">
          <Chart data={pacingChartData} height={280} />
          {analysis.pacing_analysis.power_variability != null && (
            <p className="text-xs text-muted mt-2">
              Power variability: {analysis.pacing_analysis.power_variability.toFixed(2)}
            </p>
          )}
        </div>
      )}

      {/* Decoupling */}
      {analysis.decoupling && analysis.decoupling.decoupling_pct != null && (
        <div className="bg-surface-light/30 rounded-lg p-4 mb-6">
          <h4 className="text-sm font-medium text-muted mb-3">Decoupling</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatBadge
              label="Decoupling"
              value={`${analysis.decoupling.decoupling_pct.toFixed(1)}%`}
              className={decouplingColor(analysis.decoupling.decoupling_pct)}
            />
            {analysis.decoupling.first_half_ef != null && (
              <StatBadge
                label="1st Half EF"
                value={analysis.decoupling.first_half_ef.toFixed(2)}
              />
            )}
            {analysis.decoupling.second_half_ef != null && (
              <StatBadge
                label="2nd Half EF"
                value={analysis.decoupling.second_half_ef.toFixed(2)}
              />
            )}
            {analysis.decoupling.classification && (
              <StatBadge
                label="Classification"
                value={analysis.decoupling.classification}
              />
            )}
          </div>
        </div>
      )}

      {/* Climbing Analysis */}
      {climbing && climbing.total_climbing_m != null && (
        <div className="bg-surface-light/30 rounded-lg p-4">
          <h4 className="text-sm font-medium text-muted mb-3">Climbing Analysis</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatBadge
              label="Total Climbing"
              value={`${climbing.total_climbing_m.toFixed(0)} m`}
            />
            {climbing.avg_gradient_pct != null && (
              <StatBadge
                label="Avg Gradient"
                value={`${climbing.avg_gradient_pct.toFixed(1)}%`}
              />
            )}
            {climbing.max_gradient_pct != null && (
              <StatBadge
                label="Max Gradient"
                value={`${climbing.max_gradient_pct.toFixed(1)}%`}
              />
            )}
            {climbing.time_climbing_s != null && (
              <StatBadge
                label="Climbing Time"
                value={`${Math.round(climbing.time_climbing_s / 60)} min`}
              />
            )}
            {climbing.time_flat_s != null && (
              <StatBadge
                label="Flat Time"
                value={`${Math.round(climbing.time_flat_s / 60)} min`}
              />
            )}
            {climbing.time_descending_s != null && (
              <StatBadge
                label="Descending Time"
                value={`${Math.round(climbing.time_descending_s / 60)} min`}
              />
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
