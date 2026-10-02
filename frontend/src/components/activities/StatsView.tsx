'use client';

import { useMemo } from 'react';
import type { ChartData, TimeseriesResponse } from '@/lib/api';
import { ChartCard } from '@/components/charts/ChartCard';
import { SkeletonRow } from '@/components/ui/Skeleton';
import { getActiveLocale } from '@/lib/utils';

export function StatsView({
  monthly,
  weekly,
  horizonMonths,
  onHorizonChange,
  isLoading = false,
}: {
  monthly: TimeseriesResponse | undefined;
  weekly: TimeseriesResponse | undefined;
  horizonMonths: number;
  onHorizonChange: (months: number) => void;
  isLoading?: boolean;
}) {
  const clampedTo = monthly && !monthly.complete ? monthly.clamped_to : null;
  // Monthly distance bars.
  //
  // Every value comes straight off the server's dense series. There is
  // deliberately no bucket construction and no zero-filling here: the previous
  // version built months client-side and pre-seeded them to zero, so a server
  // row cap made a missing month render as a training dip that never happened.
  // The server now returns every bucket in range, so a zero means "no
  // training" and there is no loop here that could invent one.
  const monthlyDistanceChart: ChartData | null = useMemo(() => {
    if (!monthly || monthly.buckets.length === 0) return null;
    return {
      chart_type: 'bar',
      title: 'Monthly Distance',
      labels: monthly.buckets.map((b) =>
        new Date(`${b.bucket_start}T00:00:00`).toLocaleDateString(getActiveLocale(), {
          month: 'short',
          year: '2-digit',
        }),
      ),
      x_label: 'Month',
      y_label: 'Distance (km)',
      series: [
        {
          name: 'Distance',
          data: monthly.buckets.map((b) => Math.round((b.distance_meters / 1000) * 10) / 10),
        },
      ],
    };
  }, [monthly]);

  // Sport breakdown pie.
  const sportPieChart: ChartData | null = useMemo(() => {
    const breakdown = monthly?.sport_breakdown ?? [];
    if (breakdown.length === 0) return null;
    return {
      chart_type: 'pie',
      title: 'Sport Breakdown',
      labels: breakdown.map((s) => s.sport_type ?? 'unknown'),
      series: [{ name: 'Activities', data: breakdown.map((s) => s.count) }],
    };
  }, [monthly]);

  // Weekly TSS trend. Same reasoning: server buckets, no client zero-fill.
  const weeklyTssChart: ChartData | null = useMemo(() => {
    if (!weekly || weekly.buckets.length === 0) return null;
    return {
      chart_type: 'area',
      title: 'Weekly TSS Trend',
      labels: weekly.buckets.map((b) => {
        const d = new Date(`${b.bucket_start}T00:00:00`);
        return d.toLocaleDateString(getActiveLocale(), { month: 'short', day: 'numeric' });
      }),
      x_label: 'Week starting',
      y_label: 'TSS',
      series: [{ name: 'TSS', data: weekly.buckets.map((b) => Math.round(b.tss)) }],
    };
  }, [weekly]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" aria-label="Loading stats">
        <SkeletonRow className="h-[280px]" />
        <SkeletonRow className="h-[280px]" />
        <div className="lg:col-span-2">
          <SkeletonRow className="h-[280px]" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/*
        The horizon is a real control. It was a hardcoded constant before
        (6 months / 12 weeks), and the only reason to change it was the 200-row
        cap that made anything deeper wrong. With server-side aggregation any
        depth in range is correct, so this is just a range selector.
      */}
      <div className="flex items-center gap-2 justify-end">
        <label htmlFor="stats-horizon" className="text-xs text-muted">
          Range
        </label>
        <select
          id="stats-horizon"
          value={horizonMonths}
          onChange={(e) => onHorizonChange(Number(e.target.value))}
          className="bg-surface border border-border rounded px-2 py-1 text-xs text-foreground"
        >
          <option value={6}>6 months</option>
          <option value={12}>12 months</option>
          <option value={24}>24 months</option>
          <option value={60}>5 years</option>
        </select>
      </div>

      {/* Honest signal when the server had to clamp the requested range. */}
      {clampedTo && (
        <p className="text-xs text-warning" role="status">
          Range clamped to {clampedTo} — the requested window exceeds the maximum
          number of buckets for this view.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard
          title="Monthly Distance"
          data={monthlyDistanceChart}
          emptyMessage="No activity data"
          height={280}
        />
        <ChartCard
          title="Sport Breakdown"
          data={sportPieChart}
          emptyMessage="No activity data"
          height={280}
        />
        <div className="lg:col-span-2">
          <ChartCard
            title="Weekly TSS Trend"
            data={weeklyTssChart}
            emptyMessage="No TSS data"
            height={280}
          />
        </div>
      </div>
    </div>
  );
}
