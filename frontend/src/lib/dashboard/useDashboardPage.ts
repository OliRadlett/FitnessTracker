'use client';

/**
 * The dashboard's single data source.
 *
 * Replaces `useDashboardData`, which issued 24 queries from the hook plus 16 more
 * from the tab components. This one fetches per zone, so a cold Today load costs
 * nine requests instead of thirty, and it reports a *section* state rather than a
 * single `isLoading` that ORed eleven booleans together.
 *
 * The rule the old page broke: "not loaded yet" and "you have not trained" must
 * never look the same.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type {
  Activity,
  ChartData,
  Connection,
  DeficiencyResponse,
  DailyLoadPoint,
  Goal,
  LiftingSession,
  LlmAnalysis,
  MonthlySummaryItem,
  ReadinessResponse,
  SleepDebtResponse,
  TodaySummary,
  TrainingLoadResponse,
  YearlySummary,
} from '@/lib/api';

export type DashboardView = 'today' | 'trends' | 'history';
export type DashboardRange = '7d' | '30d' | '90d' | 'ytd';

export const RANGE_DAYS: Record<DashboardRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  ytd: 300,
};

export type SectionState = 'loading' | 'ready' | 'empty' | 'error';

export interface Section<T> {
  state: SectionState;
  data: T | null;
  retry: () => void;
}

/** The page cannot be rendered without one of these; everything else degrades. */
export type PageStatus = 'loading' | 'partial' | 'ready' | 'error';

function toSection<T>(
  query: { data: T | undefined; isLoading: boolean; isError: boolean; refetch: () => unknown },
  isEmpty?: (data: T) => boolean,
): Section<T> {
  const data = query.data ?? null;
  let state: SectionState;
  if (query.isLoading) state = 'loading';
  else if (query.isError) state = 'error';
  else if (data === null || (isEmpty?.(data) ?? false)) state = 'empty';
  else state = 'ready';
  return { state, data, retry: () => void query.refetch() };
}

const EMPTY_ARRAY = (d: unknown[]) => d.length === 0;

export interface DayLoad extends DailyLoadPoint {
  hrv: number | null;
}

export function useDashboardPage(view: DashboardView, range: DashboardRange) {
  const { authFetch, token } = useAuthFetch();
  const enabled = !!token;
  const days = RANGE_DAYS[range];

  // ── Today zone ────────────────────────────────────────────────────────────
  const todayQuery = useQuery<TodaySummary>({
    queryKey: ['dashboard', 'today'],
    queryFn: () => authFetch<TodaySummary>('/api/v1/dashboard/today'),
    staleTime: 60_000,
    enabled,
  });

  const loadQuery = useQuery<TrainingLoadResponse>({
    queryKey: ['training-load', 90],
    queryFn: () => authFetch<TrainingLoadResponse>('/api/v1/cycling/training-load?days=90'),
    staleTime: 300_000,
    enabled,
  });

  const hrvQuery = useQuery<ChartData>({
    queryKey: ['charts', 'hrv_trend_detailed', 90],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/hrv_trend_detailed?days=90'),
    staleTime: 300_000,
    enabled,
  });

  const readinessQuery = useQuery<ReadinessResponse>({
    queryKey: ['readiness'],
    queryFn: () => authFetch<ReadinessResponse>('/api/v1/metrics/readiness'),
    staleTime: 300_000,
    enabled,
  });

  const sleepQuery = useQuery<SleepDebtResponse>({
    queryKey: ['metrics', 'sleep-debt', 7],
    queryFn: () => authFetch<SleepDebtResponse>('/api/v1/metrics/sleep-debt?days=7'),
    staleTime: 300_000,
    enabled,
  });

  const activitiesQuery = useQuery<Activity[]>({
    queryKey: ['activities-recent'],
    queryFn: () => authFetch<Activity[]>('/api/v1/activities?limit=5'),
    staleTime: 60_000,
    enabled,
  });

  const sessionsQuery = useQuery<LiftingSession[]>({
    queryKey: ['lifting-sessions-recent'],
    queryFn: () => authFetch<LiftingSession[]>('/api/v1/lifting/sessions?limit=5'),
    staleTime: 60_000,
    enabled,
  });

  const connectionsQuery = useQuery<Connection[]>({
    queryKey: ['connections'],
    queryFn: () => authFetch<Connection[]>('/api/v1/connections/'),
    staleTime: 5 * 60_000,
    enabled,
  });

  const deficiencyQuery = useQuery<DeficiencyResponse>({
    queryKey: ['deficiency', 8],
    queryFn: () => authFetch<DeficiencyResponse>('/api/v1/deficiency?weeks=8'),
    staleTime: 600_000,
    enabled,
  });

  // ── Trends zone (only fetched when the zone is open) ──────────────────────
  const loadChartQuery = useQuery<ChartData>({
    queryKey: ['charts', 'training_load', days],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/training_load?days=${days}`),
    staleTime: 300_000,
    enabled: enabled && view === 'trends',
  });

  const weeklyTssQuery = useQuery<ChartData>({
    queryKey: ['charts', 'weekly_tss', 13],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/weekly_tss?weeks=13'),
    staleTime: 300_000,
    enabled: enabled && view === 'trends',
  });

  const hrvChartQuery = useQuery<ChartData>({
    queryKey: ['charts', 'hrv_trend_detailed', days],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/hrv_trend_detailed?days=${days}`),
    staleTime: 300_000,
    enabled: enabled && view === 'trends',
  });

  const goalsQuery = useQuery<Goal[]>({
    queryKey: ['goals'],
    queryFn: () => authFetch<Goal[]>('/api/v1/goals'),
    staleTime: 60_000,
    enabled: enabled && view === 'trends',
  });

  const cyclingAnalysisQuery = useQuery<LlmAnalysis | null>({
    queryKey: ['cycling', 'llm-analysis', 'latest'],
    queryFn: () => authFetch<LlmAnalysis | null>('/api/v1/cycling/llm-analysis/latest'),
    staleTime: 300_000,
    enabled: enabled && view === 'trends',
  });

  const healthAnalysisQuery = useQuery<LlmAnalysis | null>({
    queryKey: ['metrics', 'health-ai-analysis'],
    queryFn: () => authFetch<LlmAnalysis | null>('/api/v1/metrics/health-ai-analysis'),
    staleTime: 300_000,
    enabled: enabled && view === 'trends',
  });

  // ── History zone ──────────────────────────────────────────────────────────
  const year = new Date().getFullYear();
  const monthsQuery = useQuery<MonthlySummaryItem[]>({
    queryKey: ['monthly-summary', 12],
    queryFn: () => authFetch<MonthlySummaryItem[]>('/api/v1/dashboard/monthly-summary?months=12'),
    staleTime: 300_000,
    enabled: enabled && view === 'history',
  });

  const yearlyQuery = useQuery<YearlySummary>({
    queryKey: ['yearly-summary', year],
    queryFn: () => authFetch<YearlySummary>(`/api/v1/dashboard/yearly-summary/${year}`),
    staleTime: 300_000,
    enabled: enabled && view === 'history',
  });

  // ── Derived ───────────────────────────────────────────────────────────────
  const hrvSeries = useMemo(() => {
    const labels = hrvQuery.data?.labels ?? [];
    const values = hrvQuery.data?.series?.[0]?.data ?? [];
    return labels.map((date, i) => ({
      date,
      hrv: typeof values[i] === 'number' ? (values[i] as number) : null,
    }));
  }, [hrvQuery.data]);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const dayLoads: DayLoad[] = useMemo(() => {
    const hrvByDate = new Map(hrvSeries.map((p) => [p.date, p.hrv]));
    return (loadQuery.data?.data ?? []).map((p) => ({ ...p, hrv: hrvByDate.get(p.date) ?? null }));
  }, [loadQuery.data, hrvSeries]);

  const readiness = toSection(readinessQuery);

  const status: PageStatus = useMemo(() => {
    if (todayQuery.isLoading) return 'loading';
    if (todayQuery.isError) return 'error';
    const sections = [loadQuery, hrvQuery, readinessQuery, activitiesQuery, sessionsQuery];
    if (sections.some((q) => q.isLoading)) return 'partial';
    if (loadQuery.isError || activitiesQuery.isError || sessionsQuery.isError) return 'partial';
    return 'ready';
  }, [todayQuery, loadQuery, hrvQuery, readinessQuery, activitiesQuery, sessionsQuery]);

  return {
    status,
    todayIso,
    today: toSection(todayQuery),
    load: toSection(loadQuery),
    dayLoads,
    readiness,
    sleepDebt: toSection(sleepQuery),
    activities: toSection(activitiesQuery, EMPTY_ARRAY),
    sessions: toSection(sessionsQuery, EMPTY_ARRAY),
    connections: toSection(connectionsQuery, EMPTY_ARRAY),
    deficiency: toSection(deficiencyQuery),
    trends: {
      loadChart: toSection(loadChartQuery),
      weeklyTss: toSection(weeklyTssQuery),
      hrvChart: toSection(hrvChartQuery),
      goals: toSection(goalsQuery, EMPTY_ARRAY),
      cyclingAnalysis: toSection(cyclingAnalysisQuery),
      healthAnalysis: toSection(healthAnalysisQuery),
    },
    history: {
      months: toSection(monthsQuery, EMPTY_ARRAY),
      yearly: toSection(yearlyQuery),
    },
  };
}

export type DashboardPageData = ReturnType<typeof useDashboardPage>;
