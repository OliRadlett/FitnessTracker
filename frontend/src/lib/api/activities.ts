import { apiFetch, apiUpload } from './fetch';
import type { Activity, ActivityContext, ActivityDetail, ActivityFilters, LlmAnalysis, MergeThresholdResult, RideAnalysis } from './types';

export async function getActivities(filters: ActivityFilters = {}): Promise<Activity[]> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      params.append(key, String(value));
    }
  });
  const query = params.toString();
  return apiFetch<Activity[]>(`/api/v1/activities${query ? `?${query}` : ''}`);
}

export async function getActivity(id: string): Promise<ActivityDetail> {
  return apiFetch<ActivityDetail>(`/api/v1/activities/${id}`);
}

export async function backfillActivities(maxPages: number = 50): Promise<{
  synced: number;
  skipped: number;
  pages: number;
  detail: string;
}> {
  return apiFetch(`/api/v1/activities/backfill?max_pages=${maxPages}`, {
    method: 'POST',
  });
}

export async function backfillRouteLinks(): Promise<{ detail: string; linked_count: number }> {
  return apiFetch('/api/v1/activities/backfill-route-links', {
    method: 'POST',
  });
}

export async function analyzeMergeThresholds(
  threshold: number = 0.60,
  days: number = 90,
  limit: number = 100,
): Promise<MergeThresholdResult> {
  return apiFetch<MergeThresholdResult>(
    `/api/v1/activities/merge-analysis?threshold=${threshold}&days=${days}&limit=${limit}`,
  );
}

export async function importGpxFile(file: File, token?: string): Promise<Activity> {
  const formData = new FormData();
  formData.append('file', file);
  return apiUpload<Activity>('/api/v1/activities/import-gpx', formData, token);
}

export async function importFitFile(file: File, token?: string): Promise<Activity> {
  const formData = new FormData();
  formData.append('file', file);
  return apiUpload<Activity>('/api/v1/activities/import-fit', formData, token);
}

// ─── Activity Analysis ──────────────────────────────────────────────────────

export async function getActivityAnalysis(activityId: string): Promise<RideAnalysis> {
  return apiFetch<RideAnalysis>(`/api/v1/activities/${activityId}/analysis`);
}

// ─── Per-Activity AI Analysis ───────────────────────────────────────────────

export async function getActivityAiAnalysis(activityId: string): Promise<LlmAnalysis | null> {
  return apiFetch<LlmAnalysis | null>(`/api/v1/activities/${activityId}/ai-analysis`);
}

export async function triggerActivityAiAnalysis(activityId: string): Promise<LlmAnalysis> {
  return apiFetch<LlmAnalysis>(`/api/v1/activities/${activityId}/ai-analysis`, {
    method: 'POST',
  });
}

// ─── Activity Context ────────────────────────────────────────────────────────

export async function getActivityContext(activityId: string): Promise<ActivityContext> {
  return apiFetch<ActivityContext>(`/api/v1/activities/${activityId}/context`);
}

export async function getActivitiesWithContext(filters: ActivityFilters = {}): Promise<ActivityContext[]> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      params.append(key, String(value));
    }
  });
  params.set('include_context', 'true');
  const query = params.toString();
  return apiFetch<ActivityContext[]>(`/api/v1/activities?${query}`);
}
