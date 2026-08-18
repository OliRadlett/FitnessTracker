import { apiFetch } from './fetch';
import type {
  TrainingPlan,
  TrainingPlanSummary,
  CreateTrainingPlanPayload,
  UpdateTrainingPlanPayload,
  GeneratePlanPayload,
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
