'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  GitCompareArrows,
  MapPin,
  MoreHorizontal,
  RefreshCw,
  Upload,
  FolderOpen,
  Flame,
  X,
} from 'lucide-react';
import { useAuthFetch } from '@/lib/api';
import { getHomeAreaHeatmap, getRoute, getRoutes, syncRoutes } from '@/lib/api/routes';
import { apiUpload } from '@/lib/api/fetch';
import { useDeepLink } from '@/lib/useDeepLink';
import { usePageTitle } from '@/lib/usePageTitle';
import { useRoutesStore } from '@/lib/stores/routesStore';
import type { HomeAreaHeatmapResponse, RouteFilters } from '@/lib/api/types';
import {
  EMPTY_FACETS,
  activeFacetCount,
  facetsFromParams,
  facetsToParams,
  facetsToQuery,
  findHub,
  sortRoutes,
  type Facets,
  type SortKey,
} from '@/lib/routeAtlas';
import { AtlasMap } from '@/components/routes/atlas/AtlasMap';
import { RouteList } from '@/components/routes/atlas/RouteList';
import { RouteDetail } from '@/components/routes/atlas/RouteDetail';
import { FacetBar } from '@/components/routes/atlas/FacetBar';
import { CompareRoutesModal } from '@/components/routes/CompareRoutesModal';
import { RoutesSidebar } from '@/components/routes/RoutesSidebar';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonRouteCard } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { MaintainTab } from './_components/MaintainTab';

const PAGE_LIMIT = 200;

export default function RoutesPage() {
  usePageTitle('Routes');
  const { token } = useAuthFetch();
  const queryClient = useQueryClient();
  const { getParam, setParam } = useDeepLink();
  const toast = useToast();

  const {
    selectedTagIds,
    activeCollectionId,
    setSelectedTagIds,
    setActiveCollectionId,
    compareRouteA,
    compareRouteB,
    toggleCompare,
    clearCompareRoutes,
  } = useRoutesStore();

  const [mode, setMode] = useState<'browse' | 'maintain'>('browse');
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS);
  const [sort, setSort] = useState<SortKey>('nearest');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [showCollections, setShowCollections] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [urlReady, setUrlReady] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Deep links: ?route=, ?mode=, facet params, and the legacy ?tab=duplicates.
  useEffect(() => {
    const tab = getParam('tab');
    if (tab === 'duplicates') {
      setMode('maintain');
      setParam('tab', null);
      setParam('mode', 'maintain');
    }
    if (getParam('mode') === 'maintain') setMode('maintain');
    const routeParam = getParam('route');
    if (routeParam) setSelectedId(routeParam);

    const fromUrl = facetsFromParams(window.location.search);
    setFacets(fromUrl.facets);
    setSort(fromUrl.sort);

    // Tag/collection selection is store-backed (multi-select); make it shareable.
    const tagParam = getParam('tags');
    if (tagParam) setSelectedTagIds(tagParam.split(',').filter(Boolean));
    const collectionParam = getParam('collection');
    if (collectionParam) setActiveCollectionId(collectionParam);

    setUrlReady(true);
  }, [getParam, setParam, setSelectedTagIds, setActiveCollectionId]);

  // Keep filters shareable/refresh-safe without clobbering ?route=/?mode=.
  useEffect(() => {
    if (!urlReady) return;
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(facetsToParams(facets, sort))) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    if (selectedTagIds.length > 0) params.set('tags', selectedTagIds.join(','));
    else params.delete('tags');
    if (activeCollectionId) params.set('collection', activeCollectionId);
    else params.delete('collection');

    const query = params.toString();
    window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
  }, [facets, sort, selectedTagIds, activeCollectionId, urlReady]);

  const queryFilters: RouteFilters = useMemo(
    () => ({
      ...(mode === 'browse' ? facetsToQuery(facets, sort) : { sort_by: 'created_at' }),
      tag_ids: mode === 'browse' && selectedTagIds.length > 0 ? selectedTagIds : undefined,
      collection_id: mode === 'browse' ? activeCollectionId || undefined : undefined,
      limit: PAGE_LIMIT,
      offset: 0,
    }),
    [facets, sort, selectedTagIds, activeCollectionId, mode],
  );

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['routes', 'atlas', queryFilters],
    queryFn: () => getRoutes(queryFilters, token),
    enabled: !!token,
    staleTime: 60_000,
  });

  const routes = data?.routes ?? [];
  const total = data?.totalCount ?? 0;
  const hub = useMemo(() => findHub(routes), [routes]);
  const visible = useMemo(() => sortRoutes(routes, sort, hub), [routes, sort, hub]);
  const filtersActive =
    activeFacetCount(facets) > 0 ||
    facets.q.trim().length > 0 ||
    selectedTagIds.length > 0 ||
    !!activeCollectionId;

  const { data: selectedRoute, isLoading: detailLoading } = useQuery({
    queryKey: ['route', selectedId],
    queryFn: () => getRoute(selectedId!, token),
    enabled: !!selectedId && !!token,
    staleTime: 300_000,
  });

  const { data: compareA } = useQuery({
    queryKey: ['route', compareRouteA],
    queryFn: () => getRoute(compareRouteA!, token),
    enabled: !!compareRouteA,
    staleTime: 300_000,
  });
  const { data: compareB } = useQuery({
    queryKey: ['route', compareRouteB],
    queryFn: () => getRoute(compareRouteB!, token),
    enabled: !!compareRouteB,
    staleTime: 300_000,
  });

  const { data: heatmap } = useQuery<HomeAreaHeatmapResponse>({
    queryKey: ['home-area-heatmap'],
    queryFn: () => getHomeAreaHeatmap(token),
    enabled: !!token && showHeatmap,
    staleTime: 300_000,
    retry: false,
  });

  const syncMutation = useMutation({
    mutationFn: () => syncRoutes(token),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['routes'] });
      const synced = result.reduce((sum, r) => sum + r.synced_count, 0);
      const merged = result.reduce((sum, r) => sum + r.merged_count, 0);
      toast.success(`Synced ${synced} routes (${merged} merged)`);
    },
    onError: () => toast.error('Route sync failed — check your connection and try again.'),
  });

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      setParam('route', id);
    },
    [setParam],
  );

  const changeMode = useCallback(
    (next: 'browse' | 'maintain') => {
      setMode(next);
      setParam('mode', next === 'maintain' ? 'maintain' : null);
      if (next === 'maintain') {
        setCompareMode(false);
      }
    },
    [setParam],
  );

  // Keyboard: F focuses search (does not clear it), Escape closes.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        if (event.key === 'Escape') (target as HTMLInputElement).blur();
        return;
      }
      if (event.key === 'f' || event.key === '/') {
        event.preventDefault();
        (document.querySelector('input[aria-label="Search routes"]') as HTMLInputElement)?.focus();
      }
      if (event.key === 'Escape') {
        if (selectedId) select(null);
        else if (compareMode) {
          setCompareMode(false);
          clearCompareRoutes();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, select, compareMode, clearCompareRoutes]);

  async function handleUploadGpx(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      await apiUpload('/api/v1/routes/upload-gpx', formData, token);
      queryClient.invalidateQueries({ queryKey: ['routes'] });
      setShowImport(false);
      toast.success('Route imported');
    } catch (err) {
      toast.error(`GPX upload failed: ${(err as Error)?.message || 'try again.'}`);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const compareIds = [compareRouteA, compareRouteB].filter((id): id is string => !!id);
  const showCompareModal = compareMode && compareA && compareB;

  return (
    <div className="flex h-[calc(100dvh-17.5rem)] flex-col gap-2 md:h-[calc(100dvh-8rem)] md:gap-3">
      <header className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="text-xl font-bold text-foreground md:text-2xl">Routes</h1>
          <span className="rounded-full bg-surface-light/70 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted">
            {total}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 rounded-lg border border-surface-light/70 bg-surface p-0.5">
            <button
              type="button"
              onClick={() => changeMode('browse')}
              aria-pressed={mode === 'browse'}
              className={`h-11 rounded-md px-2.5 text-xs font-medium transition-colors ${
                mode === 'browse' ? 'bg-accent text-white' : 'text-muted hover:text-foreground'
              }`}
            >
              Browse
            </button>
            <button
              type="button"
              onClick={() => changeMode('maintain')}
              aria-pressed={mode === 'maintain'}
              className={`h-11 rounded-md px-2.5 text-xs font-medium transition-colors ${
                mode === 'maintain' ? 'bg-accent text-white' : 'text-muted hover:text-foreground'
              }`}
            >
              Maintain
            </button>
          </div>

          {/* Desktop actions */}
          <div className="hidden items-center gap-1 md:flex">
            <HeaderButton
              icon={<GitCompareArrows className="h-4 w-4" />}
              label={compareMode ? 'Exit compare' : 'Compare'}
              active={compareMode}
              onClick={() => {
                setCompareMode((value) => !value);
                clearCompareRoutes();
              }}
            />
            <HeaderButton
              icon={<FolderOpen className="h-4 w-4" />}
              label="Collections"
              onClick={() => setShowCollections(true)}
            />
            <HeaderButton
              icon={<Flame className="h-4 w-4" />}
              label={showHeatmap ? 'Hide heatmap' : 'Heatmap'}
              active={showHeatmap}
              onClick={() => setShowHeatmap((value) => !value)}
            />
            <HeaderButton
              icon={<Upload className="h-4 w-4" />}
              label="GPX"
              onClick={() => setShowImport(true)}
            />
            <button
              type="button"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="flex h-11 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-white transition-colors hover:bg-accent/80 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
              {syncMutation.isPending ? 'Syncing' : 'Sync'}
            </button>
          </div>

          {/* Mobile: one menu */}
          <button
            type="button"
            onClick={() => setShowActions(true)}
            aria-label="Route actions"
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-surface-light/70 bg-surface text-muted md:hidden"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>
      </header>

      {mode === 'maintain' ? (
        <MaintainTab
          routes={routes}
          total={total}
          onOpenRoute={(id) => {
            changeMode('browse');
            select(id);
          }}
          onOpenCollections={() => setShowCollections(true)}
        />
      ) : (
        <>
          <FacetBar
            facets={facets}
            setFacets={setFacets}
            sort={sort}
            setSort={setSort}
            sports={Array.from(new Set(routes.map((r) => r.sport_type))).sort()}
            resultCount={visible.length}
          />

          {isLoading ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 md:grid md:grid-cols-[minmax(0,1fr)_400px]">
              <div className="min-h-[200px] flex-[3] animate-pulse rounded-xl bg-surface/60 md:min-h-0 md:flex-none" />
              <div className="min-h-0 flex-[2] space-y-2 overflow-hidden rounded-xl bg-surface/60 p-3 md:flex-none">
                {Array.from({ length: 4 }).map((_, index) => (
                  <SkeletonRouteCard key={index} />
                ))}
              </div>
            </div>
          ) : isError ? (
            <div className="flex flex-1 items-center justify-center rounded-xl border border-surface-light/60 bg-surface/60">
              <ErrorState
                title="Couldn't load routes"
                message="Your library is unchanged. Check your connection and try again."
                onRetry={() => refetch()}
              />
            </div>
          ) : total === 0 && !filtersActive ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={<MapPin className="w-8 h-8 text-muted" />}
                title="No routes yet"
                description="Connect Strava, Komoot or Wahoo and sync, or upload a GPX file."
                action={{ label: 'Go to Settings', href: '/settings' }}
              />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3 md:grid md:grid-cols-[minmax(0,1fr)_400px]">
              <div className="relative min-h-[200px] flex-[3] md:min-h-0 md:flex-none">
                <AtlasMap
                  routes={visible}
                  hub={hub}
                  selectedId={selectedId}
                  hoveredId={hoveredId}
                  compareIds={compareIds}
                  compareMode={compareMode}
                  heatmapPoints={showHeatmap ? heatmap?.points : undefined}
                  onSelect={compareMode ? () => undefined : select}
                  onHover={setHoveredId}
                  onCompare={toggleCompare}
                />
              </div>

              <div className="relative min-h-0 flex-[2] overflow-hidden rounded-xl border border-surface-light/60 bg-surface/70 md:flex-none">
                {selectedId ? (
                  detailLoading || !selectedRoute ? (
                    <div className="space-y-2 p-3">
                      {Array.from({ length: 4 }).map((_, index) => (
                        <SkeletonRouteCard key={index} />
                      ))}
                    </div>
                  ) : (
                    <RouteDetail
                      route={selectedRoute}
                      summary={visible.find((r) => r.id === selectedId) ?? null}
                      onClose={() => select(null)}
                    />
                  )
                ) : (
                  <RouteList
                    routes={visible}
                    total={total}
                    selectedId={selectedId}
                    compareIds={compareIds}
                    compareMode={compareMode}
                    filtersActive={filtersActive}
                    onSelect={select}
                    onHover={setHoveredId}
                    onCompare={toggleCompare}
                  />
                )}
              </div>
            </div>
          )}

          {total > PAGE_LIMIT && (
            <p className="shrink-0 text-[11px] text-muted">
              Showing the newest {PAGE_LIMIT} of {total} routes — narrow a filter to reach the rest.
            </p>
          )}

          {isFetching && !isLoading && (
            <p className="sr-only" role="status">
              Updating routes
            </p>
          )}
        </>
      )}

      {/* Compare: pick two rows, then the existing overlaid-elevation modal. */}
      {compareMode && compareIds.length === 1 && (
        <div
          className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-accent/30 bg-surface px-4 py-3 shadow-2xl md:bottom-6"
          role="status"
        >
          <p className="whitespace-nowrap text-sm text-foreground">Select a second route to compare</p>
          <button
            type="button"
            onClick={() => {
              setCompareMode(false);
              clearCompareRoutes();
            }}
            className="min-h-[44px] px-3 text-sm font-medium text-accent hover:text-foreground"
          >
            Exit compare
          </button>
        </div>
      )}

      {showCompareModal && compareA && compareB && (
        <CompareRoutesModal
          routeA={compareA}
          routeB={compareB}
          onClose={() => {
            clearCompareRoutes();
            setCompareMode(false);
          }}
        />
      )}

      {/* Collections drawer (tags + smart collections live in the sidebar). */}
      {showCollections && (
        <div className="fixed inset-0 z-[700] flex">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowCollections(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-label="Collections and tags"
            className="relative z-10 flex h-full w-[85vw] max-w-[340px] flex-col border-r border-surface-light/50 bg-background"
          >
            <div className="flex items-center justify-between border-b border-surface-light/50 p-4">
              <h2 className="text-base font-semibold text-foreground">Collections</h2>
              <button
                type="button"
                onClick={() => setShowCollections(false)}
                aria-label="Close collections"
                className="flex h-11 w-11 items-center justify-center rounded-md text-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <RoutesSidebar
                onTagClick={() => {
                  // Keep the drawer open: tags are multi-select.
                  refetch();
                }}
                onCollectionClick={() => {
                  setShowCollections(false);
                  refetch();
                }}
              />
            </div>
            {(selectedTagIds.length > 0 || activeCollectionId) && (
              <div className="border-t border-surface-light/50 p-3">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTagIds([]);
                    setActiveCollectionId(null);
                    setShowCollections(false);
                  }}
                  className="h-11 w-full rounded-lg border border-surface-light/70 text-xs font-medium text-muted hover:text-foreground"
                >
                  Clear tag / collection filter
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile action sheet */}
      <Modal
        open={showActions}
        onClose={() => setShowActions(false)}
        size="sm"
        aria-label="Route actions"
      >
        <div className="p-2">
          <div className="mb-1 flex items-center justify-between px-2 py-1">
            <h2 className="text-sm font-semibold text-foreground">Route actions</h2>
            <button
              type="button"
              onClick={() => setShowActions(false)}
              aria-label="Close actions"
              className="flex h-11 w-11 items-center justify-center rounded-md text-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <ActionRow
            icon={<GitCompareArrows className="h-4 w-4" />}
            label={compareMode ? 'Exit compare mode' : 'Compare two routes'}
            onClick={() => {
              setCompareMode((value) => !value);
              clearCompareRoutes();
              setShowActions(false);
            }}
          />
          <ActionRow
            icon={<FolderOpen className="h-4 w-4" />}
            label="Collections & tags"
            onClick={() => {
              setShowActions(false);
              setShowCollections(true);
            }}
          />
          <ActionRow
            icon={<Flame className="h-4 w-4" />}
            label={showHeatmap ? 'Hide ride heatmap' : 'Show ride heatmap'}
            onClick={() => {
              setShowHeatmap((value) => !value);
              setShowActions(false);
            }}
          />
          <ActionRow
            icon={<Upload className="h-4 w-4" />}
            label="Upload GPX"
            onClick={() => {
              setShowActions(false);
              setShowImport(true);
            }}
          />
          <ActionRow
            icon={<RefreshCw className="h-4 w-4" />}
            label={syncMutation.isPending ? 'Syncing…' : 'Sync providers'}
            onClick={() => {
              syncMutation.mutate();
              setShowActions(false);
            }}
          />
          <Link
            href="/routes?mode=maintain"
            onClick={() => {
              setShowActions(false);
              changeMode('maintain');
            }}
            className="flex h-11 items-center gap-3 rounded-lg px-3 text-sm text-foreground hover:bg-surface-light/40"
          >
            <Copy className="h-4 w-4 text-muted" />
            Library health & duplicates
          </Link>
        </div>
      </Modal>

      {/* GPX upload */}
      <Modal open={showImport} onClose={() => setShowImport(false)} aria-label="Upload GPX file">
        <div className="p-2">
          <p className="mb-4 text-sm text-muted">Upload a GPX file to create a new route.</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".gpx"
            onChange={handleUploadGpx}
            className="w-full text-sm text-muted file:mr-4 file:rounded-lg file:border-0 file:bg-accent file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-accent/80"
          />
        </div>
      </Modal>
    </div>
  );
}

function HeaderButton({
  icon,
  label,
  onClick,
  active = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-11 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
        active
          ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-surface-light/70 bg-surface text-muted hover:text-foreground'
      }`}
    >
      {icon}
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}

function ActionRow({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-foreground hover:bg-surface-light/40"
    >
      <span className="text-muted">{icon}</span>
      {label}
    </button>
  );
}
