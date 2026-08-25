'use client';

import React, { useState, useRef, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type {
  RouteSummary,
  RouteData,
  RouteFilters,
  RouteSyncResult,
  RouteHistoryResponse,
} from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { SkeletonRouteCard, SkeletonLine } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { RouteMap } from '@/components/maps/RouteMap';
import { ElevationProfile } from '@/components/maps/ElevationProfile';
import { SurfaceBreakdown } from '@/components/maps/SurfaceBreakdown';
import { formatDuration, formatDistance } from '@/lib/utils';
import { ProviderIcon, PROVIDER_COLORS } from '@/components/ui/ProviderBadge';
import { usePageTitle } from '@/lib/usePageTitle';
import { CompareRoutesModal } from '@/components/routes/CompareRoutesModal';
import { MapBrowseView } from '@/components/routes/MapBrowseView';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtElevation(meters: number): string {
  return `${Math.round(meters)} m`;
}

function fmtDurationShort(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

// ── Difficulty ───────────────────────────────────────────────────────────────

type DifficultyLevel = 'Easy' | 'Moderate' | 'Hard' | 'Extreme';

function computeDifficulty(
  elevationGainMeters: number | undefined | null,
  distanceMeters: number,
): DifficultyLevel | null {
  if (!elevationGainMeters || elevationGainMeters <= 0) return null;
  if (distanceMeters <= 0) return null;
  const elevPerKm = elevationGainMeters / (distanceMeters / 1000);
  if (elevPerKm < 10) return 'Easy';
  if (elevPerKm < 20) return 'Moderate';
  if (elevPerKm < 40) return 'Hard';
  return 'Extreme';
}

const DIFFICULTY_STYLES: Record<DifficultyLevel, string> = {
  Easy: 'bg-green-500/20 text-green-400 border-green-500/30',
  Moderate: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  Hard: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  Extreme: 'bg-red-500/20 text-red-400 border-red-500/30',
};

function DifficultyBadge({ level }: { level: DifficultyLevel }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${DIFFICULTY_STYLES[level]}`}
    >
      {level}
    </span>
  );
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

const SURFACE_OPTIONS = [
  { value: '', label: 'Any surface' },
  { value: 'paved', label: 'Paved' },
  { value: 'gravel', label: 'Gravel' },
  { value: 'compacted_gravel', label: 'Compacted Gravel' },
  { value: 'dirt', label: 'Dirt' },
  { value: 'grass', label: 'Grass' },
  { value: 'singletrack', label: 'Singletrack' },
  { value: 'trail', label: 'Trail' },
  { value: 'cobblestone', label: 'Cobblestone' },
  { value: 'sand', label: 'Sand' },
];

// ── Route History Section ────────────────────────────────────────────────────

function RouteHistorySection({ routeId }: { routeId: string }) {
  const { authFetch } = useAuthFetch();

  const { data: history, isLoading } = useQuery<RouteHistoryResponse>({
    queryKey: ['route-history', routeId],
    queryFn: () => authFetch<RouteHistoryResponse>(`/api/v1/routes/${routeId}/history`),
    staleTime: 300_000, // 5 min
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <SkeletonLine className="h-4 w-32" />
        <SkeletonLine className="h-3 w-48" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonLine key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!history) return null;

  return (
    <div>
      <h4 className="text-xs text-muted mb-3 uppercase tracking-wider">Ride History</h4>

      {/* Summary strip */}
      <div className="flex items-center gap-4 p-3 bg-accent/10 border border-accent/20 rounded-lg mb-3">
        <div>
          <p className="text-lg font-bold text-accent">{history.total_rides}</p>
          <p className="text-xs text-muted">Total Rides</p>
        </div>
        {history.personal_best && (
          <>
            <div className="w-px h-8 bg-accent/20" />
            <div>
              <p className="text-sm font-semibold text-green-400">
                {formatDuration(history.personal_best.duration_seconds)}
              </p>
              <p className="text-xs text-muted">Personal Best</p>
            </div>
            <div>
              <p className="text-sm text-white">
                {new Date(history.personal_best.date).toLocaleDateString()}
              </p>
              <p className="text-xs text-muted">PB Date</p>
            </div>
            {history.personal_best.average_power != null && (
              <div>
                <p className="text-sm text-yellow-400">{Math.round(history.personal_best.average_power)} W</p>
                <p className="text-xs text-muted">PB Avg Power</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Rides table */}
      {history.rides.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted border-b border-surface-light/50">
                <th className="text-left py-2 pr-3">Date</th>
                <th className="text-right py-2 px-3">Duration</th>
                <th className="text-right py-2 px-3">Distance</th>
                <th className="text-right py-2 px-3">Avg Power</th>
                <th className="text-right py-2 pl-3">TSS</th>
              </tr>
            </thead>
            <tbody>
              {history.rides.map((ride) => (
                <tr key={ride.activity_id} className="border-b border-surface-light/30 hover:bg-surface-light/20">
                  <td className="py-2 pr-3 text-white">
                    {new Date(ride.date).toLocaleDateString()}
                  </td>
                  <td className="py-2 px-3 text-right text-slate-300">
                    {ride.duration_seconds ? formatDuration(ride.duration_seconds) : '\u2014'}
                  </td>
                  <td className="py-2 px-3 text-right text-slate-300">
                    {ride.distance_meters ? formatDistance(ride.distance_meters) : '\u2014'}
                  </td>
                  <td className="py-2 px-3 text-right text-yellow-400">
                    {ride.average_power != null ? `${Math.round(ride.average_power)} W` : '\u2014'}
                  </td>
                  <td className="py-2 pl-3 text-right text-blue-400">
                    {ride.tss != null ? Math.round(ride.tss) : '\u2014'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted">No rides recorded on this route yet</p>
      )}
    </div>
  );
}

export default function RoutesPage() {
  usePageTitle('Routes');
  const { authFetch, authFetchWithHeaders, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<RouteFilters>({});
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Phase 8B state
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const [showCompareModal, setShowCompareModal] = useState(false);

  // Fetch route list
  const { data: routesData, isLoading } = useQuery<{ routes: RouteSummary[]; totalCount: number }>({
    queryKey: ['routes', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== '' && value !== null) {
          params.append(key, String(value));
        }
      });
      const query = params.toString();
      const result = await authFetchWithHeaders<RouteSummary[]>(`/api/v1/routes/${query ? `?${query}` : ''}`);
      const totalCount = parseInt(result.headers.get('X-Total-Count') || '0', 10);
      return { routes: result.data, totalCount };
    },
    staleTime: 120_000,  // 2 min
  });

  const routes = routesData?.routes;
  const totalCount = routesData?.totalCount ?? 0;

  // Fetch selected route detail
  const { data: selectedRoute } = useQuery<RouteData>({
    queryKey: ['route', selectedRouteId],
    queryFn: () => authFetch<RouteData>(`/api/v1/routes/${selectedRouteId}`),
    enabled: !!selectedRouteId,
    staleTime: 300_000,  // 5 min — route details rarely change
  });

  // Fetch compare routes (both at once)
  const compareIdArray = useMemo(() => Array.from(compareIds), [compareIds]);
  const { data: compareRouteA } = useQuery<RouteData>({
    queryKey: ['route', compareIdArray[0]],
    queryFn: () => authFetch<RouteData>(`/api/v1/routes/${compareIdArray[0]}`),
    enabled: showCompareModal && compareIdArray.length === 2,
    staleTime: 300_000,
  });
  const { data: compareRouteB } = useQuery<RouteData>({
    queryKey: ['route', compareIdArray[1]],
    queryFn: () => authFetch<RouteData>(`/api/v1/routes/${compareIdArray[1]}`),
    enabled: showCompareModal && compareIdArray.length === 2,
    staleTime: 300_000,
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

  // Rename mutation
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      authFetch(`/api/v1/routes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] });
      queryClient.invalidateQueries({ queryKey: ['route', selectedRouteId] });
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      setIsRenaming(false);
    },
  });

  // GPX download
  async function handleDownloadGpx(routeId: string, routeName: string) {
    try {
      const response = await fetch(`/api/v1/routes/${routeId}/gpx`, {
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
      const response = await fetch('/api/v1/routes/upload-gpx', {
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

  // Compare toggle
  function toggleCompare(routeId: string) {
    setCompareIds((prev) => {
      const next = new Set(prev);
      if (next.has(routeId)) {
        next.delete(routeId);
      } else if (next.size < 2) {
        next.add(routeId);
      }
      return next;
    });
  }

  // Map browse select handler
  const handleMapSelectRoute = useCallback((id: string) => {
    setSelectedRouteId(id);
    setViewMode('list');
  }, []);

  // Selected route ride stats from the list data
  const selectedRouteSummary = routes?.find(r => r.id === selectedRouteId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-white mb-2">Saved Routes</h1>
            {routes && totalCount > 0 && (
              <span className="inline-flex items-center px-3 py-1 text-sm font-semibold bg-accent/20 text-accent rounded-full">
                {totalCount} {totalCount === 1 ? 'route' : 'routes'}
              </span>
            )}
          </div>
          <p className="text-muted">Browse routes synced from Strava, Komoot, and Wahoo</p>
        </div>
        <div className="flex gap-2">
          {/* View Toggle */}
          <div className="flex items-center bg-surface rounded-lg border border-surface-light overflow-hidden" role="tablist" aria-label="Route view mode">
            <button
              onClick={() => setViewMode('list')}
              role="tab"
              aria-selected={viewMode === 'list'}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                viewMode === 'list' ? 'bg-accent text-white' : 'text-muted hover:text-white'
              }`}
            >
              List
            </button>
            <button
              onClick={() => setViewMode('map')}
              role="tab"
              aria-selected={viewMode === 'map'}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                viewMode === 'map' ? 'bg-accent text-white' : 'text-muted hover:text-white'
              }`}
            >
              Map
            </button>
          </div>
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
          {/* Surface type filter */}
          <div>
            <label className="block text-xs text-muted mb-1">Surface</label>
            <select
              value={filters.surface_type || ''}
              onChange={(e) => setFilters({ ...filters, surface_type: e.target.value || undefined })}
              className="bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {SURFACE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
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

      {/* Compare button — appears when exactly 2 routes selected */}
      {compareIds.size === 2 && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCompareModal(true)}
            className="px-4 py-2 text-sm font-medium bg-accent hover:bg-accent/80 text-white rounded-lg transition-colors"
          >
            {'\u2696\uFE0F'} Compare Routes
          </button>
          <button
            onClick={() => setCompareIds(new Set())}
            className="px-3 py-2 text-sm text-muted hover:text-white transition-colors"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Map view */}
      {viewMode === 'map' && (
        <Card>
          <MapBrowseView
            routes={routes ?? []}
            onSelectRoute={handleMapSelectRoute}
          />
        </Card>
      )}

      {/* Main content: list + detail */}
      {viewMode === 'list' && (
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
            routes.map((route) => {
                const diff = computeDifficulty(route.elevation_gain_meters, route.distance_meters);
                return (
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
                      {/* Compare checkbox */}
                      <label
                        className="flex items-center"
                        onClick={(e) => e.stopPropagation()}
                        title="Select for comparison"
                      >
                        <input
                          type="checkbox"
                          checked={compareIds.has(route.id)}
                          onChange={() => toggleCompare(route.id)}
                          className="w-4 h-4 rounded border-surface-light bg-surface-light text-accent focus:ring-accent focus:ring-offset-0 cursor-pointer"
                        />
                      </label>
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
                        <Badge variant="positive">{'\u2713'} Ridden ({route.ride_count})</Badge>
                      ) : (
                        <Badge variant="muted">New</Badge>
                      )}
                      {diff && <DifficultyBadge level={diff} />}
                    </div>
                  </div>
                </div>
                  <div className="flex items-center gap-4 text-sm text-muted flex-wrap">
                    <span>📏 {formatDistance(route.distance_meters)}</span>
                    {route.elevation_gain_meters && (
                      <span>⛰️ {fmtElevation(route.elevation_gain_meters)}</span>
                    )}
                    {route.estimated_time_seconds && (
                      <span>⏱️ {fmtDurationShort(route.estimated_time_seconds)}</span>
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
                );
              })
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
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {isRenaming ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (renameValue.trim() && renameValue.trim() !== selectedRoute.name) {
                              renameMutation.mutate({ id: selectedRoute.id, name: renameValue.trim() });
                            } else {
                              setIsRenaming(false);
                            }
                          }}
                          className="flex items-center gap-2 flex-1 min-w-0"
                        >
                          <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            autoFocus
                            className="flex-1 min-w-0 px-2 py-1 bg-background border border-accent rounded text-white text-lg font-bold focus:outline-none"
                            onBlur={() => {
                              if (!renameValue.trim() || renameValue.trim() === selectedRoute.name) {
                                setIsRenaming(false);
                              }
                            }}
                          />
                          <button
                            type="submit"
                            className="text-xs text-accent hover:text-accent/80"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsRenaming(false)}
                            className="text-xs text-muted hover:text-white"
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <>
                          <CardTitle>{selectedRoute.name}</CardTitle>
                          <button
                            onClick={() => {
                              setRenameValue(selectedRoute.name);
                              setIsRenaming(true);
                            }}
                            className="text-xs text-muted hover:text-accent transition-colors"
                            aria-label="Rename route"
                          >
                            ✏️
                          </button>
                        </>
                      )}
                      {(() => {
                        const diff = computeDifficulty(selectedRoute.elevation_gain_meters, selectedRoute.distance_meters);
                        return diff ? <DifficultyBadge level={diff} /> : null;
                      })()}
                    </div>
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
                      <span>⛰️ {fmtElevation(selectedRoute.elevation_gain_meters)}</span>
                    )}
                    {selectedRoute.estimated_time_seconds && (
                      <span>⏱️ {fmtDurationShort(selectedRoute.estimated_time_seconds)}</span>
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

                {/* Route History */}
                <div className="px-6 pb-4">
                  <RouteHistorySection routeId={selectedRoute.id} />
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
      )}

      {/* Compare Routes Modal */}
      {showCompareModal && compareRouteA && compareRouteB && (
        <CompareRoutesModal
          routeA={compareRouteA}
          routeB={compareRouteB}
          onClose={() => setShowCompareModal(false)}
        />
      )}
    </div>
  );
}
