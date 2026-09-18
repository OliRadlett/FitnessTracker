// Weight API client — manual weigh-in CRUD (backend: /metrics/weight).
//
// Follows the codebase "inline authFetch" pattern: each function takes the
// `authFetch` returned by `useAuthFetch()` as its first argument.

import type { WeightEntry, WeightHistoryResponse } from './types';

type AuthFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export type { WeightEntry, WeightHistoryResponse };

export async function getWeightHistory(
  authFetch: AuthFetch,
  days = 90,
): Promise<WeightHistoryResponse> {
  return authFetch<WeightHistoryResponse>(`/api/v1/metrics/weight?days=${days}`);
}

export interface WeightEntryPayload {
  date?: string;
  weight_kg: number;
  body_fat_percent?: number | null;
  fat_mass_kg?: number | null;
  lean_mass_kg?: number | null;
  muscle_mass_kg?: number | null;
  bone_mass_kg?: number | null;
  hydration_percent?: number | null;
  visceral_fat_index?: number | null;
  bmi?: number | null;
}

export async function createWeightEntry(
  authFetch: AuthFetch,
  payload: WeightEntryPayload,
): Promise<WeightEntry> {
  return authFetch<WeightEntry>('/api/v1/metrics/weight', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateWeightEntry(
  authFetch: AuthFetch,
  id: string,
  weight_kg: number,
  composition?: Partial<WeightEntryPayload>,
): Promise<WeightEntry> {
  return authFetch<WeightEntry>(`/api/v1/metrics/weight/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ weight_kg, ...composition }),
  });
}

export async function deleteWeightEntry(
  authFetch: AuthFetch,
  id: string,
): Promise<{ deleted: boolean }> {
  return authFetch<{ deleted: boolean }>(`/api/v1/metrics/weight/${id}`, {
    method: 'DELETE',
  });
}