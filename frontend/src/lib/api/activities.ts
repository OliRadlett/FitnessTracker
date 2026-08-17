import { apiFetch } from './fetch';
import type { Activity, ActivityDetail, ActivityFilters } from './types';

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
