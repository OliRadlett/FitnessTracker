import { apiFetch } from './fetch';
import type {
  RouteSummary,
  RouteData,
  RouteFilters,
  RouteSyncResult,
  DuplicatePair,
} from './types';

export async function getRoutes(filters: RouteFilters = {}): Promise<RouteSummary[]> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== null) {
      params.append(key, String(value));
    }
  });
  const query = params.toString();
  return apiFetch<RouteSummary[]>(`/api/v1/routes${query ? `?${query}` : ''}`);
}

export async function getRoute(id: string): Promise<RouteData> {
  return apiFetch<RouteData>(`/api/v1/routes/${id}`);
}

export async function deleteRoute(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/routes/${id}`, { method: 'DELETE' });
}

export async function syncRoutes(): Promise<RouteSyncResult[]> {
  return apiFetch<RouteSyncResult[]>('/api/v1/routes/sync', { method: 'POST' });
}

export async function getDuplicateRoutes(): Promise<DuplicatePair[]> {
  return apiFetch<DuplicatePair[]>('/api/v1/routes/duplicates');
}

export async function mergeRoutes(primaryId: string, duplicateId: string): Promise<RouteData> {
  return apiFetch<RouteData>('/api/v1/routes/merge', {
    method: 'POST',
    body: JSON.stringify({ primary_route_id: primaryId, duplicate_route_id: duplicateId }),
  });
}

export async function downloadRouteGpx(routeId: string, routeName: string, authFetchFn: <T>(path: string, options?: RequestInit) => Promise<T>): Promise<void> {
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  const token = (authFetchFn as unknown as { __token?: string }).__token;

  // Use fetch directly for blob response
  const response = await fetch(`${API_BASE_URL}/api/v1/routes/${routeId}/gpx`, {
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
