import { apiFetch, apiFetchWithHeaders } from './fetch';
import type {
  RouteSummary,
  RouteData,
  RouteFilters,
  RouteSyncResult,
  DuplicatePair,
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

export async function mergeRoutes(primaryId: string, duplicateId: string, token?: string): Promise<RouteData> {
  return apiFetch<RouteData>('/api/v1/routes/merge', {
    method: 'POST',
    body: JSON.stringify({ primary_route_id: primaryId, duplicate_route_id: duplicateId }),
  }, token);
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
