'use client';

import { useMemo } from 'react';
import type { ActivityCalendarEntry, CalendarDayData, DailyMetricSummary } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { formatDuration, formatDistance } from '@/lib/utils';
import { getRecoveryColor } from '@/lib/sportUtils';

interface TimelineViewProps {
  startDate: string;
  endDate: string;
  calendarData: CalendarDayData;
}

interface DayColumn {
  date: Date;
  dateStr: string;
  dayName: string;
  metrics: DailyMetricSummary | undefined;
  activities: ActivityCalendarEntry[];
  tss: number;
}

function computeTimelineDays(
  startDate: Date,
  endDate: Date,
  calendarData: CalendarDayData,
): DayColumn[] {
  const metricByDate: Record<string, DailyMetricSummary> = {};
  calendarData.daily_metrics.forEach((dm) => {
    const key = dm.date;
    if (!metricByDate[key]) {
      metricByDate[key] = dm;
    }
  });

  const activitiesByDate: Record<string, ActivityCalendarEntry[]> = {};
  calendarData.activities.forEach((a) => {
    const dateStr = a.date;
    if (!activitiesByDate[dateStr]) activitiesByDate[dateStr] = [];
    activitiesByDate[dateStr].push(a);
  });

  const days: DayColumn[] = [];
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0];
    const dayName = current.toLocaleDateString('en-GB', { weekday: 'short' });
    const activities = activitiesByDate[dateStr] ?? [];
    const tss = activities.reduce((s, a) => s + (a.tss ?? 0), 0);
    days.push({
      date: new Date(current),
      dateStr,
      dayName,
      metrics: metricByDate[dateStr],
      activities,
      tss,
    });
    current.setDate(current.getDate() + 1);
  }

  return days;
}

export function TimelineView({ startDate, endDate, calendarData }: TimelineViewProps) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const days = useMemo(
    () => computeTimelineDays(start, end, calendarData),
    [start, end, calendarData],
  );

  if (days.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted">No activity or health data for this period.</p>
      </div>
    );
  }

  // Compute max values for relative sizing
  const maxTss = Math.max(...days.map((d) => d.tss), 1);
  const maxDistance = Math.max(
    ...days.flatMap((d) => d.activities.map((a) => a.distance_meters ?? 0)),
    1,
  );

  // Color intensity for daily TSS bar
  function tssBarWidth(tss: number): string {
    return `${Math.min(100, (tss / maxTss) * 100)}%`;
  }

  return (
    <div className="space-y-3">
      {/* Desktop grid — each day is a row */}
      <div className="hidden md:block space-y-2">
        {days.map((day) => {
          const hasActivity = day.activities.length > 0;
          const hasMetrics = day.metrics != null;
          const hasData = hasActivity || hasMetrics;
          if (!hasData) return null;

          return (
            <Card key={day.dateStr} className="p-3">
              <div className="flex items-center gap-4">
                {/* Date column */}
                <div className="w-24 text-right">
                  <div className="text-sm font-medium text-white">
                    {day.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </div>
                  <div className="text-xs text-muted">{day.dayName}</div>
                </div>

                {/* TSS bar */}
                <div className="w-20 flex-shrink-0">
                  {day.tss > 0 ? (
                    <div className="h-6 bg-surface-light/30 rounded overflow-hidden">
                      <div
                        className="h-full bg-accent/60 rounded transition-all"
                        style={{ width: tssBarWidth(day.tss) }}
                        title={`${Math.round(day.tss)} TSS`}
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-muted/50">— TSS</span>
                  )}
                </div>

                {/* Health metrics */}
                <div className="flex-1 flex gap-4 text-xs">
                  {day.metrics?.hrv_ms != null && (
                    <span title={`HRV: ${day.metrics.hrv_ms.toFixed(0)} ms`}>
                      🫀 {day.metrics.hrv_ms.toFixed(0)}ms
                    </span>
                  )}
                  {day.metrics?.recovery_score != null && (
                    <span className={getRecoveryColor(day.metrics.recovery_score)} title={`Recovery: ${day.metrics.recovery_score.toFixed(0)}%`}>
                      📈 {Math.round(day.metrics.recovery_score)}%
                    </span>
                  )}
                  {day.metrics?.strain != null && (
                    <span className="text-muted" title={`Strain: ${day.metrics.strain.toFixed(0)}`}>
                      🔥 {day.metrics.strain.toFixed(0)}
                    </span>
                  )}
                  {day.metrics?.sleep_duration_minutes != null && (
                    <span className="text-muted" title={`Sleep: ${Math.round(day.metrics.sleep_duration_minutes / 60)}h`}>
                      🌙 {Math.round(day.metrics.sleep_duration_minutes / 60)}h
                    </span>
                  )}
                </div>

                {/* Activities */}
                <div className="flex gap-2">
                  {day.activities.map((a) => (
                    <span
                      key={a.id}
                      className="text-xs px-2 py-1 rounded-full bg-surface-light/30 text-muted whitespace-nowrap"
                      title={a.name}
                    >
                      {a.sport_type === 'cycling' ? '🚴' : a.sport_type === 'strength' ? '🏋️' : '🏃'}
                      {' '}
                      {a.distance_meters
                        ? formatDistance(a.distance_meters, 1)
                        : formatDuration(a.duration_seconds ?? 0)}
                      {a.tss ? ` · ${Math.round(a.tss)} TSS` : ''}
                    </span>
                  ))}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Mobile — stacked */}
      <div className="md:hidden space-y-3">
        {days.map((day) => {
          const hasActivity = day.activities.length > 0;
          const hasMetrics = day.metrics != null;
          if (!hasActivity && !hasMetrics) return null;

          return (
            <Card key={day.dateStr} className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="text-sm font-medium text-white">
                  {day.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </div>
                <div className="text-xs text-muted">{day.dayName}</div>
              </div>

              {/* Health metrics row */}
              {day.metrics && (
                <div className="flex flex-wrap gap-2 mb-2 text-xs">
                  {day.metrics.hrv_ms != null && (
                    <span title={`HRV: ${day.metrics.hrv_ms.toFixed(0)} ms`}>
                      🫀 {day.metrics.hrv_ms.toFixed(0)}ms
                    </span>
                  )}
                  {day.metrics.recovery_score != null && (
                    <span className={getRecoveryColor(day.metrics.recovery_score)} title={`Recovery: ${day.metrics.recovery_score.toFixed(0)}%`}>
                      📈 {Math.round(day.metrics.recovery_score)}%
                    </span>
                  )}
                  {day.metrics.strain != null && (
                    <span className="text-muted">🔥 {day.metrics.strain.toFixed(0)}</span>
                  )}
                  {day.metrics.sleep_duration_minutes != null && (
                    <span className="text-muted">🌙 {Math.round(day.metrics.sleep_duration_minutes / 60)}h</span>
                  )}
                </div>
              )}

              {/* Activities row */}
              {day.activities.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {day.activities.map((a) => (
                    <span
                      key={a.id}
                      className="text-xs px-2 py-1 rounded-full bg-surface-light/30 text-muted"
                      title={a.name}
                    >
                      {a.sport_type === 'cycling' ? '🚴' : a.sport_type === 'strength' ? '🏋️' : '🏃'}
                      {' '}
                      {a.distance_meters
                        ? formatDistance(a.distance_meters, 1)
                        : formatDuration(a.duration_seconds ?? 0)}
                      {a.tss ? ` · ${Math.round(a.tss)}TSS` : ''}
                    </span>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
