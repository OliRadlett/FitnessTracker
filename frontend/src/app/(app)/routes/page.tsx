'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import { useDeepLink } from '@/lib/useDeepLink';
import { useRoutesStore } from '@/lib/stores/routesStore';
import type { RouteSummary, RouteData, RouteFilters } from '@/lib/api/types';
import { getRoutes, syncRoutes, getRoute } from '@/lib/api/routes';
import { apiUpload } from '@/lib/api/fetch';
import { Card } from '@/components/ui/Card';
import { SkeletonRouteCard } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { RoutesMapView } from '@/components/routes/RoutesMapView';
import { RoutesListView } from '@/components/routes/VirtualRouteList';
import { RoutesGridView } from '@/components/routes/RoutesGridView';
import { RouteDetailPanel } from '@/components/routes/RouteDetailPanel';
import { RoutesSidebar } from '@/components/routes/RoutesSidebar';
import { RouteFilterBar } from '@/components/routes/RouteFilterBar';
import { usePageTitle } from '@/lib/usePageTitle';
import { MapPin, List, Grid3x3, RefreshCw, Upload } from 'lucide-react';

export default function RoutesPage() {
  usePageTitle('Routes');
  const { token } = useAuthFetch();
  const queryClient = useQueryClient();
  const { getParam, setParam } = useDeepLink();

  const {
    viewMode,
    setViewMode,
    selectedRouteId,
    setSelectedRouteId,
    clearSelection,
    selectedTagIds,
    activeCollectionId,
    filters,
    setFilters,
    showImportModal,
    setShowImportModal,
  } = useRoutesStore();

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Deep-link: select the route referenced by ?route=<id> on load
  useEffect(() => {
    const id = getParam('route');
    if (id) setSelectedRouteId(id);
  }, [getParam, setSelectedRouteId]);

  const handleSelectRoute = useCallback((id: string | null) => {
    setSelectedRouteId(id);
    setParam('route', id);
  }, [setParam, setSelectedRouteId]);

  const handleSelectRouteFromList = useCallback((route: RouteSummary) => {
    handleSelectRoute(route.id);
  }, [handleSelectRoute]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;

      const tag = e.target as HTMLElement;
      if (tag.tagName === 'INPUT' || tag.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case '1': setViewMode('map'); break;
        case '2': setViewMode('list'); break;
        case '3': setViewMode('grid'); break;
        case 'f':
          setFilters({ ...filters, q: '' });
          setTimeout(() => (document.querySelector('input[placeholder="Search routes..."]') as HTMLInputElement)?.focus(), 100);
          break;
        case 'Escape':
          setSelectedRouteId(null);
          clearSelection();
          setParam('route', null);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setViewMode, setFilters, setSelectedRouteId, clearSelection, setParam]);

  // Build query filters from store
  const queryFilters: RouteFilters = {
    ...filters,
    tag_ids: selectedTagIds.length > 0 ? selectedTagIds : undefined,
    collection_id: activeCollectionId || undefined,
  };

  // Fetch routes
  const { data: routesData, isLoading, refetch } = useQuery<{
    routes: RouteSummary[];
    totalCount: number;
  }>({
    queryKey: ['routes', queryFilters],
    queryFn: () => getRoutes(queryFilters, token),
    staleTime: 60_000,
  });

  const routes = routesData?.routes ?? [];
  const totalCount = routesData?.totalCount ?? 0;

  // Fetch selected route detail
  const { data: selectedRoute } = useQuery<RouteData>({
    queryKey: ['route', selectedRouteId],
    queryFn: () => getRoute(selectedRouteId!, token),
    enabled: !!selectedRouteId,
    staleTime: 300_000,
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: () => syncRoutes(token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] });
    },
  });

  // Upload handlers
  async function handleUploadGpx(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      await apiUpload<RouteData>('/api/v1/routes/upload-gpx', formData, token);
      queryClient.invalidateQueries({ queryKey: ['routes'] });
      setShowImportModal(false);
    } catch (err) {
      console.error('GPX upload failed:', err);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // View mode buttons
  const viewModes = [
    { key: 'map', label: 'Map', icon: MapPin },
    { key: 'list', label: 'List', icon: List },
    { key: 'grid', label: 'Grid', icon: Grid3x3 },
  ];

  // Active filters count
  const activeFilterCount = Object.entries(queryFilters).filter(
    ([k, v]) => k !== 'q' && v !== undefined && v !== '' && v !== null,
  ).length;

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Sidebar */}
      <RoutesSidebar
        onTagClick={() => refetch()}
        onCollectionClick={() => refetch()}
      />

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 p-4 border-b border-surface-light/30">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-white">Saved Routes</h1>
                {routes && totalCount > 0 && (
                  <span className="inline-flex items-center px-3 py-1 text-sm font-semibold bg-accent/20 text-accent rounded-full">
                    {totalCount} {totalCount === 1 ? 'route' : 'routes'}
                  </span>
                )}
              </div>
              <p className="text-muted mt-1">
                Browse, organize, and plan rides from your synced routes.
                <span className="mx-2">•</span>
                <span className="text-xs text-muted">
                  Press 1/2/3 for Map/List/Grid · F to search · Esc to deselect
                </span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* View mode toggle */}
              <div
                className="flex items-center bg-surface rounded-lg border border-surface-light overflow-hidden"
                role="tablist"
                aria-label="Route view mode"
              >
                {viewModes.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setViewMode(key as typeof viewMode)}
                    role="tab"
                    aria-selected={viewMode === key}
                    className={`px-3 py-2 text-sm font-medium transition-colors flex items-center gap-1 ${
                      viewMode === key
                        ? 'bg-accent text-white'
                        : 'text-muted hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setShowImportModal(true)}
                aria-label="Upload GPX file"
                className="px-3 py-2 text-sm font-medium bg-surface-light hover:bg-surface-light/80 text-white rounded-lg transition-colors flex items-center gap-1"
              >
                <Upload className="w-4 h-4" />
                Upload GPX
              </button>

              <button
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                aria-label="Sync routes from providers"
                className="px-3 py-2 text-sm font-medium bg-accent hover:bg-accent/80 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                <RefreshCw className={`w-4 h-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                {syncMutation.isPending ? 'Syncing...' : 'Sync'}
              </button>
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex-shrink-0 px-4 py-3 border-b border-surface-light/30">
          <RouteFilterBar />
        </div>

        {/* Sync status banner */}
        {syncMutation.isSuccess && syncMutation.data && (
          <div className="flex-shrink-0 px-4 py-2.5 border-b border-surface-light/30">
            <div className="flex items-center justify-between px-4 py-2.5 rounded-lg border bg-positive/10 border-positive/20 text-positive">
              <span className="text-sm">
                ✅ Synced {syncMutation.data.reduce((sum, r) => sum + r.synced_count, 0)} routes
                ({syncMutation.data.reduce((sum, r) => sum + r.merged_count, 0)} merged duplicates)
              </span>
            </div>
          </div>
        )}

        {/* Error banner */}
        {syncMutation.isError && (
          <div className="flex-shrink-0 px-4 py-2.5 border-b border-surface-light/30">
            <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300 text-sm">
              <span>{syncMutation.error instanceof Error ? syncMutation.error.message : 'Route sync failed'}</span>
            </div>
          </div>
        )}

        {/* Main content area */}
        <div className="flex-1 overflow-hidden flex">
          {/* Routes view (map, list, or grid) */}
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonRouteCard key={i} />
                ))}
              </div>
            ) : routes.length > 0 ? (
              <>
                {viewMode === 'map' && (
                  <div className="p-4">
                    <Card>
                      <RoutesMapView
                        routes={routes}
                        onSelectRoute={handleSelectRoute}
                      />
                    </Card>
                  </div>
                )}

                {viewMode === 'list' && (
                  <div className="p-4">
                    <RoutesListView
                      routes={routes}
                      onSelect={handleSelectRouteFromList}
                    />
                  </div>
                )}

                {viewMode === 'grid' && (
                  <div className="p-4">
                    <RoutesGridView
                      routes={routes}
                      onSelect={handleSelectRouteFromList}
                    />
                  </div>
                )}
              </>
            ) : (
              <div className="p-8">
                <EmptyState
                  icon="🗺️"
                  title="No routes found"
                  description={
                    activeFilterCount > 0
                      ? 'Try clearing your filters to see all routes.'
                      : 'Connect a provider (Strava, Komoot, or Wahoo) and sync to import routes. You can also upload a GPX file.'
                  }
                  action={{ label: 'Go to Settings', href: '/settings' }}
                />
              </div>
            )}
          </div>

          {/* Route detail panel (slide-over on mobile/desktop) */}
          <div className="flex-shrink-0 hidden lg:block">
            <RouteDetailPanel
              route={selectedRoute ?? null}
              onClose={() => handleSelectRoute(null)}
            />
          </div>
        </div>
      </div>

      {/* GPX Upload Modal */}
      {showImportModal && (
        <Modal open onClose={() => setShowImportModal(false)} aria-label="Upload GPX File">
          <div className="p-2">
            <p className="text-sm text-muted mb-4">
              Upload a GPX file to create a new route.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".gpx"
              onChange={handleUploadGpx}
              className="w-full text-sm text-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-accent file:text-white hover:file:bg-accent/80"
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
