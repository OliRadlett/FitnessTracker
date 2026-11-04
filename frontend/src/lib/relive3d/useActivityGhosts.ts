'use client';

import { useQuery } from '@tanstack/react-query';

import { useAuthFetch } from '@/lib/api/fetch';
import type { GhostListResponse } from '@/lib/api/types/relive';

/**
 * Past rides on this activity's route, for ghost racing.
 *
 * Separate from the replay query because it is optional page furniture: a ride
 * with no route, or a route ridden once, simply has no ghosts and the picker
 * stays hidden.
 */
export function useActivityGhosts(activityId: string | undefined) {
  const { authFetch, token } = useAuthFetch();

  return useQuery({
    queryKey: ['activity-ghosts', activityId],
    queryFn: () =>
      authFetch<GhostListResponse>(`/api/v1/activities/${activityId}/ghosts`),
    enabled: Boolean(activityId && token),
    staleTime: 10 * 60 * 1000,
  });
}
