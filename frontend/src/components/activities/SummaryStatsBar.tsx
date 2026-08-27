'use client';

import { useMemo } from 'react';
import type { Activity } from '@/lib/api';
import { formatDistance, formatDuration } from '@/lib/utils';
import { STRENGTH_TYPES } from '@/lib/sportUtils';

export function SummaryStatsBar({ activities }: { activities: Activity[] }) {
  const stats = useMemo(() => {
    const totalDistance = activities.reduce((sum, a) => {
      if (STRENGTH_TYPES.includes(a.sport_type)) return sum;
      return sum + (a.distance_meters || 0);
    }, 0);
    const totalTime = activities.reduce((sum, a) => sum + (a.duration_seconds || 0), 0);
    const totalTss = activities.reduce((sum, a) => sum + (a.tss || 0), 0);
    return { totalDistance, totalTime, totalTss, count: activities.length };
  }, [activities]);

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
