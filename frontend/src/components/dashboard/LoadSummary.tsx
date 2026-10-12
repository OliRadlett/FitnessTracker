'use client';

/**
 * V2: LoadSummary — the 3-row metric strip with sparklines.
 * Replaces the old LoadStrip. Uses MetricCard + Sparkline (card+sparkline V2 base unit).
 */

import React from 'react';
import { MetricCard } from '@/components/ui/MetricCard';
import { Card } from '@/components/ui/Card';
import type { DashboardData } from '@/lib/dashboard/useDashboardData';

interface LoadSummaryProps {
  data: DashboardData;
  syncBadge?: React.ReactNode;
}

function toTrend(d: 'up' | 'down' | 'flat' | null): 'up' | 'down' | 'stable' | null {
  if (d === 'flat') return 'stable';
  return d;
}

export function LoadSummary({ data, syncBadge }: LoadSummaryProps) {
  const {
    ctl, atl, tsb, tsbDelta7d, weekTss, ftpWatts, loadTrendDirection,
    loadTrendPoints, loadIsLoading,
  } = data;

  if (loadIsLoading && !ctl && !atl && !tsb) {
    return (
      <Card className="p-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse bg-surface-light/50 rounded-lg" />
          ))}
        </div>
      </Card>
    );
  }

  const trend = toTrend(loadTrendDirection);

  // For TSB, an "up" trend (more positive TSB) is good, so invert
  const tsbTrend = trend === 'up' ? 'down' : trend === 'down' ? 'up' : trend;

  return (
    <Card className="p-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label="CTL"
          value={ctl?.toFixed(1) ?? '—'}
          color="text-foreground"
          subtitle={
            tsbDelta7d !== null
              ? `Δ${tsbDelta7d > 0 ? '+' : ''}${tsbDelta7d.toFixed(1)} TSB/7d`
              : undefined
          }
          sparklineData={loadTrendPoints?.map((p) => p.ctl) ?? undefined}
          trend={trend}
        />
        <MetricCard
          label="ATL"
          value={atl?.toFixed(1) ?? '—'}
          color="text-foreground"
          sparklineData={loadTrendPoints?.map((p) => p.atl) ?? undefined}
          trend={trend}
        />
        <MetricCard
          label="TSB"
          value={tsb !== null ? (tsb > 0 ? '+' : '') + tsb.toFixed(1) : '—'}
          color={tsb !== null && tsb > 3 ? 'text-positive' : tsb !== null && tsb < -10 ? 'text-warning' : 'text-foreground'}
          subtitle={tsb !== null ? (tsb > 3 ? 'Fresh' : tsb < -10 ? 'Heavy' : 'Moderate') : undefined}
          sparklineData={loadTrendPoints?.map((p) => p.tsb) ?? undefined}
          trend={tsbTrend}
        />
        <MetricCard
          label="Week TSS"
          value={weekTss?.toFixed(0) ?? '—'}
          color="text-foreground"
          sparklineData={loadTrendPoints?.slice(-7).map((p) => p.tss) ?? undefined}
        />
        <MetricCard
          label="FTP"
          value={ftpWatts ? `${ftpWatts.toFixed(0)}W` : '—'}
          color="text-accent"
        />
        {syncBadge && (
          <div className="col-span-2 sm:col-span-3 lg:col-span-1 flex items-center justify-center">
            {syncBadge}
          </div>
        )}
      </div>
    </Card>
  );
}
