'use client';

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import { useDeepLink } from '@/lib/useDeepLink';
import { useRoutesStore } from '@/lib/stores/routesStore';
import type { RouteSummary, RouteData, RouteFilters } from '@/lib/api/types';
import { getRoutes, syncRoutes, getRoute } from '@/lib/api/routes';
import { apiUpload } from '@/lib/api/fetch';
import { Card } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { SkeletonRouteCard } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { RoutesMapView } from '@/components/routes/RoutesMapView';
import { RoutesListView } from '@/components/routes/RoutesListView';
import { RoutesGridView } from '@/components/routes/RoutesGridView';
import { RouteDetailPanel } from '@/components/routes/RouteDetailPanel';
import { MobileRouteDetailSheet } from '@/components/routes/MobileRouteDetailSheet';
import { RoutesSidebar } from '@/components/routes/RoutesSidebar';
import { RouteFilterBar } from '@/components/routes/RouteFilterBar';
import { CompareRoutesModal } from '@/components/routes/CompareRoutesModal';
import { usePageTitle } from '@/lib/usePageTitle';
import { MapPin, List, Grid3x3, RefreshCw, Upload, Copy, X, Folder } from 'lucide-react';
import Link from 'next/link';

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
    showHeatmap,
    setShowHeatmap,
    compareRouteA,
    compareRouteB,
    clearCompareRoutes,
  } = useRoutesStore();

  const compareMode = compareRouteA !== null || compareRouteB !== null;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showOrganize, setShowOrganize] = useState(false);
  // B-23: first-run discovery tips (dismiss persisted).
  const [showTips, setShowTips] = useState(() => {
    try {
      return localStorage.getItem('fittrack-routes-tips') !== 'done';
    } catch {
      return true;
    }
  });
  const dismissTips = () => {
    try {
      localStorage.setItem('fittrack-routes-tips', 'done');
    } catch {
      /* ignore */
    }
    setShowTips(false);
  };

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

  // Fetch routes (B-24: paged infinite scroll, 60/page).
  const PAGE_SIZE = 60;
  const {
    data: routesPages,
    isLoading,
    isError,
    error: routesError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<{
    routes: RouteSummary[];
    totalCount: number;
  }>({
    queryKey: ['routes', queryFilters],
    queryFn: ({ pageParam = 0 }) =>
      getRoutes({ ...queryFilters, limit: PAGE_SIZE, offset: pageParam as number }, token),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((n, p) => n + p.routes.length, 0);
      return loaded < lastPage.totalCount ? loaded : undefined;
    },
    initialPageParam: 0,
    enabled: !!token,
    staleTime: 60_000,
  });

  const routes = routesPages?.pages.flatMap((p) => p.routes) ?? [];
  const totalCount = routesPages?.pages[0]?.totalCount ?? 0;

  // B-24: auto-load next page when the sentinel scrolls into view.
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) fetchNextPage();
      },
      { rootMargin: '400px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, routes.length]);

  // Fetch selected route detail
  const { data: selectedRoute } = useQuery<RouteData>({
    queryKey: ['route', selectedRouteId],
    queryFn: () => getRoute(selectedRouteId!, token),
    enabled: !!selectedRouteId,
    staleTime: 300_000,
  });

  // Fetch compare route data
  const { data: compareRouteAData } = useQuery<RouteData>({
    queryKey: ['route', compareRouteA],
    queryFn: () => getRoute(compareRouteA!, token),
    enabled: !!compareRouteA,
    staleTime: 300_000,
  });

  const { data: compareRouteBData } = useQuery<RouteData>({
    queryKey: ['route', compareRouteB],
    queryFn: () => getRoute(compareRouteB!, token),
    enabled: !!compareRouteB,
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
    { value: 'map', label: 'Map', icon: MapPin },
    { value: 'list', label: 'List', icon: List },
    { value: 'grid', label: 'Grid', icon: Grid3x3 },
  ] as const;

  // Active filters count
  const activeFilterCount = Object.entries(queryFilters).filter(
    ([k, v]) => k !== 'q' && v !== undefined && v !== '' && v !== null,
  ).length;

  return (
    <div className="flex h-[calc(100vh-4rem)] md:h-[calc(100vh-4rem)] h-[calc(100dvh-10rem)] overflow-hidden min-w-0">
      {/* Sidebar — desktop only; on mobile use the Organize drawer */}
      <div className="hidden lg:block flex-shrink-0 h-full">
        <RoutesSidebar
          onTagClick={() => refetch()}
          onCollectionClick={() => refetch()}
        />
      </div>

      {/* Mobile Organize drawer */}
      {showOrganize && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setShowOrganize(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-label="Organize routes"
            className="fixed inset-y-0 left-0 z-50 w-[85vw] max-w-[320px] bg-background border-r border-surface-light/50 lg:hidden flex flex-col"
          >
            <div className="flex items-center justify-between p-4 border-b border-surface-light/50">
              <h2 className="text-base font-semibold text-foreground">Organize</h2>
              <button
                onClick={() => setShowOrganize(false)}
                aria-label="Close organize panel"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-surface-light/50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <RoutesSidebar
                onTagClick={() => { refetch(); setShowOrganize(false); }}
                onCollectionClick={() => { refetch(); setShowOrganize(false); }}
              />
            </div>
          </div>
        </>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 p-4 border-b border-surface-light/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-foreground">Saved Routes</h1>
                {routes && totalCount > 0 && (
                  <span className="inline-flex items-center px-3 py-1 text-sm font-semibold bg-accent/20 text-accent rounded-full">
                    {totalCount} {totalCount === 1 ? 'route' : 'routes'}
                  </span>
                )}
              </div>
              <p className="text-muted mt-1">
                Browse, organize, and plan rides from your synced routes.
                <span className="mx-2 hidden sm:inline">•</span>
                <span className="text-xs text-muted hidden sm:inline">
                  Press 1/2/3 for Map/List/Grid · F to search · Esc to deselect
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Mobile Organize button */}
              <button
                onClick={() => setShowOrganize(true)}
                aria-label="Open organize panel"
                className="lg:hidden min-h-[44px] px-3 py-2 text-sm font-medium bg-surface-light hover:bg-surface-light/80 text-foreground rounded-lg transition-colors flex items-center gap-1"
              >
                <Folder className="w-4 h-4" />
                Organize
              </button>
              {/* View mode toggle */}
              <SegmentedControl
                ariaLabel="Route view mode"
                value={viewMode}
                onChange={setViewMode}
                options={[...viewModes]}
              />

              <button
                onClick={() => setShowImportModal(true)}
                aria-label="Upload GPX file"
                className="min-h-[44px] px-3 py-2 text-sm font-medium bg-surface-light hover:bg-surface-light/80 text-foreground rounded-lg transition-colors flex items-center gap-1"
              >
                <Upload className="w-4 h-4" />
                Upload GPX
              </button>

              <Link
                href="/routes/duplicates"
                className="min-h-[44px] px-3 py-2 text-sm font-medium bg-surface-light hover:bg-surface-light/80 text-foreground rounded-lg transition-colors flex items-center gap-1"
              >
                <Copy className="w-4 h-4" />
                Duplicates
              </Link>

               <button
                 onClick={() => syncMutation.mutate()}
                 disabled={syncMutation.isPending}
                 aria-label="Sync routes from providers"
                 className="min-h-[44px] px-3 py-2 text-sm font-medium bg-accent hover:bg-accent/80 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
               >
                 <RefreshCw className={`w-4 h-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                 {syncMutation.isPending ? 'Syncing...' : 'Sync'}
               </button>

                {viewMode === 'map' && (
                  <button
                    onClick={() => setShowHeatmap(!showHeatmap)}
                    aria-label="Toggle heatmap"
                    className={`min-h-[44px] px-3 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-1 ${
                      showHeatmap
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : 'bg-surface-light hover:bg-surface-light/80 text-foreground'
                    }`}
                  >
                    <MapPin className="w-4 h-4" />
                    {showHeatmap ? 'Hide Heatmap' : 'Heatmap'}
                  </button>
                )}

                {compareMode && (
                  <button
                    onClick={() => clearCompareRoutes()}
                    aria-label="Exit compare mode"
                    className="min-h-[44px] px-3 py-2 text-sm font-medium bg-accent/20 hover:bg-accent/30 text-accent rounded-lg transition-colors flex items-center gap-1"
                  >
                    <X className="w-4 h-4" />
                    Exit Compare
                  </button>
                )}
              </div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex-shrink-0 px-4 py-3 border-b border-surface-light/30">
          <RouteFilterBar />
        </div>

        {/* B-23 discovery tips (first run) */}
        {showTips && (
          <div className="flex-shrink-0 px-4 py-2 border-b border-surface-light/30">
            <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-accent/10 border border-accent/20 text-xs text-muted">
              <span>
                💡 Tag routes to group them, build <strong className="text-foreground">collections</strong> (smart ones auto-fill), and tick two routes to <strong className="text-foreground">compare</strong> them.
              </span>
              <button
                onClick={dismissTips}
                className="shrink-0 text-muted hover:text-foreground"
                aria-label="Dismiss routes tips"
              >
                ✕
              </button>
            </div>
          </div>
        )}

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
            <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-warning text-sm">
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
                          showHeatmap={showHeatmap}
                          compareMode={compareMode}
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
                {/* B-24 infinite-scroll sentinel (list + grid views) */}
                {(viewMode === 'list' || viewMode === 'grid') && hasNextPage && (
                  <div className="p-4 pt-0" ref={loadMoreRef}>
                    <button
                      onClick={() => fetchNextPage()}
                      disabled={isFetchingNextPage}
                      className="w-full py-2 text-sm text-muted hover:text-foreground border border-surface-light/50 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isFetchingNextPage
                        ? 'Loading…'
                        : `Show more (${routes.length} of ${totalCount})`}
                    </button>
                  </div>
                )}
              </>
            ) : isError ? (
              <div className="p-8">
                <EmptyState
                  icon="⚠️"
                  title="Failed to load routes"
                  description={routesError ? (routesError as Error)?.message : 'There was a problem fetching your routes. Try syncing again or check your connection.'}
                  action={{ label: 'Retry', onClick: () => refetch() }}
                />
              </div>
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

          {/* Route detail panel — desktop slide-over */}
          <div className="flex-shrink-0 hidden lg:block">
            <RouteDetailPanel
              route={selectedRoute ?? null}
              onClose={() => handleSelectRoute(null)}
            />
          </div>
        </div>
      </div>

      {/* Route detail panel — mobile bottom sheet */}
      <MobileRouteDetailSheet
        route={selectedRoute ?? null}
        onClose={() => handleSelectRoute(null)}
      />

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

      {/* Compare Routes Modal — only once both routes have loaded */}
      {compareMode && compareRouteAData && compareRouteBData && (
        <CompareRoutesModal
          routeA={compareRouteAData}
          routeB={compareRouteBData}
          onClose={() => clearCompareRoutes()}
        />
      )}

      {/* One-route hint: guide the user to pick a second route */}
      {compareMode && !(compareRouteAData && compareRouteBData) && (
        <div
          className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-surface border border-accent/30 rounded-xl px-4 py-3 shadow-2xl"
          role="status"
        >
          <p className="text-sm text-foreground whitespace-nowrap">Select a second route to compare</p>
          <button
            onClick={() => clearCompareRoutes()}
            className="min-h-[44px] px-3 text-sm font-medium text-accent hover:text-foreground rounded-lg transition-colors"
          >
            Exit Compare
          </button>
        </div>
      )}
    </div>
  );
}
