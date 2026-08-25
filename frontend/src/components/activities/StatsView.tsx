'use client';

import { useMemo } from 'react';
import type { Activity, ChartData } from '@/lib/api';
import { ChartCard } from '@/components/charts/ChartCard';
import { STRENGTH_TYPES } from '@/lib/sportUtils';

function getISOWeek(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

export function StatsView({ activities }: { activities: Activity[] }) {
  // Monthly distance bars (last 6 months)
  const monthlyDistanceChart: ChartData | null = useMemo(() => {
    if (activities.length === 0) return null;
    const now = new Date();
    const months: { key: string; label: string; distance: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
      months.push({ key, label, distance: 0 });
    }
    for (const a of activities) {
      if (STRENGTH_TYPES.includes(a.sport_type)) continue;
      const d = new Date(a.start_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const month = months.find((m) => m.key === key);
      if (month) month.distance += a.distance_meters ?? 0;
    }
    return {
      chart_type: 'bar',
      title: 'Monthly Distance',
      labels: months.map((m) => m.label),
      x_label: 'Month',
      y_label: 'Distance (km)',
      series: [{ name: 'Distance', data: months.map((m) => Math.round(m.distance / 1000 * 10) / 10) }],
    };
  }, [activities]);

  // Sport breakdown pie
  const sportPieChart: ChartData | null = useMemo(() => {
    if (activities.length === 0) return null;
    const counts = new Map<string, number>();
    for (const a of activities) {
      counts.set(a.sport_type, (counts.get(a.sport_type) ?? 0) + 1);
    }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    return {
      chart_type: 'pie',
      title: 'Sport Breakdown',
      labels: sorted.map(([type]) => type),
      series: [{ name: 'Activities', data: sorted.map(([, count]) => count) }],
    };
  }, [activities]);

  // Weekly TSS trend (last 12 weeks)
  const weeklyTssChart: ChartData | null = useMemo(() => {
    if (activities.length === 0) return null;
    const now = new Date();
    const weeks: { key: string; label: string; tss: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      const weekKey = getISOWeek(d);
      const label = `W${weekKey.split('-W')[1]}`;
      weeks.push({ key: weekKey, label, tss: 0 });
    }
    // Deduplicate by key
    const uniqueWeeks = weeks.filter((w, i, arr) => arr.findIndex((x) => x.key === w.key) === i);
    for (const a of activities) {
      const weekKey = getISOWeek(new Date(a.start_date));
      const week = uniqueWeeks.find((w) => w.key === weekKey);
      if (week) week.tss += a.tss ?? 0;
    }
    return {
      chart_type: 'area',
      title: 'Weekly TSS Trend',
      labels: uniqueWeeks.map((w) => w.label),
      x_label: 'Week',
      y_label: 'TSS',
      series: [{ name: 'TSS', data: uniqueWeeks.map((w) => Math.round(w.tss)) }],
    };
  }, [activities]);

  return (
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
  );
}
