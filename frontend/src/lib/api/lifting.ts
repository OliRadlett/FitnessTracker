import { apiFetch } from './fetch';
import type {
  LiftingSession,
  LiftingSet,
  PersonalRecord,
  AddSetPayload,
  CreateSessionPayload,
  UpdateSessionPayload,
  LinkSessionPayload,
  WarmupTemplate,
  CreateWarmupTemplatePayload,
  UpdateWarmupTemplatePayload,
  VolumeTrendResponse,
  Activity,
  LiftingAnalysis,
  LlmAnalysis,
} from './types';

type AuthFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export async function getLiftingSessions(authFetch: AuthFetch): Promise<LiftingSession[]> {
  return authFetch<LiftingSession[]>('/api/v1/lifting/sessions');
}

export async function getActiveLiftingSession(authFetch: AuthFetch): Promise<LiftingSession | null> {
  return authFetch<LiftingSession | null>('/api/v1/lifting/sessions/active');
}

export async function updateLiftingSession(
  authFetch: AuthFetch,
  id: string,
  payload: UpdateSessionPayload
): Promise<LiftingSession> {
  return authFetch<LiftingSession>(`/api/v1/lifting/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function createLiftingSession(authFetch: AuthFetch, payload: CreateSessionPayload): Promise<LiftingSession> {
  return authFetch<LiftingSession>('/api/v1/lifting/sessions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getLiftingSession(authFetch: AuthFetch, id: string): Promise<LiftingSession> {
  return authFetch<LiftingSession>(`/api/v1/lifting/sessions/${id}`);
}

export async function addSetToSession(authFetch: AuthFetch, sessionId: string, payload: AddSetPayload): Promise<LiftingSet> {
  return authFetch<LiftingSet>(`/api/v1/lifting/sessions/${sessionId}/sets`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteLiftingSet(authFetch: AuthFetch, setId: string): Promise<void> {
  return authFetch<void>(`/api/v1/lifting/sets/${setId}`, {
    method: 'DELETE',
  });
}

export async function getPersonalRecords(authFetch: AuthFetch): Promise<PersonalRecord[]> {
  return authFetch<PersonalRecord[]>('/api/v1/lifting/prs');
}

export async function getVolumeTrends(authFetch: AuthFetch, weeks: number = 12): Promise<VolumeTrendResponse> {
  return authFetch<VolumeTrendResponse>(`/api/v1/lifting/volume-trends?weeks=${weeks}`);
}

export async function linkSession(authFetch: AuthFetch, sessionId: string, payload: LinkSessionPayload): Promise<LiftingSession> {
  return authFetch<LiftingSession>(`/api/v1/lifting/sessions/${sessionId}/link`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function getLinkableActivities(authFetch: AuthFetch, sessionId: string): Promise<Activity[]> {
  return authFetch<Activity[]>(`/api/v1/lifting/sessions/${sessionId}/linkable-activities`);
}

export async function backfillLinks(authFetch: AuthFetch): Promise<{ linked_count: number }> {
  return authFetch<{ linked_count: number }>('/api/v1/lifting/backfill-links', {
    method: 'POST',
  });
}

// ─── Warmup Templates ────────────────────────────────────────────────────────

export async function getWarmupTemplates(authFetch: AuthFetch, exerciseName?: string): Promise<WarmupTemplate[]> {
  const query = exerciseName ? `?exercise_name=${encodeURIComponent(exerciseName)}` : '';
  return authFetch<WarmupTemplate[]>(`/api/v1/lifting/warmup-templates${query}`);
}

export async function getWarmupTemplate(authFetch: AuthFetch, id: string): Promise<WarmupTemplate> {
  return authFetch<WarmupTemplate>(`/api/v1/lifting/warmup-templates/${id}`);
}

export async function createWarmupTemplate(authFetch: AuthFetch, payload: CreateWarmupTemplatePayload): Promise<WarmupTemplate> {
  return authFetch<WarmupTemplate>('/api/v1/lifting/warmup-templates', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateWarmupTemplate(authFetch: AuthFetch, id: string, payload: UpdateWarmupTemplatePayload): Promise<WarmupTemplate> {
  return authFetch<WarmupTemplate>(`/api/v1/lifting/warmup-templates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteWarmupTemplate(authFetch: AuthFetch, id: string): Promise<void> {
  return authFetch<void>(`/api/v1/lifting/warmup-templates/${id}`, {
    method: 'DELETE',
  });
}

// ─── Session Analysis ────────────────────────────────────────────────────────

export async function getLiftingAnalysis(authFetch: AuthFetch, sessionId: string): Promise<LiftingAnalysis> {
  return authFetch<LiftingAnalysis>(`/api/v1/lifting/sessions/${sessionId}/analysis`);
}

// ─── Session AI Analysis ────────────────────────────────────────────────────

export async function getSessionAiAnalysis(authFetch: AuthFetch, sessionId: string): Promise<LlmAnalysis | null> {
  return authFetch<LlmAnalysis | null>(`/api/v1/lifting/sessions/${sessionId}/ai-analysis`);
}

export async function triggerSessionAiAnalysis(authFetch: AuthFetch, sessionId: string): Promise<LlmAnalysis> {
  return authFetch<LlmAnalysis>(`/api/v1/lifting/sessions/${sessionId}/ai-analysis`, {
    method: 'POST',
  });
}
