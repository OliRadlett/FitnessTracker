import type { ActivityWeather, CurrentWeather, ForecastResponse } from './types';

/**
 * Weather API client.
 *
 * Unlike most clients these functions take the backend JWT explicitly and use
 * a small local request helper: `apiFetch` collapses all non-2xx responses
 * into a thrown `Error` with no status attached, but weather endpoints return
 * 404 in normal operation (no location set / activity untagged) and callers
 * need to distinguish that from real failures. 404 → `null`.
 */

async function weatherRequest<T>(path: string, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(path, { headers, credentials: 'include' });

  if (!response.ok) {
    if (response.status === 404) {
      // Normal case: no location set, or activity has no weather tag.
      return null as T;
    }
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || `API error: ${response.status}`);
  }

  return (await response.json()) as T;
}

function locationQuery(lat?: number, lng?: number): string {
  if (lat == null || lng == null) return '';
  return `&lat=${lat}&lng=${lng}`;
}

export async function getCurrentWeather(token?: string, lat?: number, lng?: number): Promise<CurrentWeather | null> {
  const query = locationQuery(lat, lng);
  return weatherRequest<CurrentWeather | null>(`/api/v1/weather/current${query ? `?${query.slice(1)}` : ''}`, token);
}

export async function getForecast(token?: string, days = 7, lat?: number, lng?: number): Promise<ForecastResponse | null> {
  return weatherRequest<ForecastResponse | null>(
    `/api/v1/weather/forecast?days=${days}${locationQuery(lat, lng)}`,
    token,
  );
}

export async function getActivityWeather(token?: string, activityId?: string): Promise<ActivityWeather | null> {
  return weatherRequest<ActivityWeather | null>(`/api/v1/weather/for-activity/${activityId}`, token);
}
