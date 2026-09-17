'use client';

import type { WhoopWeeklySummary } from '@/lib/api/types';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { TrendArrow } from '@/components/ui/TrendArrow';

interface WhoopWeeklyCardProps {
  data: WhoopWeeklySummary;
}

export function WhoopWeeklyCard({ data }: WhoopWeeklyCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>🩺 Whoop Weekly</CardTitle>
      </CardHeader>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-muted mb-1">Avg Recovery</p>
          <div className="flex items-center gap-1">
            <p className="text-xl font-bold text-positive">
              {data.avg_recovery?.toFixed(0) ?? '—'}%
            </p>
            <TrendArrow trend={data.avg_recovery_trend} />
          </div>
        </div>
        <div>
          <p className="text-xs text-muted mb-1">Avg Sleep</p>
          <div className="flex items-center gap-1">
            <p className="text-xl font-bold text-blue-400">
              {data.avg_sleep_hours?.toFixed(1) ?? '—'}h
            </p>
            <TrendArrow trend={data.avg_sleep_trend} />
          </div>
        </div>
        <div>
          <p className="text-xs text-muted mb-1">Total Strain</p>
          <div className="flex items-center gap-1">
            <p className="text-xl font-bold text-orange-400">
              {data.total_strain?.toFixed(1) ?? '—'}
            </p>
            <TrendArrow trend={data.total_strain_trend} />
          </div>
        </div>
        <div>
          <p className="text-xs text-muted mb-1">Sleep Consistency</p>
          <p className="text-xl font-bold text-purple-400">
            {data.sleep_consistency?.toFixed(0) ?? '—'}%
          </p>
        </div>
      </div>
      {(data.best_recovery_day || data.worst_recovery_day) && (
        <div className="flex gap-4 mt-4 pt-3 border-t border-white/5 text-xs">
          {data.best_recovery_day && (
            <div>
              <span className="text-muted">Best: </span>
              <span className="text-positive">
                {new Date(data.best_recovery_day.date).toLocaleDateString(undefined, { weekday: 'short' })} ({data.best_recovery_day.score?.toFixed(0)}%)
              </span>
            </div>
          )}
          {data.worst_recovery_day && (
            <div>
              <span className="text-muted">Worst: </span>
              <span className="text-warning">
                {new Date(data.worst_recovery_day.date).toLocaleDateString(undefined, { weekday: 'short' })} ({data.worst_recovery_day.score?.toFixed(0)}%)
              </span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
