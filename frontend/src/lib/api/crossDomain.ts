// Cross-domain insights API client.

import type { CrossDomainInsightsResponse } from './types';

type AuthFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export async function getCrossDomainInsights(
  authFetch: AuthFetch,
  insightType?: string,
): Promise<CrossDomainInsightsResponse> {
  const params = insightType ? `?insight_type=${insightType}` : '';
  return authFetch<CrossDomainInsightsResponse>(`/api/v1/cross-domain${params}`);
}
