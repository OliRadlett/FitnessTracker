'use client';

import { useQuery } from '@tanstack/react-query';
import { getPlanWeek, getTrainingPlans, useAuthFetch } from '@/lib/api';
import type { TrainingPlanSummary, TrainingWeekDay } from '@/lib/api/types';
import { getCurrentWeek, toDateStr } from '@/lib/training/week';

export interface TodaysStrengthDay {
  planName: string;
  planDay: TrainingWeekDay;
}

/**
 * Today's uncompleted strength plan day (if any) from the active plan.
 * Shared by Live Lift ("Load from today's plan") and the lifting Sessions
 * tab ("Today's Strength Day" card). Same query key in both places, so the
 * fetch happens once. Suggest-only data — nothing auto-applies.
 */
export function useTodaysStrengthDay(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  const { authFetch, token } = useAuthFetch();
  return useQuery({
    queryKey: ['live-plan-today'],
    queryFn: async (): Promise<TodaysStrengthDay | null> => {
      const plans = await getTrainingPlans(authFetch, 'active');
      const today = toDateStr(new Date());
      const plan: TrainingPlanSummary | undefined = plans.find(
        (p) => p.start_date <= today && today <= p.end_date,
      );
      if (!plan) return null;
      const week = getCurrentWeek(plan.start_date, plan.end_date);
      const weekData = await getPlanWeek(authFetch, plan.id, week);
      const day = weekData.days.find(
        (d) =>
          d.day_date === today &&
          d.sport === 'strength' &&
          (d.planned_exercises?.length ?? 0) > 0 &&
          !d.completed,
      );
      return day ? { planName: plan.name, planDay: day } : null;
    },
    staleTime: 10 * 60_000,
    enabled: enabled && !!token,
  });
}
