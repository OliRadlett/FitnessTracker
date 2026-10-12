'use client';

/**
 * Lightweight hook for the mobile Train FAB target.
 *
 * V2 replaces the heavy useAthleteState() (8 endpoints) with targeted hooks.
 * The Train button only needs today's plan day to resolve its target — no
 * full AthleteState composition required.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPlanWeek, getTrainingPlans, useAuthFetch } from '@/lib/api';
import type { TrainingWeekDay } from '@/lib/api';
import { getCurrentWeek } from '@/lib/training/week';

/** Inline V2 replacement for resolveTrainTarget from mode-shell. */
function resolveTrainTarget(
  today: Pick<TrainingWeekDay, 'sport' | 'completed'> | null | undefined,
): string {
  if (!today || today.completed) return '/today';
  if (today.sport === 'strength') return '/lifting/live';
  if (today.sport === 'rest') return '/today';
  return '/training';
}

export function useTodayPlanTarget(): string {
  const { authFetch, token } = useAuthFetch();

  const plansQuery = useQuery({
    queryKey: ['training-plans', 'active'],
    queryFn: () => getTrainingPlans(authFetch, 'active'),
    staleTime: 60_000,
    enabled: !!token,
  });

  const activePlan = useMemo(
    () => plansQuery.data?.[0] ?? null,
    [plansQuery.data],
  );

  const currentWeek = useMemo(
    () => (activePlan ? getCurrentWeek(activePlan.start_date, activePlan.end_date) : 0),
    [activePlan],
  );

  const planWeekQuery = useQuery({
    queryKey: ['plan-week', activePlan?.id, currentWeek],
    queryFn: () => getPlanWeek(authFetch, activePlan!.id, currentWeek),
    staleTime: 60_000,
    enabled: !!token && !!activePlan,
  });

  const todayDay = useMemo<TrainingWeekDay | null>(() => {
    if (!planWeekQuery.data?.days) return null;
    // Find today's day in the plan week
    const today = new Date().toISOString().split('T')[0];
    return planWeekQuery.data.days.find((d) => d.day_date === today) ?? null;
  }, [planWeekQuery.data]);

  return useMemo(() => resolveTrainTarget(todayDay), [todayDay]);
}
