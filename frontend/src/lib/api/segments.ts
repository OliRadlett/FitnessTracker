import type {
  ClimbDetail,
  Segment,
  SegmentDetail,
  SegmentGroup,
  SegmentGroupDetail,
  SegmentGroupList,
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

/** Stable segment groups — the /segments page. */
export interface SegmentGroupQuery {
  kind?: string;
  tab?: 'ridden' | 'to_ride' | 'all';
  q?: string;
  area?: string;
  region?: string;
  sort?: 'attempts' | 'recent' | 'hardest' | 'longest' | 'steepest' | 'name';
  limit?: number;
  offset?: number;
}

export async function getSegmentGroups(
  authFetch: AuthFetch,
  params: SegmentGroupQuery = {}
): Promise<SegmentGroupList> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });
  const qs = query.toString();
  return authFetch<SegmentGroupList>(
    `/api/v1/segments/groups${qs ? `?${qs}` : ''}`
  );
}

export async function getSegmentGroup(
  authFetch: AuthFetch,
  groupId: string
): Promise<SegmentGroupDetail> {
  return authFetch<SegmentGroupDetail>(
    `/api/v1/segments/groups/${groupId}`
  );
}

/** null / empty resets the hill to its generated name. */
export async function renameSegmentGroup(
  authFetch: AuthFetch,
  groupId: string,
  displayName: string | null
): Promise<SegmentGroup> {
  return authFetch<SegmentGroup>(`/api/v1/segments/groups/${groupId}`, {
    method: 'PATCH',
    body: JSON.stringify({ display_name: displayName }),
  });
}