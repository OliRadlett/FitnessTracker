import { useAuthFetch } from './fetch';

export interface ExerciseEntry {
  name: string;
  category: string;
}

export interface ExerciseDetail {
  id: string;
  name: string;
  category: string;
  aliases: string[] | null;
  is_active: boolean;
}

export async function searchExercises(
  authFetch: ReturnType<typeof useAuthFetch>['authFetch'],
  query: string = '',
  limit: number = 15,
): Promise<ExerciseEntry[]> {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  params.set('limit', String(limit));
  return authFetch<ExerciseEntry[]>(`/api/v1/lifting/exercises?${params}`);
}

export async function createExercise(
  authFetch: ReturnType<typeof useAuthFetch>['authFetch'],
  data: { name: string; category?: string; aliases?: string[] },
): Promise<ExerciseDetail> {
  return authFetch<ExerciseDetail>('/api/v1/lifting/exercises', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateExercise(
  authFetch: ReturnType<typeof useAuthFetch>['authFetch'],
  exerciseId: string,
  data: { name?: string; category?: string; aliases?: string[]; is_active?: boolean },
): Promise<ExerciseDetail> {
  return authFetch<ExerciseDetail>(`/api/v1/lifting/exercises/${exerciseId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteExercise(
  authFetch: ReturnType<typeof useAuthFetch>['authFetch'],
  exerciseId: string,
): Promise<void> {
  return authFetch<void>(`/api/v1/lifting/exercises/${exerciseId}`, {
    method: 'DELETE',
  });
}
