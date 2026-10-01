import type {
  ClimbDetail,
  Segment,
  SegmentDetail,
  SegmentRecomputeResponse,
} from './types';

type AuthFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

/** §3.13 — climb segments for the user (optionally for one route), PR-first. */
export async function getSegments(
  authFetch: AuthFetch,
  routeId?: string
): Promise<Segment[]> {
  const query = routeId ? `?route_id=${encodeURIComponent(routeId)}` : '';
  return authFetch<Segment[]>(`/api/v1/segments${query}`);
}

/** §3.13 — segment detail + leaderboard-of-self efforts (PR first). */
export async function getSegmentDetail(
  authFetch: AuthFetch,
  segmentId: string
): Promise<SegmentDetail> {
  return authFetch<SegmentDetail>(`/api/v1/segments/${segmentId}`);
}

/**
 * One physical hill merged across every route it appears on (plan §3).
 *
 * Efforts come back ranked by VAM (window-robust), falling back to elapsed
 * seconds only when no member effort carries a VAM.
 */
export async function getClimbDetail(
  authFetch: AuthFetch,
  geoClusterId: string
): Promise<ClimbDetail> {
  return authFetch<ClimbDetail>(
    `/api/v1/segments/climbs/${geoClusterId}`
  );
}

/** §3.13 — recompute climb segments + efforts for one route. */
export async function recomputeRouteSegments(
  authFetch: AuthFetch,
  routeId: string
): Promise<SegmentRecomputeResponse> {
  return authFetch<SegmentRecomputeResponse>(
    `/api/v1/routes/${routeId}/segments/recompute`,
    { method: 'POST' }
  );
}