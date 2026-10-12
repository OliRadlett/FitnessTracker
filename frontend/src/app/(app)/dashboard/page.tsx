'use client';

/**
 * V2 Dashboard — Phase 1 rewrite.
 *
 * Kills the data duplication that caused the dashboard/TODAY contradiction:
 * the old page fetched verdict + load + body + plan + goals + sync via
 * useAthleteState() AND re-fetched many of the same things via 12+ individual
 * useQuery calls with different cache keys. This version uses one hook —
 * useDashboardData() — which shares cache keys with every other page.
 *
 * Removed: SwipeViews (static verdict), TimeRangePicker (replaced by WeekNav).
 * Tab components (TodayTab / WeeklyTab / MonthlyTab) are unchanged — the page
 * adapts DashboardData → their existing props.
 */

import React, { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useAuthFetch } from '@/lib/api';
import { usePageTitle } from '@/lib/usePageTitle';
import { getGreeting, getActiveLocale } from '@/lib/utils';
import { sportLabel } from '@/lib/sportUtils';
import { PageHeader } from '@/components/ui/PageHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { ReadinessIndicator } from '@/components/ui/ReadinessIndicator';
import { DashboardRefresh } from '@/components/dashboard/DashboardRefresh';
import { WeatherWidget } from '@/components/dashboard/WeatherWidget';
import { TodayTab } from '@/components/dashboard/TodayTab';
import { WeeklyTab } from '@/components/dashboard/WeeklyTab';
import { MonthlyTab } from '@/components/dashboard/MonthlyTab';
import { YearDashboard } from '@/components/dashboard/YearDashboard';
import { VerdictCard } from '@/components/athlete/VerdictCard';
import { SyncBadge } from '@/components/athlete/SyncBadge';
import { LoadSummary } from '@/components/dashboard/LoadSummary';
import { WeekNav } from '@/components/dashboard/WeekNav';
import { mondayOfOffset } from '@/components/dashboard/PeriodNav';
import { useDashboardData } from '@/lib/dashboard/useDashboardData';
import { TimeRangeProvider, useTimeRange } from '@/lib/time-range';
import type { HealthAnalysisResult } from '@/lib/api';

const ACTIVE_TABS = ['today', 'weekly', 'monthly', 'yearly'] as const;

// ── Pull-to-sync (retained from Phase 1, now standalone) ─────────────────────

const PULL_SYNC_THRESHOLD_PX = 64;
type PullSyncPhase = 'idle' | 'pull' | 'ready' | 'syncing';

function usePullToSync(onSync: () => Promise<unknown>): PullSyncPhase {
  const startYRef = React.useRef<number | null>(null);
  const phaseRef = React.useRef<PullSyncPhase>('idle');
  const [phase, setPhase] = React.useState<PullSyncPhase>('idle');
  const onSyncRef = React.useRef(onSync);

  React.useEffect(() => {
    onSyncRef.current = onSync;
  });

  React.useEffect(() => {
    const setBoth = (p: PullSyncPhase) => {
      phaseRef.current = p;
      setPhase(p);
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || window.scrollY > 0) {
        startYRef.current = null;
        return;
      }
      startYRef.current = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      const startY = startYRef.current;
      if (startY == null || e.touches.length !== 1 || window.scrollY > 0) return;
      if (phaseRef.current === 'syncing') return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) {
        setBoth('idle');
        return;
      }
      setBoth(dy >= PULL_SYNC_THRESHOLD_PX ? 'ready' : 'pull');
    };
    const onTouchEnd = () => {
      startYRef.current = null;
      if (phaseRef.current !== 'ready') {
        if (phaseRef.current !== 'syncing') setBoth('idle');
        return;
      }
      setBoth('syncing');
      void Promise.resolve()
        .then(() => onSyncRef.current())
        .catch(() => undefined)
        .finally(() => setBoth('idle'));
    };
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  return phase;
}

function PullSyncStatus({ phase, label }: { phase: PullSyncPhase; label: string }) {
  if (phase === 'idle') return null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="flex justify-center"
    >
      <span className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-surface/20 bg-surface px-4 py-1 text-xs text-muted">
        <span aria-hidden="true">
          {phase === 'syncing' ? '⟳' : phase === 'ready' ? '↑' : '↓'}
        </span>
        {phase === 'syncing' ? 'Syncing…' : phase === 'ready' ? 'Release to sync' : 'Pull to sync'}
      </span>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function DashboardPageInner() {
  usePageTitle('Dashboard');
  const { authFetch } = useAuthFetch();
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [activeTab, setActiveTab] = useState<'today' | 'weekly' | 'monthly' | 'yearly'>('today');
  const [analysisResults, setAnalysisResults] = useState<HealthAnalysisResult[] | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [weeksBack, setWeeksBack] = useState(0);

  // ── Single data source (no useAthleteState, no 12 individual queries) ──────
  const data = useDashboardData(selectedYear);

  // ── Time-range context for chart-driven tabs ─────────────────────────────
  const { setCustom } = useTimeRange();

  const handleWeeksBackChange = useCallback(
    (weeks: number) => {
      setWeeksBack(weeks);
      const monday = mondayOfOffset(weeks);
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      setCustom(monday, sunday);
    },
    [setCustom],
  );

  // ── Pull-to-sync ──────────────────────────────────────────────────────────
  const syncPage = useCallback(
    () => queryClient.refetchQueries({ type: 'active' }),
    [queryClient],
  );
  const pullPhase = usePullToSync(syncPage);

  // ── Mutations (actions, not data) ─────────────────────────────────────────
  const llmMutation = useMutation({
    mutationFn: () => authFetch<any>('/api/v1/cycling/llm-analysis/on-demand', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cycling', 'llm-analysis', 'latest'] }),
  });

  const analyzeMutation = useMutation({
    mutationFn: () =>
      authFetch<{ analysis_results: HealthAnalysisResult[] }>(
        '/api/v1/metrics/health-alerts/analyze',
        { method: 'POST' },
      ),
    onSuccess: (res) => {
      setAnalysisResults(res.analysis_results || []);
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

  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleDownloadReport = useCallback(
    async (apiPath: string, filename: string) => {
      try {
        const response = await fetch(apiPath, {
          headers: session?.backendToken
            ? { Authorization: `Bearer ${session.backendToken}` }
            : {},
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
    },
    [session?.backendToken],
  );

  // ── Derived ────────────────────────────────────────────────────────────────
  const hasReadiness = !!(data.readiness && data.readiness.readiness !== 'unknown');
  const stale = data.staleProviders.length > 0;

  const verdictPlanContext = data.activePlan
    ? {
        planName: data.activePlan.name,
        dayLabel:
          data.todayPlan && data.todayPlan.sport !== 'rest'
            ? data.todayPlan.workout_description || sportLabel(data.todayPlan.sport)
            : null,
      }
    : null;

  return (
    <div className="space-y-8" aria-live="polite">
      <PullSyncStatus phase={pullPhase} label="Dashboard sync status" />

      {/* Error banner */}
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

      <ErrorState
        variant="inline"
        show={data.isError}
        message="Some dashboard data failed to load."
      />

      {/* Hero header */}
      <PageHeader
        title={<>{getGreeting()} 👋</>}
        subtitle={new Date().toLocaleDateString(getActiveLocale(), {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })}
        actions={
          <>
            <DashboardRefresh />
            <WeatherWidget />
            {hasReadiness && data.readiness && (
              <ReadinessIndicator
                recoveryScore={data.readiness.recovery_score ?? undefined}
                readiness={data.readiness.readiness}
                hrvMs={data.readiness.hrv_ms ?? undefined}
                restingHr={data.readiness.resting_hr ?? undefined}
                message={data.readiness.message}
                compact
              />
            )}
          </>
        }
      />

      {/* Static VerdictCard (no swipe views) */}
      <VerdictCard
        verdict={data.verdict}
        planContext={verdictPlanContext}
        tsb={data.tsb}
        sleepDebtHours={data.sleepDebtHours}
        isLoading={data.verdictIsLoading || data.planIsLoading}
      />

      {/* LoadSummary with embedded SyncBadge */}
      <LoadSummary
        data={data}
        syncBadge={
          <SyncBadge
            lastSyncedAt={data.lastSyncedAt}
            stale={stale}
            provider={data.staleProviders[0]?.provider ?? null}
          />
        }
      />

      {/* WeekNav (replaces TimeRangePicker) */}
      <WeekNav
        weeksBack={weeksBack}
        onChange={handleWeeksBackChange}
        selectedYear={selectedYear}
        onYearChange={setSelectedYear}
      />

      {/* Tab navigation */}
      <div className="flex gap-1 bg-surface rounded-xl p-1 border border-surface-light/50 w-fit max-w-full overflow-x-auto">
        {ACTIVE_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`min-h-[44px] px-4 py-2 text-sm font-medium rounded-lg transition-colors capitalize whitespace-nowrap ${
              activeTab === tab
                ? 'bg-accent text-white'
                : 'text-muted hover:text-foreground hover:bg-surface-light/50'
            }`}
          >
            {tab === 'today' ? 'Today' : tab === 'weekly' ? 'Week' : tab === 'monthly' ? 'Month' : 'Year'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'today' && (
        <TodayTab
          todaySummary={data.todaySummary}
          isLoading={data.isLoading}
          summary={data.dashboardSummary}
          readiness={data.readiness}
          hasReadiness={hasReadiness}
          respiratoryRate={data.respiratoryRate}
          upcomingEvents={data.upcomingEvents}
          goals={data.goals}
          stale={stale}
        />
      )}

      {activeTab === 'weekly' && (
        <WeeklyTab
          summary={data.dashboardSummary}
          summaryLoading={data.isLoading}
          readiness={data.readiness}
          hasReadiness={hasReadiness}
          respiratoryRate={data.respiratoryRate}
          whoopWeekly={data.whoopWeekly ?? undefined}
          hasWhoop={data.hasWhoop}
          activities={data.activities}
          activitiesLoading={data.activitiesLoading}
          activitiesError={data.activitiesError}
          onRetryActivities={data.refetchActivities}
          sessions={data.sessions}
          sessionsLoading={data.sessionsLoading}
          sessionsError={data.sessionsError}
          onRetrySessions={data.refetchSessions}
          recentSessions={data.sessions?.slice(0, 5) ?? []}
          streaks={data.streaks ?? undefined}
          goals={data.goals}
          deficiency={data.deficiency ?? undefined}
          deficiencyLoading={data.deficiencyLoading}
          period={{
            monthlySummary: data.monthlySummary,
            selectedYear,
            setSelectedYear,
            currentYear,
            yearlySummary: data.yearlySummary ?? undefined,
            yearlyLoading: data.yearlyLoading,
          }}
          upcomingEvents={data.upcomingEvents}
          llmAnalysis={data.llmAnalysis}
          llmLoading={data.llmLoading}
          onRefreshLlm={() => llmMutation.mutate()}
          isRefreshingLlm={llmMutation.isPending}
          analysisResults={analysisResults}
          isAnalyzing={isAnalyzing}
          onAnalyze={handleAnalyze}
          onDownloadReport={handleDownloadReport}
          stale={stale}
        />
      )}

      {activeTab === 'monthly' && (
        <MonthlyTab
          monthlySummary={data.monthlySummary}
          isLoading={data.monthlyLoading}
          selectedYear={selectedYear}
          setSelectedYear={setSelectedYear}
          currentYear={currentYear}
          yearlySummary={data.yearlySummary ?? undefined}
          yearlyLoading={data.yearlyLoading}
          onDownloadReport={handleDownloadReport}
          stale={stale}
        />
      )}

      {activeTab === 'yearly' && (
        <YearDashboard
          yearlySummary={data.yearlySummary ?? null}
          yearlyLoading={data.yearlyLoading}
          selectedYear={selectedYear}
          stale={stale}
        />
      )}
    </div>
  );
}

export default function DashboardPage() {
  /* TimeRangeProvider stays — TodayTab/WeeklyTab/MonthlyTab use useTimeRange()
     for chart windows. WeekNav replaces TimeRangePicker as the header control. */
  return (
    <TimeRangeProvider>
      <DashboardPageInner />
    </TimeRangeProvider>
  );
}
