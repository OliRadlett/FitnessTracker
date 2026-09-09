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
  LiftVideoListParams,
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

// ─── Strength Videos (§1.1) ─────────────────────────────────────────────────────

export async function getLiftVideos(
  authFetch: AuthFetch,
  params?: LiftVideoListParams,
): Promise<LiftVideo[]> {
  const query = new URLSearchParams();
  if (params?.source) query.set('source', params.source);
  if (params?.exercise_name) query.set('exercise_name', params.exercise_name);
  if (params?.lifting_session_id) query.set('lifting_session_id', params.lifting_session_id);
  if (params?.personal_record_id) query.set('personal_record_id', params.personal_record_id);
  if (params?.after) query.set('after', params.after);
  if (params?.before) query.set('before', params.before);
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));
  const qs = query.toString();
  return authFetch<LiftVideo[]>(`/api/v1/lifting/videos/${qs ? `?${qs}` : ''}`);
}

export async function getLiftVideo(authFetch: AuthFetch, videoId: string): Promise<LiftVideo> {
  return authFetch<LiftVideo>(`/api/v1/lifting/videos/${videoId}`);
}

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
): Promise<VideoStreamUrl> {
  return authFetch<VideoStreamUrl>(`/api/v1/lifting/videos/${videoId}/stream-url`);
}

export async function deleteLiftVideo(authFetch: AuthFetch, videoId: string): Promise<LiftVideo> {
  return authFetch<LiftVideo>(`/api/v1/lifting/videos/${videoId}`, {
    method: 'DELETE',
  });
}
