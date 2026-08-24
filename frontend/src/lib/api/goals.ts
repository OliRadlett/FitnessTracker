// Goals API client (Phase 6 — semantic metrics).
//
// Follows the codebase "inline authFetch" pattern: each function takes the
// `authFetch` returned by `useAuthFetch()` as its first argument so pages can
// call them directly inside React Query `queryFn`/`mutationFn`.
import type {
  Goal,
  GoalCheckIn,
  GoalCheckInPayload,
  CreateGoalPayload,
  UpdateGoalPayload,
  MetricInfo,
  ReactivateResponse,
} from './types';

type AuthFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export async function listGoals(authFetch: AuthFetch, statusFilter?: string): Promise<Goal[]> {
  const query = statusFilter ? `?status_filter=${encodeURIComponent(statusFilter)}` : '';
  return authFetch<Goal[]>(`/api/v1/goals${query}`);
}

export async function createGoal(authFetch: AuthFetch, payload: CreateGoalPayload): Promise<Goal> {
  return authFetch<Goal>('/api/v1/goals', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateGoal(
  authFetch: AuthFetch,
  id: string,
  patch: UpdateGoalPayload,
): Promise<Goal> {
  return authFetch<Goal>(`/api/v1/goals/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteGoal(authFetch: AuthFetch, id: string): Promise<void> {
  return authFetch<void>(`/api/v1/goals/${id}`, { method: 'DELETE' });
}

export async function getGoalMetrics(authFetch: AuthFetch): Promise<MetricInfo[]> {
  return authFetch<MetricInfo[]>('/api/v1/goals/metrics');
}

export async function addCheckIn(
  authFetch: AuthFetch,
  goalId: string,
  payload: GoalCheckInPayload,
): Promise<GoalCheckIn> {
  return authFetch<GoalCheckIn>(`/api/v1/goals/${goalId}/checkins`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getCheckIns(authFetch: AuthFetch, goalId: string): Promise<GoalCheckIn[]> {
  return authFetch<GoalCheckIn[]>(`/api/v1/goals/${goalId}/checkins`);
}

export async function reactivateGoal(
  authFetch: AuthFetch,
  goalId: string,
): Promise<ReactivateResponse> {
  return authFetch<ReactivateResponse>(`/api/v1/goals/${goalId}/reactivate`, {
    method: 'POST',
  });
}
