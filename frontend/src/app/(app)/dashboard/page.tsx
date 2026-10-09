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
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/Toast';
import { ErrorState } from '@/components/ui/ErrorState';
import { getGreeting, getActiveLocale } from '@/lib/utils';
import { WeatherWidget } from '@/components/dashboard/WeatherWidget';
import { DashboardRefresh } from '@/components/dashboard/DashboardRefresh';
import { useAthleteState } from '@/lib/athlete';
import { LoadStrip, SyncBadge, VerdictCard } from '@/components/athlete';
import { sportLabel } from '@/lib/sportUtils';
import { TodayTab } from '@/components/dashboard/TodayTab';
import { WeeklyTab } from '@/components/dashboard/WeeklyTab';
import { MonthlyTab } from '@/components/dashboard/MonthlyTab';
import { usePageTitle } from '@/lib/usePageTitle';

export default function DashboardPage() {
  usePageTitle('Dashboard');
  const { authFetch, token } = useAuthFetch();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const currentYear = new Date().getFullYear();
  const [analysisResults, setAnalysisResults] = useState<HealthAnalysisResult[] | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [activeTab, setActiveTab] = useState<'today' | 'weekly' | 'monthly'>('today');

  /* ── Phase 1 shared athlete slots (plans/ui-redesign-v2.md §1.3) ──────────
     The VerdictCard props below are IDENTICAL to the /today slot (verdict,
     planContext, tsb, sleepDebtHours, isLoading — no per-page forks), so the
     dashboard/TODAY contradiction dies by construction. LoadStrip is the
     single home for CTL/ATL/TSB display; SyncBadge rides in its slot so
     degradation is shown, never averaged away. Display only — no computation
     changes (docs/algorithms.md authoritative). */
  const athlete = useAthleteState();
  const verdictTodaySlice = athlete.plan.today;
  const verdictPlanContext = athlete.plan.activePlan
    ? {
        planName: athlete.plan.activePlan.name,
        dayLabel:
          verdictTodaySlice && verdictTodaySlice.sport !== 'rest'
            ? verdictTodaySlice.workout_description || sportLabel(verdictTodaySlice.sport)
            : null,
      }
    : null;
  const verdictIsLoading = athlete.verdict.isLoading || athlete.plan.isLoading;

  /* ── Queries ───────────────────────────────────────────────────────────── */

  const {
    data: todaySummary,
    isLoading: todayLoading,
    isError: todayError,
  } = useQuery<TodaySummary>({
    queryKey: ['today-summary'],
    queryFn: () => authFetch<TodaySummary>('/api/v1/dashboard/today'),
    enabled: !!token,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
  } = useQuery<DashboardSummary>({
    queryKey: ['dashboard-summary'],
    queryFn: () => authFetch<DashboardSummary>('/api/v1/dashboard/summary'),
    enabled: !!token,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const { data: weeklyTss, isLoading: tssLoading } = useQuery<ChartData>({
    queryKey: ['chart-weekly-tss', 12],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/weekly_tss?weeks=12'),
    enabled: activeTab === 'weekly' && !!token,
    staleTime: 300_000,
    refetchOnWindowFocus: true,
  });

  const { data: activities, isLoading: activitiesLoading } = useQuery<Activity[]>({
    queryKey: ['activities-recent'],
    queryFn: () => authFetch<Activity[]>('/api/v1/activities?limit=5'),
    enabled: activeTab === 'weekly' && !!token,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const { data: sessions, isLoading: sessionsLoading } = useQuery<LiftingSession[]>({
    queryKey: ['lifting-sessions-recent'],
    queryFn: () => authFetch<LiftingSession[]>('/api/v1/lifting/sessions?limit=5'),
    enabled: activeTab === 'weekly' && !!token,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const { data: readiness } = useQuery<ReadinessResponse>({
    queryKey: ['readiness'],
    queryFn: () => authFetch<ReadinessResponse>('/api/v1/metrics/readiness'),
    enabled: !!token,
    staleTime: 300_000,
    refetchOnWindowFocus: true,
  });

  const { data: respiratoryRate } = useQuery<RespiratoryRateResponse>({
    queryKey: ['respiratory-rate'],
    queryFn: () => authFetch<RespiratoryRateResponse>('/api/v1/metrics/respiratory-rate'),
    enabled: !!token,
    staleTime: 300_000,
    refetchOnWindowFocus: true,
  });

  const { data: whoopWeekly } = useQuery<WhoopWeeklySummary>({
    queryKey: ['whoop-weekly'],
    queryFn: () => authFetch<WhoopWeeklySummary>('/api/v1/dashboard/whoop-weekly'),
    enabled: activeTab === 'weekly' && !!token,
    staleTime: 300_000,
    refetchOnWindowFocus: true,
  });

  const { data: strainVsRecovery } = useQuery<ChartData>({
    queryKey: ['chart-strain-vs-recovery', 30],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/strain_vs_recovery?days=30'),
    enabled: activeTab === 'weekly' && !!token,
    staleTime: 300_000,
    refetchOnWindowFocus: true,
  });

  const { data: monthlySummary, isLoading: monthlyLoading } = useQuery<MonthlySummaryItem[]>({
    queryKey: ['monthly-summary'],
    queryFn: () => authFetch<MonthlySummaryItem[]>('/api/v1/dashboard/monthly-summary?months=6'),
    enabled: (activeTab === 'weekly' || activeTab === 'monthly') && !!token,
    staleTime: 300_000,
    refetchOnWindowFocus: true,
  });

  const { data: streaks } = useQuery<TrainingStreaks>({
    queryKey: ['training-streaks'],
    queryFn: () => authFetch<TrainingStreaks>('/api/v1/dashboard/streaks'),
    enabled: activeTab === 'weekly' && !!token,
    staleTime: 300_000,
    refetchOnWindowFocus: true,
  });

  const { data: goals } = useQuery<Goal[]>({
    queryKey: ['goals'],
    queryFn: () => authFetch<Goal[]>('/api/v1/goals'),
    // QW6 — GoalsSection renders on both Today (compact top-3) and Weekly.
    enabled: (activeTab === 'weekly' || activeTab === 'today') && !!token,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const { data: yearlySummary, isLoading: yearlyLoading } = useQuery<YearlySummary>({
    queryKey: ['yearly-summary', selectedYear],
    queryFn: () => authFetch<YearlySummary>(`/api/v1/dashboard/yearly-summary/${selectedYear}`),
    enabled: (activeTab === 'weekly' || activeTab === 'monthly') && !!token,
    staleTime: 300_000,
    refetchOnWindowFocus: true,
  });

  const { data: upcomingEvents } = useQuery<Event[]>({
    queryKey: ['events', 'upcoming'],
    queryFn: () => authFetch<Event[]>('/api/v1/events?upcoming_only=true'),
    enabled: !!token,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const { data: llmAnalysis, isLoading: llmLoading } = useQuery<LlmAnalysis | null>({
    queryKey: ['llm-analysis'],
    queryFn: () => authFetch<LlmAnalysis | null>('/api/v1/cycling/llm-analysis/latest'),
    enabled: activeTab === 'weekly' && !!token,
    staleTime: 300_000,
    refetchOnWindowFocus: true,
  });

  const { data: deficiency, isLoading: deficiencyLoading } = useQuery<DeficiencyResponse>({
    queryKey: ['deficiency'],
    queryFn: () => authFetch<DeficiencyResponse>('/api/v1/deficiency?weeks=8'),
    enabled: activeTab === 'weekly' && !!token,
    staleTime: 600_000,  // 10 min — expensive server-side computation
    refetchOnWindowFocus: true,
  });

  /* ── Mutations ─────────────────────────────────────────────────────────── */

  const llmMutation = useMutation({
    mutationFn: () => authFetch<LlmAnalysis>('/api/v1/cycling/llm-analysis/on-demand', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['llm-analysis'] }),
    onError: (err) => toast.error(`Analysis request failed: ${(err as Error)?.message || 'please try again.'}`),
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
  const hasQueryError = todayError || summaryError;

  const [downloadError, setDownloadError] = useState<string | null>(null);

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
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
      setTimeout(() => setDownloadError(null), 5000);
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
      {/* ── Error Banner ────────────────────────────────────────────────────── */}
      {downloadError && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-warning text-sm">
          <span>{downloadError}</span>
          <button
            onClick={() => setDownloadError(null)}
            className="shrink-0 text-warning hover:text-warning/80"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Core query error banner ─────────────────────────────────────────── */}
      <ErrorState variant="inline"
        show={hasQueryError}
        message="Some dashboard data failed to load."
      />

      {/* ── Hero Header ─────────────────────────────────────────────────────── */}
      <PageHeader
        title={<>{getGreeting()} 👋</>}
        subtitle={new Date().toLocaleDateString(getActiveLocale(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        actions={
          <>
            <DashboardRefresh />
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
          </>
        }
      />

      {/* ── Phase 1 shared slots: overview home keeps its banner position ──── */}
      <VerdictCard
        verdict={athlete.verdict.verdict}
        planContext={verdictPlanContext}
        tsb={athlete.load.tsb}
        sleepDebtHours={athlete.body.sleepDebtHours}
        isLoading={verdictIsLoading}
      />
      <LoadStrip
        ctl={athlete.load.ctl}
        atl={athlete.load.atl}
        tsb={athlete.load.tsb}
        weekTss={athlete.load.weekTss}
        ftpWatts={athlete.load.ftpWatts}
        trend={athlete.load.trend}
        isLoading={athlete.load.isLoading}
        syncBadge={
          <SyncBadge
            lastSyncedAt={athlete.sync.lastSyncedAt}
            stale={athlete.sync.staleProviders.length > 0}
            provider={athlete.sync.staleProviders[0]?.provider ?? null}
          />
        }
      />

      {/* ── Tab Navigation ───────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-surface rounded-xl p-1 border border-surface-light/50 w-fit max-w-full overflow-x-auto">
        {(['today', 'weekly', 'monthly'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`min-h-[44px] px-4 py-2 text-sm font-medium rounded-lg transition-colors capitalize whitespace-nowrap ${
              activeTab === tab
                ? 'bg-accent text-white'
                : 'text-muted hover:text-foreground hover:bg-surface-light/50'
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
          goals={goals}
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
          period={{
            monthlySummary,
            selectedYear,
            setSelectedYear,
            currentYear,
            yearlySummary,
            yearlyLoading,
          }}
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
