// Phase 5C — planned-vs-actual conformity clients.
// Plain apiFetch pattern (see goals.ts); optional explicit token because
// apiFetch cannot attach the session JWT itself outside of useAuthFetch.

import { apiFetch } from './fetch';
import type {
  PlanConformityResponse,
  DayConformityResponse,
  LinkActivitiesResponse,
} from './types';

/** GET /api/v1/training-plans/{id}/conformity?weeks=N */
export async function getPlanConformity(
  planId: string,
  weeks?: number,
  token?: string
): Promise<PlanConformityResponse> {
  const query = weeks != null ? `?weeks=${encodeURIComponent(String(weeks))}` : '';
  return apiFetch<PlanConformityResponse>(
    `/api/v1/training-plans/${planId}/conformity${query}`,
    {},
    token
  );
}

/** GET /api/v1/training-plans/{id}/days/{dayId}/conformity */
export async function getDayConformity(
  planId: string,
  dayId: string,
  token?: string
): Promise<DayConformityResponse> {
  return apiFetch<DayConformityResponse>(
    `/api/v1/training-plans/${planId}/days/${dayId}/conformity`,
    {},
    token
  );
}

/** POST /api/v1/training-plans/{id}/link-activities — auto-link synced activities to plan days. */
export async function linkPlanActivities(
  planId: string,
  token?: string
): Promise<LinkActivitiesResponse> {
  return apiFetch<LinkActivitiesResponse>(
    `/api/v1/training-plans/${planId}/link-activities`,
    { method: 'POST' },
    token
  );
}
