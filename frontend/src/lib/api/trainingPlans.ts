import { apiFetch } from './fetch';
import type {
  TrainingPlan,
  TrainingPlanSummary,
  CreateTrainingPlanPayload,
  UpdateTrainingPlanPayload,
  GeneratePlanPayload,
  TrainingWeekResponse,
  UpdateTrainingPlanDayPayload,
  TrainingPlanDay,
} from './types';

export async function getTrainingPlans(statusFilter?: string): Promise<TrainingPlanSummary[]> {
  const query = statusFilter ? `?status_filter=${encodeURIComponent(statusFilter)}` : '';
  return apiFetch<TrainingPlanSummary[]>(`/api/v1/training-plans${query}`);
}

export async function getTrainingPlan(id: string): Promise<TrainingPlan> {
  return apiFetch<TrainingPlan>(`/api/v1/training-plans/${id}`);
}

export async function createTrainingPlan(payload: CreateTrainingPlanPayload): Promise<TrainingPlan> {
  return apiFetch<TrainingPlan>('/api/v1/training-plans', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateTrainingPlan(id: string, payload: UpdateTrainingPlanPayload): Promise<TrainingPlan> {
  return apiFetch<TrainingPlan>(`/api/v1/training-plans/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteTrainingPlan(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/training-plans/${id}`, {
    method: 'DELETE',
  });
}

export async function generateTrainingPlan(payload: GeneratePlanPayload): Promise<TrainingPlan> {
  return apiFetch<TrainingPlan>('/api/v1/training-plans/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Phase 5B — one Monday-based week of a plan with weather/actuals/route matches. */
export async function getPlanWeek(
  planId: string,
  weekNumber: number,
  options: { includeWeather?: boolean; token?: string } = {}
): Promise<TrainingWeekResponse> {
  const { includeWeather = true, token } = options;
  return apiFetch<TrainingWeekResponse>(
    `/api/v1/training-plans/${planId}/week/${weekNumber}?include_weather=${includeWeather}`,
    {},
    token
  );
}

/** Phase 5B — targeted partial update of a single plan day. */
export async function updatePlanDay(
  planId: string,
  dayId: string,
  payload: UpdateTrainingPlanDayPayload,
  token?: string
): Promise<TrainingPlanDay> {
  return apiFetch<TrainingPlanDay>(
    `/api/v1/training-plans/${planId}/days/${dayId}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
    token
  );
}
