'use client';

import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';

import { updatePlanDay, useAuthFetch } from '@/lib/api';
import type {
  TrainingPlan,
  TrainingWeekResponse,
  UpdateTrainingPlanDayPayload,
} from '@/lib/api';
import { patchDayInPlan, patchDayInWeek } from './planDayCache';

export interface InstantDayEditVars {
  dayId: string;
  payload: UpdateTrainingPlanDayPayload;
}

/**
 * Optimistic single-day field edit — the "instant edit" save model.
 *
 * A field change commits immediately through the targeted day PATCH (the
 * server applies only the provided fields), so there is no draft and no Save
 * button. The visible week and the plan detail are patched optimistically so
 * the UI never waits; a failed write rolls both back. Derived caches
 * (conformity, the plan list, today's-plan slice shared with `/lifting`) are
 * invalidated once the write settles so they reconcile with the server.
 *
 * Pass the currently-visible `week` so the right `['plan-week', planId, week]`
 * cache entry is patched; `null` skips the week patch but still edits the plan.
 */
export function useInstantDayEdit(planId: string | null, week: number | null) {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();

  const weekKey: QueryKey | null =
    planId && week != null ? ['plan-week', planId, week] : null;
  const planKey: QueryKey | null = planId ? ['training-plan', planId] : null;

  return useMutation({
    mutationFn: ({ dayId, payload }: InstantDayEditVars) => {
      if (!planId) throw new Error('No plan selected');
      return updatePlanDay(authFetch, planId, dayId, payload);
    },

    onMutate: async ({ dayId, payload }) => {
      const keys = [weekKey, planKey].filter((k): k is QueryKey => k !== null);
      await Promise.all(keys.map((k) => queryClient.cancelQueries({ queryKey: k })));

      const snapshot: Array<[QueryKey, unknown]> = keys.map((k) => [
        k,
        queryClient.getQueryData(k),
      ]);

      if (weekKey) {
        const prev = queryClient.getQueryData<TrainingWeekResponse>(weekKey);
        if (prev) queryClient.setQueryData(weekKey, patchDayInWeek(prev, dayId, payload));
      }
      if (planKey) {
        const prev = queryClient.getQueryData<TrainingPlan>(planKey);
        if (prev) queryClient.setQueryData(planKey, patchDayInPlan(prev, dayId, payload));
      }

      return { snapshot };
    },

    onError: (_err, _vars, context) => {
      context?.snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },

    onSettled: () => {
      if (!planId) return;
      queryClient.invalidateQueries({ queryKey: ['plan-week', planId] });
      queryClient.invalidateQueries({ queryKey: ['training-plan', planId] });
      queryClient.invalidateQueries({ queryKey: ['plan-conformity', planId] });
      queryClient.invalidateQueries({ queryKey: ['day-conformity'] });
      queryClient.invalidateQueries({ queryKey: ['training-plans'] });
      queryClient.invalidateQueries({ queryKey: ['live-plan-today'] });
    },
  });
}
