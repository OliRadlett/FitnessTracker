'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChartData,
  Connection,
  HealthAlert,
  LlmAnalysis,
  OptimalBedtimeResponse,
  ReadinessResponse,
  RespiratoryRateResponse,
  SleepConsistencyResponse,
  SleepDebtResponse,
  WeightHistoryResponse,
} from '@/lib/api';
import { useAuthFetch } from '@/lib/api';
import {
  ageDays,
  EMPTY_CHART,
  todayISO,
  type HealthCheckResponse,
  type HealthViewModel,
} from './healthView';

const CHART_KEYS = [
  'whoop_recovery_trend',
  'hrv_trend_detailed',
  'resting_hr_trend',
  'sleep_quality_trend',
  'whoop_strain_trend',
] as const;

export function useHealthPageData(tab: 'now' | 'trends' | 'history', rangeDays: number) {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const enabled = !!token;

  // Let readiness/sleep own the first paint. Charts and the six-signal check
  // are deferred: the check is DB-heavy and must not starve the core queries.
  const [deferred, setDeferred] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setDeferred(true), 600);
    return () => window.clearTimeout(timer);
  }, []);

  const readiness = useQuery<ReadinessResponse>({
    queryKey: ['health-readiness'],
    queryFn: () => authFetch<ReadinessResponse>('/api/v1/metrics/readiness'),
    staleTime: 300_000,
    enabled,
  });

  const sleepConsistency = useQuery<SleepConsistencyResponse>({
    queryKey: ['health-sleep-consistency', 7],
    queryFn: () => authFetch<SleepConsistencyResponse>('/api/v1/metrics/sleep-consistency?days=7'),
    staleTime: 300_000,
    enabled,
  });
  const sleepDebt = useQuery<SleepDebtResponse>({
    queryKey: ['health-sleep-debt', 7],
    queryFn: () => authFetch<SleepDebtResponse>('/api/v1/metrics/sleep-debt?days=7'),
    staleTime: 300_000,
    enabled,
  });
  const bedtime = useQuery<OptimalBedtimeResponse>({
    queryKey: ['health-optimal-bedtime'],
    queryFn: () => authFetch<OptimalBedtimeResponse>('/api/v1/metrics/optimal-bedtime'),
    staleTime: 300_000,
    enabled,
  });

  const respiratory = useQuery<RespiratoryRateResponse>({
    queryKey: ['health-respiratory-rate'],
    queryFn: () => authFetch<RespiratoryRateResponse>('/api/v1/metrics/respiratory-rate'),
    staleTime: 300_000,
    enabled,
  });

  const alerts = useQuery<HealthAlert[]>({
    queryKey: ['health-alerts', 'all'],
    queryFn: () => authFetch<HealthAlert[]>('/api/v1/metrics/health-alerts?status=all'),
    staleTime: 60_000,
    enabled,
  });

  const check = useQuery<HealthCheckResponse>({
    queryKey: ['health-check'],
    queryFn: () => authFetch<HealthCheckResponse>('/api/v1/metrics/health-check'),
    staleTime: 60_000,
    enabled: enabled && deferred,
  });

  const weight = useQuery<WeightHistoryResponse>({
    queryKey: ['weight-history'],
    queryFn: () => authFetch<WeightHistoryResponse>('/api/v1/metrics/weight'),
    staleTime: 300_000,
    enabled,
  });

  const connections = useQuery<Connection[]>({
    queryKey: ['connections'],
    queryFn: () => authFetch<Connection[]>('/api/v1/connections/'),
    staleTime: 300_000,
    retry: 1,
    enabled,
  });

  const charts = useQuery<Record<string, ChartData>>({
    queryKey: ['health-charts', rangeDays],
    queryFn: async () => {
      // One failed chart must not blank the other four.
      const settled = await Promise.allSettled(
        CHART_KEYS.map(async (key) => {
          const data = await authFetch<ChartData>(`/api/v1/charts/${key}?days=${rangeDays}`);
          return [key, data] as const;
        }),
      );
      const chartMap: Record<string, ChartData> = {};
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          const [key, data] = result.value;
          chartMap[key] = data;
        }
      }
      return chartMap;
    },
    staleTime: 300_000,
    enabled: enabled && deferred,
  });

  // The correlation chart is the only one that touches activity streams; load
  // it only on Trends so it cannot block the Now answer.
  const correlations = useQuery<ChartData>({
    queryKey: ['health-correlations', rangeDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/recovery_vs_performance?days=${rangeDays}`),
    staleTime: 300_000,
    enabled: enabled && deferred && tab === 'trends',
  });

  const ai = useQuery<LlmAnalysis | null>({
    queryKey: ['health-ai-analysis'],
    queryFn: () => authFetch<LlmAnalysis | null>('/api/v1/metrics/health-ai-analysis'),
    staleTime: 30 * 60_000,
    enabled: enabled && tab === 'history',
  });

  const checkMutation = useMutation({
    mutationFn: () =>
      authFetch<{ analysis_results: HealthCheckResponse['analysis_results']; alerts_generated: number }>(
        '/api/v1/metrics/health-alerts/analyze',
        { method: 'POST' },
      ),
    onSuccess: (data) => {
      queryClient.setQueryData<HealthCheckResponse>(['health-check'], {
        checked_at: new Date().toISOString(),
        analysis_results: data.analysis_results,
      });
      void queryClient.invalidateQueries({ queryKey: ['health-alerts'] });
    },
  });

  const aiMutation = useMutation({
    mutationFn: () => authFetch<LlmAnalysis>('/api/v1/metrics/health-ai-analysis', { method: 'POST' }),
    onSuccess: (data) => {
      queryClient.setQueryData(['health-ai-analysis'], data);
    },
  });

  const syncAt = connections.data?.find((c) => c.provider === 'whoop')?.last_synced_at ?? null;
  const todayDate = todayISO();
  const readinessDate = readiness.data?.date ?? todayDate;
  const syncAge = ageDays(syncAt, todayDate);
  const dataAge = ageDays(readinessDate, todayDate);

  const vm: HealthViewModel = useMemo(() => {
    const chartMap = charts.data ?? {};
    const checkData = check.data ?? null;
    const sleep = sleepConsistency.data && sleepDebt.data && bedtime.data
      ? { consistency: sleepConsistency.data, debt: sleepDebt.data, bedtime: bedtime.data }
      : null;
    // The read-only check can be slow (six DB-backed analyses); it must not
    // hold the readiness answer hostage. The check card owns its own loading.
    const isLoading = readiness.isLoading || sleepDebt.isLoading;
    const whoopInfo = connections.data?.find((c) => c.provider === 'whoop');
    const connected = !!whoopInfo && whoopInfo.status === 'active';
    const isStale = !isLoading && (
      (syncAge != null && syncAge > 2) ||
      (dataAge != null && dataAge > 2) ||
      (connected && syncAt == null)
    );
    const isEmpty = !isLoading && !connected && !readiness.data?.recovery_score;
    const isAttention = !!checkData?.analysis_results.some(
      (r) => r.result && r.result.severity !== 'none',
    );

    return {
      isLoading,
      isError: readiness.isError,
      isEmpty,
      isStale,
      isAttention,
      asOf: readiness.data?.date ?? todayDate,
      syncAt,
      connectionsLoading: connections.isLoading,
      connectionsError: connections.isError,
      whoopConnected: connected,
      readiness: readiness.data ?? null,
      sleep,
      alerts: alerts.data ?? [],
      analysis: checkData?.analysis_results ?? null,
      analysisDate: checkData?.checked_at ?? null,
      checkLoading: !deferred || check.isLoading,
      respiratory: respiratory.data ?? null,
      ai: ai.data ?? null,
      aiLoading: ai.isLoading,
      weight: weight.data ?? null,
      connections: connections.data ?? [],
      charts: {
        whoop_recovery_trend: chartMap.whoop_recovery_trend ?? EMPTY_CHART,
        hrv_trend_detailed: chartMap.hrv_trend_detailed ?? EMPTY_CHART,
        resting_hr_trend: chartMap.resting_hr_trend ?? EMPTY_CHART,
        sleep_quality_trend: chartMap.sleep_quality_trend ?? EMPTY_CHART,
        whoop_strain_trend: chartMap.whoop_strain_trend ?? EMPTY_CHART,
        recovery_vs_performance: correlations.data ?? EMPTY_CHART,
      },
    };
  }, [
    alerts.data, bedtime.data, charts.data, check.data, check.isLoading,
    connections.data, connections.isError, connections.isLoading, correlations.data, dataAge, readiness.data,
    readiness.isError, readiness.isLoading, respiratory.data, sleepConsistency.data,
    sleepDebt.data, sleepDebt.isLoading, syncAge, syncAt, weight.data, ai.data, ai.isLoading,
    todayDate, deferred,
  ]);

  return {
    vm,
    checking: checkMutation.isPending,
    regenerating: aiMutation.isPending,
    runCheck: () => checkMutation.mutate(),
    regenerate: () => aiMutation.mutate(),
    refetchAll: () => queryClient.refetchQueries({ type: 'active' }),
  };
}
