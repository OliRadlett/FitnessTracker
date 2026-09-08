// Health-alert preferences API client (§3.12).
//
// Follows the "inline authFetch" pattern (see notifications.ts): functions take
// `authFetch` as their first argument so components can call them directly in
// React Query query/mutation functions.

import type { HealthPreferences, HealthPreferencesUpdate } from './types';

type AuthFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export async function getHealthPreferences(
  authFetch: AuthFetch,
): Promise<HealthPreferences> {
  return authFetch<HealthPreferences>('/api/v1/metrics/health-preferences');
}

export async function updateHealthPreferences(
  authFetch: AuthFetch,
  patch: HealthPreferencesUpdate,
): Promise<HealthPreferences> {
  return authFetch<HealthPreferences>('/api/v1/metrics/health-preferences', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}