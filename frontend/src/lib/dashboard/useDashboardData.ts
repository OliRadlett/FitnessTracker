'use client';

/**
 * V2: Single data source for the DashboardPage.
 * Replaces useAthleteState() + 12 individual useQuery calls with one hook.
 * Uses the SAME cache keys as other pages so data is shared, not duplicated.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getPlanWeek,
  getTrainingPlans,
  useAuthFetch,
} from '@/lib/api';
import { getCurrentWeek, toDateStr } from '@/lib/training/week';
import {
  classifyGoalTrajectories,
  deriveLastSyncedAt,
  deriveLoadTrend,
  deriveStaleProviders,
  deriveWeekTss,
  pickActivePlan,
} from '@/lib/athlete/selectors';
import { useGoalProjections } from '@/components/goals/useGoalProjections';
import type {
  Activity,
  Connection,
  CyclingProfile,
  DashboardSummary,
  DailyLoadPoint,
  DeficiencyResponse,
  Event,
  Goal,
  LlmAnalysis,
  LiftingSession,
  MonthlySummaryItem,
  OptimalBedtimeResponse,
  ReadinessResponse,
  RespiratoryRateResponse,
  SleepConsistencyResponse,
  SleepDebtResponse,
  TodaySummary,
  TodayVerdict,
  TrainingLoadResponse,
  TrainingPlanSummary,
  TrainingStreaks,
  TrainingWeekDay,
  TrainingWeekResponse,
  WeightHistoryResponse,
  WhoopWeeklySummary,
  YearlySummary,
} from '@/lib/api';

const LOAD_DAYS = 90;
const CONFORMITY_WEEKS = 4;

export interface DashboardData {
  // Verdict (from /dashboard/today)
  verdict: TodayVerdict | null;
  verdictHeadline: string | null;
  shouldRest: boolean;
  verdictReasons: string[];
  verdictEngines: NonNullable<TodaySummary['verdict']>['consensus'] | null;
  verdictIsLoading: boolean;
  verdictIsError: boolean;

  // Load
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  tsbDelta7d: number | null;
  loadTrendDirection: 'up' | 'down' | 'flat' | null;
  weekTss: number | null;
  ftpWatts: number | null;
  loadTrendPoints: DailyLoadPoint[] | null;
  loadIsLoading: boolean;

   // Body
  weightKg: number | null;
  weightSource: string | null;
  weightDate: string | null;
  weightHistory: WeightHistoryResponse | undefined;
  sleepDebtHours: number | null;
  sleepConsistency: SleepConsistencyResponse | undefined;
  optimalBedtime: OptimalBedtimeResponse | undefined;
  hrvMs: number | null;
  restingHr: number | null;
  recoveryScore: number | null;
  bodyIsLoading: boolean;

  // Plan
  activePlan: TrainingPlanSummary | null;
  todayPlan: TrainingWeekDay | null;
  conformityPct: number | null;
  planIsLoading: boolean;

  // Goals
  goals: Goal[] | undefined;
  goalTrajectories: ReturnType<typeof classifyGoalTrajectories>;
  goalsIsLoading: boolean;

  // Sync
  staleProviders: ReturnType<typeof deriveStaleProviders>;
  lastSyncedAt: string | null;

  // Dashboard-specific
  activities: Activity[] | undefined;
  activitiesLoading: boolean;
  activitiesError: boolean;
  refetchActivities: () => void;
  sessions: LiftingSession[] | undefined;
  sessionsLoading: boolean;
  sessionsError: boolean;
  refetchSessions: () => void;
  dashboardSummary: DashboardSummary | undefined;
  todaySummary: TodaySummary | undefined;
  readiness: ReadinessResponse | undefined;
  respiratoryRate: RespiratoryRateResponse | undefined;
  whoopWeekly: WhoopWeeklySummary | null;
  hasWhoop: boolean;
  monthlySummary: MonthlySummaryItem[] | undefined;
  monthlyLoading: boolean;
  streaks: TrainingStreaks | null;
  yearlySummary: YearlySummary | null;
  yearlyLoading: boolean;
  selectedYear: number;
  upcomingEvents: Event[] | undefined;
  llmAnalysis: LlmAnalysis | null;
  llmLoading: boolean;
  deficiency: DeficiencyResponse | null;
  deficiencyLoading: boolean;

  // Combined
  isLoading: boolean;
  isError: boolean;
}

export function useDashboardData(selectedYear?: number): DashboardData {
  const { authFetch, token } = useAuthFetch();
  const currentYear = new Date().getFullYear();
  const year = selectedYear ?? currentYear;

  // ── Verdict ──────────────────────────────────────────────────────────────
  const todayQuery = useQuery<TodaySummary>({
    queryKey: ['dashboard', 'today'],
    queryFn: () => authFetch<TodaySummary>('/api/v1/dashboard/today'),
    staleTime: 60_000,
    enabled: !!token,
  });

  // ── Load (single source for CTL/ATL/TSB) ─────────────────────────────────
  const loadQuery = useQuery<TrainingLoadResponse>({
    queryKey: ['training-load', LOAD_DAYS],
    queryFn: () =>
      authFetch<TrainingLoadResponse>(`/api/v1/cycling/training-load?days=${LOAD_DAYS}`),
    staleTime: 300_000,
    enabled: !!token,
  });
  const profileQuery = useQuery<CyclingProfile>({
    queryKey: ['cycling-profile'],
    queryFn: () => authFetch<CyclingProfile>('/api/v1/cycling/profile'),
    staleTime: 300_000,
    enabled: !!token,
  });

  // ── Body ─────────────────────────────────────────────────────────────────
  const readinessQuery = useQuery<ReadinessResponse>({
    queryKey: ['readiness'],
    queryFn: () => authFetch<ReadinessResponse>('/api/v1/metrics/readiness'),
    staleTime: 300_000,
    enabled: !!token,
  });
  const respiratoryRateQuery = useQuery<RespiratoryRateResponse>({
    queryKey: ['respiratory-rate'],
    queryFn: () => authFetch<RespiratoryRateResponse>('/api/v1/metrics/respiratory-rate'),
    staleTime: 300_000,
    enabled: !!token,
  });
  const sleepDebtQuery = useQuery<SleepDebtResponse>({
    queryKey: ['metrics', 'sleep-debt'],
    queryFn: () => authFetch<SleepDebtResponse>('/api/v1/metrics/sleep-debt?days=7'),
    staleTime: 300_000,
    enabled: !!token,
  });
  const sleepConsistencyQuery = useQuery<SleepConsistencyResponse>({
    queryKey: ['metrics', 'sleep-consistency'],
    queryFn: () => authFetch<SleepConsistencyResponse>('/api/v1/metrics/sleep-consistency?days=7'),
    staleTime: 300_000,
    enabled: !!token,
  });
  const optimalBedtimeQuery = useQuery<OptimalBedtimeResponse>({
    queryKey: ['metrics', 'optimal-bedtime'],
    queryFn: () => authFetch<OptimalBedtimeResponse>('/api/v1/metrics/optimal-bedtime'),
    staleTime: 300_000,
    enabled: !!token,
  });
  const weightQuery = useQuery<WeightHistoryResponse>({
    queryKey: ['weight-history'],
    queryFn: () =>
      authFetch<WeightHistoryResponse>('/api/v1/metrics/weight?days=90'),
    staleTime: 300_000,
    enabled: !!token,
  });

  // ── Plan ──────────────────────────────────────────────────────────────────
  const plansQuery = useQuery<TrainingPlanSummary[]>({
    queryKey: ['training-plans', 'active'],
    queryFn: () => getTrainingPlans(authFetch, 'active'),
    staleTime: 60_000,
    enabled: !!token,
  });
  const activePlan = useMemo(
    () => pickActivePlan(plansQuery.data),
    [plansQuery.data],
  );
  const currentWeek = useMemo(
    () => (activePlan ? getCurrentWeek(activePlan.start_date, activePlan.end_date) : 0),
    [activePlan],
  );
  const planWeekQuery = useQuery<TrainingWeekResponse>({
    queryKey: ['plan-week', activePlan?.id, currentWeek],
    queryFn: () => getPlanWeek(authFetch, activePlan!.id, currentWeek),
    staleTime: 60_000,
    enabled: !!token && !!activePlan,
  });
  const conformityQuery = useQuery({
    queryKey: ['plan-conformity', activePlan?.id, CONFORMITY_WEEKS],
    queryFn: () =>
      authFetch<any>(
        `/api/v1/training-plans/${activePlan!.id}/conformity?weeks=${CONFORMITY_WEEKS}`,
      ),
    staleTime: 60_000,
    enabled: !!token && !!activePlan,
  });

  // ── Goals ─────────────────────────────────────────────────────────────────
  const goalsQuery = useQuery<Goal[]>({
    queryKey: ['goals'],
    queryFn: () => authFetch<Goal[]>('/api/v1/goals'),
    staleTime: 60_000,
    enabled: !!token,
  });
  const projections = useGoalProjections(goalsQuery.data);

  // ── Sync ────────────────────────────────────────────────────────────────
  const connectionsQuery = useQuery<Connection[]>({
    queryKey: ['connections'],
    queryFn: () => authFetch<Connection[]>('/api/v1/connections/'),
    staleTime: 5 * 60_000,
    enabled: !!token,
  });

  // ── Dashboard summary ─────────────────────────────────────────────────────
  const dashboardSummaryQuery = useQuery<DashboardSummary>({
    queryKey: ['dashboard-summary'],
    queryFn: () => authFetch<DashboardSummary>('/api/v1/dashboard/summary'),
    staleTime: 60_000,
    enabled: !!token,
  });

  // ── Dashboard-specific ────────────────────────────────────────────────────
  const activitiesQuery = useQuery<Activity[]>({
    queryKey: ['activities-recent'],
    queryFn: () => authFetch<Activity[]>('/api/v1/activities?limit=5'),
    staleTime: 60_000,
    enabled: !!token,
  });

  const sessionsQuery = useQuery<LiftingSession[]>({
    queryKey: ['lifting-sessions-recent'],
    queryFn: () => authFetch<LiftingSession[]>('/api/v1/lifting/sessions?limit=5'),
    staleTime: 60_000,
    enabled: !!token,
  });

  const whoopWeeklyQuery = useQuery<WhoopWeeklySummary>({
    queryKey: ['whoop-weekly'],
    queryFn: () => authFetch<WhoopWeeklySummary>('/api/v1/dashboard/whoop-weekly'),
    staleTime: 300_000,
    enabled: !!token,
  });

  const monthlyQuery = useQuery<MonthlySummaryItem[]>({
    queryKey: ['monthly-summary', 12],
    queryFn: () => authFetch<MonthlySummaryItem[]>('/api/v1/dashboard/monthly-summary?months=12'),
    staleTime: 300_000,
    enabled: !!token,
  });

  const streaksQuery = useQuery<TrainingStreaks>({
    queryKey: ['training-streaks'],
    queryFn: () => authFetch<TrainingStreaks>('/api/v1/dashboard/streaks'),
    staleTime: 300_000,
    enabled: !!token,
  });

  const yearlyQuery = useQuery<YearlySummary>({
    queryKey: ['yearly-summary', year],
    queryFn: () => authFetch<YearlySummary>(`/api/v1/dashboard/yearly-summary/${year}`),
    staleTime: 300_000,
    enabled: !!token,
  });

  const eventsQuery = useQuery<Event[]>({
    queryKey: ['events', 'upcoming'],
    queryFn: () => authFetch<Event[]>('/api/v1/events?upcoming_only=true'),
    staleTime: 60_000,
    enabled: !!token,
  });

  const llmQuery = useQuery<LlmAnalysis | null>({
    queryKey: ['cycling', 'llm-analysis', 'latest'],
    queryFn: () => authFetch<LlmAnalysis | null>('/api/v1/cycling/llm-analysis/latest'),
    staleTime: 300_000,
    enabled: !!token,
  });

  const deficiencyQuery = useQuery<DeficiencyResponse>({
    queryKey: ['deficiency', '8w'],
    queryFn: () => authFetch<DeficiencyResponse>('/api/v1/deficiency?weeks=8'),
    staleTime: 600_000,
    enabled: !!token,
  });

  // ── Derived values ────────────────────────────────────────────────────────
  const loadPoints = loadQuery.data?.data ?? null;
  const trend = useMemo(() => deriveLoadTrend(loadPoints), [loadPoints]);
  const weekTss = useMemo(() => deriveWeekTss(loadPoints), [loadPoints]);

  const todayStr = toDateStr(new Date());
  const todayDay = useMemo(
    () => (planWeekQuery.data?.days ?? []).find((d) => d.day_date === todayStr) ?? null,
    [planWeekQuery.data],
  );

  const weightEntries = weightQuery.data?.entries ?? [];
  const latestWeight = useMemo(
    () => (weightEntries.length > 0 ? weightEntries[weightEntries.length - 1] : null),
    [weightEntries],
  );

  const staleProviders = useMemo(
    () => deriveStaleProviders(connectionsQuery.data),
    [connectionsQuery.data],
  );

  const trajectories = useMemo(
    () => classifyGoalTrajectories(goalsQuery.data, projections),
    [goalsQuery.data, projections],
  );

  const hasWhoop = useMemo(
    () => !!(whoopWeeklyQuery.data && whoopWeeklyQuery.data.days_with_data > 0),
    [whoopWeeklyQuery.data],
  );

  // ── Combine ───────────────────────────────────────────────────────────────
  return useMemo<DashboardData>(() => {
    const verdict = todayQuery.data?.verdict ?? null;

    return {
      // Verdict
      verdict,
      verdictHeadline: verdict?.headline ?? null,
      shouldRest: verdict?.should_rest ?? false,
      verdictReasons: verdict?.reasons ?? [],
      verdictEngines: verdict?.consensus ?? null,
      verdictIsLoading: todayQuery.isLoading,
      verdictIsError: todayQuery.isError,

      // Load
      ctl: loadQuery.data?.current_ctl ?? todayQuery.data?.current_ctl ?? null,
      atl: loadQuery.data?.current_atl ?? todayQuery.data?.current_atl ?? null,
      tsb: loadQuery.data?.current_tsb ?? todayQuery.data?.current_tsb ?? null,
      tsbDelta7d: trend.delta,
      loadTrendDirection: trend.direction,
      weekTss,
      ftpWatts: profileQuery.data?.ftp_watts ?? null,
      loadTrendPoints: loadPoints,
      loadIsLoading: loadQuery.isLoading || profileQuery.isLoading,

      // Body
      weightKg: latestWeight?.weight_kg ?? null,
      weightSource: latestWeight?.source ?? null,
      weightDate: latestWeight?.date ?? null,
      weightHistory: weightQuery.data,
      sleepDebtHours: sleepDebtQuery.data?.debt_hours ?? null,
      sleepConsistency: sleepConsistencyQuery.data,
      optimalBedtime: optimalBedtimeQuery.data,
      hrvMs: readinessQuery.data?.hrv_ms ?? todayQuery.data?.latest_hrv_ms ?? null,
      restingHr: readinessQuery.data?.resting_hr ?? null,
      recoveryScore: readinessQuery.data?.recovery_score ?? todayQuery.data?.latest_recovery ?? null,
      bodyIsLoading: readinessQuery.isLoading || sleepDebtQuery.isLoading || weightQuery.isLoading,

      // Plan
      activePlan: pickActivePlan(plansQuery.data),
      todayPlan: todayDay,
      conformityPct: conformityQuery.data?.overall_pct ?? null,
      planIsLoading: plansQuery.isLoading || planWeekQuery.isLoading || conformityQuery.isLoading,

      // Goals
      goals: goalsQuery.data,
      goalTrajectories: trajectories,
      goalsIsLoading: goalsQuery.isLoading,

      // Sync
      staleProviders,
      lastSyncedAt: deriveLastSyncedAt(connectionsQuery.data),

      // Dashboard-specific
      activities: activitiesQuery.data,
      activitiesLoading: activitiesQuery.isLoading,
      activitiesError: activitiesQuery.isError,
      refetchActivities: () => { void activitiesQuery.refetch(); },
      sessions: sessionsQuery.data,
      sessionsLoading: sessionsQuery.isLoading,
      sessionsError: sessionsQuery.isError,
      refetchSessions: () => { void sessionsQuery.refetch(); },
      dashboardSummary: dashboardSummaryQuery.data,
      todaySummary: todayQuery.data,
      readiness: readinessQuery.data,
      respiratoryRate: respiratoryRateQuery.data,
      whoopWeekly: whoopWeeklyQuery.data ?? null,
      hasWhoop,
      monthlySummary: monthlyQuery.data,
      monthlyLoading: monthlyQuery.isLoading,
      streaks: streaksQuery.data ?? null,
      yearlySummary: yearlyQuery.data ?? null,
      yearlyLoading: yearlyQuery.isLoading,
      selectedYear: year,
      upcomingEvents: eventsQuery.data,
      llmAnalysis: llmQuery.data ?? null,
      llmLoading: llmQuery.isLoading,
      deficiency: deficiencyQuery.data ?? null,
      deficiencyLoading: deficiencyQuery.isLoading,

      // Combined
      isLoading:
        todayQuery.isLoading ||
        loadQuery.isLoading ||
        profileQuery.isLoading ||
        readinessQuery.isLoading ||
        sleepDebtQuery.isLoading ||
        sleepConsistencyQuery.isLoading ||
        optimalBedtimeQuery.isLoading ||
        weightQuery.isLoading ||
        plansQuery.isLoading ||
        goalsQuery.isLoading ||
        connectionsQuery.isLoading,
      isError:
        todayQuery.isError ||
        loadQuery.isError ||
        profileQuery.isError ||
        readinessQuery.isError ||
        plansQuery.isError ||
        goalsQuery.isError ||
        connectionsQuery.isError,
    };
  }, [
    todayQuery.data, todayQuery.isLoading, todayQuery.isError,
    loadQuery.data, loadQuery.isLoading, loadQuery.isError,
    profileQuery.data, profileQuery.isLoading, profileQuery.isError,
    loadPoints, trend.delta, trend.direction,
    readinessQuery.data, readinessQuery.isLoading, readinessQuery.isError,
    sleepDebtQuery.data, sleepDebtQuery.isLoading,
    sleepConsistencyQuery.data,
    optimalBedtimeQuery.data,
    weightQuery.data, weightQuery.isLoading,
    latestWeight,
    plansQuery.data, plansQuery.isLoading, plansQuery.isError,
    planWeekQuery.data, planWeekQuery.isLoading, planWeekQuery.isError,
    conformityQuery.data, conformityQuery.isLoading, conformityQuery.isError,
    todayDay,
    goalsQuery.data, goalsQuery.isLoading, goalsQuery.isError,
    projections, trajectories,
    connectionsQuery.data, connectionsQuery.isLoading, connectionsQuery.isError,
    staleProviders,
    activitiesQuery.data, activitiesQuery.isLoading, activitiesQuery.isError,
    sessionsQuery.data, sessionsQuery.isLoading, sessionsQuery.isError,
    dashboardSummaryQuery.data,
    respiratoryRateQuery.data,
    whoopWeeklyQuery.data, hasWhoop,
    monthlyQuery.data, monthlyQuery.isLoading,
    streaksQuery.data,
    yearlyQuery.data, yearlyQuery.isLoading,
    year,
    eventsQuery.data,
    llmQuery.data, llmQuery.isLoading,
    deficiencyQuery.data, deficiencyQuery.isLoading,
  ]);
}
