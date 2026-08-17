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
