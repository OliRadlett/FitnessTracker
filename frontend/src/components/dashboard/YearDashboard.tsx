'use client';

/**
 * V2: YearDashboard — annual stats + monthly bar chart + highlights.
 *
 * New tab in the dashboard (Today/Week/Month/Year). Pulls from
 * DashboardData.yearlySummary (already fetched by useDashboardData).
 */

import React from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { MetricCard } from '@/components/ui/MetricCard';
import { ChartCard } from '@/components/charts/ChartCard';
import { formatDistance } from '@/lib/utils';
import type { YearlySummary, MonthlySummaryItem } from '@/lib/api';
import type { ChartData } from '@/lib/api';
import { Trophy } from 'lucide-react';

interface YearDashboardProps {
  yearlySummary: YearlySummary | null;
  yearlyLoading: boolean;
  selectedYear: number;
  stale?: boolean;
}

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function monthlyTssChart(months: MonthlySummaryItem[]): ChartData {
  const labels = months.map((m) => {
    const idx = Number(m.month.split('-')[1]) - 1;
    return MONTH_LABELS[idx] ?? m.month;
  });
  return {
    chart_type: 'bar',
    title: 'Monthly TSS',
    labels,
    series: [{ name: 'TSS', data: months.map((m) => m.total_tss) }],
    x_label: 'Month',
    y_label: 'TSS',
  };
}

function monthlyVolumeChart(months: MonthlySummaryItem[]): ChartData {
  const labels = months.map((m) => {
    const idx = Number(m.month.split('-')[1]) - 1;
    return MONTH_LABELS[idx] ?? m.month;
  });
  return {
    chart_type: 'bar',
    title: 'Monthly Lifting Volume',
    labels,
    series: [{ name: 'Volume (kg)', data: months.map((m) => m.lifting_volume_kg) }],
    x_label: 'Month',
    y_label: 'kg',
  };
}

export function YearDashboard({
  yearlySummary,
  yearlyLoading,
  selectedYear,
  stale,
}: YearDashboardProps) {
  if (yearlyLoading || !yearlySummary) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse bg-surface-light/50 rounded-lg" />
        ))}
      </div>
    );
  }

  const months = yearlySummary.months ?? [];
  const highlights = yearlySummary.highlights;
  const yoy = yearlySummary.year_over_year;

  const tssSparkline = months.map((m) => m.total_tss);
  const volSparkline = months.map((m) => m.lifting_volume_kg);

  return (
    <div className="space-y-6">
      {/* Annual stats grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label="Activities"
          value={yearlySummary.total_activities}
          color="text-foreground"
          sparklineData={tssSparkline}
        />
        <MetricCard
          label="Distance"
          value={formatDistance(yearlySummary.total_distance_m)}
          color="text-foreground"
        />
        <MetricCard
          label="Total TSS"
          value={yearlySummary.total_tss.toFixed(0)}
          color="text-accent"
          sparklineData={tssSparkline}
        />
        <MetricCard
          label="Lifting Sessions"
          value={yearlySummary.total_lifting_sessions}
          color="text-foreground"
          sparklineData={volSparkline}
        />
        <MetricCard
          label="Lifting Volume"
          value={yearlySummary.total_lifting_volume_kg.toLocaleString()}
          unit="kg"
          color="text-foreground"
        />
        <MetricCard
          label="Avg Recovery"
          value={yearlySummary.avg_recovery != null ? yearlySummary.avg_recovery.toFixed(0) : '—'}
          unit="%"
          color="text-foreground"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard
          title="Monthly TSS"
          data={monthlyTssChart(months)}
          isLoading={false}
          height={280}
          stale={stale}
        />
        <ChartCard
          title="Monthly Lifting Volume"
          data={monthlyVolumeChart(months)}
          isLoading={false}
          height={280}
          stale={stale}
        />
      </div>

      {/* Highlights */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-accent" />
            {selectedYear} Highlights
          </CardTitle>
        </CardHeader>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 p-4 pt-0">
          <div className="text-center">
            <p className="text-2xl font-bold text-accent tabular-nums">{yearlySummary.total_tss.toFixed(0)}</p>
            <p className="text-xs text-muted">Total TSS</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-accent tabular-nums">{highlights?.total_prs ?? 0}</p>
            <p className="text-xs text-muted">New PRs</p>
          </div>
          {highlights?.longest_ride && (
            <div className="text-center">
              <p className="text-sm font-medium text-foreground truncate">
                {formatDistance(highlights.longest_ride.value)}
              </p>
              <p className="text-xs text-muted">Longest ride</p>
            </div>
          )}
          {highlights?.heaviest_lift && (
            <div className="text-center">
              <p className="text-sm font-medium text-foreground truncate">
                {highlights.heaviest_lift.value.toLocaleString()} {highlights.heaviest_lift.unit}
              </p>
              <p className="text-xs text-muted">Heaviest lift</p>
            </div>
          )}
        </div>

        {yoy && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 px-4 pb-4">
            <div className="text-center">
              <p className={`text-sm font-medium ${yoy.activities_pct != null && yoy.activities_pct > 0 ? 'text-positive' : 'text-warning'}`}>
                {yoy.activities_pct != null ? `${yoy.activities_pct > 0 ? '+' : ''}${yoy.activities_pct.toFixed(0)}%` : '—'}
              </p>
              <p className="text-xs text-muted">vs {selectedYear - 1}</p>
            </div>
            <div className="text-center">
              <p className={`text-sm font-medium ${yoy.tss_pct != null && yoy.tss_pct > 0 ? 'text-positive' : 'text-warning'}`}>
                {yoy.tss_pct != null ? `${yoy.tss_pct > 0 ? '+' : ''}${yoy.tss_pct.toFixed(0)}%` : '—'}
              </p>
              <p className="text-xs text-muted">TSS YoY</p>
            </div>
            <div className="text-center">
              <p className={`text-sm font-medium ${yoy.lifting_volume_pct != null && yoy.lifting_volume_pct > 0 ? 'text-positive' : 'text-warning'}`}>
                {yoy.lifting_volume_pct != null ? `${yoy.lifting_volume_pct > 0 ? '+' : ''}${yoy.lifting_volume_pct.toFixed(0)}%` : '—'}
              </p>
              <p className="text-xs text-muted">Volume YoY</p>
            </div>
            <div className="text-center">
              <p className={`text-sm font-medium ${yoy.prs_delta != null && yoy.prs_delta > 0 ? 'text-positive' : 'text-warning'}`}>
                {yoy.prs_delta != null ? `${yoy.prs_delta > 0 ? '+' : ''}${yoy.prs_delta}` : '—'}
              </p>
              <p className="text-xs text-muted">PRs YoY</p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
