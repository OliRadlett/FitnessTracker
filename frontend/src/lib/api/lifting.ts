import type {
  LiftingSession,
  LiftingSet,
  PersonalRecord,
  AddSetPayload,
  CreateSessionPayload,
  UpdateSessionPayload,
  WarmupTemplate,
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

export async function deleteLiftingSession(authFetch: AuthFetch, id: string): Promise<void> {
  return authFetch<void>(`/api/v1/lifting/sessions/${id}`, {
    method: 'DELETE',
  });
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

// ─── Warmup Templates ────────────────────────────────────────────────────────

export async function getWarmupTemplates(authFetch: AuthFetch, exerciseName?: string): Promise<WarmupTemplate[]> {
  const query = exerciseName ? `?exercise_name=${encodeURIComponent(exerciseName)}` : '';
  return authFetch<WarmupTemplate[]>(`/api/v1/lifting/warmup-templates${query}`);
}
