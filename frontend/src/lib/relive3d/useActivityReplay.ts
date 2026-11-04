'use client';

import { useQuery } from '@tanstack/react-query';

import { useAuthFetch } from '@/lib/api/fetch';
import type { ReplayResponse } from '@/lib/api/types/relive';
import { replayToRide } from './adapter';

/**
 * Fetch + adapt the production replay. `refetchOnMount: 'always'` makes each
 * viewer open hit the endpoint, which is also what increments the server-side
 * monthly map budget.
 *
 * Pass `claimMap: false` for payloads loaded into a map that is already open —
 * a ghost ride. Those cost no Google load, so they must not be charged against
 * the budget.
 */
export function useActivityReplay(
  activityId: string | undefined,
  { claimMap = true }: { claimMap?: boolean } = {},
) {
  const { authFetch, token } = useAuthFetch();

  return useQuery({
    queryKey: ['activity-replay', activityId, claimMap],
    queryFn: async () => {
      const query = claimMap ? '' : '?claim_map=0';
      const response = await authFetch<ReplayResponse>(
        `/api/v1/activities/${activityId}/replay${query}`,
      );
      return { response, ride: replayToRide(response) };
    },
    enabled: Boolean(activityId && token),
    refetchOnMount: 'always',
    staleTime: 5 * 60 * 1000,
  });
}
