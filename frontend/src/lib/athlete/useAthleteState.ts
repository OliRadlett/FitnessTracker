'use client';

/**
 * Phase 1 (plans/ui-redesign-v2.md §1.1) — `useAthleteState()`.
 *
 * Frontend composition first (zero new backend endpoints, zero migration
 * risk). Composes ONLY existing endpoints/queries:
 *
 *   verdict  GET /api/v1/dashboard/today          (Wave-4 five-engine consensus)
 *   load     GET /api/v1/cycling/training-load    (CTL/ATL/TSB — single source)
 *            + GET /api/v1/cycling/profile        (FTP)
 *   body     GET /api/v1/metrics/readiness + /metrics/sleep-debt + /metrics/weight
 *   plan     GET /api/v1/training-plans (+ week slice + conformity)
 *   goals    GET /api/v1/goals (+ per-goal projections, shared cache keys)
 *   sync     GET /api/v1/connections/             (stale/needs_reauth surfaced)
 *
 * Query keys reuse the exact keys pages already use, so mounting this hook
 * shares cache instead of refetching. Every query gates on `enabled: !!token`
 * (pitfall 11); dependent queries additionally gate on their prerequisite.
 * Slices degrade independently (pitfall 43): one failed query nulls its own
 * slice, never the whole state.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getPlanWeek,
  getTrainingPlans,
  useAuthFetch,
} from '@/lib/api';
import { useGoalProjections } from '@/components/goals/useGoalProjections';
import type {
  Connection,
  CyclingProfile,
  Goal,
  PlanConformityResponse,
  ReadinessResponse,
  SleepDebtResponse,
  TodaySummary,
  TrainingLoadResponse,
  TrainingPlanSummary,
  TrainingWeekResponse,
  WeightHistoryResponse,
} from '@/lib/api';
import { getCurrentWeek, toDateStr } from '@/lib/training/week';
import type { AthleteState } from './types';
import {
  classifyGoalTrajectories,
  deriveDegradedEngines,
  deriveLastSyncedAt,
  deriveLoadTrend,
  deriveStaleProviders,
  deriveWeekTss,
  pickActivePlan,
} from './selectors';

const LOAD_DAYS = 90;
const CONFORMITY_WEEKS = 4;

export function useAthleteState(): AthleteState {
  const { authFetch, token } = useAuthFetch();

  // ── Verdict (Wave-4 consensus, incl. silent/degraded engines) ──────────
  const todayQuery = useQuery<TodaySummary>({
    queryKey: ['dashboard', 'today'],
    queryFn: () => authFetch<TodaySummary>('/api/v1/dashboard/today'),
    staleTime: 60_000,
    enabled: !!token,
  });

  // ── Load (single source for every CTL/ATL/TSB number) ──────────────────
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

  // ── Body ───────────────────────────────────────────────────────────────
  const readinessQuery = useQuery<ReadinessResponse>({
    queryKey: ['readiness'],
    queryFn: () => authFetch<ReadinessResponse>('/api/v1/metrics/readiness'),
    staleTime: 300_000,
    enabled: !!token,
  });
  const sleepDebtQuery = useQuery<SleepDebtResponse>({
    queryKey: ['metrics', 'sleep-debt'],
    queryFn: () => authFetch<SleepDebtResponse>('/api/v1/metrics/sleep-debt?days=7'),
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

  // ── Plan (today slice + conformity) ────────────────────────────────────
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
  const conformityQuery = useQuery<PlanConformityResponse>({
    queryKey: ['plan-conformity', activePlan?.id],
    queryFn: () =>
      authFetch<PlanConformityResponse>(
        `/api/v1/training-plans/${activePlan!.id}/conformity?weeks=${CONFORMITY_WEEKS}`,
      ),
    staleTime: 60_000,
    enabled: !!token && !!activePlan,
  });

  // ── Goals (trajectories via shared per-goal projection cache) ──────────
  const goalsQuery = useQuery<Goal[]>({
    queryKey: ['goals'],
    queryFn: () => authFetch<Goal[]>('/api/v1/goals'),
    staleTime: 60_000,
    enabled: !!token,
  });
  const projections = useGoalProjections(goalsQuery.data);

  // ── Sync (stale/needs_reauth shown, never averaged away) ───────────────
  const connectionsQuery = useQuery<Connection[]>({
    queryKey: ['connections'],
    queryFn: () => authFetch<Connection[]>('/api/v1/connections/'),
    staleTime: 5 * 60_000,
    enabled: !!token,
  });

  return useMemo<AthleteState>(() => {
    const verdict = todayQuery.data?.verdict ?? null;
    const consensus = verdict?.consensus ?? [];
    const degradedEngines = deriveDegradedEngines(consensus);

    const loadPoints = loadQuery.data?.data ?? null;
    const trend = deriveLoadTrend(loadPoints);

    const todayStr = toDateStr(new Date());
    const todayDay =
      (planWeekQuery.data?.days ?? []).find((d) => d.day_date === todayStr) ?? null;

    const weightEntries = weightQuery.data?.entries ?? [];
    const latestWeight = weightEntries.length > 0
      ? weightEntries[weightEntries.length - 1]
      : null;
    const rollingAvg = weightQuery.data?.rolling_avg ?? [];
    const latestAvg = rollingAvg.length > 0 ? rollingAvg[rollingAvg.length - 1] : null;

    const trajectories = classifyGoalTrajectories(goalsQuery.data, projections);

    const staleProviders = deriveStaleProviders(connectionsQuery.data);

    const state: AthleteState = {
      verdict: {
        verdict,
        headline: verdict?.headline ?? null,
        shouldRest: verdict?.should_rest ?? false,
        reasons: verdict?.reasons ?? [],
        engines: consensus,
        degradedEngines,
        isLoading: todayQuery.isLoading,
        isError: todayQuery.isError,
      },
      load: {
        ctl: loadQuery.data?.current_ctl ?? todayQuery.data?.current_ctl ?? null,
        atl: loadQuery.data?.current_atl ?? todayQuery.data?.current_atl ?? null,
        tsb: loadQuery.data?.current_tsb ?? todayQuery.data?.current_tsb ?? null,
        tsbDelta7d: trend.delta,
        trend: trend.direction,
        weekTss: deriveWeekTss(loadPoints),
        ftpWatts: profileQuery.data?.ftp_watts ?? null,
        isLoading: loadQuery.isLoading || profileQuery.isLoading,
        isError: loadQuery.isError || profileQuery.isError,
      },
      body: {
        weightKg: latestWeight?.weight_kg ?? null,
        weightSource: latestWeight?.source ?? null,
        weightDate: latestWeight?.date ?? null,
        rollingAvgKg: latestAvg?.weight_kg ?? null,
        hrvMs: readinessQuery.data?.hrv_ms ?? todayQuery.data?.latest_hrv_ms ?? null,
        restingHr: readinessQuery.data?.resting_hr ?? null,
        recoveryScore:
          readinessQuery.data?.recovery_score ?? todayQuery.data?.latest_recovery ?? null,
        sleepDebtHours: sleepDebtQuery.data?.debt_hours ?? null,
        readiness: readinessQuery.data?.readiness ?? null,
        isLoading:
          readinessQuery.isLoading || sleepDebtQuery.isLoading || weightQuery.isLoading,
        isError:
          readinessQuery.isError || sleepDebtQuery.isError || weightQuery.isError,
      },
      plan: {
        activePlan,
        today: todayDay,
        conformityPct: conformityQuery.data?.overall_pct ?? null,
        conformity: conformityQuery.data ?? null,
        isLoading:
          plansQuery.isLoading || planWeekQuery.isLoading || conformityQuery.isLoading,
        isError:
          plansQuery.isError || planWeekQuery.isError || conformityQuery.isError,
      },
      goals: {
        ...trajectories,
        isLoading: goalsQuery.isLoading,
        isError: goalsQuery.isError,
      },
      sync: {
        staleProviders,
        degradedEngines,
        lastSyncedAt: deriveLastSyncedAt(connectionsQuery.data),
        isLoading: connectionsQuery.isLoading,
        isError: connectionsQuery.isError,
      },
      isLoading:
        todayQuery.isLoading ||
        loadQuery.isLoading ||
        readinessQuery.isLoading ||
        plansQuery.isLoading ||
        goalsQuery.isLoading ||
        connectionsQuery.isLoading,
      isError:
        todayQuery.isError ||
        loadQuery.isError ||
        readinessQuery.isError ||
        plansQuery.isError ||
        goalsQuery.isError ||
        connectionsQuery.isError,
    };
    return state;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    todayQuery.data,
    todayQuery.isLoading,
    todayQuery.isError,
    loadQuery.data,
    loadQuery.isLoading,
    loadQuery.isError,
    profileQuery.data,
    profileQuery.isLoading,
    profileQuery.isError,
    readinessQuery.data,
    readinessQuery.isLoading,
    readinessQuery.isError,
    sleepDebtQuery.data,
    sleepDebtQuery.isLoading,
    sleepDebtQuery.isError,
    weightQuery.data,
    weightQuery.isLoading,
    weightQuery.isError,
    plansQuery.data,
    plansQuery.isLoading,
    plansQuery.isError,
    activePlan,
    planWeekQuery.data,
    planWeekQuery.isLoading,
    planWeekQuery.isError,
    conformityQuery.data,
    conformityQuery.isLoading,
    conformityQuery.isError,
    goalsQuery.data,
    goalsQuery.isLoading,
    goalsQuery.isError,
    projections,
    connectionsQuery.data,
    connectionsQuery.isLoading,
    connectionsQuery.isError,
  ]);
}
