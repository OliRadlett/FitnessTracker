'use client';

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type {
  DashboardSummary,
  ChartData,
  Activity,
  LiftingSession,
  ReadinessResponse,
  RespiratoryRateResponse,
  WhoopWeeklySummary,
  HealthAlert,
} from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, getSportBadgeVariant } from '@/components/ui/Badge';
import { Chart } from '@/components/charts/Chart';
import { ReadinessIndicator } from '@/components/ui/ReadinessIndicator';

/* ── Helpers ────────────────────────────────────────────────────────────── */

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function formatDistance(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/* ── Compact Metric Card ────────────────────────────────────────────────── */

function MetricCard({ label, value, subtitle, color, icon }: {
  label: string;
  value: string | number;
  subtitle?: string;
  color: string;
  icon?: string;
}) {
  return (
    <div className="bg-surface rounded-xl border border-surface-light/50 p-4 hover:border-surface-light transition-colors">
      <div className="flex items-center gap-2 mb-2">
        {icon && <span className="text-base">{icon}</span>}
        <p className="text-xs font-medium text-muted uppercase tracking-wider">{label}</p>
      </div>
      <p className={`text-2xl font-bold ${color} leading-none`}>{value}</p>
      {subtitle && <p className="text-xs text-muted mt-1.5">{subtitle}</p>}
    </div>
  );
}

/* ── Trend Arrow ────────────────────────────────────────────────────────── */

function TrendArrow({ trend }: { trend?: 'up' | 'down' | 'stable' | null }) {
  if (!trend || trend === 'stable') return <span className="text-muted">→</span>;
  if (trend === 'up') return <span className="text-positive">↑</span>;
  return <span className="text-warning">↓</span>;
}

/* ── Whoop Weekly Card ──────────────────────────────────────────────────── */

function WhoopWeeklyCard({ data }: { data: WhoopWeeklySummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>🩺 Whoop Weekly</CardTitle>
      </CardHeader>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-muted mb-1">Avg Recovery</p>
          <div className="flex items-center gap-1">
            <p className="text-xl font-bold text-green-400">
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
              <span className="text-green-400">
                {new Date(data.best_recovery_day.date).toLocaleDateString(undefined, { weekday: 'short' })} ({data.best_recovery_day.score?.toFixed(0)}%)
              </span>
            </div>
          )}
          {data.worst_recovery_day && (
            <div>
              <span className="text-muted">Worst: </span>
              <span className="text-red-400">
                {new Date(data.worst_recovery_day.date).toLocaleDateString(undefined, { weekday: 'short' })} ({data.worst_recovery_day.score?.toFixed(0)}%)
              </span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ── Health Monitor Card ────────────────────────────────────────────────── */

function HealthMonitorCard({
  analysisResults,
  isAnalyzing,
  onAnalyze,
}: {
  analysisResults: any[] | null;
  isAnalyzing: boolean;
  onAnalyze: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between w-full">
          <CardTitle>🛡️ Health Monitor</CardTitle>
          <button
            onClick={onAnalyze}
            disabled={isAnalyzing}
            className="px-3 py-1.5 text-xs bg-accent/20 text-accent border border-accent/30 rounded-lg hover:bg-accent/30 transition-colors disabled:opacity-50"
          >
            {isAnalyzing ? '⏳ Analyzing...' : '🔍 Analyze Now'}
          </button>
        </div>
      </CardHeader>
      {analysisResults && analysisResults.length > 0 ? (
        <div className="space-y-3">
          {analysisResults.map((item, i) => {
            const severity = item.result?.severity || 'none';
            const borderClass = severity === 'critical' ? 'border-red-500/30 bg-red-500/10'
              : severity === 'warning' ? 'border-yellow-500/30 bg-yellow-500/10'
              : severity === 'info' ? 'border-blue-500/30 bg-blue-500/10'
              : 'border-green-500/20 bg-green-500/5';
            const badgeClass = severity === 'critical' ? 'bg-red-500/20 text-red-400'
              : severity === 'warning' ? 'bg-yellow-500/20 text-yellow-400'
              : severity === 'info' ? 'bg-blue-500/20 text-blue-400'
              : 'bg-green-500/20 text-green-400';
            const badgeText = severity === 'none' ? '✅ OK'
              : severity === 'info' ? 'ℹ️ INFO'
              : severity.toUpperCase();

            return (
              <div key={i} className={`p-3 rounded-lg border ${borderClass}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-white">{item.label}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${badgeClass}`}>{badgeText}</span>
                </div>
                {item.result?.description && (
                  <p className="text-xs text-slate-300 mt-1">{item.result.description}</p>
                )}
                {item.result?.evidence && Object.keys(item.result.evidence).length > 0 && (
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                    {Object.entries(item.result.evidence).map(([key, value]) => (
                      <div key={key} className="flex justify-between text-xs gap-2">
                        <span className="text-muted truncate">{key}</span>
                        <span className="text-slate-300 font-mono whitespace-nowrap">
                          {typeof value === 'number' ? value.toFixed(0) : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {item.error && (
                  <p className="text-xs text-red-400 mt-1">Error: {item.error}</p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-6">
          <p className="text-3xl mb-2">🏥</p>
          <p className="text-muted text-sm">Click "Analyze Now" for a comprehensive health check</p>
          <p className="text-muted text-xs mt-1">Checks overtraining risk, injury risk, and illness indicators</p>
        </div>
      )}
    </Card>
  );
}

/* ── Respiratory Rate Card ──────────────────────────────────────────────── */

function RespiratoryRateCard({ data }: { data: RespiratoryRateResponse }) {
  const trendColor = data.trend === 'elevated' ? 'text-warning' : data.trend === 'low' ? 'text-blue-400' : 'text-positive';
  const trendArrow = data.trend === 'elevated' ? '↑' : data.trend === 'low' ? '↓' : '→';

  return (
    <div className="bg-surface rounded-xl border border-surface-light/50 p-4">
      <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">🫁 Resp. Rate</p>
      <div className="flex items-baseline gap-2">
        <p className={`text-2xl font-bold ${trendColor} leading-none`}>
          {data.current_rr?.toFixed(1) ?? '—'}
        </p>
        <span className={`text-lg ${trendColor}`}>{trendArrow}</span>
      </div>
      <p className="text-xs text-muted mt-1.5">
        {data.baseline_avg_rr
          ? `Baseline: ${data.baseline_avg_rr.toFixed(1)} bpm`
          : 'Collecting baseline...'}
      </p>
      {data.trend === 'elevated' && (
        <p className="text-xs text-warning mt-1">⚠️ Above normal range</p>
      )}
    </div>
  );
}

/* ── Activity Row ───────────────────────────────────────────────────────── */

function ActivityRow({ activity }: { activity: Activity }) {
  return (
    <div className="flex items-center justify-between p-3 bg-surface-light/30 rounded-lg hover:bg-surface-light/50 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <Badge variant={getSportBadgeVariant(activity.sport_type)}>
          {activity.sport_type}
        </Badge>
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">{activity.name}</p>
          <p className="text-xs text-muted">
            {new Date(activity.start_date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </p>
        </div>
      </div>
      <div className="text-right shrink-0 ml-3">
        {activity.distance_meters && !['weighttraining', 'workout', 'crossfit', 'strength_training'].includes(activity.sport_type) && (
          <p className="text-sm text-slate-300">{formatDistance(activity.distance_meters)}</p>
        )}
        {activity.duration_seconds && (
          <p className="text-xs text-muted">{formatDuration(activity.duration_seconds)}</p>
        )}
      </div>
    </div>
  );
}

/* ── Session Row ────────────────────────────────────────────────────────── */

function SessionRow({ session }: { session: LiftingSession }) {
  return (
    <div className="flex items-center justify-between p-3 bg-surface-light/30 rounded-lg hover:bg-surface-light/50 transition-colors">
      <div>
        <p className="text-sm font-medium text-white">{session.focus || 'General'}</p>
        <p className="text-xs text-muted">
          {new Date(session.session_date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
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
  );
}

/* ── Skeleton Loaders ───────────────────────────────────────────────────── */

function MetricSkeleton() {
  return (
    <div className="bg-surface rounded-xl border border-surface-light/50 p-4 animate-pulse">
      <div className="h-3 bg-surface-light rounded w-20 mb-3"></div>
      <div className="h-7 bg-surface-light rounded w-14 mb-2"></div>
      <div className="h-3 bg-surface-light rounded w-24"></div>
    </div>
  );
}

function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="animate-pulse h-16 bg-surface-light rounded-lg"></div>
      ))}
    </div>
  );
}

/* ── Main Dashboard Page ────────────────────────────────────────────────── */

export default function DashboardPage() {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();
  const [analysisResults, setAnalysisResults] = useState<any[] | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  /* ── Queries ───────────────────────────────────────────────────────────── */

  const { data: summary, isLoading: summaryLoading } = useQuery<DashboardSummary>({
    queryKey: ['dashboard-summary'],
    queryFn: () => authFetch<DashboardSummary>('/api/v1/dashboard/summary'),
    staleTime: 60_000,
  });

  const { data: weeklyTss, isLoading: tssLoading } = useQuery<ChartData>({
    queryKey: ['chart-weekly-tss'],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/weekly_tss?weeks=12'),
    staleTime: 300_000,
  });

  const { data: activities, isLoading: activitiesLoading } = useQuery<Activity[]>({
    queryKey: ['activities-recent'],
    queryFn: () => authFetch<Activity[]>('/api/v1/activities?limit=5'),
    staleTime: 60_000,
  });

  const { data: sessions, isLoading: sessionsLoading } = useQuery<LiftingSession[]>({
    queryKey: ['lifting-sessions-recent'],
    queryFn: () => authFetch<LiftingSession[]>('/api/v1/lifting/sessions?limit=5'),
    staleTime: 60_000,
  });

  const { data: readiness } = useQuery<ReadinessResponse>({
    queryKey: ['readiness'],
    queryFn: () => authFetch<ReadinessResponse>('/api/v1/metrics/readiness'),
    staleTime: 300_000,
  });

  const { data: respiratoryRate } = useQuery<RespiratoryRateResponse>({
    queryKey: ['respiratory-rate'],
    queryFn: () => authFetch<RespiratoryRateResponse>('/api/v1/metrics/respiratory-rate'),
    staleTime: 300_000,
  });

  const { data: whoopWeekly } = useQuery<WhoopWeeklySummary>({
    queryKey: ['whoop-weekly'],
    queryFn: () => authFetch<WhoopWeeklySummary>('/api/v1/dashboard/whoop-weekly'),
    staleTime: 300_000,
  });

  const { data: strainVsRecovery } = useQuery<ChartData>({
    queryKey: ['chart-strain-vs-recovery'],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/strain_vs_recovery?days=30'),
    staleTime: 300_000,
  });

  const recentSessions = sessions?.slice(0, 5) ?? [];

  const hasReadiness = readiness && readiness.readiness !== 'unknown';
  const hasWhoop = whoopWeekly && whoopWeekly.days_with_data > 0;

  /* ── Analyze handler ───────────────────────────────────────────────────── */

  const handleAnalyze = () => {
    setIsAnalyzing(true);
    authFetch<{ analysis_results: any[] }>('/api/v1/metrics/health-alerts/analyze', { method: 'POST' })
      .then((data) => {
        setAnalysisResults(data.analysis_results || []);
        queryClient.invalidateQueries({ queryKey: ['health-alerts'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      })
      .catch(() => setAnalysisResults([]))
      .finally(() => setIsAnalyzing(false));
  };

  return (
    <div className="space-y-8">
      {/* ── Hero Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">{getGreeting()} 👋</h1>
          <p className="text-muted mt-1">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        {hasReadiness && (
          <ReadinessIndicator
            recoveryScore={readiness.recovery_score ?? undefined}
            readiness={readiness.readiness}
            hrvMs={readiness.hrv_ms ?? undefined}
            restingHr={readiness.resting_hr ?? undefined}
            message={readiness.message}
            compact
          />
        )}
      </div>

      {/* ── Status Row: Readiness + Respiratory + Key Vitals ─────────────────── */}
      {hasReadiness && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <ReadinessIndicator
            recoveryScore={readiness.recovery_score ?? undefined}
            readiness={readiness.readiness}
            hrvMs={readiness.hrv_ms ?? undefined}
            restingHr={readiness.resting_hr ?? undefined}
            message={readiness.message}
          />
          {respiratoryRate ? (
            <RespiratoryRateCard data={respiratoryRate} />
          ) : (
            <div className="bg-surface rounded-xl border border-surface-light/50 p-4 flex items-center justify-center text-muted text-sm">
              No respiratory data
            </div>
          )}
          <MetricCard
            label="Daily Strain"
            value={summary?.latest_strain?.toFixed(1) ?? '—'}
            subtitle="Whoop strain (0-21)"
            color={
              (summary?.latest_strain ?? 0) >= 14 ? 'text-warning'
              : (summary?.latest_strain ?? 0) >= 10 ? 'text-yellow-400'
              : 'text-green-400'
            }
            icon="💪"
          />
          <MetricCard
            label="Active Alerts"
            value={summary?.active_alerts_count ?? 0}
            subtitle="Health warnings"
            color={(summary?.active_alerts_count ?? 0) > 0 ? 'text-warning' : 'text-green-400'}
            icon="🔔"
          />
        </div>
      )}

      {/* ── Weekly KPI Metrics ───────────────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">This Week</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {summaryLoading ? (
            Array.from({ length: 5 }).map((_, i) => <MetricSkeleton key={i} />)
          ) : (
            <>
              <MetricCard
                label="Volume"
                value={summary ? `${summary.weekly_volume_kg.toLocaleString()} kg` : '—'}
                subtitle={`${summary?.weekly_sessions ?? 0} lifting sessions`}
                color="text-accent"
                icon="🏋️"
              />
              <MetricCard
                label="Distance"
                value={summary ? `${(summary.weekly_distance_meters / 1000).toFixed(1)} km` : '—'}
                subtitle="Cycling, running, etc."
                color="text-green-400"
                icon="🚴"
              />
              <MetricCard
                label="TSS"
                value={summary?.weekly_tss?.toFixed(0) ?? '—'}
                subtitle="Training Stress Score"
                color="text-blue-400"
                icon="⚡"
              />
              {!hasReadiness && (
                <MetricCard
                  label="Recovery"
                  value={summary?.latest_recovery?.toFixed(1) ?? '—'}
                  subtitle={summary?.latest_hrv_ms ? `HRV: ${summary.latest_hrv_ms.toFixed(0)}ms` : 'No data'}
                  color={(summary?.latest_recovery ?? 0) >= 70 ? 'text-positive' : 'text-warning'}
                  icon="❤️"
                />
              )}
              <MetricCard
                label="Strain"
                value={summary?.latest_strain?.toFixed(1) ?? '—'}
                subtitle="Whoop strain (0-21)"
                color={
                  (summary?.latest_strain ?? 0) >= 14 ? 'text-warning'
                  : (summary?.latest_strain ?? 0) >= 10 ? 'text-yellow-400'
                  : 'text-green-400'
                }
                icon="💪"
              />
              <MetricCard
                label="Alerts"
                value={summary?.active_alerts_count ?? 0}
                subtitle="Health warnings"
                color={(summary?.active_alerts_count ?? 0) > 0 ? 'text-warning' : 'text-muted'}
                icon="🔔"
              />
            </>
          )}
        </div>
      </div>

      {/* ── Health & Wellness ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <HealthMonitorCard
          analysisResults={analysisResults}
          isAnalyzing={isAnalyzing}
          onAnalyze={handleAnalyze}
        />
        {hasWhoop ? (
          <WhoopWeeklyCard data={whoopWeekly} />
        ) : (
          <Card className="flex items-center justify-center text-muted">
            <div className="text-center py-8">
              <p className="text-3xl mb-2">🩺</p>
              <p className="text-sm">Connect Whoop for weekly health insights</p>
            </div>
          </Card>
        )}
      </div>

      {/* ── Training Charts ──────────────────────────────────────────────────── */}
      <div className="space-y-6">
        <div>
          <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">Training Load</h2>
          <Card>
            {tssLoading ? (
              <div className="h-80 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-accent"></div>
              </div>
            ) : weeklyTss ? (
              <Chart data={weeklyTss} height={300} />
            ) : (
              <div className="h-80 flex items-center justify-center text-muted">
                No TSS data available
              </div>
            )}
          </Card>
        </div>

        {strainVsRecovery && strainVsRecovery.labels.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Strain vs Next-Day Recovery</CardTitle>
            </CardHeader>
            <Chart data={strainVsRecovery} height={300} />
          </Card>
        )}
      </div>

      {/* ── Recent Activity ──────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">Recent Activity</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <CardTitle>Activities</CardTitle>
                <span className="text-xs text-muted">Last 5</span>
              </div>
            </CardHeader>
            {activitiesLoading ? (
              <ListSkeleton />
            ) : activities && activities.length > 0 ? (
              <div className="space-y-2">
                {activities.map((activity) => (
                  <ActivityRow key={activity.id} activity={activity} />
                ))}
              </div>
            ) : (
              <p className="text-muted text-center py-8 text-sm">No recent activities</p>
            )}
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <CardTitle>Lifting Sessions</CardTitle>
                <span className="text-xs text-muted">Last 5</span>
              </div>
            </CardHeader>
            {sessionsLoading ? (
              <ListSkeleton />
            ) : recentSessions.length > 0 ? (
              <div className="space-y-2">
                {recentSessions.map((session) => (
                  <SessionRow key={session.id} session={session} />
                ))}
              </div>
            ) : (
              <p className="text-muted text-center py-8 text-sm">No lifting sessions yet</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
