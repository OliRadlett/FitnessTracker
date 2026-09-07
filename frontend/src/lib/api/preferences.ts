// User preferences API client (unit system, locale, time format).
// Backend: /user/preferences — JSONB on User, values stored server-side.

import type { UserPreferences, UserPreferencesUpdate } from './types';

type AuthFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export type { UserPreferences, UserPreferencesUpdate };

export async function getPreferences(
  authFetch: AuthFetch,
): Promise<UserPreferences> {
  return authFetch<UserPreferences>('/api/v1/user/preferences');
}

export async function updatePreferences(
  authFetch: AuthFetch,
  payload: UserPreferencesUpdate,
): Promise<UserPreferences> {
  return authFetch<UserPreferences>('/api/v1/user/preferences', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}