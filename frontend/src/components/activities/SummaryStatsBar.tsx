'use client';

import { useMemo } from 'react';
import type { Activity, ActivitySummary } from '@/lib/api';
import { formatDistance, formatDuration } from '@/lib/utils';
import { STRENGTH_TYPES } from '@/lib/sportUtils';

interface SummaryStatsBarProps {
  activities?: Activity[];
  summary?: ActivitySummary;
}

export function SummaryStatsBar({ activities, summary }: SummaryStatsBarProps) {
  const stats = useMemo(() => {
    if (summary) {
      return {
        totalDistance: summary.total_distance_meters,
        totalTime: summary.total_duration_seconds,
        totalTss: summary.total_tss,
        count: summary.count,
      };
    }
    const acts = activities ?? [];
    const totalDistance = acts.reduce((sum, a) => {
      if (STRENGTH_TYPES.includes(a.sport_type)) return sum;
      return sum + (a.distance_meters || 0);
    }, 0);
    const totalTime = acts.reduce((sum, a) => sum + (a.duration_seconds || 0), 0);
    const totalTss = acts.reduce((sum, a) => sum + (a.tss || 0), 0);
    return { totalDistance, totalTime, totalTss, count: acts.length };
  }, [activities, summary]);

  if (stats.count === 0) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="bg-surface rounded-lg p-3 border border-surface-light/30">
        <p className="text-lg font-bold text-white">{stats.count}</p>
        <p className="text-xs text-muted">Activities</p>
      </div>
      <div className="bg-surface rounded-lg p-3 border border-surface-light/30">
        <p className="text-lg font-bold text-positive">{formatDistance(stats.totalDistance)}</p>
        <p className="text-xs text-muted">Total Distance</p>
      </div>
      <div className="bg-surface rounded-lg p-3 border border-surface-light/30">
        <p className="text-lg font-bold text-blue-400">{formatDuration(stats.totalTime)}</p>
        <p className="text-xs text-muted">Total Time</p>
      </div>
      <div className="bg-surface rounded-lg p-3 border border-surface-light/30">
        <p className="text-lg font-bold text-accent">{Math.round(stats.totalTss)}</p>
        <p className="text-xs text-muted">Total TSS</p>
      </div>
    </div>
  );
}
