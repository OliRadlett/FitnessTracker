import { apiFetch, apiFetchWithHeaders, apiUpload } from './fetch';
import type {
  RouteSummary,
  RouteData,
  RouteFilters,
  RouteSyncResult,
  DuplicatePair,
  RouteHistoryResponse,
  RouteTag,
  RouteCollection,
  RouteTagCreate,
  RouteTagUpdate,
  RouteCollectionCreate,
  RouteCollectionUpdate,
  RouteQualityScore,
  EffortEstimateResponse,
  EffortEstimateRequest,
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

export async function deleteRoute(id: string, token?: string): Promise<void> {
  return apiFetch<void>(`/api/v1/routes/${id}`, { method: 'DELETE' }, token);
}

export async function updateRoute(
  id: string,
  data: { name?: string; sport_type?: string; is_favorite?: boolean },
  token?: string,
): Promise<RouteData> {
  return apiFetch<RouteData>(`/api/v1/routes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }, token);
}

export async function syncRoutes(token?: string): Promise<RouteSyncResult[]> {
  return apiFetch<RouteSyncResult[]>('/api/v1/routes/sync', { method: 'POST' }, token);
}

// ─── Tags ─────────────────────────────────────────────────────────────────

export async function getTags(token?: string): Promise<RouteTag[]> {
  return apiFetch<RouteTag[]>('/api/v1/routes/tags', {}, token);
}

export async function createTag(data: RouteTagCreate, token?: string): Promise<RouteTag> {
  return apiFetch<RouteTag>('/api/v1/routes/tags', {
    method: 'POST',
    body: JSON.stringify(data),
  }, token);
}

export async function updateTag(id: string, data: RouteTagUpdate, token?: string): Promise<RouteTag> {
  return apiFetch<RouteTag>(`/api/v1/routes/tags/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }, token);
}

export async function deleteTag(id: string, token?: string): Promise<void> {
  return apiFetch<void>(`/api/v1/routes/tags/${id}`, { method: 'DELETE' }, token);
}

export async function addRouteTag(tagId: string, routeId: string, token?: string): Promise<{ detail: string }> {
  return apiFetch<{ detail: string }>(`/api/v1/routes/tags/${tagId}/routes/${routeId}`, {
    method: 'POST',
  }, token);
}

export async function removeRouteTag(tagId: string, routeId: string, token?: string): Promise<{ detail: string }> {
  return apiFetch<{ detail: string }>(`/api/v1/routes/tags/${tagId}/routes/${routeId}`, {
    method: 'DELETE',
  }, token);
}

// ─── Collections ──────────────────────────────────────────────────────────────

export async function getCollections(token?: string): Promise<RouteCollection[]> {
  return apiFetch<RouteCollection[]>('/api/v1/routes/collections', {}, token);
}

export async function createCollection(data: RouteCollectionCreate, token?: string): Promise<RouteCollection> {
  return apiFetch<RouteCollection>('/api/v1/routes/collections', {
    method: 'POST',
    body: JSON.stringify(data),
  }, token);
}

export async function updateCollection(id: string, data: RouteCollectionUpdate, token?: string): Promise<RouteCollection> {
  return apiFetch<RouteCollection>(`/api/v1/routes/collections/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }, token);
}

export async function deleteCollection(id: string, token?: string): Promise<void> {
  return apiFetch<void>(`/api/v1/routes/collections/${id}`, { method: 'DELETE' }, token);
}

export async function addToCollection(collectionId: string, routeId: string, token?: string): Promise<{ detail: string }> {
  return apiFetch<{ detail: string }>(`/api/v1/routes/collections/${collectionId}/routes/${routeId}`, {
    method: 'POST',
  }, token);
}

export async function removeFromCollection(collectionId: string, routeId: string, token?: string): Promise<{ detail: string }> {
  return apiFetch<{ detail: string }>(`/api/v1/routes/collections/${collectionId}/routes/${routeId}`, {
    method: 'DELETE',
  }, token);
}

export async function createSmartCollection(data: RouteCollectionCreate, token?: string): Promise<RouteCollection> {
  return apiFetch<RouteCollection>('/api/v1/routes/collections/from-filters', {
    method: 'POST',
    body: JSON.stringify(data),
  }, token);
}

// ─── Quality ──────────────────────────────────────────────────────────────────

export async function getRouteQualityScores(token?: string): Promise<RouteQualityScore[]> {
  return apiFetch<RouteQualityScore[]>('/api/v1/routes/quality', {}, token);
}

export async function recomputeRouteQuality(token?: string): Promise<{ updated: number; total: number }> {
  return apiFetch<{ updated: number; total: number }>('/api/v1/routes/quality/recompute', {
    method: 'POST',
  }, token);
}

// ─── Effort Estimation ────────────────────────────────────────────────────────

export async function getEffortEstimate(routeId: string, token?: string): Promise<EffortEstimateResponse> {
  return apiFetch<EffortEstimateResponse>(`/api/v1/routes/${routeId}/effort-estimate`, {}, token);
}

export async function postEffortEstimate(routeId: string, data: EffortEstimateRequest, token?: string): Promise<EffortEstimateResponse> {
  return apiFetch<EffortEstimateResponse>(`/api/v1/routes/${routeId}/effort-estimate-custom`, {
    method: 'POST',
    body: JSON.stringify(data),
  }, token);
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

// ─── Bulk Operations ──────────────────────────────────────────────────────────

export async function bulkExportGpx(routeIds: string[], token?: string): Promise<Blob> {
  const response = await fetch('/api/v1/routes/bulk/export-gpx', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
    body: JSON.stringify(routeIds),
  });
  if (!response.ok) throw new Error('Export failed');
  return response.blob();
}

export async function bulkDeleteRoutes(routeIds: string[], token?: string): Promise<{ deleted: number; total: number }> {
  return apiFetch<{ deleted: number; total: number }>('/api/v1/routes/bulk/delete', {
    method: 'POST',
    body: JSON.stringify(routeIds),
  }, token);
}

// ─── GPX ─────────────────────────────────────────────────────────────────────

export async function getRouteHistory(routeId: string, token?: string): Promise<RouteHistoryResponse> {
  return apiFetch<RouteHistoryResponse>(`/api/v1/routes/${routeId}/history`, {}, token);
}

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

export async function uploadRouteGpx(file: File, token?: string): Promise<RouteData> {
  return apiUpload<RouteData>('/api/v1/routes/upload-gpx', (() => {
    const fd = new FormData();
    fd.append('file', file);
    return fd;
  })(), token);
}
