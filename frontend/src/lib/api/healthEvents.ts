// User-marked illness/injury/fatigue periods and alert-overlap validation.

import type {
  HealthEvent,
  HealthEventSeverity,
  HealthEventType,
  HealthEventValidation,
} from './types';

type AuthFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export interface HealthEventInput {
  event_type: HealthEventType;
  start_date: string;
  end_date: string | null;
  severity: HealthEventSeverity;
  note: string | null;
}

export async function getHealthEvents(
  authFetch: AuthFetch,
  days = 365,
): Promise<HealthEvent[]> {
  return authFetch<HealthEvent[]>(`/api/v1/metrics/health-events?days=${days}`);
}

export async function createHealthEvent(
  authFetch: AuthFetch,
  payload: HealthEventInput,
): Promise<HealthEvent> {
  return authFetch<HealthEvent>('/api/v1/metrics/health-events', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateHealthEvent(
  authFetch: AuthFetch,
  id: string,
  payload: Partial<HealthEventInput>,
): Promise<HealthEvent> {
  return authFetch<HealthEvent>(`/api/v1/metrics/health-events/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteHealthEvent(
  authFetch: AuthFetch,
  id: string,
): Promise<void> {
  await authFetch<void>(`/api/v1/metrics/health-events/${id}`, {
    method: 'DELETE',
  });
}

export async function getHealthEventValidation(
  authFetch: AuthFetch,
  days = 365,
): Promise<HealthEventValidation> {
  return authFetch<HealthEventValidation>(
    `/api/v1/metrics/health-events/validation?days=${days}`,
  );
}
