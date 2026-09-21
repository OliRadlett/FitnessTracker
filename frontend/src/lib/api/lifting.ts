import type {
  LiftingSession,
  LiftingSet,
  PersonalRecord,
  AddSetPayload,
  CreateSessionPayload,
  UpdateSessionPayload,
  WarmupTemplate,
  LiftVideo,
  VideoUploadRequest,
  VideoUploadResponse,
  VideoStreamUrl,
  VbtProfile,
  SuggestLoadRequest,
  SuggestLoadResponse,
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

// ─── Load Suggestion (FL3) ─────────────────────────────────────────────────

/** Suggest a working weight as % of the current e1RM (PR, else best recent set). */
export async function suggestLoad(
  authFetch: AuthFetch,
  payload: SuggestLoadRequest,
): Promise<SuggestLoadResponse> {
  return authFetch<SuggestLoadResponse>('/api/v1/lifting/suggest-load', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ─── Warmup Templates ────────────────────────────────────────────────────────

export async function getWarmupTemplates(authFetch: AuthFetch, exerciseName?: string): Promise<WarmupTemplate[]> {
  const query = exerciseName ? `?exercise_name=${encodeURIComponent(exerciseName)}` : '';
  return authFetch<WarmupTemplate[]>(`/api/v1/lifting/warmup-templates${query}`);
}

// ─── Strength Videos (§1.1) ─────────────────────────────────────────────────────
// NOTE (B-10): list/single/status fns removed — pages fetch inline via
// authFetch; the write-path fns below are the live seam.

export async function createLiftVideo(
  authFetch: AuthFetch,
  payload: Omit<LiftVideo, 'id' | 'user_id' | 'created_at' | 'updated_at'>,
): Promise<LiftVideo> {
  return authFetch<LiftVideo>('/api/v1/lifting/videos/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getVideoUploadUrl(
  authFetch: AuthFetch,
  payload: VideoUploadRequest,
): Promise<VideoUploadResponse> {
  return authFetch<VideoUploadResponse>('/api/v1/lifting/videos/upload-url', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getVideoStreamUrl(
  authFetch: AuthFetch,
  videoId: string,
  variant: 'original' | 'trimmed' | 'overlay' = 'original',
): Promise<VideoStreamUrl> {
  return authFetch<VideoStreamUrl>(
    `/api/v1/lifting/videos/${videoId}/stream-url?variant=${variant}`,
  );
}

export async function getVbtProfile(
  authFetch: AuthFetch,
  exerciseName: string,
  days = 365,
): Promise<VbtProfile> {
  const params = new URLSearchParams({ exercise_name: exerciseName, days: String(days) });
  return authFetch<VbtProfile>(`/api/v1/lifting/videos/vbt/profile?${params}`);
}

export async function deleteLiftVideo(authFetch: AuthFetch, videoId: string): Promise<LiftVideo> {
  return authFetch<LiftVideo>(`/api/v1/lifting/videos/${videoId}`, {
    method: 'DELETE',
  });
}

// ─── Video Processing (§1.1) ───────────────────────────────────────────────

export async function processLiftVideo(
  authFetch: AuthFetch,
  videoId: string,
  depth: 'basic' | 'full' = 'full',
  force = false,
): Promise<{ status: string; video_id: string; analysis_depth: string }> {
  const params = new URLSearchParams({ depth });
  if (force) params.set('force', 'true');
  return authFetch<{ status: string; video_id: string; analysis_depth: string }>(
    `/api/v1/lifting/videos/${videoId}/process?${params}`,
    { method: 'POST' },
  );
}
// NOTE (B-10): getVideoProcessStatus removed — unused (pages poll inline).
