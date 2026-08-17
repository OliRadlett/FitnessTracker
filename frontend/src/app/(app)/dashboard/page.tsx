'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { DashboardSummary, ChartData, Activity, LiftingSession } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, getSportBadgeVariant } from '@/components/ui/Badge';
import { Chart } from '@/components/charts/Chart';

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function formatDistance(meters: number): string {
  const km = meters / 1000;
  return `${km.toFixed(1)} km`;
}

function SummaryCard({ title, value, subtitle, color }: {
  title: string;
  value: string | number;
  subtitle?: string;
  color: string;
}) {
  return (
    <Card>
      <p className="text-sm text-muted mb-1">{title}</p>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      {subtitle && <p className="text-xs text-muted mt-1">{subtitle}</p>}
    </Card>
  );
}

export default function DashboardPage() {
  const { authFetch } = useAuthFetch();

  const { data: summary, isLoading: summaryLoading } = useQuery<DashboardSummary>({
    queryKey: ['dashboard-summary'],
    queryFn: () => authFetch<DashboardSummary>('/api/v1/dashboard/summary'),
    staleTime: 60_000,  // 1 min
  });

  const { data: weeklyTss, isLoading: tssLoading } = useQuery<ChartData>({
    queryKey: ['chart-weekly-tss'],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/weekly_tss?weeks=12'),
    staleTime: 300_000,  // 5 min — chart data is expensive
  });

  const { data: activities, isLoading: activitiesLoading } = useQuery<Activity[]>({
    queryKey: ['activities-recent'],
    queryFn: () => authFetch<Activity[]>('/api/v1/activities?limit=5'),
    staleTime: 60_000,  // 1 min
  });

  const { data: sessions, isLoading: sessionsLoading } = useQuery<LiftingSession[]>({
    queryKey: ['lifting-sessions-recent'],
    queryFn: () => authFetch<LiftingSession[]>('/api/v1/lifting/sessions?limit=5'),
    staleTime: 60_000,  // 1 min
  });

  const recentSessions = sessions?.slice(0, 5) ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Dashboard</h1>
        <p className="text-muted">Your fitness overview for this week</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
        {summaryLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <div className="animate-pulse">
                <div className="h-4 bg-surface-light rounded w-24 mb-3"></div>
                <div className="h-8 bg-surface-light rounded w-16 mb-2"></div>
                <div className="h-3 bg-surface-light rounded w-20"></div>
              </div>
            </Card>
          ))
        ) : (
          <>
            <SummaryCard
              title="Weekly Volume"
              value={summary ? `${summary.weekly_volume_kg.toLocaleString()} kg` : '—'}
              subtitle={`${summary?.weekly_sessions ?? 0} lifting sessions`}
              color="text-accent"
            />
            <SummaryCard
              title="Weekly Distance"
              value={summary ? `${(summary.weekly_distance_meters / 1000).toFixed(1)} km` : '—'}
              subtitle="Cycling, running, etc."
              color="text-green-400"
            />
            <SummaryCard
              title="Latest Recovery"
              value={summary?.latest_recovery?.toFixed(1) ?? '—'}
              subtitle={summary?.latest_hrv_ms ? `HRV: ${summary.latest_hrv_ms.toFixed(0)}ms` : 'No data'}
              color={(summary?.latest_recovery ?? 0) >= 70 ? 'text-positive' : 'text-warning'}
            />
            <SummaryCard
              title="Weekly TSS"
              value={summary?.weekly_tss?.toFixed(0) ?? '—'}
              subtitle="Training Stress Score"
              color="text-blue-400"
            />
            <SummaryCard
              title="Daily Strain"
              value={summary?.latest_strain?.toFixed(1) ?? '—'}
              subtitle="Whoop strain (0-21)"
              color={
                (summary?.latest_strain ?? 0) >= 14
                  ? 'text-warning'
                  : (summary?.latest_strain ?? 0) >= 10
                    ? 'text-yellow-400'
                    : 'text-green-400'
              }
            />
            <SummaryCard
              title="Active Alerts"
              value={summary?.active_alerts_count ?? 0}
              subtitle="Health warnings"
              color={(summary?.active_alerts_count ?? 0) > 0 ? 'text-warning' : 'text-muted'}
            />
          </>
        )}
      </div>

      {/* Weekly TSS Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Weekly Training Stress Score</CardTitle>
        </CardHeader>
        {tssLoading ? (
          <div className="h-80 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-accent"></div>
          </div>
        ) : weeklyTss ? (
          <Chart data={weeklyTss} height={320} />
        ) : (
          <div className="h-80 flex items-center justify-center text-muted">
            No TSS data available
          </div>
        )}
      </Card>

      {/* Recent Activities & Sessions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Recent Activities</CardTitle>
          </CardHeader>
          {activitiesLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="animate-pulse h-16 bg-surface-light rounded-lg"></div>
              ))}
            </div>
          ) : activities && activities.length > 0 ? (
            <div className="space-y-3">
              {activities.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-center justify-between p-3 bg-surface-light/30 rounded-lg hover:bg-surface-light/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant={getSportBadgeVariant(activity.sport_type)}>
                      {activity.sport_type}
                    </Badge>
                    <div>
                      <p className="text-sm font-medium text-white">{activity.name}</p>
                      <p className="text-xs text-muted">
                        {new Date(activity.start_date).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                  {activity.distance_meters && !['weighttraining', 'workout', 'crossfit', 'strength_training'].includes(activity.sport_type) && (
                    <p className="text-sm text-slate-300">{formatDistance(activity.distance_meters)}</p>
                  )}
                  {activity.duration_seconds && (
                    <p className="text-xs text-muted">{formatDuration(activity.duration_seconds)}</p>
                  )}
                </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted text-center py-8">No recent activities</p>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Lifting Sessions</CardTitle>
          </CardHeader>
          {sessionsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="animate-pulse h-16 bg-surface-light rounded-lg"></div>
              ))}
            </div>
          ) : recentSessions.length > 0 ? (
            <div className="space-y-3">
              {recentSessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between p-3 bg-surface-light/30 rounded-lg hover:bg-surface-light/50 transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-white">
                      {session.focus || 'General'}
                    </p>
                    <p className="text-xs text-muted">
                      {new Date(session.session_date).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-purple-400">
                      {session.sets?.length ?? 0} sets
                    </p>
                    {session.total_volume_kg !== undefined && (
                      <p className="text-xs text-muted">
                        {session.total_volume_kg.toLocaleString()} kg vol
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted text-center py-8">No lifting sessions yet</p>
          )}
        </Card>
      </div>
    </div>
  );
}
