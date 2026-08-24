// Projections API client (Phase 7 — success prediction).
//
// Follows the codebase "inline authFetch" pattern: each function takes the
// `authFetch` returned by `useAuthFetch()` as its first argument so pages can
// call them directly inside React Query `queryFn`.
import type { GoalProjectionResponse, TsbProjectionResponse } from './types';

type AuthFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

/** GET /api/v1/projections/goal/{goalId} — trend, projected date, badge, history. */
export async function getGoalProjection(
  authFetch: AuthFetch,
  goalId: string,
): Promise<GoalProjectionResponse> {
  return authFetch<GoalProjectionResponse>(`/api/v1/projections/goal/${goalId}`);
}

/** GET /api/v1/projections/tsb/{planId}?days=N — event-linked TSB trajectory. */
export async function getTsbProjection(
  authFetch: AuthFetch,
  planId: string,
  days = 14,
): Promise<TsbProjectionResponse> {
  return authFetch<TsbProjectionResponse>(
    `/api/v1/projections/tsb/${planId}?days=${days}`,
  );
}
