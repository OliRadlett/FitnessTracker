import { apiFetch, apiFetchWithHeaders } from './fetch';
import type {
  RouteSummary,
  RouteData,
  RouteFilters,
  RouteSyncResult,
  DuplicatePair,
  MergeResult,
  OrphanReviewResponse,
  DismissedRoutes,
  RouteMergeLogEntry,
  SimilarRoute,
  MergedRouteView,
  HomeAreaHeatmapResponse,
  RouteCollection,
  RouteCollectionCreate,
} from './types';

export async function getRoutes(
  filters: RouteFilters = {},
  token?: string,
): Promise<{ routes: RouteSummary[]; totalCount: number }> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== null) {
      if (Array.isArray(value)) {
        value.forEach((v) => params.append(key, String(v)));
      } else {
        params.append(key, String(value));
      }
    }
  });
  // Default to 200 (backend max) unless caller specified a limit
  if (!params.has('limit')) {
    params.set('limit', '200');
  }
  const query = params.toString();
  const result = await apiFetchWithHeaders<RouteSummary[]>(
    `/api/v1/routes/${query ? `?${query}` : ''}`,
    {},
    token,
  );
  const totalCount = parseInt(result.headers.get('X-Total-Count') || '0', 10);
  return { routes: result.data, totalCount };
}

export async function getRoute(id: string, token?: string): Promise<RouteData> {
  return apiFetch<RouteData>(`/api/v1/routes/${id}`, {}, token);
}

export async function syncRoutes(token?: string): Promise<RouteSyncResult[]> {
  return apiFetch<RouteSyncResult[]>('/api/v1/routes/sync', { method: 'POST' }, token);
}

// ─── Duplicates ───────────────────────────────────────────────────────────────

export async function getDuplicateRoutes(token?: string): Promise<DuplicatePair[]> {
  return apiFetch<DuplicatePair[]>('/api/v1/routes/duplicates', {}, token);
}

export async function mergeRoutes(
  primaryId: string,
  duplicateId: string,
  token?: string,
  mergeKind: 'identical' | 'variant' = 'identical',
): Promise<MergeResult> {
  return apiFetch<MergeResult>('/api/v1/routes/merge', {
    method: 'POST',
    body: JSON.stringify({
      primary_route_id: primaryId,
      duplicate_route_id: duplicateId,
      merge_kind: mergeKind,
    }),
  }, token);
}

export async function listRouteMerges(token?: string): Promise<RouteMergeLogEntry[]> {
  return apiFetch<RouteMergeLogEntry[]>('/api/v1/routes/merges', {}, token);
}

// ─── Orphan review ────────────────────────────────────────────────────────────

export async function getOrphanCandidates(
  token?: string,
): Promise<OrphanReviewResponse> {
  return apiFetch<OrphanReviewResponse>('/api/v1/routes/orphans', {}, token);
}

/**
 * Routes reviewed and rejected, newest first.
 *
 * Dismissal is the decision most likely to be made in bulk, and a bulk
 * mistake is likely by construction — this is how you find one and send it
 * back to the review queue via `keepOrphan`.
 */
export async function getDismissedRoutes(token?: string): Promise<DismissedRoutes> {
  return apiFetch<DismissedRoutes>('/api/v1/routes/orphans/dismissed', {}, token);
}

/**
 * Dismiss every quarantined route currently in one review bucket.
 *
 * `expectedCount` is the number the UI displayed; the server refuses the
 * write if the queue has moved on, because dismissal is durable and there
 * is no bulk undo.
 */
export async function bulkDismissOrphans(
  bucket: string,
  expectedCount: number,
  token?: string,
): Promise<{ bucket: string; dismissed: number }> {
  return apiFetch<{ bucket: string; dismissed: number }>(
    '/api/v1/routes/orphans/bulk-dismiss',
    {
      method: 'POST',
      body: JSON.stringify({ bucket, expected_count: expectedCount }),
    },
    token,
  );
}

/** Reject a quarantined route. It stays quarantined, but leaves the queue. */
export async function dismissOrphan(
  routeId: string,
  token?: string,
): Promise<{ id: string; dismissed: boolean }> {
  return apiFetch<{ id: string; dismissed: boolean }>(
    `/api/v1/routes/orphans/${routeId}/dismiss`,
    { method: 'POST' },
    token,
  );
}

/**
 * Keep a quarantined route: un-quarantine it so matching can use it again.
 * Also clears any earlier dismissal.
 */
export async function keepOrphan(
  routeId: string,
  token?: string,
): Promise<{ id: string; quarantined_at: string | null; dismissed: boolean }> {
  return apiFetch<{ id: string; quarantined_at: string | null; dismissed: boolean }>(
    `/api/v1/routes/orphans/${routeId}/keep`,
    { method: 'POST' },
    token,
  );
}

export type MergeKind = 'identical' | 'variant' | 'unclassified';

export async function classifyRouteMerge(
  logId: string,
  mergeKind: MergeKind,
  token?: string,
): Promise<{ id: string; merge_kind: string | null }> {
  return apiFetch<{ id: string; merge_kind: string | null }>(
    `/api/v1/routes/merges/${logId}?merge_kind=${mergeKind}`,
    { method: 'PATCH' },
    token,
  );
}

export async function resetRouteMergeClassification(
  token?: string,
): Promise<{ reset: number }> {
  return apiFetch<{ reset: number }>(
    '/api/v1/routes/merges/reset-classification',
    { method: 'POST' },
    token,
  );
}

export async function undoRouteMerge(logId: string, token?: string): Promise<RouteData> {
  return apiFetch<RouteData>(`/api/v1/routes/merges/${logId}/undo`, { method: 'POST' }, token);
}

export async function getSimilarRoutes(routeId: string, token?: string): Promise<SimilarRoute[]> {
  return apiFetch<SimilarRoute[]>(`/api/v1/routes/${routeId}/similar`, {}, token);
}

export async function autoMergeDuplicates(threshold: number = 0.90, token?: string): Promise<{ merged: number; threshold: number }> {
  return apiFetch<{ merged: number; threshold: number }>(
    `/api/v1/routes/duplicates/auto-merge?threshold=${threshold}`,
    { method: 'POST' },
    token,
  );
}

// ─── GPX ─────────────────────────────────────────────────────────────────────

export async function downloadRouteGpx(routeId: string, routeName: string, token?: string): Promise<void> {
  // Use relative URL — Caddy proxy or Next.js rewrite handles routing to backend.
  const response = await fetch(`/api/v1/routes/${routeId}/gpx`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });

  if (!response.ok) throw new Error('Failed to download GPX');

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${routeName.replace(/ /g, '_').replace(/\//g, '_')}.gpx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Merged Route View ────────────────────────────────────────────────────────

export async function getMergedRouteView(routeId: string, token?: string): Promise<MergedRouteView> {
  return apiFetch<MergedRouteView>(`/api/v1/routes/${routeId}/merged-view`, {}, token);
}

// ─── Home Area Heatmap ────────────────────────────────────────────────────────

export async function getHomeAreaHeatmap(
  token?: string,
): Promise<HomeAreaHeatmapResponse> {
  return apiFetch<HomeAreaHeatmapResponse>(
    `/api/v1/routes/heatmap/home`,
    {},
    token,
  );
}

// ─── Collections ──────────────────────────────────────────────────────────────

export async function createCollectionFromFilters(
  payload: RouteCollectionCreate,
  token?: string,
): Promise<RouteCollection> {
  return apiFetch<RouteCollection>(
    '/api/v1/routes/collections/from-filters',
    { method: 'POST', body: JSON.stringify(payload) },
    token,
  );
}
