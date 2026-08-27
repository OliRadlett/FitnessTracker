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

type AuthFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export async function getTrainingPlans(authFetch: AuthFetch, statusFilter?: string): Promise<TrainingPlanSummary[]> {
  const query = statusFilter ? `?status_filter=${encodeURIComponent(statusFilter)}` : '';
  return authFetch<TrainingPlanSummary[]>(`/api/v1/training-plans${query}`);
}

export async function getTrainingPlan(authFetch: AuthFetch, id: string): Promise<TrainingPlan> {
  return authFetch<TrainingPlan>(`/api/v1/training-plans/${id}`);
}

export async function createTrainingPlan(authFetch: AuthFetch, payload: CreateTrainingPlanPayload): Promise<TrainingPlan> {
  return authFetch<TrainingPlan>('/api/v1/training-plans', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateTrainingPlan(authFetch: AuthFetch, id: string, payload: UpdateTrainingPlanPayload): Promise<TrainingPlan> {
  return authFetch<TrainingPlan>(`/api/v1/training-plans/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteTrainingPlan(authFetch: AuthFetch, id: string): Promise<void> {
  return authFetch<void>(`/api/v1/training-plans/${id}`, {
    method: 'DELETE',
  });
}

export async function generateTrainingPlan(authFetch: AuthFetch, payload: GeneratePlanPayload): Promise<TrainingPlan> {
  return authFetch<TrainingPlan>('/api/v1/training-plans/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Phase 5B — one Monday-based week of a plan with weather/actuals/route matches. */
export async function getPlanWeek(
  authFetch: AuthFetch,
  planId: string,
  weekNumber: number,
  options: { includeWeather?: boolean } = {}
): Promise<TrainingWeekResponse> {
  const { includeWeather = true } = options;
  return authFetch<TrainingWeekResponse>(
    `/api/v1/training-plans/${planId}/week/${weekNumber}?include_weather=${includeWeather}`
  );
}

/** Phase 5B — targeted partial update of a single plan day. */
export async function updatePlanDay(
  authFetch: AuthFetch,
  planId: string,
  dayId: string,
  payload: UpdateTrainingPlanDayPayload
): Promise<TrainingPlanDay> {
  return authFetch<TrainingPlanDay>(
    `/api/v1/training-plans/${planId}/days/${dayId}`,
    { method: 'PATCH', body: JSON.stringify(payload) }
  );
}

export async function copySessionToPlanDay(
  authFetch: AuthFetch,
  planId: string,
  dayId: string,
  sessionId: string
): Promise<TrainingPlanDay> {
  return authFetch<TrainingPlanDay>(
    `/api/v1/training-plans/${planId}/days/${dayId}/copy-from-session/${sessionId}`,
    { method: 'POST' }
  );
}

export async function copyPlanDayToDate(
  authFetch: AuthFetch,
  planId: string,
  sourceDayId: string,
  targetDate: string
): Promise<TrainingPlanDay> {
  return authFetch<TrainingPlanDay>(
    `/api/v1/training-plans/${planId}/days/${sourceDayId}/copy-to-date/${targetDate}`,
    { method: 'POST' }
  );
}

// ── Workout preview (Feature 2) ──────────────────────────────────────────

export interface WorkoutPreviewTargets {
  difficulty: string;
  zone_id: string;
  zone_name: string;
  duration_minutes: number;
  target_power_low: number;
  target_power_high: number;
  target_if_low: number;
  target_if_high: number;
  target_tss_low: number;
  target_tss_high: number;
  estimated_calories_low: number;
  estimated_calories_high: number;
}

export interface WorkoutPreviewResponse {
  targets: WorkoutPreviewTargets | null;
  ftp: number | null;
  message: string | null;
}

export async function previewWorkout(
  authFetch: AuthFetch,
  workoutType: string,
  durationMinutes: number
): Promise<WorkoutPreviewResponse> {
  const params = new URLSearchParams({
    duration_minutes: String(durationMinutes),
    workout_type: workoutType,
  });
  return authFetch<WorkoutPreviewResponse>(
    `/api/v1/training-plans/preview-workout?${params}`,
    { method: 'POST' }
  );
}
