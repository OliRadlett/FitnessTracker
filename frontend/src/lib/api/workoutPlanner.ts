import { apiFetch } from './fetch';
import type {
  WorkoutZonesResponse,
  WorkoutPlanRequest,
  WorkoutPlanResponse,
  RouteMatchResponse,
} from './types';

export async function getWorkoutZones(): Promise<WorkoutZonesResponse> {
  return apiFetch<WorkoutZonesResponse>('/api/v1/workout-planner/zones');
}

export async function planWorkout(payload: WorkoutPlanRequest): Promise<WorkoutPlanResponse> {
  return apiFetch<WorkoutPlanResponse>('/api/v1/workout-planner/plan', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function matchRoutes(payload: {
  difficulty: string;
  duration_minutes?: number;
  max_results?: number;
}): Promise<RouteMatchResponse> {
  return apiFetch<RouteMatchResponse>('/api/v1/workout-planner/match-routes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
