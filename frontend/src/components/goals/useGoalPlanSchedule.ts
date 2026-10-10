'use client';

// Shared schedule lookup for the goal → plan-day cross-links (Phase 2).
// Resolves the most-recently-updated ACTIVE training plan and its days via the
// existing `['training-plans']` / `['training-plan', id]` cache entries, so
// every goal card / modal mounting this hook shares one fetch with the
// training page instead of refetching per goal. Links only — read-only.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch, getTrainingPlans } from '@/lib/api';
import type { TrainingPlan, TrainingPlanDay } from '@/lib/api';

export interface GoalPlanSchedule {
  planId: string | null;
  planName: string | null;
  days: TrainingPlanDay[];
  isLoading: boolean;
}

export function useGoalPlanSchedule(): GoalPlanSchedule {
  const { authFetch, token } = useAuthFetch();

  const plansQuery = useQuery({
    queryKey: ['training-plans'],
    queryFn: () => getTrainingPlans(authFetch),
    staleTime: 60_000,
    enabled: !!token,
  });

  // Same pick as the training page auto-select: most-recently-updated active.
  const activePlan = useMemo(() => {
    const actives = (plansQuery.data ?? []).filter((p) => p.status === 'active');
    if (actives.length === 0) return null;
    return [...actives].sort((a, b) => {
      const aTime = new Date(a.updated_at ?? a.start_date).getTime();
      const bTime = new Date(b.updated_at ?? b.start_date).getTime();
      return bTime - aTime;
    })[0];
  }, [plansQuery.data]);

  const detailQuery = useQuery({
    queryKey: ['training-plan', activePlan?.id],
    queryFn: () => authFetch<TrainingPlan>(`/api/v1/training-plans/${activePlan!.id}`),
    staleTime: 60_000,
    enabled: !!token && !!activePlan,
  });

  return {
    planId: activePlan?.id ?? null,
    planName: activePlan?.name ?? null,
    days: detailQuery.data?.days ?? [],
    isLoading: plansQuery.isLoading || (!!activePlan && detailQuery.isLoading),
  };
}
