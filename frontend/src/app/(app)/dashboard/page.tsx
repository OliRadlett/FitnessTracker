'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import { useSession } from 'next-auth/react';
import type {
  DashboardSummary,
  MonthlySummaryItem,
  ChartData,
  Activity,
  LiftingSession,
  ReadinessResponse,
  RespiratoryRateResponse,
  WhoopWeeklySummary,
  HealthAlert,
  HealthAnalysisResult,
  TrainingStreaks,
  Goal,
  CreateGoalPayload,
  Event,
  YearlySummary,
} from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, getSportBadgeVariant } from '@/components/ui/Badge';
import { Chart } from '@/components/charts/Chart';
import { ReadinessIndicator } from '@/components/ui/ReadinessIndicator';
import { SkeletonMetric, SkeletonChart, SkeletonRow } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { GoalCard, GoalForm } from '@/components/ui/GoalCard';

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
  analysisResults: HealthAnalysisResult[] | null;
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
            aria-label="Run health analysis"
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

function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2" aria-label="Loading data">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

/* ── Main Dashboard Page ────────────────────────────────────────────────── */

export default function DashboardPage() {
  const { authFetch } = useAuthFetch();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const currentYear = new Date().getFullYear();
  const [analysisResults, setAnalysisResults] = useState<HealthAnalysisResult[] | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [selectedYear, setSelectedYear] = useState(currentYear);

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

  const { data: monthlySummary, isLoading: monthlyLoading } = useQuery<MonthlySummaryItem[]>({
    queryKey: ['monthly-summary'],
    queryFn: () => authFetch<MonthlySummaryItem[]>('/api/v1/dashboard/monthly-summary?months=6'),
    staleTime: 300_000,
  });

  // ── Streaks + Goals ────────────────────────────────────────────────────

  const { data: streaks } = useQuery<TrainingStreaks>({
    queryKey: ['training-streaks'],
    queryFn: () => authFetch<TrainingStreaks>('/api/v1/dashboard/streaks'),
    staleTime: 300_000,
  });

  const { data: goals } = useQuery<Goal[]>({
    queryKey: ['goals'],
    queryFn: () => authFetch<Goal[]>('/api/v1/goals'),
    staleTime: 60_000,
  });

  const { data: yearlySummary, isLoading: yearlyLoading } = useQuery<YearlySummary>({
    queryKey: ['yearly-summary', selectedYear],
    queryFn: () => authFetch<YearlySummary>(`/api/v1/dashboard/yearly-summary/${selectedYear}`),
    staleTime: 300_000,
  });

  const { data: upcomingEvents } = useQuery<Event[]>({
    queryKey: ['events', 'upcoming'],
    queryFn: () => authFetch<Event[]>('/api/v1/events?upcoming_only=true'),
    staleTime: 60_000,
  });

  const createGoalMutation = useMutation({
    mutationFn: (payload: CreateGoalPayload) =>
      authFetch<Goal>('/api/v1/goals', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      setShowGoalForm(false);
    },
  });

  const achieveGoalMutation = useMutation({
    mutationFn: (goalId: string) =>
      authFetch<Goal>(`/api/v1/goals/${goalId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'achieved' }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['goals'] }),
  });

  const deleteGoalMutation = useMutation({
    mutationFn: (goalId: string) =>
      authFetch<void>(`/api/v1/goals/${goalId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['goals'] }),
  });

  const recentSessions = sessions?.slice(0, 5) ?? [];

  const hasReadiness = readiness && readiness.readiness !== 'unknown';
  const hasWhoop = whoopWeekly && whoopWeekly.days_with_data > 0;

  /* ── Analyze handler ───────────────────────────────────────────────────── */

  const handleAnalyze = () => {
    setIsAnalyzing(true);
    authFetch<{ analysis_results: HealthAnalysisResult[] }>('/api/v1/metrics/health-alerts/analyze', { method: 'POST' })
      .then((data) => {
        setAnalysisResults(data.analysis_results || []);
        queryClient.invalidateQueries({ queryKey: ['health-alerts'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      })
      .catch(() => setAnalysisResults([]))
      .finally(() => setIsAnalyzing(false));
  };

  /* ── PDF report download ──────────────────────────────────────────────── */

  async function handleDownloadReport(apiPath: string, filename: string) {
    try {
      const response = await fetch(apiPath, {
        headers: session?.backendToken ? { Authorization: `Bearer ${session.backendToken}` } : {},
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Report download failed:', err);
    }
  }

  function getCurrentMonday(): string {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now.setDate(diff));
    return monday.toISOString().split('T')[0];
  }

  // Check if dashboard has any data at all
  const hasAnyData = !!(summary && (
    summary.weekly_volume_kg > 0 ||
    summary.weekly_distance_meters > 0 ||
    summary.weekly_sessions > 0 ||
    (activities && activities.length > 0) ||
    (sessions && sessions.length > 0)
  ));

  return (
    <div className="space-y-8" aria-live="polite">
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

      {/* ── Rest Day Suggestion / Training Readiness ─────────────────────────── */}
      {summary?.rest_day_suggestion && (() => {
        const rds = summary.rest_day_suggestion;
        const isWarning = rds.should_rest;
        return (
          <div className={`rounded-xl p-4 flex items-start gap-3 border ${
            isWarning
              ? 'bg-amber-900/30 border-amber-500/30'
              : 'bg-surface border-surface-light/50'
          }`}>
            <span className="text-2xl">{isWarning ? '💡' : '✅'}</span>
            <div className="flex-1">
              <p className={`font-medium ${isWarning ? 'text-amber-200' : 'text-green-300'}`}>
                {isWarning ? 'Consider a rest day today' : 'Training readiness looks good'}
              </p>
              {/* Contributing factors always visible */}
              <div className="mt-2 grid grid-cols-3 gap-3 text-xs">
                <div>
                  <p className="text-muted uppercase tracking-wider">TSB (Form)</p>
                  <p className={`font-mono font-bold ${
                    (rds.current_tsb ?? 0) < -30 ? 'text-red-400'
                    : (rds.current_tsb ?? 0) < -10 ? 'text-amber-400'
                    : (rds.current_tsb ?? 0) > 10 ? 'text-green-400'
                    : 'text-blue-400'
                  }`}>
                    {rds.current_tsb?.toFixed(0) ?? '—'}
                  </p>
                </div>
                <div>
                  <p className="text-muted uppercase tracking-wider">Recovery</p>
                  <p className={`font-mono font-bold ${
                    (rds.latest_recovery ?? 0) >= 70 ? 'text-green-400'
                    : (rds.latest_recovery ?? 0) >= 50 ? 'text-amber-400'
                    : 'text-red-400'
                  }`}>
                    {rds.latest_recovery?.toFixed(0) ?? '—'}%
                  </p>
                </div>
                <div>
                  <p className="text-muted uppercase tracking-wider">Consecutive Days</p>
                  <p className={`font-mono font-bold ${
                    rds.consecutive_training_days >= 7 ? 'text-red-400'
                    : rds.consecutive_training_days >= 4 ? 'text-amber-400'
                    : 'text-green-400'
                  }`}>
                    {rds.consecutive_training_days}
                  </p>
                </div>
              </div>
              {/* Reasons */}
              {rds.reasons.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {rds.reasons.map((reason, i) => (
                    <li key={i} className={`text-sm ${isWarning ? 'text-amber-300/80' : 'text-muted'}`}>• {reason}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Upcoming Events Banner ──────────────────────────────────────────── */}
      {upcomingEvents && upcomingEvents.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {upcomingEvents.slice(0, 3).map(evt => (
            <div
              key={evt.id}
              className={`rounded-xl p-4 border ${
                evt.is_in_taper
                  ? 'bg-purple-900/20 border-purple-500/30'
                  : 'bg-surface border-surface-light/50'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">{evt.event_type === 'race' ? '🏁' : evt.event_type === 'ride' ? '🚴' : evt.event_type === 'lift' ? '🏋️' : '📌'}</span>
                <div>
                  <p className="text-white font-medium text-sm">{evt.name}</p>
                  <p className="text-xs text-muted">{evt.event_date}</p>
                </div>
              </div>
              <p className="text-sm mt-2">
                {evt.days_until === 0 ? (
                  <span className="text-accent font-bold">🎯 Today!</span>
                ) : (
                  <span className="text-white">🎯 <strong>{evt.days_until}</strong> days away</span>
                )}
              </p>
              {evt.is_in_taper && (
                <p className="text-xs text-purple-300 mt-1">📉 Taper phase — reduce load</p>
              )}
              {evt.days_until_taper !== undefined && evt.days_until_taper > 0 && evt.days_until_taper <= 14 && (
                <p className="text-xs text-muted mt-1">Taper starts in {evt.days_until_taper} days</p>
              )}
            </div>
          ))}
        </div>
      )}

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
            Array.from({ length: 5 }).map((_, i) => <SkeletonMetric key={i} />)
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
              <SkeletonChart height={300} />
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
              <div className="text-center py-8">
                <p className="text-3xl mb-2" aria-hidden="true">🏃</p>
                <p className="text-muted text-sm">No recent activities</p>
                <p className="text-muted text-xs mt-1">
                  <a href="/settings" className="text-accent hover:text-accent-hover">Connect Strava</a> to start syncing
                </p>
              </div>
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
              <div className="text-center py-8">
                <p className="text-3xl mb-2" aria-hidden="true">🏋️</p>
                <p className="text-muted text-sm">No lifting sessions yet</p>
                <a href="/lifting" className="text-accent hover:text-accent-hover text-xs mt-1 inline-block">Create your first session</a>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ── Training Streaks ─────────────────────────────────────────────── */}
      {streaks && (
        <div>
          <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">Training Streaks</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard
              label="Current Streak"
              value={streaks.current_streak_days > 0 ? `${streaks.current_streak_days} days` : '—'}
              subtitle={streaks.current_streak_days > 0 ? 'Keep it going!' : 'Start training today'}
              color="text-orange-400"
              icon="🔥"
            />
            <MetricCard
              label="Longest Streak"
              value={streaks.longest_streak_days > 0 ? `${streaks.longest_streak_days} days` : '—'}
              subtitle="All-time record"
              color="text-yellow-400"
              icon="🏆"
            />
            <MetricCard
              label="Weekly Consistency"
              value={streaks.weekly_consistency_pct > 0 ? `${streaks.weekly_consistency_pct}%` : '—'}
              subtitle="Weeks with ≥3 sessions"
              color={
                streaks.weekly_consistency_pct >= 75 ? 'text-green-400'
                : streaks.weekly_consistency_pct >= 50 ? 'text-yellow-400'
                : 'text-red-400'
              }
              icon="📊"
            />
            <MetricCard
              label="This Month"
              value={
                streaks.monthly_sessions.length > 0
                  ? `${streaks.monthly_sessions[streaks.monthly_sessions.length - 1].sessions}`
                  : '0'
              }
              subtitle="Total sessions"
              color="text-blue-400"
              icon="📅"
            />
          </div>

          {/* Monthly session bars */}
          {streaks.monthly_sessions.length > 0 && (
            <div className="mt-4 flex items-end gap-2 h-20">
              {streaks.monthly_sessions.map((m) => {
                const maxSessions = Math.max(...streaks.monthly_sessions.map((s) => s.sessions), 1);
                const heightPct = (m.sessions / maxSessions) * 100;
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] text-muted font-medium">{m.sessions}</span>
                    <div className="w-full bg-surface-light/40 rounded-t" style={{ height: `${Math.max(heightPct, 4)}%` }}>
                      <div className="w-full h-full bg-accent/60 rounded-t" />
                    </div>
                    <span className="text-[10px] text-muted">{m.month.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Goals ───────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted uppercase tracking-wider">Training Goals</h2>
          <button
            onClick={() => setShowGoalForm(!showGoalForm)}
            className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
          >
            {showGoalForm ? 'Cancel' : '+ New Goal'}
          </button>
        </div>

        {showGoalForm && (
          <div className="mb-4">
            <GoalForm
              onSubmit={(data) => createGoalMutation.mutate(data)}
              onCancel={() => setShowGoalForm(false)}
              isPending={createGoalMutation.isPending}
            />
          </div>
        )}

        {goals && goals.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {goals.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                onAchieve={goal.status === 'active' && (goal.current_value ?? 0) >= goal.target_value
                  ? () => achieveGoalMutation.mutate(goal.id)
                  : undefined}
                onDelete={() => deleteGoalMutation.mutate(goal.id)}
              />
            ))}
          </div>
        ) : !showGoalForm ? (
          <Card>
            <div className="text-center py-6">
              <p className="text-3xl mb-2">🎯</p>
              <p className="text-muted text-sm">No goals set yet</p>
              <p className="text-muted text-xs mt-1">Set targets for FTP, 1RM, weekly sessions, or distance</p>
            </div>
          </Card>
        ) : null}
      </div>

      {/* ── Monthly Summary ──────────────────────────────────────────────── */}
      {monthlySummary && monthlySummary.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">Monthly Summary</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {monthlySummary.map((month, i) => {
              const prevMonth = i < monthlySummary.length - 1 ? monthlySummary[i + 1] : null;
              const tssTrend = prevMonth && prevMonth.total_tss > 0
                ? ((month.total_tss - prevMonth.total_tss) / prevMonth.total_tss * 100)
                : null;
              const volTrend = prevMonth && prevMonth.lifting_volume_kg > 0
                ? ((month.lifting_volume_kg - prevMonth.lifting_volume_kg) / prevMonth.lifting_volume_kg * 100)
                : null;
              return (
                <Card key={month.month}>
                  <CardHeader>
                    <div className="flex items-center justify-between w-full">
                      <CardTitle>{new Date(month.month + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</CardTitle>
                      {month.pr_count > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
                          🏆 {month.pr_count} PR{month.pr_count > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted">TSS</p>
                      <div className="flex items-center gap-1">
                        <p className="text-sm font-bold text-blue-400">{month.total_tss.toFixed(0)}</p>
                        {tssTrend !== null && (
                          <span className={`text-xs ${tssTrend > 5 ? 'text-positive' : tssTrend < -5 ? 'text-warning' : 'text-muted'}`}>
                            {tssTrend > 0 ? '↑' : tssTrend < 0 ? '↓' : '→'}
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Lifting Volume</p>
                      <div className="flex items-center gap-1">
                        <p className="text-sm font-bold text-purple-400">{(month.lifting_volume_kg / 1000).toFixed(1)}k kg</p>
                        {volTrend !== null && (
                          <span className={`text-xs ${volTrend > 5 ? 'text-positive' : volTrend < -5 ? 'text-warning' : 'text-muted'}`}>
                            {volTrend > 0 ? '↑' : volTrend < 0 ? '↓' : '→'}
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Distance</p>
                      <p className="text-sm font-bold text-green-400">{(month.total_distance_meters / 1000).toFixed(0)} km</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Time</p>
                      <p className="text-sm font-bold text-slate-300">{(month.total_time_seconds / 3600).toFixed(1)}h</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Sessions</p>
                      <p className="text-sm font-bold text-white">
                        {month.lifting_sessions + month.cardio_sessions}
                        <span className="text-xs text-muted ml-1">
                          ({month.lifting_sessions}🏋️ {month.cardio_sessions}🚴)
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Avg Recovery</p>
                      <p className={`text-sm font-bold ${
                        (month.avg_recovery ?? 0) >= 70 ? 'text-green-400'
                        : (month.avg_recovery ?? 0) >= 50 ? 'text-yellow-400'
                        : 'text-red-400'
                      }`}>
                        {month.avg_recovery?.toFixed(0) ?? '—'}%
                      </p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Download Reports ─────────────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">Download Reports</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => handleDownloadReport(
              `/api/v1/export/weekly-report/${getCurrentMonday()}`,
              `fittrack_weekly_${getCurrentMonday()}.pdf`,
            )}
            className="px-4 py-2 text-sm font-medium bg-surface-light hover:bg-surface text-white rounded-lg transition-colors border border-surface-light"
          >
            📄 Weekly Report (PDF)
          </button>
          <button
            onClick={() => {
              const m = `${currentYear}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
              handleDownloadReport(
                `/api/v1/export/monthly-report/${m}`,
                `fittrack_monthly_${m}.pdf`,
              );
            }}
            className="px-4 py-2 text-sm font-medium bg-surface-light hover:bg-surface text-white rounded-lg transition-colors border border-surface-light"
          >
            📄 Monthly Report (PDF)
          </button>
        </div>
      </div>

      {/* ── Yearly Summary ──────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted uppercase tracking-wider">
            {selectedYear} Year in Review
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedYear((y) => y - 1)}
              className="px-2 py-1 text-xs bg-surface-light hover:bg-surface text-muted rounded-lg transition-colors"
            >
              ← {selectedYear - 1}
            </button>
            {selectedYear < currentYear && (
              <button
                onClick={() => setSelectedYear((y) => Math.min(y + 1, currentYear))}
                className="px-2 py-1 text-xs bg-surface-light hover:bg-surface text-muted rounded-lg transition-colors"
              >
                {selectedYear + 1} →
              </button>
            )}
            {selectedYear !== currentYear && (
              <button
                onClick={() => setSelectedYear(currentYear)}
                className="px-2 py-1 text-xs bg-accent/20 text-accent border border-accent/30 rounded-lg hover:bg-accent/30 transition-colors"
              >
                Current Year
              </button>
            )}
          </div>
        </div>

        {yearlyLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonMetric key={i} />)}
          </div>
        ) : yearlySummary ? (
          <div className="space-y-6">
            {/* Year-over-year comparison badges */}
            {yearlySummary.year_over_year && (
              <div className="flex flex-wrap gap-2">
                {[
                  { label: 'Activities', value: yearlySummary.year_over_year.activities_delta, pct: yearlySummary.year_over_year.activities_pct },
                  { label: 'TSS', value: Math.round(yearlySummary.year_over_year.tss_delta), pct: yearlySummary.year_over_year.tss_pct },
                  { label: 'Distance', value: Math.round(yearlySummary.year_over_year.distance_delta_m / 1000), pct: yearlySummary.year_over_year.distance_pct, unit: 'km' },
                  { label: 'Lifting Vol', value: Math.round(yearlySummary.year_over_year.lifting_volume_delta_kg / 1000), pct: yearlySummary.year_over_year.lifting_volume_pct, unit: 'k kg' },
                  { label: 'PRs', value: yearlySummary.year_over_year.prs_delta, pct: null },
                ].map((item) => (
                  <span
                    key={item.label}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${
                      (item.value ?? 0) > 0 ? 'bg-green-500/15 text-green-400 border border-green-500/20'
                      : (item.value ?? 0) < 0 ? 'bg-red-500/15 text-red-400 border border-red-500/20'
                      : 'bg-surface-light text-muted border border-surface-light'
                    }`}
                  >
                    {item.label}: {item.value > 0 ? '+' : ''}{item.value}{item.unit ? ` ${item.unit}` : ''}
                    {item.pct !== null && item.pct !== undefined && (
                      <span className="opacity-75">({item.pct > 0 ? '+' : ''}{item.pct.toFixed(0)}%)</span>
                    )}
                  </span>
                ))}
                <span className="text-xs text-muted self-center ml-1">vs {selectedYear - 1}</span>
              </div>
            )}

            {/* Year totals */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <MetricCard
                label="Activities"
                value={yearlySummary.total_activities}
                subtitle="Cardio sessions"
                color="text-blue-400"
                icon="🚴"
              />
              <MetricCard
                label="Distance"
                value={`${(yearlySummary.total_distance_m / 1000).toFixed(0)} km`}
                subtitle="Total distance"
                color="text-green-400"
                icon="📏"
              />
              <MetricCard
                label="TSS"
                value={yearlySummary.total_tss.toFixed(0)}
                subtitle="Training Stress"
                color="text-accent"
                icon="⚡"
              />
              <MetricCard
                label="Lifting"
                value={`${yearlySummary.total_lifting_sessions}`}
                subtitle={`${(yearlySummary.total_lifting_volume_kg / 1000).toFixed(0)}k kg vol`}
                color="text-purple-400"
                icon="🏋️"
              />
              <MetricCard
                label="Time"
                value={`${(yearlySummary.total_time_s / 3600).toFixed(0)}h`}
                subtitle="Cardio hours"
                color="text-slate-300"
                icon="⏱️"
              />
              <MetricCard
                label="Recovery"
                value={yearlySummary.avg_recovery ? `${yearlySummary.avg_recovery.toFixed(0)}%` : '—'}
                subtitle={yearlySummary.avg_hrv_ms ? `HRV: ${yearlySummary.avg_hrv_ms.toFixed(0)}ms` : 'Avg recovery'}
                color={(yearlySummary.avg_recovery ?? 0) >= 70 ? 'text-green-400' : 'text-yellow-400'}
                icon="❤️"
              />
            </div>

            {/* Highlight cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Best month */}
              {yearlySummary.highlights.best_month_tss && (
                <div className="bg-surface rounded-xl border border-surface-light/50 p-4">
                  <p className="text-xs font-medium text-muted uppercase tracking-wider mb-1">🏆 Best Month (TSS)</p>
                  <p className="text-lg font-bold text-yellow-400">
                    {new Date(yearlySummary.highlights.best_month_tss + '-01').toLocaleDateString(undefined, { month: 'long' })}
                  </p>
                  <p className="text-xs text-muted">{yearlySummary.highlights.best_month_tss_value.toFixed(0)} TSS</p>
                </div>
              )}

              {/* Total PRs */}
              <div className="bg-surface rounded-xl border border-surface-light/50 p-4">
                <p className="text-xs font-medium text-muted uppercase tracking-wider mb-1">🏅 Total PRs</p>
                <p className="text-lg font-bold text-orange-400">{yearlySummary.highlights.total_prs}</p>
                <p className="text-xs text-muted">Personal records set</p>
              </div>

              {/* Longest ride */}
              {yearlySummary.highlights.longest_ride && (
                <div className="bg-surface rounded-xl border border-surface-light/50 p-4">
                  <p className="text-xs font-medium text-muted uppercase tracking-wider mb-1">🚴 Longest Ride</p>
                  <p className="text-lg font-bold text-green-400">{yearlySummary.highlights.longest_ride.value} {yearlySummary.highlights.longest_ride.unit}</p>
                  <p className="text-xs text-muted truncate">{yearlySummary.highlights.longest_ride.name}</p>
                </div>
              )}

              {/* Heaviest lift */}
              {yearlySummary.highlights.heaviest_lift && (
                <div className="bg-surface rounded-xl border border-surface-light/50 p-4">
                  <p className="text-xs font-medium text-muted uppercase tracking-wider mb-1">🏋️ Heaviest Lift</p>
                  <p className="text-lg font-bold text-purple-400">{yearlySummary.highlights.heaviest_lift.value} {yearlySummary.highlights.heaviest_lift.unit}</p>
                  <p className="text-xs text-muted truncate">{yearlySummary.highlights.heaviest_lift.name}</p>
                </div>
              )}
            </div>

            {/* PR highlights table */}
            {yearlySummary.highlights.pr_highlights.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>🏅 PR Highlights</CardTitle>
                </CardHeader>
                <div className="space-y-2">
                  {yearlySummary.highlights.pr_highlights.map((pr, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-surface-light/30 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-white">{pr.exercise_name}</p>
                        <p className="text-xs text-muted">
                          {pr.record_type} — {pr.weight_kg}kg × {pr.reps}
                          {pr.estimated_1rm && ` (1RM: ${pr.estimated_1rm.toFixed(1)}kg)`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted">{new Date(pr.achieved_date).toLocaleDateString()}</p>
                        {pr.improvement_pct !== null && pr.improvement_pct !== undefined && (
                          <span className={`text-xs font-medium ${pr.improvement_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {pr.improvement_pct > 0 ? '+' : ''}{pr.improvement_pct}%
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Monthly bar charts */}
            {yearlySummary.months.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* TSS by month */}
                <Card>
                  <CardHeader>
                    <CardTitle>Monthly TSS</CardTitle>
                  </CardHeader>
                  <div className="flex items-end gap-1.5 h-32">
                    {yearlySummary.months.map((m) => {
                      const maxTss = Math.max(...yearlySummary.months.map((x) => x.total_tss), 1);
                      const h = (m.total_tss / maxTss) * 100;
                      return (
                        <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-[9px] text-muted">{m.total_tss > 0 ? Math.round(m.total_tss) : ''}</span>
                          <div className="w-full bg-surface-light/40 rounded-t" style={{ height: `${Math.max(h, 2)}%` }}>
                            <div className="w-full h-full bg-blue-500/60 rounded-t" />
                          </div>
                          <span className="text-[9px] text-muted">{m.month.slice(5)}</span>
                        </div>
                      );
                    })}
                  </div>
                </Card>

                {/* Distance by month */}
                <Card>
                  <CardHeader>
                    <CardTitle>Monthly Distance (km)</CardTitle>
                  </CardHeader>
                  <div className="flex items-end gap-1.5 h-32">
                    {yearlySummary.months.map((m) => {
                      const km = m.total_distance_meters / 1000;
                      const maxKm = Math.max(...yearlySummary.months.map((x) => x.total_distance_meters / 1000), 1);
                      const h = (km / maxKm) * 100;
                      return (
                        <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-[9px] text-muted">{km > 0 ? Math.round(km) : ''}</span>
                          <div className="w-full bg-surface-light/40 rounded-t" style={{ height: `${Math.max(h, 2)}%` }}>
                            <div className="w-full h-full bg-green-500/60 rounded-t" />
                          </div>
                          <span className="text-[9px] text-muted">{m.month.slice(5)}</span>
                        </div>
                      );
                    })}
                  </div>
                </Card>

                {/* Volume by month */}
                <Card>
                  <CardHeader>
                    <CardTitle>Monthly Volume (k kg)</CardTitle>
                  </CardHeader>
                  <div className="flex items-end gap-1.5 h-32">
                    {yearlySummary.months.map((m) => {
                      const vol = m.lifting_volume_kg / 1000;
                      const maxVol = Math.max(...yearlySummary.months.map((x) => x.lifting_volume_kg / 1000), 1);
                      const h = (vol / maxVol) * 100;
                      return (
                        <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-[9px] text-muted">{vol > 0 ? vol.toFixed(1) : ''}</span>
                          <div className="w-full bg-surface-light/40 rounded-t" style={{ height: `${Math.max(h, 2)}%` }}>
                            <div className="w-full h-full bg-purple-500/60 rounded-t" />
                          </div>
                          <span className="text-[9px] text-muted">{m.month.slice(5)}</span>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>
            )}
          </div>
        ) : (
          <Card>
            <div className="text-center py-8">
              <p className="text-3xl mb-2">📅</p>
              <p className="text-muted text-sm">No data for {selectedYear} yet</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
