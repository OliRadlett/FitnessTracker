import type { CalendarResponse } from './types/calendar';

type AuthFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export interface CalendarQuery {
  start: string;
  end: string;
  planId?: string;
}

/**
 * One bounded read for the calendar surface (max 62 days server-side).
 * The caller passes the visible month grid's Monday/Sunday range.
 */
export async function getCalendar(
  authFetch: AuthFetch,
  { start, end, planId }: CalendarQuery,
): Promise<CalendarResponse> {
  const params = new URLSearchParams({ start, end });
  if (planId) params.set('plan_id', planId);
  return authFetch<CalendarResponse>(`/api/v1/calendar?${params.toString()}`);
}
