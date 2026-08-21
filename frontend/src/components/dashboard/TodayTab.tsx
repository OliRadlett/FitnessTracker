'use client';

import React from 'react';
import type { TodaySummary } from '@/lib/api';
import { Badge, getSportBadgeVariant } from '@/components/ui/Badge';
import { SkeletonMetric } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { MetricCard, formatDistance, formatDuration, ListSkeleton } from './helpers';

interface TodayTabProps {
  todaySummary: TodaySummary | undefined;
  isLoading: boolean;
}

export function TodayTab({ todaySummary, isLoading }: TodayTabProps) {
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonMetric key={i} />)}
        </div>
        <ListSkeleton count={3} />
      </div>
    );
  }

  if (!todaySummary) {
    return (
      <EmptyState
        icon="📅"
        title="No data for today"
        description="Start training to see your daily summary here."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Today's Key Metrics */}
      <div>
        <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">Today's Numbers</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <MetricCard
            label="TSS Today"
            value={todaySummary.today_tss > 0 ? todaySummary.today_tss.toFixed(0) : '—'}
            subtitle="Training Stress Score"
            color="text-blue-400"
            icon="⚡"
          />
          <MetricCard
            label="Volume Today"
            value={todaySummary.today_volume_kg > 0 ? `${todaySummary.today_volume_kg.toLocaleString()} kg` : '—'}
            subtitle="Lifting volume"
            color="text-purple-400"
            icon="🏋️"
          />
          <MetricCard
            label="Distance"
            value={todaySummary.today_distance_meters > 0 ? formatDistance(todaySummary.today_distance_meters) : '—'}
            subtitle="Cardio distance"
            color="text-green-400"
            icon="🚴"
          />
          <MetricCard
            label="Duration"
            value={todaySummary.today_duration_seconds > 0 ? formatDuration(todaySummary.today_duration_seconds) : '—'}
            subtitle="Training time"
            color="text-slate-300"
            icon="⏱️"
          />
          <MetricCard
            label="Recovery"
            value={todaySummary.latest_recovery != null ? `${todaySummary.latest_recovery.toFixed(0)}%` : '—'}
            subtitle={todaySummary.latest_hrv_ms != null ? `HRV: ${todaySummary.latest_hrv_ms.toFixed(0)}ms` : 'No data'}
            color={(todaySummary.latest_recovery ?? 0) >= 70 ? 'text-green-400' : (todaySummary.latest_recovery ?? 0) >= 50 ? 'text-yellow-400' : 'text-red-400'}
            icon="❤️"
          />
          <MetricCard
            label="Strain"
            value={todaySummary.latest_strain != null ? todaySummary.latest_strain.toFixed(1) : '—'}
            subtitle="Whoop strain (0-21)"
            color={(todaySummary.latest_strain ?? 0) >= 14 ? 'text-warning' : (todaySummary.latest_strain ?? 0) >= 10 ? 'text-yellow-400' : 'text-green-400'}
            icon="💪"
          />
          <MetricCard
            label="Sleep"
            value={todaySummary.latest_sleep_hours != null ? `${todaySummary.latest_sleep_hours.toFixed(1)}h` : '—'}
            subtitle="Last night"
            color={(todaySummary.latest_sleep_hours ?? 0) >= 7 ? 'text-green-400' : (todaySummary.latest_sleep_hours ?? 0) >= 6 ? 'text-yellow-400' : 'text-red-400'}
            icon="😴"
          />
          <MetricCard
            label="Active Alerts"
            value={todaySummary.active_alerts}
            subtitle="Health warnings"
            color={todaySummary.active_alerts > 0 ? 'text-warning' : 'text-green-400'}
            icon="🔔"
          />
        </div>
      </div>

      {/* Training Load */}
      <div>
        <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">Training Load</h2>
        <div className="grid grid-cols-3 gap-4">
          <MetricCard
            label="CTL (Fitness)"
            value={todaySummary.current_ctl.toFixed(1)}
            subtitle="42-day chronic load"
            color="text-blue-400"
            icon="📈"
          />
          <MetricCard
            label="ATL (Fatigue)"
            value={todaySummary.current_atl.toFixed(1)}
            subtitle="7-day acute load"
            color="text-orange-400"
            icon="🔥"
          />
          <MetricCard
            label="TSB (Form)"
            value={todaySummary.current_tsb.toFixed(1)}
            subtitle={
              todaySummary.current_tsb < -30 ? 'Overreaching'
              : todaySummary.current_tsb < -10 ? 'Productive'
              : todaySummary.current_tsb > 10 ? 'Fresh / Tapered'
              : 'Neutral'
            }
            color={
              todaySummary.current_tsb < -30 ? 'text-red-400'
              : todaySummary.current_tsb < -10 ? 'text-amber-400'
              : todaySummary.current_tsb > 10 ? 'text-green-400'
              : 'text-blue-400'
            }
            icon="⚖️"
          />
        </div>
      </div>

      {/* Today's Activities */}
      <div>
        <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">Today's Activities</h2>
        {todaySummary.today_activities.length > 0 ? (
          <div className="space-y-2">
            {todaySummary.today_activities.map((a) => (
              <div key={a.id} className="flex items-center justify-between p-3 bg-surface-light/30 rounded-lg hover:bg-surface-light/50 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <Badge variant={getSportBadgeVariant(a.sport_type)}>
                    {a.sport_type}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{a.name}</p>
                    <p className="text-xs text-muted">
                      {new Date(a.start_date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0 ml-3 flex items-center gap-4">
                  {a.tss != null && (
                    <p className="text-xs text-blue-400">{a.tss.toFixed(0)} TSS</p>
                  )}
                  {a.average_power != null && (
                    <p className="text-xs text-yellow-400">{a.average_power.toFixed(0)}W</p>
                  )}
                  {a.average_heartrate != null && (
                    <p className="text-xs text-red-400">{a.average_heartrate.toFixed(0)} bpm</p>
                  )}
                  {a.distance_meters != null && !['weighttraining', 'workout', 'crossfit', 'strength_training'].includes(a.sport_type) && (
                    <p className="text-sm text-slate-300">{formatDistance(a.distance_meters)}</p>
                  )}
                  {a.duration_seconds != null && (
                    <p className="text-xs text-muted">{formatDuration(a.duration_seconds)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="🏃"
            title="No activities today"
            description="Go for a ride, run, or log a workout to see it here."
            action={{ label: 'View Activities', href: '/activities' }}
          />
        )}
      </div>

      {/* Today's Lifting Sessions */}
      <div>
        <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">Today's Lifting</h2>
        {todaySummary.today_lifting_sessions.length > 0 ? (
          <div className="space-y-2">
            {todaySummary.today_lifting_sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between p-3 bg-surface-light/30 rounded-lg hover:bg-surface-light/50 transition-colors">
                <div>
                  <p className="text-sm font-medium text-white">{s.focus || 'General'}</p>
                  <p className="text-xs text-muted">{s.sets_count} sets</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-purple-400">
                    {s.total_volume_kg.toLocaleString()} kg vol
                  </p>
                  {s.rpe_session != null && (
                    <p className="text-xs text-muted">RPE {s.rpe_session.toFixed(1)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="🏋️"
            title="No lifting today"
            description="Log a lifting session to track your strength work."
            action={{ label: 'Create Session', href: '/lifting' }}
          />
        )}
      </div>
    </div>
  );
}
