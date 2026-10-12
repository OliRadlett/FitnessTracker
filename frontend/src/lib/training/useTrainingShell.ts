'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { getTrainingPlans, useAuthFetch } from '@/lib/api';
import type { TrainingPlan, TrainingPlanSummary } from '@/lib/api';
import { useDeepLink } from '@/lib/useDeepLink';
import { isIsoDate, parseTrainingMode, pickActivePlan } from './trainingModes';
import type { TrainingMode } from './trainingModes';

/**
 * Shell state for `/training`: the active mode (`?mode=`, default plan), the
 * selected plan (`?plan=`, else the most recent active), the plan's detail, and
 * the `?day=` deep-link highlight. Owns the shared plan queries so every mode
 * reads one cache entry (and so `/goals`/`/lifting` keep sharing them too).
 */
export function useTrainingShell() {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const { getParam, setParam } = useDeepLink();

  const mode = parseTrainingMode(getParam('mode'));
  const urlPlan = getParam('plan');
  const urlDay = getParam('day');
  // Validated YYYY-MM-DD only — anything else would poison the week math.
  const highlightDate = isIsoDate(urlDay) ? urlDay!.slice(0, 10) : null;

  const plansQuery = useQuery<TrainingPlanSummary[]>({
    queryKey: ['training-plans'],
    queryFn: () => getTrainingPlans(authFetch),
    enabled: !!token,
  });

  const [selectedPlanId, setSelectedPlanIdState] = useState<string | null>(null);

  // Initial selection: `?plan=` when it names a plan in the list, else the
  // most recently updated active plan. Runs once data is available.
  useEffect(() => {
    if (selectedPlanId || !plansQuery.data) return;
    const linked = urlPlan
      ? plansQuery.data.find((p) => p.id === urlPlan)
      : undefined;
    const next = linked ?? pickActivePlan(plansQuery.data);
    if (next) setSelectedPlanIdState(next.id);
  }, [plansQuery.data, selectedPlanId, urlPlan]);

  const setSelectedPlanId = useCallback(
    (id: string | null) => {
      setSelectedPlanIdState(id);
      setParam('plan', id);
    },
    [setParam],
  );

  // 'plan' is the default, so it drops the param (clean URLs); others write it.
  const setMode = useCallback(
    (next: TrainingMode) => {
      setParam('mode', next === 'plan' ? null : next);
    },
    [setParam],
  );

  const planQuery = useQuery<TrainingPlan>({
    queryKey: ['training-plan', selectedPlanId],
    queryFn: () => authFetch<TrainingPlan>(`/api/v1/training-plans/${selectedPlanId}`),
    enabled: !!selectedPlanId && !!token,
  });

  /** Invalidate the caches a plan-level change (rename/status/day edit) affects. */
  const invalidatePlan = useCallback(
    (planId: string) => {
      queryClient.invalidateQueries({ queryKey: ['training-plans'] });
      queryClient.invalidateQueries({ queryKey: ['training-plan', planId] });
      queryClient.invalidateQueries({ queryKey: ['plan-week', planId] });
      queryClient.invalidateQueries({ queryKey: ['plan-conformity', planId] });
      queryClient.invalidateQueries({ queryKey: ['adaptive-suggestions', planId] });
    },
    [queryClient],
  );

  return {
    mode,
    setMode,
    plans: plansQuery.data ?? [],
    plansLoading: plansQuery.isLoading,
    plansError: plansQuery.isError,
    refetchPlans: plansQuery.refetch,
    selectedPlanId,
    setSelectedPlanId,
    selectedPlan: planQuery.data,
    planLoading: planQuery.isLoading,
    highlightDate,
    invalidatePlan,
  };
}
