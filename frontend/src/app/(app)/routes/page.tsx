'use client';

import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { RouteSummary, RouteData, RouteFilters, RouteSyncResult } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { SkeletonRouteCard } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { RouteMap } from '@/components/maps/RouteMap';
import { ElevationProfile } from '@/components/maps/ElevationProfile';
import { SurfaceBreakdown } from '@/components/maps/SurfaceBreakdown';

function formatDistance(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatElevation(meters: number): string {
  return `${Math.round(meters)} m`;
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

const PROVIDER_COLORS: Record<string, string> = {
  strava: 'bg-orange-500',
  komoot: 'bg-green-600',
  wahoo: 'bg-blue-500',
  manual: 'bg-gray-500',
};

const PROVIDER_ICONS: Record<string, string> = {
  strava: '/icons/strava.svg',
  komoot: '/icons/komoot.svg',
  wahoo: '/icons/wahoo.svg',
  manual: '',
};

function ProviderIcon({ provider, size = 14 }: { provider: string; size?: number }) {
  const src = PROVIDER_ICONS[provider];
  if (src) {
    return <img src={src} alt={`${provider} logo`} className="inline-block" style={{ width: size, height: size }} />;
  }
  return <span aria-hidden="true">✏️</span>;
}

const SORT_OPTIONS = [
  { value: '', label: 'Default (Newest)' },
  { value: 'name', label: 'Name' },
  { value: 'distance', label: 'Distance' },
  { value: 'elevation', label: 'Elevation' },
  { value: 'ride_count', label: 'Ride Count' },
  { value: 'last_ridden', label: 'Last Ridden' },
  { value: 'created_at', label: 'Date Added' },
];

export default function RoutesPage() {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<RouteFilters>({});
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch route list
  const { data: routes, isLoading } = useQuery<RouteSummary[]>({
    queryKey: ['routes', filters],
    queryFn: () => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== '' && value !== null) {
          params.append(key, String(value));
        }
      });
      const query = params.toString();
      return authFetch<RouteSummary[]>(`/api/v1/routes/${query ? `?${query}` : ''}`);
    },
    staleTime: 120_000,  // 2 min
  });

  // Fetch selected route detail
  const { data: selectedRoute } = useQuery<RouteData>({
    queryKey: ['route', selectedRouteId],
    queryFn: () => authFetch<RouteData>(`/api/v1/routes/${selectedRouteId}`),
    enabled: !!selectedRouteId,
    staleTime: 300_000,  // 5 min — route details rarely change
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: () => authFetch<RouteSyncResult[]>('/api/v1/routes/sync', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => authFetch(`/api/v1/routes/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] });
      setSelectedRouteId(null);
    },
  });

  // GPX download
  async function handleDownloadGpx(routeId: string, routeName: string) {
    try {
      const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const session = await import('next-auth/react').then(m => m.getSession());
      const token = session?.backendToken;

      const response = await fetch(`${API_BASE_URL}/api/v1/routes/${routeId}/gpx`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Download failed');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${routeName.replace(/ /g, '_').replace(/\//g, '_')}.gpx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('GPX download failed:', err);
    }
  }

  // GPX upload
  async function handleUploadGpx(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const session = await import('next-auth/react').then(m => m.getSession());
      const token = session?.backendToken;

      const response = await fetch(`${API_BASE_URL}/api/v1/routes/upload-gpx`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) throw new Error('Upload failed');

      queryClient.invalidateQueries({ queryKey: ['routes'] });
      setShowUploadModal(false);
    } catch (err) {
      console.error('GPX upload failed:', err);
    }

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // Selected route ride stats from the list data
  const selectedRouteSummary = routes?.find(r => r.id === selectedRouteId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-white mb-2">Saved Routes</h1>
            {routes && routes.length > 0 && (
              <span className="inline-flex items-center px-3 py-1 text-sm font-semibold bg-accent/20 text-accent rounded-full">
                {routes.length} {routes.length === 1 ? 'route' : 'routes'}
              </span>
            )}
          </div>
          <p className="text-muted">Browse routes synced from Strava, Komoot, and Wahoo</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowUploadModal(!showUploadModal)}
            aria-label="Upload GPX file"
            className="px-4 py-2 text-sm font-medium bg-surface-light hover:bg-surface-light/80 text-white rounded-lg transition-colors"
          >
            📤 Upload GPX
          </button>
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            aria-label="Sync routes from providers"
            className="px-4 py-2 text-sm font-medium bg-accent hover:bg-accent/80 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {syncMutation.isPending ? 'Syncing...' : '🔄 Sync Routes'}
          </button>
        </div>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <Card>
          <div className="p-4">
            <p className="text-sm text-muted mb-3">Upload a GPX file to create a new route.</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".gpx"
              onChange={handleUploadGpx}
              className="text-sm text-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-accent file:text-white hover:file:bg-accent/80"
            />
          </div>
        </Card>
      )}

      {/* Sync result */}
      {syncMutation.isSuccess && syncMutation.data && (
        <Card>
          <div className="p-4" aria-live="polite">
            <p className="text-sm text-positive">
              ✅ Synced {syncMutation.data.reduce((sum, r) => sum + r.synced_count, 0)} routes
              ({syncMutation.data.reduce((sum, r) => sum + r.merged_count, 0)} merged duplicates)
            </p>
          </div>
        </Card>
      )}

      {/* Filter Bar */}
      <Card>
        <div className="flex flex-wrap gap-4 items-end p-4">
          <div>
            <label className="block text-xs text-muted mb-1">Status</label>
            <select
              value={filters.is_ridden === undefined ? '' : filters.is_ridden ? 'ridden' : 'unridden'}
              onChange={(e) => {
                const val = e.target.value;
                setFilters({
                  ...filters,
                  is_ridden: val === '' ? undefined : val === 'ridden',
                });
              }}
              className="bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">All</option>
              <option value="unridden">Not yet ridden</option>
              <option value="ridden">Ridden</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Sport Type</label>
            <select
              value={filters.sport_type || ''}
              onChange={(e) => setFilters({ ...filters, sport_type: e.target.value || undefined })}
              className="bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">All</option>
              <option value="cycling">Cycling</option>
              <option value="running">Running</option>
              <option value="walking">Walking</option>
              <option value="hiking">Hiking</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Source</label>
            <select
              value={filters.source || ''}
              onChange={(e) => setFilters({ ...filters, source: e.target.value || undefined })}
              className="bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">All Sources</option>
              <option value="strava">Strava</option>
              <option value="komoot">Komoot</option>
              <option value="wahoo">Wahoo</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Route Type</label>
            <select
              value={filters.is_loop === undefined ? '' : filters.is_loop ? 'loop' : 'point'}
              onChange={(e) => {
                const val = e.target.value;
                setFilters({
                  ...filters,
                  is_loop: val === '' ? undefined : val === 'loop',
                });
              }}
              className="bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">All</option>
              <option value="loop">Loop</option>
              <option value="point">Point to Point</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Min Dist (km)</label>
            <input
              type="number"
              min="0"
              step="0.5"
              placeholder="0"
              value={filters.min_distance ? filters.min_distance / 1000 : ''}
              onChange={(e) => setFilters({
                ...filters,
                min_distance: e.target.value ? parseFloat(e.target.value) * 1000 : undefined,
              })}
              className="w-24 bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Max Dist (km)</label>
            <input
              type="number"
              min="0"
              step="0.5"
              placeholder="∞"
              value={filters.max_distance ? filters.max_distance / 1000 : ''}
              onChange={(e) => setFilters({
                ...filters,
                max_distance: e.target.value ? parseFloat(e.target.value) * 1000 : undefined,
              })}
              className="w-24 bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Min Elev (m)</label>
            <input
              type="number"
              min="0"
              step="10"
              placeholder="0"
              value={filters.min_elevation ?? ''}
              onChange={(e) => setFilters({
                ...filters,
                min_elevation: e.target.value ? parseFloat(e.target.value) : undefined,
              })}
              className="w-24 bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Max Elev (m)</label>
            <input
              type="number"
              min="0"
              step="10"
              placeholder="∞"
              value={filters.max_elevation ?? ''}
              onChange={(e) => setFilters({
                ...filters,
                max_elevation: e.target.value ? parseFloat(e.target.value) : undefined,
              })}
              className="w-24 bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Sort By</label>
            <select
              value={filters.sort_by || ''}
              onChange={(e) => setFilters({ ...filters, sort_by: e.target.value || undefined })}
              className="bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {filters.sort_by && (
            <div>
              <label className="block text-xs text-muted mb-1">Order</label>
              <select
                value={filters.sort_order || 'desc'}
                onChange={(e) => setFilters({ ...filters, sort_order: e.target.value })}
                className="bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs text-muted mb-1">Search</label>
            <input
              type="text"
              placeholder="Route name..."
              value={filters.q || ''}
              onChange={(e) => setFilters({ ...filters, q: e.target.value || undefined })}
              className="bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <button
            onClick={() => setFilters({})}
            aria-label="Clear all route filters"
            className="px-4 py-2 text-sm text-muted hover:text-white border border-surface-light rounded-lg hover:bg-surface-light/50 transition-colors"
          >
            Clear
          </button>
        </div>
      </Card>

      {/* Main content: list + detail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Route List */}
        <div className="space-y-3" aria-live="polite">
          {isLoading ? (
            <>
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonRouteCard key={i} />
              ))}
            </>
          ) : routes && routes.length > 0 ? (
            routes.map((route) => (
              <Card
                key={route.id}
                className={`cursor-pointer transition-all hover:border-accent/50 ${
                  selectedRouteId === route.id ? 'border-accent ring-1 ring-accent/30' : ''
                }`}
              >
                <div
                  className="p-4"
                  onClick={() => setSelectedRouteId(route.id)}
                >
                  <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-white font-medium truncate">{route.name}</h3>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {/* Deduplicate sources by provider for display */}
                      {Array.from(
                        new Map(route.sources.map((s) => [s.provider, s])).values()
                      ).map((s) => (
                        <span
                          key={s.provider}
                          className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full text-white ${PROVIDER_COLORS[s.provider] || 'bg-gray-500'}`}
                        >
                          <ProviderIcon provider={s.provider} size={12} /> {s.provider}
                        </span>
                      ))}
                      {route.is_loop && (
                        <Badge variant="positive">Loop</Badge>
                      )}
                      {route.ride_count > 0 ? (
                        <Badge variant="positive">✓ Ridden ({route.ride_count})</Badge>
                      ) : (
                        <Badge variant="muted">New</Badge>
                      )}
                    </div>
                  </div>
                </div>
                  <div className="flex items-center gap-4 text-sm text-muted flex-wrap">
                    <span>📏 {formatDistance(route.distance_meters)}</span>
                    {route.elevation_gain_meters && (
                      <span>⛰️ {formatElevation(route.elevation_gain_meters)}</span>
                    )}
                    {route.estimated_time_seconds && (
                      <span>⏱️ {formatDuration(route.estimated_time_seconds)}</span>
                    )}
                    {route.country && (
                      <span>📍 {route.locality ? `${route.locality}, ` : ''}{route.country}</span>
                    )}
                    {route.last_ridden_date && (
                      <span className="text-xs text-accent">
                        🚴 Last: {new Date(route.last_ridden_date).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            ))
          ) : (
            <EmptyState
              icon="🗺️"
              title="No routes synced yet"
              description="Connect a provider (Strava, Komoot, or Wahoo) and sync to import routes. You can also upload a GPX file."
              action={{ label: 'Go to Settings', href: '/settings' }}
            />
          )}
        </div>

        {/* Route Detail */}
        <div>
          {selectedRoute ? (
            <div className="space-y-4 sticky top-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>{selectedRoute.name}</CardTitle>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDownloadGpx(selectedRoute.id, selectedRoute.name)}
                        aria-label="Download route as GPX file"
                        className="px-3 py-1.5 text-xs font-medium bg-surface-light hover:bg-surface-light/80 text-white rounded-lg transition-colors"
                      >
                        ⬇️ GPX
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Delete this route?')) {
                            deleteMutation.mutate(selectedRoute.id);
                          }
                        }}
                        aria-label="Delete route"
                        className="px-3 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <div className="px-6 pb-4">
                  {/* Ride stats */}
                  {selectedRouteSummary && selectedRouteSummary.ride_count > 0 && (
                    <div className="flex items-center gap-4 p-3 bg-accent/10 border border-accent/20 rounded-lg mb-4">
                      <div>
                        <p className="text-lg font-bold text-accent">{selectedRouteSummary.ride_count}</p>
                        <p className="text-xs text-muted">Total Rides</p>
                      </div>
                      {selectedRouteSummary.last_ridden_date && (
                        <div>
                          <p className="text-sm text-white">
                            {new Date(selectedRouteSummary.last_ridden_date).toLocaleDateString()}
                          </p>
                          <p className="text-xs text-muted">Last Ridden</p>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-4 text-sm text-muted mb-4">
                    <span>📏 {formatDistance(selectedRoute.distance_meters)}</span>
                    {selectedRoute.elevation_gain_meters && (
                      <span>⛰️ {formatElevation(selectedRoute.elevation_gain_meters)}</span>
                    )}
                    {selectedRoute.estimated_time_seconds && (
                      <span>⏱️ {formatDuration(selectedRoute.estimated_time_seconds)}</span>
                    )}
                    <span>{selectedRoute.is_loop ? '🔄 Loop' : '➡️ Point to Point'}</span>
                    {selectedRoute.country && (
                      <span>📍 {selectedRoute.locality ? `${selectedRoute.locality}, ` : ''}{selectedRoute.country}</span>
                    )}
                  </div>

                  {/* Provider Sources */}
                  <div className="mb-4">
                    <h4 className="text-xs text-muted mb-2 uppercase tracking-wider">Provider Sources</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedRoute.sources.map((s) => (
                        <span
                          key={s.id}
                          className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-white ${PROVIDER_COLORS[s.provider] || 'bg-gray-500'}`}
                        >
                          <ProviderIcon provider={s.provider} size={14} /> {s.provider_name}
                          <span className="text-white/60 text-[10px]">({s.provider})</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Map */}
                <div className="px-6 pb-4">
                  <RouteMap
                    encodedPolyline={selectedRoute.encoded_polyline}
                    isLoop={selectedRoute.is_loop}
                    className="h-[350px]"
                  />
                </div>

                {/* Elevation Profile */}
                {selectedRoute.elevation_profile?.elevations && (
                  <div className="px-6 pb-4">
                    <ElevationProfile
                      encodedPolyline={selectedRoute.encoded_polyline}
                      elevations={selectedRoute.elevation_profile.elevations}
                    />
                  </div>
                )}

                {/* Surface Breakdown */}
                <div className="px-6 pb-4">
                  {selectedRoute.surface_profile ? (
                    <SurfaceBreakdown surfaceProfile={selectedRoute.surface_profile} />
                  ) : (
                    <p className="text-xs text-muted">Surface data not available for this route</p>
                  )}
                </div>
              </Card>
            </div>
          ) : (
            <Card>
              <div className="p-12 text-center text-muted">
                <p className="text-4xl mb-3">🗺️</p>
                <p>Select a route to view details and map</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
