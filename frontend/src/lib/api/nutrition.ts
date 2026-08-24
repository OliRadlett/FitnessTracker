import { apiFetch } from './fetch';
import type { RideFuelPlan, CreateFuelPlanPayload, FuelActualsUpdatePayload } from './types';

export async function createFuelPlan(payload: CreateFuelPlanPayload): Promise<RideFuelPlan> {
  return apiFetch<RideFuelPlan>('/api/v1/nutrition/fuel-plan', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getFuelPlan(id: string): Promise<RideFuelPlan> {
  return apiFetch<RideFuelPlan>(`/api/v1/nutrition/fuel-plan/${id}`);
}

export async function getFuelPlanForActivity(activityId: string): Promise<RideFuelPlan | null> {
  return apiFetch<RideFuelPlan | null>(`/api/v1/nutrition/fuel-plan/activity/${activityId}`);
}

export async function updateFuelPlanActuals(id: string, payload: FuelActualsUpdatePayload): Promise<RideFuelPlan> {
  return apiFetch<RideFuelPlan>(`/api/v1/nutrition/fuel-plan/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteFuelPlan(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/nutrition/fuel-plan/${id}`, {
    method: 'DELETE',
  });
}
