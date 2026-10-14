'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  addDay,
  copyPlanDayToDate,
  deleteDay,
  rescheduleDay,
  substituteDay,
  swapDays,
  useAuthFetch,
} from '@/lib/api';
import type { CreateTrainingPlanDayPayload, SubstituteDayPayload } from '@/lib/api';

/**
 * The atomic structural day operations (add / delete / swap / move /
 * substitute) — the non-destructive counterparts to the full-array plan PATCH.
 *
 * These are discrete, confirm-gated actions rather than per-keystroke edits, so
 * they are not optimistically patched: each invalidates the plan's derived
 * caches and lets the authoritative server response repaint. Field edits on an
 * existing day use `useInstantDayEdit` instead.
 */
export function usePlanDayOps(planId: string | null) {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();

  const invalidate = () => {
    if (!planId) return;
    queryClient.invalidateQueries({ queryKey: ['plan-week', planId] });
    queryClient.invalidateQueries({ queryKey: ['training-plan', planId] });
    queryClient.invalidateQueries({ queryKey: ['plan-conformity', planId] });
    queryClient.invalidateQueries({ queryKey: ['adaptive-suggestions', planId] });
    queryClient.invalidateQueries({ queryKey: ['strength-suggestions', planId] });
    queryClient.invalidateQueries({ queryKey: ['day-conformity'] });
    queryClient.invalidateQueries({ queryKey: ['plan-unplanned', planId] });
    queryClient.invalidateQueries({ queryKey: ['training-plans'] });
    queryClient.invalidateQueries({ queryKey: ['live-plan-today'] });
  };

  return {
    /** Add a session on a (previously empty) date. 409 when the date is taken. */
    addDay: useMutation({
      mutationFn: (payload: CreateTrainingPlanDayPayload) => {
        if (!planId) throw new Error('No plan selected');
        return addDay(authFetch, planId, payload);
      },
      onSettled: invalidate,
    }),

    /** Delete a day. Completed days are refused by the server (400). */
    deleteDay: useMutation({
      mutationFn: (dayId: string) => {
        if (!planId) throw new Error('No plan selected');
        return deleteDay(authFetch, planId, dayId);
      },
      onSettled: invalidate,
    }),

    /** Atomically exchange two days' dates (a true swap — needs no free slot). */
    swapDays: useMutation({
      mutationFn: ({ dayId, targetDayId }: { dayId: string; targetDayId: string }) => {
        if (!planId) throw new Error('No plan selected');
        return swapDays(authFetch, planId, dayId, targetDayId);
      },
      onSettled: invalidate,
    }),

    /** Move an uncompleted day to another date (409 when the target is occupied). */
    moveDay: useMutation({
      mutationFn: ({ dayId, targetDate }: { dayId: string; targetDate: string }) => {
        if (!planId) throw new Error('No plan selected');
        return rescheduleDay(authFetch, planId, dayId, targetDate);
      },
      onSettled: invalidate,
    }),

    /** Convert a missed day into an alternate session on the same date. */
    substituteDay: useMutation({
      mutationFn: ({ dayId, payload }: { dayId: string; payload: SubstituteDayPayload }) => {
        if (!planId) throw new Error('No plan selected');
        return substituteDay(authFetch, planId, dayId, payload);
      },
      onSettled: invalidate,
    }),

    /** Copy a day's planned content onto another date in the same plan. */
    duplicateDay: useMutation({
      mutationFn: ({ dayId, targetDate }: { dayId: string; targetDate: string }) => {
        if (!planId) throw new Error('No plan selected');
        return copyPlanDayToDate(authFetch, planId, dayId, targetDate);
      },
      onSettled: invalidate,
    }),
  };
}
