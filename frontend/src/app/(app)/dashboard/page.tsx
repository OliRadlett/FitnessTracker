'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import { useSession } from 'next-auth/react';
import type {
  DashboardSummary,
  MonthlySummaryItem,
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
import { TimeRangePicker } from '@/components/dashboard/TimeRangePicker';
import { TimeRangeProvider } from '@/lib/time-range';
import { usePageTitle } from '@/lib/usePageTitle';
import { MOTION } from '@/components/motion/tokens';
import { usePrefersReducedMotion } from '@/components/motion/usePrefersReducedMotion';

export default function DashboardPage() {
  /* The shared REVIEW time-range (ui-redesign-v2 §2.1) must wrap every
     consumer — including the picker itself — so the page body lives in an
     inner component under the provider. */
  return (
    <TimeRangeProvider>
      <DashboardPageInner />
    </TimeRangeProvider>
  );
}

const VERDICT_TAB_ORDER = ['today', 'weekly', 'monthly'] as const;

/* Swipeable verdict views (ui-redesign-v2 section 3.5 mobile-first).
   Small touch-swipe wrapper around the existing VerdictCard slot: a
   horizontal swipe (48px+, horizontal-dominant) moves between the Today /
   Week / Month verdict views by driving the existing tab state. Those tab
   buttons stay as the fallback (untouched, keyboard-operable) — swipe never
   replaces them. Gated behind prefers-reduced-motion (static fallback, no
   slide transform). Dark tokens, 12px floor, 44px dot targets. Display only
   — VerdictCard props and queries untouched. */
const VERDICT_SWIPE_MIN_PX = 48;
const VERDICT_SWIPE_CLAMP_PX = 96;

function SwipeViews({
  index,
  count,
  onIndex,
  viewsLabel,
  children,
}: {
  index: number;
  count: number;
  onIndex: (next: number) => void;
  viewsLabel: string;
  children: React.ReactNode;
}) {
  const reduceMotion = usePrefersReducedMotion();
  const startRef = React.useRef<{ x: number; y: number } | null>(null);
  const [dragX, setDragX] = React.useState(0);

  const go = (dir: 1 | -1) =>
    onIndex(Math.min(count - 1, Math.max(0, index + dir)));

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) {
      startRef.current = null;
      return;
    }
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY };
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start || e.touches.length !== 1 || reduceMotion) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) <= Math.abs(dy) * 1.5) {
      setDragX(0);
      return;
    }
    setDragX(Math.max(-VERDICT_SWIPE_CLAMP_PX, Math.min(VERDICT_SWIPE_CLAMP_PX, dx)));
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = startRef.current;
    startRef.current = null;
    setDragX(0);
    if (!start || count < 2) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) >= VERDICT_SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) {
      go(dx < 0 ? 1 : -1);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (count < 2) return;
    if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  };

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={viewsLabel}
      tabIndex={count > 1 ? 0 : undefined}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onKeyDown={handleKeyDown}
    >
      <div
        style={
          reduceMotion || dragX === 0
            ? undefined
            : {
                transform: `translateX(${dragX}px)`,
                transition: `transform ${MOTION.durationFastMs}ms ${MOTION.easeOut}`,
              }
        }
      >
        {children}
      </div>
      {count > 1 && (
        <div className="flex items-center justify-center gap-1 pt-1">
          {Array.from({ length: count }).map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onIndex(i)}
              aria-label={`Show verdict view ${i + 1} of ${count}`}
              aria-current={i === index ? 'true' : undefined}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <span
                aria-hidden="true"
                className={`block h-2 w-2 rounded-full ${i === index ? 'bg-accent' : 'bg-surface-light'}`}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* Pull-to-sync (ui-redesign-v2 section 3.5 REVIEW signature). A touch
   pull-down from the very top of the page (scrollY at 0, 64px+) refetches
   the page queries through the SAME React Query keys (refetchQueries with
   type active — no new endpoints, no computation changes) with a small
   release-to-sync indicator. Static show/hide under
   prefers-reduced-motion; dark tokens; 12px floor; the pill is
   non-interactive status text. Desktop/keyboard fallback is the existing
   refresh control. */
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
  const reduceMotion = usePrefersReducedMotion();
  if (phase === 'idle') return null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="flex justify-center"
      style={
        reduceMotion
          ? undefined
          : { transition: `opacity ${MOTION.durationFastMs}ms ${MOTION.easeOut}` }
      }
    >
      <span className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-surface-light/50 bg-surface px-4 py-1 text-xs text-muted">
        <span aria-hidden="true">{phase === 'syncing' ? '⟳' : phase === 'ready' ? '↑' : '↓'}</span>
        {phase === 'syncing' ? 'Syncing…' : phase === 'ready' ? 'Release to sync' : 'Pull to sync'}
      </span>
    </div>
  );
}

function DashboardPageInner() {
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

  /* Pull-to-sync refetch (section 3.5): same React Query keys, no new fetches. */
  const syncPage = React.useCallback(
    () => queryClient.refetchQueries({ type: 'active' }),
    [queryClient],
  );
  const pullPhase = usePullToSync(syncPage);

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

  const { data: activities, isLoading: activitiesLoading, isError: activitiesError, refetch: refetchActivities } = useQuery<Activity[]>({
    queryKey: ['activities-recent'],
    queryFn: () => authFetch<Activity[]>('/api/v1/activities?limit=5'),
    enabled: activeTab === 'weekly' && !!token,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const { data: sessions, isLoading: sessionsLoading, isError: sessionsError, refetch: refetchSessions } = useQuery<LiftingSession[]>({
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

  /* Phase 2: months=12 (was 6) so the month navigator has genuine look-back
     depth. Same endpoint, no computation change — the grids simply show more
     history (data maximalism). */
  const { data: monthlySummary, isLoading: monthlyLoading } = useQuery<MonthlySummaryItem[]>({
    queryKey: ['monthly-summary', 12],
    queryFn: () => authFetch<MonthlySummaryItem[]>('/api/v1/dashboard/monthly-summary?months=12'),
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

  return (
    <div className="space-y-8" aria-live="polite">
      <PullSyncStatus phase={pullPhase} label="Dashboard sync status" />
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
      <SwipeViews
        index={VERDICT_TAB_ORDER.indexOf(activeTab)}
        count={VERDICT_TAB_ORDER.length}
        onIndex={(i) => setActiveTab(VERDICT_TAB_ORDER[i])}
        viewsLabel="Verdict views: Today, Week, Month"
      >
      <VerdictCard
        verdict={athlete.verdict.verdict}
        planContext={verdictPlanContext}
        tsb={athlete.load.tsb}
        sleepDebtHours={athlete.body.sleepDebtHours}
        isLoading={verdictIsLoading}
      />
      </SwipeViews>
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

      {/* ── Tab Navigation + shared chart-range picker ─────────────────────────
          Phase 2 (ui-redesign-v2 §2.1): one TimeRangePicker drives every
          dashboard chart together via TimeRangeProvider. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <TimeRangePicker />
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
          stale={athlete.sync.staleProviders.length > 0}
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
          activities={activities}
          activitiesLoading={activitiesLoading}
          activitiesError={activitiesError}
          onRetryActivities={() => refetchActivities()}
          sessions={sessions}
          sessionsLoading={sessionsLoading}
          sessionsError={sessionsError}
          onRetrySessions={() => refetchSessions()}
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
          stale={athlete.sync.staleProviders.length > 0}
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
          onDownloadReport={handleDownloadReport}
          stale={athlete.sync.staleProviders.length > 0}
        />
      )}
    </div>
  );
}
