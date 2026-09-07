'use client';

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
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
} from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ChartBody } from '@/components/charts/Chart';
import { ReadinessIndicator } from '@/components/ui/ReadinessIndicator';
import { SkeletonMetric } from '@/components/ui/Skeleton';
import { MetricCard, RespiratoryRateCard } from '@/components/dashboard/helpers';
import { HealthAiAnalysisCard } from '@/components/health/HealthAiAnalysisCard';
import { formatDateDMY } from '@/lib/utils';

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-400 border-red-500/30',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  info: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'CRITICAL',
  warning: 'WARNING',
  info: 'INFO',
};

export default function HealthPage() {
  usePageTitle('Health');
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const [alertTab, setAlertTab] = useState<'all' | 'active' | 'dismissed'>('all');

  const chartOptions = { staleTime: 300_000 } as const;

  const { data: readiness } = useQuery<ReadinessResponse>({
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
    queryKey: ['chart-recovery-trend', 90],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/whoop_recovery_trend?days=90'),
    ...chartOptions,
    enabled: !!token,
  });

  const { data: hrvChart, isLoading: hrvLoading } = useQuery<ChartData>({
    queryKey: ['chart-hrv-trend-detailed', 90],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/hrv_trend_detailed?days=90'),
    ...chartOptions,
    enabled: !!token,
  });

  const { data: restingHrChart, isLoading: restingHrLoading } = useQuery<ChartData>({
    queryKey: ['chart-resting-hr', 90],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/resting_hr_trend?days=90'),
    ...chartOptions,
    enabled: !!token,
  });

  const { data: respirationChart, isLoading: respirationLoading } = useQuery<ChartData>({
    queryKey: ['chart-respiration', 90],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/respiration_trend?days=90'),
    ...chartOptions,
    enabled: !!token,
  });

  // ── Sleep intelligence (the previously unreferenced endpoints) ───────────
  const { data: sleepConsistency } = useQuery<SleepConsistencyResponse>({
    queryKey: ['sleep-consistency', 7],
    queryFn: () => authFetch<SleepConsistencyResponse>('/api/v1/metrics/sleep-consistency?days=7'),
    staleTime: 300_000,
    enabled: !!token,
  });

  const { data: sleepDebt } = useQuery<SleepDebtResponse>({
    queryKey: ['sleep-debt', 7],
    queryFn: () => authFetch<SleepDebtResponse>('/api/v1/metrics/sleep-debt?days=7'),
    staleTime: 300_000,
    enabled: !!token,
  });

  const { data: optimalBedtime } = useQuery<OptimalBedtimeResponse>({
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

  // ── Health alert history ─────────────────────────────────────────────────
  const { data: alerts, isLoading: alertsLoading } = useQuery<HealthAlert[]>({
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
  });

  const sleepingLoading = !sleepConsistency && !sleepDebt && !optimalBedtime;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">🩺 Health</h1>
        <p className="text-muted mt-1">
          Recovery, sleep, trends, and health alerts — powered by Whoop.
        </p>
      </div>

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
              subtitle={sleepDebt ? `${sleepDebt.debt_hours > 0 ? '+' : ''}${sleepDebt.debt_hours.toFixed(1)}h vs target` : 'Last night'}
              color={(todaySummary?.latest_sleep_hours ?? 0) >= 7 ? 'text-positive' : (todaySummary?.latest_sleep_hours ?? 0) >= 6 ? 'text-yellow-400' : 'text-warning'}
              icon="😴"
            />
          </>
        ) : (
          Array.from({ length: 4 }).map((_, i) => <SkeletonMetric key={i} />)
        )}
      </div>

      {/* ── Trend Charts ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Recovery Trend (90 days)</CardTitle>
          </CardHeader>
          <ChartBody
            isLoading={recoveryLoading}
            data={recoveryChart}
            emptyMessage="No recovery data — connect Whoop to populate."
            height={260}
          />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>HRV Trend (90 days)</CardTitle>
          </CardHeader>
          <ChartBody
            isLoading={hrvLoading}
            data={hrvChart}
            emptyMessage="No HRV data — sync Whoop to populate."
            height={260}
          />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Resting Heart Rate (90 days)</CardTitle>
          </CardHeader>
          <ChartBody
            isLoading={restingHrLoading}
            data={restingHrChart}
            emptyMessage="No resting HR data — sync Whoop to populate."
            height={260}
          />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Respiratory Rate (90 days)</CardTitle>
          </CardHeader>
          <ChartBody
            isLoading={respirationLoading}
            data={respirationChart}
            emptyMessage="No respiratory rate data — sync Whoop to populate."
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
            <p className="px-4 py-6 text-sm text-muted text-center">Loading…</p>
          ) : sleepConsistency ? (
            <div className="px-4 pb-4 space-y-2 text-sm">
              <div className="flex items-end justify-between">
                <span className="text-muted">Score</span>
                <span className={`text-lg font-bold ${sleepConsistency.consistency_score >= 70 ? 'text-positive' : sleepConsistency.consistency_score >= 50 ? 'text-yellow-400' : 'text-warning'}`}>
                  {sleepConsistency.consistency_score.toFixed(0)}/100
                </span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-muted">Average bedtime</span>
                <span className="font-medium text-white">{sleepConsistency.avg_bedtime ?? '—'}</span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-muted">Bedtime variability</span>
                <span className="font-medium text-white">±{sleepConsistency.std_minutes.toFixed(0)} min</span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-muted">Days analyzed</span>
                <span className="font-medium text-white">{sleepConsistency.days_analyzed}</span>
              </div>
            </div>
          ) : (
            <p className="px-4 pb-4 text-sm text-muted text-center">No sleep data.</p>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sleep Debt</CardTitle>
          </CardHeader>
          {sleepDebt ? (
            <div className="px-4 pb-4 space-y-2 text-sm">
              <div className="flex items-end justify-between">
                <span className="text-muted">Debt (rolling 7d)</span>
                <span className={`text-lg font-bold ${sleepDebt.debt_hours > 0 ? 'text-warning' : 'text-positive'}`}>
                  {sleepDebt.debt_hours > 0 ? '+' : ''}{sleepDebt.debt_hours.toFixed(1)}h
                </span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-muted">Average sleep</span>
                <span className="font-medium text-white">{sleepDebt.avg_sleep_hours.toFixed(1)}h</span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-muted">Target</span>
                <span className="font-medium text-white">{sleepDebt.target_hours.toFixed(0)}h / night</span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-muted">Nights below target</span>
                <span className={`font-medium ${sleepDebt.days_below_target > 0 ? 'text-warning' : 'text-positive'}`}>
                  {sleepDebt.days_below_target} / {sleepDebt.window_days}
                </span>
              </div>
            </div>
          ) : (
            <p className="px-4 pb-4 text-sm text-muted text-center">No sleep data.</p>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Optimal Bedtime</CardTitle>
          </CardHeader>
          {optimalBedtime ? (
            <div className="px-4 pb-4 space-y-2 text-sm">
              <div className="flex items-end justify-between">
                <span className="text-muted">Suggested</span>
                <span className="text-lg font-bold text-accent">{optimalBedtime.suggested_bedtime ?? '—'}</span>
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
                  <p className="text-[11px] text-muted mb-1">Best-recovery bedtimes</p>
                  <div className="space-y-0.5">
                    {optimalBedtime.best_recovery_bedtimes.slice(0, 3).map((b) => (
                      <div key={b.date} className="flex justify-between text-xs">
                        <span className="text-muted">{formatDateDMY(b.date)}</span>
                        <span className="text-white">
                          {b.bedtime} · <span className="text-positive">{b.recovery_score.toFixed(0)}%</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="px-4 pb-4 text-sm text-muted text-center">No bedtime data.</p>
          )}
        </Card>
      </div>

      {/* ── AI Health Analysis + Alert History ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <HealthAiAnalysisCard />

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <CardTitle>Health Alert History</CardTitle>
              <div className="flex items-center gap-1 p-1 rounded-lg bg-surface-light/30">
                {(['all', 'active', 'dismissed'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setAlertTab(tab)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md capitalize transition-colors ${
                      alertTab === tab ? 'bg-accent/20 text-accent' : 'text-muted hover:text-white'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          {alertsLoading ? (
            <p className="px-4 py-6 text-sm text-muted text-center">Loading…</p>
          ) : alerts && alerts.length > 0 ? (
            <div className="max-h-96 overflow-y-auto space-y-2 px-4 pb-4">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`rounded-lg border p-3 ${
                    SEVERITY_BADGE[alert.severity] ?? 'border-surface-light bg-surface-light/20'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-white">{alert.title}</p>
                      <p className="text-xs text-muted mt-0.5">{alert.description}</p>
                    </div>
                    {alert.status === 'active' && (
                      <button
                        onClick={() => dismissMutation.mutate(alert.id)}
                        disabled={dismissMutation.isPending}
                        className="shrink-0 text-[11px] text-muted hover:text-white disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted">
                    <span className="uppercase font-medium">{SEVERITY_LABEL[alert.severity] ?? alert.severity}</span>
                    <span>·</span>
                    <span>{formatDateDMY(alert.detected_date)}</span>
                    <span>·</span>
                    <span>{alert.status}</span>
                  </div>
                </div>
              ))}
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