'use client';

import { useQueries } from '@tanstack/react-query';
import { useAuthFetch, getGoalProjection } from '@/lib/api';
import type { Goal, GoalProjectionResponse } from '@/lib/api';

/**
 * Bulk projection fetch for goal lists (0.3).
 * Uses the same `['goal-projection', id]` keys as `GoalDetailModal` so opening
 * a modal after the list hits cache. Only active goals with a target_date are
 * eligible (mirrors `ProjectionCard`). Failures resolve to null — the card
 * falls back to the alignment badge.
 */
export function useGoalProjections(
  goals: Pick<Goal, 'id' | 'status' | 'target_date'>[] | undefined,
): Map<string, GoalProjectionResponse> {
  const { authFetch, token } = useAuthFetch();
  const ids = (goals ?? [])
    .filter((g) => g.status === 'active' && g.target_date)
    .map((g) => g.id);

  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['goal-projection', id],
      queryFn: () => getGoalProjection(authFetch, id),
      staleTime: 5 * 60_000,
      retry: false,
      enabled: !!token,
    })),
  });

  const map = new Map<string, GoalProjectionResponse>();
  results.forEach((r, i) => {
    if (r.data) map.set(ids[i], r.data);
  });
  return map;
}
