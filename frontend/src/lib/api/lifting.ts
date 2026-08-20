import { apiFetch } from './fetch';
import type {
  LiftingSession,
  LiftingSet,
  PersonalRecord,
  AddSetPayload,
  CreateSessionPayload,
  LinkSessionPayload,
  WarmupTemplate,
  CreateWarmupTemplatePayload,
  UpdateWarmupTemplatePayload,
  VolumeTrendResponse,
  Activity,
  LiftingAnalysis,
} from './types';

export async function getLiftingSessions(): Promise<LiftingSession[]> {
  return apiFetch<LiftingSession[]>('/api/v1/lifting/sessions');
}

export async function createLiftingSession(payload: CreateSessionPayload): Promise<LiftingSession> {
  return apiFetch<LiftingSession>('/api/v1/lifting/sessions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getLiftingSession(id: string): Promise<LiftingSession> {
  return apiFetch<LiftingSession>(`/api/v1/lifting/sessions/${id}`);
}

export async function addSetToSession(sessionId: string, payload: AddSetPayload): Promise<LiftingSet> {
  return apiFetch<LiftingSet>(`/api/v1/lifting/sessions/${sessionId}/sets`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getPersonalRecords(): Promise<PersonalRecord[]> {
  return apiFetch<PersonalRecord[]>('/api/v1/lifting/prs');
}

export async function getVolumeTrends(weeks: number = 12): Promise<VolumeTrendResponse> {
  return apiFetch<VolumeTrendResponse>(`/api/v1/lifting/volume-trends?weeks=${weeks}`);
}

export async function linkSession(sessionId: string, payload: LinkSessionPayload): Promise<LiftingSession> {
  return apiFetch<LiftingSession>(`/api/v1/lifting/sessions/${sessionId}/link`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function getLinkableActivities(sessionId: string): Promise<Activity[]> {
  return apiFetch<Activity[]>(`/api/v1/lifting/sessions/${sessionId}/linkable-activities`);
}

export async function backfillLinks(): Promise<{ linked_count: number }> {
  return apiFetch<{ linked_count: number }>('/api/v1/lifting/backfill-links', {
    method: 'POST',
  });
}

// ─── Warmup Templates ────────────────────────────────────────────────────────

export async function getWarmupTemplates(exerciseName?: string): Promise<WarmupTemplate[]> {
  const query = exerciseName ? `?exercise_name=${encodeURIComponent(exerciseName)}` : '';
  return apiFetch<WarmupTemplate[]>(`/api/v1/lifting/warmup-templates${query}`);
}

export async function getWarmupTemplate(id: string): Promise<WarmupTemplate> {
  return apiFetch<WarmupTemplate>(`/api/v1/lifting/warmup-templates/${id}`);
}

export async function createWarmupTemplate(payload: CreateWarmupTemplatePayload): Promise<WarmupTemplate> {
  return apiFetch<WarmupTemplate>('/api/v1/lifting/warmup-templates', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateWarmupTemplate(id: string, payload: UpdateWarmupTemplatePayload): Promise<WarmupTemplate> {
  return apiFetch<WarmupTemplate>(`/api/v1/lifting/warmup-templates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteWarmupTemplate(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/lifting/warmup-templates/${id}`, {
    method: 'DELETE',
  });
}

// ─── Session Analysis ────────────────────────────────────────────────────────

export async function getLiftingAnalysis(sessionId: string): Promise<LiftingAnalysis> {
  return apiFetch<LiftingAnalysis>(`/api/v1/lifting/sessions/${sessionId}/analysis`);
}

