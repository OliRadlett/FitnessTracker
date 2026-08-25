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
  HealthAnalysisResult,
  TrainingStreaks,
  Goal,
  Event,
  YearlySummary,
  TodaySummary,
  LlmAnalysis,
  DeficiencyResponse,
} from '@/lib/api';
import { ReadinessIndicator } from '@/components/ui/ReadinessIndicator';
import { getGreeting } from '@/components/dashboard/helpers';
import { WeatherWidget } from '@/components/dashboard/WeatherWidget';
import { TodayTab } from '@/components/dashboard/TodayTab';
import { WeeklyTab } from '@/components/dashboard/WeeklyTab';
import { MonthlyTab } from '@/components/dashboard/MonthlyTab';
import { usePageTitle } from '@/lib/usePageTitle';

export default function DashboardPage() {
  usePageTitle('Dashboard');
  const { authFetch } = useAuthFetch();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const currentYear = new Date().getFullYear();
  const [analysisResults, setAnalysisResults] = useState<HealthAnalysisResult[] | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [activeTab, setActiveTab] = useState<'today' | 'weekly' | 'monthly'>('today');

  /* ── Queries ───────────────────────────────────────────────────────────── */

  const { data: todaySummary, isLoading: todayLoading } = useQuery<TodaySummary>({
    queryKey: ['today-summary'],
    queryFn: () => authFetch<TodaySummary>('/api/v1/dashboard/today'),
    staleTime: 60_000,
  });

  const { data: summary, isLoading: summaryLoading } = useQuery<DashboardSummary>({
    queryKey: ['dashboard-summary'],
    queryFn: () => authFetch<DashboardSummary>('/api/v1/dashboard/summary'),
    staleTime: 60_000,
  });

  const { data: weeklyTss, isLoading: tssLoading } = useQuery<ChartData>({
    queryKey: ['chart-weekly-tss', 12],
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
    queryKey: ['chart-strain-vs-recovery', 30],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/strain_vs_recovery?days=30'),
    staleTime: 300_000,
  });

  const { data: monthlySummary, isLoading: monthlyLoading } = useQuery<MonthlySummaryItem[]>({
    queryKey: ['monthly-summary'],
    queryFn: () => authFetch<MonthlySummaryItem[]>('/api/v1/dashboard/monthly-summary?months=6'),
    staleTime: 300_000,
  });

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

  const { data: llmAnalysis, isLoading: llmLoading } = useQuery<LlmAnalysis | null>({
    queryKey: ['llm-analysis'],
    queryFn: () => authFetch<LlmAnalysis | null>('/api/v1/cycling/llm-analysis/latest'),
    staleTime: 300_000,
  });

  const { data: deficiency, isLoading: deficiencyLoading } = useQuery<DeficiencyResponse>({
    queryKey: ['deficiency'],
    queryFn: () => authFetch<DeficiencyResponse>('/api/v1/deficiency?weeks=8'),
    staleTime: 600_000,  // 10 min — expensive server-side computation
  });

  /* ── Mutations ─────────────────────────────────────────────────────────── */

  const llmMutation = useMutation({
    mutationFn: () => authFetch<LlmAnalysis>('/api/v1/cycling/llm-analysis/on-demand', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['llm-analysis'] }),
  });

  const analyzeMutation = useMutation({
    mutationFn: () =>
      authFetch<{ analysis_results: HealthAnalysisResult[] }>('/api/v1/metrics/health-alerts/analyze', { method: 'POST' }),
    onSuccess: (data) => {
      setAnalysisResults(data.analysis_results || []);
      queryClient.invalidateQueries({ queryKey: ['health-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    },
    onError: () => setAnalysisResults([]),
    onSettled: () => setIsAnalyzing(false),
  });

  const handleAnalyze = () => {
    setIsAnalyzing(true);
    analyzeMutation.mutate();
  };

  /* ── Derived values ─────────────────────────────────────────────────────── */

  const recentSessions = sessions?.slice(0, 5) ?? [];
  const hasReadiness = readiness && readiness.readiness !== 'unknown';
  const hasWhoop = whoopWeekly && whoopWeekly.days_with_data > 0;

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

  return (
    <div className="space-y-8" aria-live="polite">
      {/* ── Hero Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">{getGreeting()} 👋</h1>
          <p className="text-muted mt-1">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <div className="flex items-end gap-4">
          <WeatherWidget />
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
      </div>

      {/* ── Tab Navigation ───────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-surface rounded-xl p-1 border border-surface-light/50 w-fit">
        {(['today', 'weekly', 'monthly'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors capitalize ${
              activeTab === tab
                ? 'bg-accent text-white'
                : 'text-muted hover:text-white hover:bg-surface-light/50'
            }`}
          >
            {tab === 'today' ? '📅 Today' : tab === 'weekly' ? '📊 Weekly' : '📆 Monthly'}
          </button>
        ))}
      </div>

      {/* ── Tab Content ──────────────────────────────────────────────────────── */}
      {activeTab === 'today' && (
        <TodayTab
          todaySummary={todaySummary}
          isLoading={todayLoading}
          summary={summary}
          readiness={readiness}
          hasReadiness={!!hasReadiness}
          respiratoryRate={respiratoryRate}
          upcomingEvents={upcomingEvents}
        />
      )}

      {activeTab === 'weekly' && (
        <WeeklyTab
          summary={summary}
          summaryLoading={summaryLoading}
          readiness={readiness}
          hasReadiness={!!hasReadiness}
          respiratoryRate={respiratoryRate}
          whoopWeekly={whoopWeekly}
          hasWhoop={!!hasWhoop}
          weeklyTss={weeklyTss}
          tssLoading={tssLoading}
          strainVsRecovery={strainVsRecovery}
          activities={activities}
          activitiesLoading={activitiesLoading}
          sessions={sessions}
          sessionsLoading={sessionsLoading}
          recentSessions={recentSessions}
          streaks={streaks}
          goals={goals}
          deficiency={deficiency}
          deficiencyLoading={deficiencyLoading}
          monthlySummary={monthlySummary}
          selectedYear={selectedYear}
          setSelectedYear={setSelectedYear}
          currentYear={currentYear}
          yearlySummary={yearlySummary}
          yearlyLoading={yearlyLoading}
          upcomingEvents={upcomingEvents}
          llmAnalysis={llmAnalysis}
          llmLoading={llmLoading}
          onRefreshLlm={() => llmMutation.mutate()}
          isRefreshingLlm={llmMutation.isPending}
          analysisResults={analysisResults}
          isAnalyzing={isAnalyzing}
          onAnalyze={handleAnalyze}
          onDownloadReport={handleDownloadReport}
          getCurrentMonday={getCurrentMonday}
        />
      )}

      {activeTab === 'monthly' && (
        <MonthlyTab
          monthlySummary={monthlySummary}
          isLoading={monthlyLoading}
          selectedYear={selectedYear}
          setSelectedYear={setSelectedYear}
          currentYear={currentYear}
          yearlySummary={yearlySummary}
          yearlyLoading={yearlyLoading}
        />
      )}
    </div>
  );
}
