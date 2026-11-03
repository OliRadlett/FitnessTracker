'use client';

import { useQuery } from '@tanstack/react-query';
import { getPlanWeek, getTrainingPlans, useAuthFetch } from '@/lib/api';
import type { TrainingPlanSummary, TrainingWeekResponse } from '@/lib/api/types';
import { getCurrentWeek, toDateStr } from '@/lib/training/week';

export interface PlanWeekOverview {
  plan: TrainingPlanSummary;
  week: TrainingWeekResponse;
  today: string;
}

/**
 * Current week of the active plan, regardless of whether today's day is
 * completed or has structured exercises.
 *
 * `useTodaysStrengthDay` deliberately returns only an *uncompleted strength day
 * with exercises* (for Live Lift's "load from plan"). The Overview needs the
 * whole week — rest days, completed days, focus-only days — so this is a
 * separate hook with its own query key.
 */
export function usePlanWeekOverview(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  const { authFetch, token } = useAuthFetch();
  return useQuery({
    queryKey: ['lifting-plan-week-overview'],
    queryFn: async (): Promise<PlanWeekOverview | null> => {
      const plans = await getTrainingPlans(authFetch, 'active');
      const today = toDateStr(new Date());
      const plan = plans.find((p) => p.start_date <= today && today <= p.end_date);
      if (!plan) return null;
      const weekNumber = getCurrentWeek(plan.start_date, plan.end_date);
      const week = await getPlanWeek(authFetch, plan.id, weekNumber, { includeWeather: false });
      return { plan, week, today };
    },
    staleTime: 10 * 60_000,
    enabled: enabled && !!token,
  });
}
