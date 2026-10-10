'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch, resolveHealthAlert } from '@/lib/api';
import { useDeepLink } from '@/lib/useDeepLink';
import { usePageTitle } from '@/lib/usePageTitle';
import type {
  ReadinessResponse,
  RespiratoryRateResponse,
  SleepConsistencyResponse,
  SleepDebtResponse,
  OptimalBedtimeResponse,
  ChartData,
  TodaySummary,
  HealthAlert,
  Connection,
  CyclingProfile,
  TrainingLoadResponse,
  WeightHistoryResponse,
} from '@/lib/api';
import { getWeightHistory } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { ChartBody } from '@/components/charts/Chart';
import { ReadinessIndicator } from '@/components/ui/ReadinessIndicator';
import { SkeletonMetric } from '@/components/ui/Skeleton';
import { MetricCard } from '@/components/ui/MetricCard';
import { RespiratoryRateCard } from '@/components/health/RespiratoryRateCard';
import { LoadStrip, SyncBadge, WeightCard } from '@/components/athlete';
import {
  deriveLastSyncedAt,
  deriveLoadTrend,
  deriveStaleProviders,
  deriveWeekTss,
} from '@/lib/athlete';
import { HealthAiAnalysisCard } from '@/components/health/HealthAiAnalysisCard';
import { formatDateDMY } from '@/lib/utils';
import { TimeRangePicker } from '@/components/dashboard/TimeRangePicker';
import { TimeRangeProvider, timeRangeDays, useTimeRange } from '@/lib/time-range';
import { MOTION } from '@/components/motion/tokens';
import { usePrefersReducedMotion } from '@/components/motion/usePrefersReducedMotion';

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-warning/15 text-warning border-warning/30',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  info: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'CRITICAL',
  warning: 'WARNING',
  info: 'INFO',
};

export default function HealthPage() {
  /* The shared REVIEW time-range (ui-redesign-v2 §2.1) must wrap every
     consumer — including the picker itself — so the page body lives in an
     inner component under the provider (dashboard pattern). */
  return (
    <TimeRangeProvider>
      <HealthPageInner />
    </TimeRangeProvider>
  );
}

/* Pull-to-sync (ui-redesign-v2 section 3.5 REVIEW signature). A touch
   pull-down from the very top of the page (scrollY at 0, 64px+) refetches
   the page queries through the SAME React Query keys (refetchQueries with
   type active — no new endpoints, no computation changes) with a small
   release-to-sync indicator. Static show/hide under
   prefers-reduced-motion; dark tokens; 12px floor; the pill is
   non-interactive status text. Desktop/keyboard fallback is the existing
   page controls. */
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

function HealthPageInner() {
  usePageTitle('Health');
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [alertTab, setAlertTab] = useState<'all' | 'active' | 'dismissed'>('all');

  /* Pull-to-sync refetch (section 3.5): same React Query keys, no new fetches. */
  const syncPage = React.useCallback(
    () => queryClient.refetchQueries({ type: 'active' }),
    [queryClient],
  );
  const pullPhase = usePullToSync(syncPage);

  /* ── Shared REVIEW time-range (ui-redesign-v2 §2.1): one picker drives every
     health trend chart together. Day spans are clamped to the backend `?days=`
     cap (≤365) inside timeRangeDays. Display only — no computation changes
     (docs/algorithms.md authoritative). The 7-day sleep-intelligence cards and
     the shared athlete slots (weight-history / connections) keep their fixed
     windows so their caches stay shared. ───────────────────────────────── */
  const { start: rangeStart, end: rangeEnd } = useTimeRange();
  const chartDays = timeRangeDays(rangeStart, rangeEnd);

  const chartOptions = { staleTime: 300_000 } as const;

  const { data: readiness, isError: readinessError } = useQuery<ReadinessResponse>({
    queryKey: ['readiness'],
    queryFn: () => authFetch<ReadinessResponse>('/api/v1/metrics/readiness'),
    staleTime: 300_000,
    enabled: !!token,
  });

  const { data: respiratoryRate } = useQuery<RespiratoryRateResponse>({
    queryKey: ['respiratory-rate'],
    queryFn: () => authFetch<RespiratoryRateResponse>('/api/v1/metrics/respiratory-rate'),
    staleTime: 300_000,
    enabled: !!token,
  });

  const { data: recoveryChart, isLoading: recoveryLoading } = useQuery<ChartData>({
    queryKey: ['chart-recovery-trend', chartDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/whoop_recovery_trend?days=${chartDays}`),
    ...chartOptions,
    enabled: !!token,
  });

  const { data: hrvChart, isLoading: hrvLoading } = useQuery<ChartData>({
    queryKey: ['chart-hrv-trend-detailed', chartDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/hrv_trend_detailed?days=${chartDays}`),
    ...chartOptions,
    enabled: !!token,
  });

  const { data: restingHrChart, isLoading: restingHrLoading } = useQuery<ChartData>({
    queryKey: ['chart-resting-hr', chartDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/resting_hr_trend?days=${chartDays}`),
    ...chartOptions,
    enabled: !!token,
  });

  const { data: respirationChart, isLoading: respirationLoading } = useQuery<ChartData>({
    queryKey: ['chart-respiration', chartDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/respiration_trend?days=${chartDays}`),
    ...chartOptions,
    enabled: !!token,
  });

  const { data: recoveryVsPerfChart, isLoading: recoveryVsPerfLoading } = useQuery<ChartData>({
    queryKey: ['chart-recovery-vs-performance', chartDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/recovery_vs_performance?days=${chartDays}`),
    ...chartOptions,
    enabled: !!token,
  });

  const { data: sleepQualityChart, isLoading: sleepQualityLoading } = useQuery<ChartData>({
    queryKey: ['chart-sleep-quality', chartDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/sleep_quality_trend?days=${chartDays}`),
    ...chartOptions,
    enabled: !!token,
  });

  const { data: strainTrendChart, isLoading: strainTrendLoading } = useQuery<ChartData>({
    queryKey: ['chart-whoop-strain', chartDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/whoop_strain_trend?days=${chartDays}`),
    ...chartOptions,
    enabled: !!token,
  });

  // ── Sleep intelligence (the previously unreferenced endpoints) ───────────
  const { data: sleepConsistency, isLoading: consistencyLoading, isError: consistencyError, refetch: refetchConsistency } = useQuery<SleepConsistencyResponse>({
    queryKey: ['sleep-consistency', 7],
    queryFn: () => authFetch<SleepConsistencyResponse>('/api/v1/metrics/sleep-consistency?days=7'),
    staleTime: 300_000,
    enabled: !!token,
  });

  const { data: sleepDebt, isLoading: debtLoading, isError: debtError, refetch: refetchDebt } = useQuery<SleepDebtResponse>({
    queryKey: ['sleep-debt', 7],
    queryFn: () => authFetch<SleepDebtResponse>('/api/v1/metrics/sleep-debt?days=7'),
    staleTime: 300_000,
    enabled: !!token,
  });

  const { data: optimalBedtime, isLoading: bedtimeLoading, isError: bedtimeError, refetch: refetchBedtime } = useQuery<OptimalBedtimeResponse>({
    queryKey: ['optimal-bedtime'],
    queryFn: () => authFetch<OptimalBedtimeResponse>('/api/v1/metrics/optimal-bedtime'),
    staleTime: 300_000,
    enabled: !!token,
  });

  // ── Chronic load / strain ────────────────────────────────────────────────
  const { data: todaySummary } = useQuery<TodaySummary>({
    queryKey: ['dashboard', 'today'],
    queryFn: () => authFetch<TodaySummary>('/api/v1/dashboard/today'),
    staleTime: 300_000,
    enabled: !!token,
  });

  // ── Phase 1 shared athlete-state slices (plans/ui-redesign-v2.md §1) ─────
  // Query keys match `useAthleteState()` exactly, so every slot adopting
  // LoadStrip/WeightCard/SyncBadge shares one cache entry. Values are
  // display-only — CTL/ATL/TSB computation stays in docs/algorithms.md.
  const { data: trainingLoad, isLoading: loadLoading } = useQuery<TrainingLoadResponse>({
    queryKey: ['training-load', chartDays],
    queryFn: () => authFetch<TrainingLoadResponse>(`/api/v1/cycling/training-load?days=${chartDays}`),
    ...chartOptions,
    enabled: !!token,
  });

  const { data: cyclingProfile, isLoading: profileLoading } = useQuery<CyclingProfile>({
    queryKey: ['cycling-profile'],
    queryFn: () => authFetch<CyclingProfile>('/api/v1/cycling/profile'),
    ...chartOptions,
    enabled: !!token,
  });

  const {
    data: weightHistory,
    isLoading: weightLoading,
    isError: weightError,
  } = useQuery<WeightHistoryResponse>({
    queryKey: ['weight-history'],
    queryFn: () => getWeightHistory(authFetch, 90),
    ...chartOptions,
    enabled: !!token,
  });

  const { data: connections } = useQuery<Connection[]>({
    queryKey: ['connections'],
    queryFn: () => authFetch<Connection[]>('/api/v1/connections/'),
    staleTime: 300_000,
    enabled: !!token,
  });

  // Presentational derivations only (shared selectors — no recomputation).
  const loadTrend = deriveLoadTrend(trainingLoad?.data ?? null);
  const weekTss = deriveWeekTss(trainingLoad?.data ?? null);
  const staleProviders = deriveStaleProviders(connections);
  const lastSyncedAt = deriveLastSyncedAt(connections);
  const syncStale = staleProviders.length > 0;

  // ── Health alert history ─────────────────────────────────────────────────
  const {
    data: alerts,
    isLoading: alertsLoading,
    isError: alertsError,
  } = useQuery<HealthAlert[]>({
    queryKey: ['health-alerts', alertTab],
    queryFn: () =>
      authFetch<HealthAlert[]>(
        alertTab === 'all'
          ? '/api/v1/metrics/health-alerts?status=all'
          : `/api/v1/metrics/health-alerts?status=${alertTab}`,
      ),
    staleTime: 60_000,
    enabled: !!token,
  });

  const dismissMutation = useMutation({
    mutationFn: (alertId: string) =>
      authFetch<HealthAlert>(`/api/v1/metrics/health-alerts/${alertId}/dismiss`, {
        method: 'PATCH',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health-alerts'] });
    },
    onError: (err) => toast.error(`Dismiss alert failed: ${(err as Error)?.message || 'please try again.'}`),
  });

  // Phase 2 notification → Health deep link (`?alert=`): resolve the key
  // against id → alert_type → title, reveal the tab holding it, scroll it
  // into view + highlight. Stale keys render the page normally.
  const { getParam } = useDeepLink();
  const alertKey = getParam('alert');
  const targetAlert = useMemo(
    () => resolveHealthAlert(alerts ?? [], alertKey),
    [alerts, alertKey],
  );

  useEffect(() => {
    if (!targetAlert) return;
    const hidden =
      (targetAlert.status === 'dismissed' && alertTab === 'active') ||
      (targetAlert.status !== 'dismissed' && alertTab === 'dismissed');
    if (hidden) setAlertTab('all');
  }, [targetAlert, alertTab]);

  useEffect(() => {
    if (!targetAlert) return;
    // Wait a tick so a tab switch above has rendered the card first.
    requestAnimationFrame(() => {
      document
        .getElementById(`health-alert-${targetAlert.id}`)
        ?.scrollIntoView({ block: 'center' });
    });
  }, [targetAlert, alertTab]);

  const sleepingLoading = consistencyLoading || debtLoading || bedtimeLoading;
  const sleepingError = consistencyError || debtError || bedtimeError;
  const retrySleeping = () => {
    if (consistencyError) refetchConsistency();
    if (debtError) refetchDebt();
    if (bedtimeError) refetchBedtime();
  };
  const hasQueryError = readinessError || alertsError;

  return (
    <div className="space-y-8">
      <PullSyncStatus phase={pullPhase} label="Health sync status" />
      <PageHeader
        title="🩺 Health"
        subtitle="Recovery, sleep, trends, and health alerts — powered by Whoop."
        status={
          connections ? (
            <div className="mt-2">
              <SyncBadge lastSyncedAt={lastSyncedAt} stale={syncStale} />
            </div>
          ) : null
        }
      />

      {/* ── Core query error banner ─────────────────────────────────────────── */}
      <ErrorState variant="inline"
        show={hasQueryError}
        message="Some health data failed to load."
      />

      {/* Shared REVIEW chart range (ui-redesign-v2 §2.1) — one picker drives
          every health trend chart together via TimeRangeProvider. */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <TimeRangePicker />
      </div>

      {/* ── Training load (shared LoadStrip — identical props in every slot, §1) */}
      <LoadStrip
        ctl={trainingLoad?.current_ctl ?? null}
        atl={trainingLoad?.current_atl ?? null}
        tsb={trainingLoad?.current_tsb ?? null}
        weekTss={weekTss}
        ftpWatts={cyclingProfile?.ftp_watts ?? null}
        trend={loadTrend.direction}
        isLoading={loadLoading || profileLoading}
        syncBadge={
          connections ? (
            <SyncBadge lastSyncedAt={lastSyncedAt} stale={syncStale} />
          ) : undefined
        }
      />

      {/* ── Status Row ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {readiness ? (
          <>
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
              <MetricCard
                label="Respiratory Rate"
                value="—"
                subtitle="No data"
                color="text-muted"
                icon="🌬️"
              />
            )}
            <MetricCard
              label="Strain (today)"
              value={todaySummary?.latest_strain != null ? todaySummary.latest_strain.toFixed(1) : '—'}
              subtitle="Whoop strain (0-21)"
              color={(todaySummary?.latest_strain ?? 0) >= 14 ? 'text-warning' : (todaySummary?.latest_strain ?? 0) >= 10 ? 'text-yellow-400' : 'text-positive'}
              icon="💪"
              tooltip="Whoop Strain (0-21) measures cardiovascular load. 0-9: low, 10-13: moderate, 14-17: high, 18+: all-out."
            />
            <MetricCard
              label="Sleep (last night)"
              value={todaySummary?.latest_sleep_hours != null ? `${todaySummary.latest_sleep_hours.toFixed(1)}h` : '—'}
              subtitle={sleepDebt ? (sleepDebt.debt_hours > 0 ? `-${sleepDebt.debt_hours.toFixed(1)}h debt (7d)` : 'Caught up') : 'Last night'}
              color={(todaySummary?.latest_sleep_hours ?? 0) >= 7 ? 'text-positive' : (todaySummary?.latest_sleep_hours ?? 0) >= 6 ? 'text-yellow-400' : 'text-warning'}
              icon="😴"
            />
          </>
        ) : (
          Array.from({ length: 4 }).map((_, i) => <SkeletonMetric key={i} />)
        )}
      </div>

      {/* ── Body weight (shared WeightCard — identical props in every slot, §1).
          Read-only display; logging lives in the full WeightPanel on /cycling. */}
      <div className="max-w-2xl space-y-2">
        <WeightCard
          history={weightHistory ?? null}
          isLoading={weightLoading}
          isError={weightError}
        />
        <p className="text-xs text-muted">
          <a href="/cycling" className="text-accent hover:text-accent/80">
            Log or manage weigh-ins on the Cycling page →
          </a>
        </p>
      </div>

      {/* ── Trend Charts ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Recovery Trend ({chartDays} days)</CardTitle>
          </CardHeader>
          <ChartBody
            isLoading={recoveryLoading}
            data={recoveryChart}
            stale={syncStale}
            emptyMessage="No recovery data — connect Whoop to populate."
            height={260}
          />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>HRV Trend ({chartDays} days)</CardTitle>
          </CardHeader>
          <ChartBody
            isLoading={hrvLoading}
            data={hrvChart}
            stale={syncStale}
            emptyMessage="No HRV data — sync Whoop to populate."
            height={260}
          />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Resting Heart Rate ({chartDays} days)</CardTitle>
          </CardHeader>
          <ChartBody
            isLoading={restingHrLoading}
            data={restingHrChart}
            stale={syncStale}
            emptyMessage="No resting HR data — sync Whoop to populate."
            height={260}
          />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Respiratory Rate ({chartDays} days)</CardTitle>
          </CardHeader>
          <ChartBody
            isLoading={respirationLoading}
            data={respirationChart}
            stale={syncStale}
            emptyMessage="No respiratory rate data — sync Whoop to populate."
            height={260}
          />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recovery vs Next-Day Performance ({chartDays} days)</CardTitle>
          </CardHeader>
          <ChartBody
            isLoading={recoveryVsPerfLoading}
            data={recoveryVsPerfChart}
            stale={syncStale}
            emptyMessage="Not enough recovery + training data yet — sync Whoop and log sessions."
            height={260}
          />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sleep Quality ({chartDays} days)</CardTitle>
          </CardHeader>
          <ChartBody
            isLoading={sleepQualityLoading}
            data={sleepQualityChart}
            stale={syncStale}
            emptyMessage="No sleep data — sync Whoop to populate."
            height={260}
          />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Whoop Strain ({chartDays} days)</CardTitle>
          </CardHeader>
          <ChartBody
            isLoading={strainTrendLoading}
            data={strainTrendChart}
            stale={syncStale}
            emptyMessage="No strain data — sync Whoop to populate."
            height={260}
          />
        </Card>
      </div>

      {/* ── Sleep Intelligence ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Sleep Consistency</CardTitle>
          </CardHeader>
          {sleepingLoading ? (
            <div className="px-4 py-4" aria-label="Loading sleep consistency">
              <SkeletonMetric />
            </div>
          ) : sleepingError && !sleepConsistency ? (
            <div className="px-4 pb-4">
              <ErrorState
                title="Couldn't load sleep insights"
                message="Check your connection and try again."
                onRetry={retrySleeping}
              />
            </div>
          ) : sleepConsistency ? (
            <div className="px-4 pb-4 space-y-2 text-sm">
              <div className="flex items-end justify-between">
                <span className="text-muted">Score</span>
                <span className={`text-lg font-bold tabular-nums ${sleepConsistency.consistency_score >= 70 ? 'text-positive' : sleepConsistency.consistency_score >= 50 ? 'text-yellow-400' : 'text-warning'}`}>
                  {sleepConsistency.consistency_score.toFixed(0)}/100
                </span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-muted">Average bedtime</span>
                <span className="font-medium tabular-nums text-foreground">{sleepConsistency.avg_bedtime ?? '—'}</span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-muted">Bedtime variability</span>
                <span className="font-medium tabular-nums text-foreground">±{sleepConsistency.std_minutes.toFixed(0)} min</span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-muted">Days analyzed</span>
                <span className="font-medium tabular-nums text-foreground">{sleepConsistency.days_analyzed}</span>
              </div>
            </div>
          ) : (
            <p className="px-4 pb-4 text-sm text-muted text-center">No sleep data — sync Whoop to populate.</p>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sleep Debt</CardTitle>
          </CardHeader>
          {debtLoading ? (
            <div className="px-4 py-4" aria-label="Loading sleep debt">
              <SkeletonMetric />
            </div>
          ) : debtError && !sleepDebt ? (
            <div className="px-4 pb-4">
              <ErrorState
                title="Couldn't load sleep debt"
                message="Check your connection and try again."
                onRetry={retrySleeping}
              />
            </div>
          ) : sleepDebt ? (
            <div className="px-4 pb-4 space-y-2 text-sm">
              <div className="flex items-end justify-between">
                <span className="text-muted">Debt (rolling 7d)</span>
                <span className={`text-lg font-bold tabular-nums ${sleepDebt.debt_hours > 0 ? 'text-warning' : 'text-positive'}`}>
                  {sleepDebt.debt_hours > 0 ? '-' : ''}{sleepDebt.debt_hours.toFixed(1)}h
                </span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-muted">Average sleep</span>
                <span className="font-medium tabular-nums text-foreground">{sleepDebt.avg_sleep_hours.toFixed(1)}h</span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-muted">Target</span>
                <span className="font-medium tabular-nums text-foreground">{sleepDebt.target_hours.toFixed(0)}h / night</span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-muted">Nights below target</span>
                <span className={`font-medium tabular-nums ${sleepDebt.days_below_target > 0 ? 'text-warning' : 'text-positive'}`}>
                  {sleepDebt.days_below_target} / {sleepDebt.window_days}
                </span>
              </div>
            </div>
          ) : (
            <p className="px-4 pb-4 text-sm text-muted text-center">No sleep data — sync Whoop to populate.</p>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Optimal Bedtime</CardTitle>
          </CardHeader>
          {bedtimeLoading ? (
            <div className="px-4 py-4" aria-label="Loading optimal bedtime">
              <SkeletonMetric />
            </div>
          ) : bedtimeError && !optimalBedtime ? (
            <div className="px-4 pb-4">
              <ErrorState
                title="Couldn't load bedtime guidance"
                message="Check your connection and try again."
                onRetry={retrySleeping}
              />
            </div>
          ) : optimalBedtime ? (
            <div className="px-4 pb-4 space-y-2 text-sm">
              <div className="flex items-end justify-between">
                <span className="text-muted">Suggested</span>
                <span className="text-lg font-bold tabular-nums text-accent">{optimalBedtime.suggested_bedtime ?? '—'}</span>
              </div>
              {optimalBedtime.confidence && (
                <div className="flex items-end justify-between">
                  <span className="text-muted">Confidence</span>
                  <span className={`uppercase font-medium ${
                    optimalBedtime.confidence === 'high' ? 'text-positive' : optimalBedtime.confidence === 'medium' ? 'text-yellow-400' : 'text-muted'
                  }`}>
                    {optimalBedtime.confidence}
                  </span>
                </div>
              )}
              {optimalBedtime.message && (
                <p className="text-xs text-muted leading-relaxed">{optimalBedtime.message}</p>
              )}
              {optimalBedtime.best_recovery_bedtimes.length > 0 && (
                <div className="pt-1">
                  <p className="text-xs text-muted mb-1">Best-recovery bedtimes</p>
                  <div className="space-y-0.5">
                    {optimalBedtime.best_recovery_bedtimes.slice(0, 3).map((b) => (
                      <div key={b.date} className="flex justify-between text-xs">
                        <span className="text-muted">{formatDateDMY(b.date)}</span>
                        <span className="tabular-nums text-foreground">
                          {b.bedtime} · <span className="text-positive">{b.recovery_score.toFixed(0)}%</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="px-4 pb-4 text-sm text-muted text-center">No bedtime data — sync Whoop to populate.</p>
          )}
        </Card>
      </div>

      {/* ── AI Health Analysis + Alert History ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <HealthAiAnalysisCard />

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2 w-full">
              <CardTitle>Health Alert History</CardTitle>
              <div className="flex items-center gap-1 p-1 rounded-lg bg-surface-light/30">
                {(['all', 'active', 'dismissed'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setAlertTab(tab)}
                    className={`min-h-[44px] px-3 py-1 text-xs font-medium rounded-md capitalize transition-colors ${
                      alertTab === tab ? 'bg-accent/20 text-accent' : 'text-muted hover:text-foreground'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          {alertsLoading ? (
            <div className="px-4 py-4 space-y-2" aria-label="Loading health alerts">
              <SkeletonMetric />
              <SkeletonMetric />
            </div>
          ) : alerts && alerts.length > 0 ? (
            <div className="max-h-96 overflow-y-auto space-y-2 px-4 pb-4">
              {alerts.map((alert) => {
                // Dismissed alerts render greyed (2.10) — a yellow "warning"
                // card for something already handled reads as a live problem.
                // Phase 2: the `?alert=` deep-link target gets an anchor id +
                // accent ring so notification taps land visibly.
                const dismissed = alert.status === 'dismissed';
                const targeted = targetAlert?.id === alert.id;
                return (
                <div
                  key={alert.id}
                  id={`health-alert-${alert.id}`}
                  className={`rounded-lg border p-3 scroll-mt-4 ${
                    targeted
                      ? 'border-accent ring-2 ring-accent'
                      : dismissed
                        ? 'border-surface-light/50 bg-surface-light/10 opacity-60'
                        : SEVERITY_BADGE[alert.severity] ?? 'border-surface-light bg-surface-light/20'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">{alert.title}</p>
                      <p className="text-xs text-muted mt-0.5">{alert.description}</p>
                    </div>
                    {alert.status === 'active' && (
                      <button
                        onClick={() => dismissMutation.mutate(alert.id)}
                        disabled={dismissMutation.isPending}
                        className="shrink-0 min-h-[44px] min-w-[44px] px-2 text-xs text-muted hover:text-foreground disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-muted">
                    <span className="uppercase font-medium">{SEVERITY_LABEL[alert.severity] ?? alert.severity}</span>
                    <span>·</span>
                    <span>{formatDateDMY(alert.detected_date)}</span>
                    <span>·</span>
                    <span>{alert.status}</span>
                  </div>
                </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-3xl mb-2">✅</p>
              <p className="text-sm text-muted">No {alertTab} health alerts.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}