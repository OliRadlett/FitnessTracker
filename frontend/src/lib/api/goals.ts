import { apiFetch } from './fetch';
import type { Goal, CreateGoalPayload, UpdateGoalPayload } from './types';

export async function getGoals(statusFilter?: string): Promise<Goal[]> {
  const query = statusFilter ? `?status_filter=${encodeURIComponent(statusFilter)}` : '';
  return apiFetch<Goal[]>(`/api/v1/goals${query}`);
}

export async function getGoal(id: string): Promise<Goal> {
  return apiFetch<Goal>(`/api/v1/goals/${id}`);
}

export async function createGoal(payload: CreateGoalPayload): Promise<Goal> {
  return apiFetch<Goal>('/api/v1/goals', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateGoal(id: string, payload: UpdateGoalPayload): Promise<Goal> {
  return apiFetch<Goal>(`/api/v1/goals/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteGoal(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/goals/${id}`, {
    method: 'DELETE',
  });
}
