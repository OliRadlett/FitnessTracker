'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  Download,
  Pencil,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import type { MergedRouteView, RouteData, RouteSummary } from '@/lib/api/types';
import { downloadRouteGpx, getMergedRouteView, useAuthFetch } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { ProviderIcon, PROVIDER_COLORS } from '@/components/ui/ProviderBadge';
import { RouteMap } from '@/components/maps/RouteMap';
import { ElevationProfile } from '@/components/maps/ElevationProfile';
import { SurfaceBreakdown } from '@/components/maps/SurfaceBreakdown';
import { RouteWeatherCard } from '@/components/routes/RouteWeatherCard';
import { EffortEstimateCard } from '@/components/routes/EffortEstimateCard';
import { SegmentsCard } from '@/components/routes/SegmentsCard';
import { SimilarRoutesSection } from '@/components/routes/SimilarRoutesSection';
import { RouteHistorySection } from '@/components/routes/RouteHistorySection';
import { MergedRouteMapView } from '@/components/routes/MergedRouteMapView';
import { RouteShape } from './RouteShape';
import { ElevationStrip } from './ElevationStrip';
import {
  formatClimb,
  formatDate,
  formatDuration,
  formatKm,
  hasElevation,
  providerChain,
} from '@/lib/routeAtlas';

const Route3D = dynamic(
  () => import('@/components/routes/Route3D').then((m) => m.Route3D),
  {
    ssr: false,
    loading: () => <div className="h-[320px] animate-pulse rounded bg-surface/40" />,
  },
);

/**
 * One scroll: shape -> elevation -> stats -> provenance -> rides -> actions,
 * with the deep tools folded into a native disclosure. Replaces the 7-tab
 * panel whose last four tabs could not be reached.
 */
export function RouteDetail({
  route,
  summary,
  onClose,
}: {
  route: RouteData;
  summary?: RouteSummary | null;
  onClose: () => void;
}) {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(route.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [terrainMode, setTerrainMode] = useState<'2d' | '3d'>('2d');
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    setRenaming(false);
    setRenameValue(route.name);
  }, [route.id, route.name]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const invalidate = (id: string) => {
    queryClient.invalidateQueries({ queryKey: ['routes'] });
    queryClient.invalidateQueries({ queryKey: ['route', id] });
  };

  const favouriteMutation = useMutation({
    mutationFn: (is_favorite: boolean) =>
      authFetch(`/api/v1/routes/${route.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_favorite }),
      }),
    onSuccess: () => invalidate(route.id),
    onError: (err) => toast.error(`Favourite failed: ${(err as Error)?.message || 'try again.'}`),
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) =>
      authFetch(`/api/v1/routes/${route.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      invalidate(route.id);
      setRenaming(false);
    },
    onError: (err) => toast.error(`Rename failed: ${(err as Error)?.message || 'try again.'}`),
  });

  const deleteMutation = useMutation({
    mutationFn: () => authFetch(`/api/v1/routes/${route.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] });
      toast.success('Route deleted');
      onClose();
    },
    onError: (err) => toast.error(`Delete failed: ${(err as Error)?.message || 'try again.'}`),
  });

  const providers = useMemo(() => {
    const seen = new Map<string, RouteData['sources'][number]>();
    for (const source of route.sources) {
      if (!seen.has(source.provider)) seen.set(source.provider, source);
    }
    return Array.from(seen.values());
  }, [route.sources]);

  // Terrain and surface are characteristics, not a score: show the facts and
  // leave the missing ones out (half the library has no Komoot payload).
  const terrainType = route.terrain_classification?.terrain_type;
  const terrainLabel = terrainType && terrainType !== 'unknown' ? terrainType.replace(/_/g, ' ') : null;
  const surfaceSummary = useMemo(() => {
    const entries = Object.entries(route.surface_profile ?? {})
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    const total = entries.reduce((sum, [, value]) => sum + value, 0);
    if (!total) return [];
    return entries.map(
      ([name, value]) => `${name.replace(/_/g, ' ')} ${Math.round((value / total) * 100)}%`,
    );
  }, [route.surface_profile]);

  const download = () => {
    downloadRouteGpx(route.id, route.name, token);
  };

  return (
    <aside
      role="dialog"
      aria-label={`${route.name} details`}
      className="absolute inset-0 z-[20] overflow-y-auto border border-surface-light/70 bg-surface shadow-2xl max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:top-16 max-md:z-[700] max-md:rounded-none max-md:border-x-0 md:rounded-xl"
    >
      <div className="sticky top-0 z-10 border-b border-surface-light/50 bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {renaming ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const next = renameValue.trim();
                  if (next && next !== route.name) renameMutation.mutate(next);
                  else setRenaming(false);
                }}
                className="flex items-center gap-2"
              >
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  className="min-w-0 flex-1 rounded border border-accent bg-background px-2 py-1 text-base font-semibold text-foreground outline-none"
                />
                <button type="submit" className="text-xs text-accent">
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setRenaming(false)}
                  className="text-xs text-muted"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="truncate text-base font-semibold text-foreground">{route.name}</h2>
                <button
                  type="button"
                  onClick={() => setRenaming(true)}
                  aria-label="Rename route"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-muted hover:bg-surface-light/60 hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <p className="mt-0.5 text-[11px] text-muted">
              {route.sport_type} · {route.is_loop ? 'Loop' : 'Point to point'} · {providerChain(route)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="-mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-light/60 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="space-y-3 p-3 pb-8">
        <div className="overflow-hidden rounded-lg border border-surface-light/50 bg-[#0b1115] p-2">
          <div className="flex items-center justify-center text-accent">
            <RouteShape encoded={route.encoded_polyline} width={352} height={150} strokeWidth={2.2} />
          </div>
          {hasElevation(route.elevation_profile) ? (
            <div className="mt-1 text-accent/70">
              <ElevationStrip profile={route.elevation_profile} width={320} height={44} />
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Stat label="Distance" value={formatKm(route.distance_meters)} />
          <Stat label="Climb" value={formatClimb(route.elevation_gain_meters)} />
          <Stat label="Est. time" value={formatDuration(route.estimated_time_seconds)} />
          <Stat label="Rides" value={summary ? String(summary.ride_count) : '—'} />
          <Stat
            label="Last ridden"
            value={summary?.last_ridden_date ? formatDate(summary.last_ridden_date) : 'Never'}
          />
          <Stat label="Added" value={formatDate(route.created_at)} />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {providers.map((source) => (
            <span
              key={source.provider}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] capitalize text-foreground ${
                PROVIDER_COLORS[source.provider] || 'bg-muted'
              }`}
            >
              <ProviderIcon provider={source.provider} size={12} />
              {source.provider}
            </span>
          ))}
          {(route.tags ?? []).map((tag) => (
            <span
              key={tag.id}
              className="rounded px-2 py-1 text-[11px]"
              style={{
                backgroundColor: `${tag.color || '#64748b'}33`,
                color: tag.color || '#94a3b8',
              }}
            >
              {tag.name}
            </span>
          ))}
        </div>

        {(terrainLabel || surfaceSummary.length > 0) && (
          <div className="flex flex-wrap gap-1.5 text-[11px] text-muted">
            {terrainLabel && (
              <span className="rounded bg-surface-light/40 px-2 py-1 capitalize">
                Terrain · {terrainLabel}
              </span>
            )}
            {surfaceSummary.length > 0 && (
              <span className="rounded bg-surface-light/40 px-2 py-1">
                Surface · {surfaceSummary.join(' · ')}
              </span>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => favouriteMutation.mutate(!route.is_favorite)}
            aria-pressed={route.is_favorite}
            className={`flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border text-xs font-medium transition-colors ${
              route.is_favorite
                ? 'border-amber-400/40 bg-amber-400/10 text-amber-300'
                : 'border-surface-light/70 text-muted hover:text-foreground'
            }`}
          >
            <Star className="h-4 w-4" fill={route.is_favorite ? 'currentColor' : 'none'} />
            {route.is_favorite ? 'Favourited' : 'Favourite'}
          </button>
          <button
            type="button"
            onClick={download}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-surface-light/70 text-xs font-medium text-muted transition-colors hover:text-foreground"
          >
            <Download className="h-4 w-4" />
            GPX
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete route"
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-surface-light/70 text-warning transition-colors hover:bg-warning/10"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <div>
          <RouteHistorySection routeId={route.id} />
        </div>

        <div className="rounded-lg border border-surface-light/50 bg-background/40">
          <button
            type="button"
            onClick={() => setMoreOpen((value) => !value)}
            aria-expanded={moreOpen}
            className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted transition-colors hover:text-foreground"
          >
            Map, weather, effort, segments and more
            <ChevronDown
              className={`h-4 w-4 transition-transform ${moreOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {moreOpen && (
          <div className="space-y-4 border-t border-surface-light/50 p-3">
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted">
                  Map &amp; profile
                </h4>
                <div className="flex items-center rounded border border-surface-light/60">
                  {(['2d', '3d'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setTerrainMode(mode)}
                      className={`rounded px-2 py-0.5 text-[10px] capitalize ${
                        terrainMode === mode
                          ? 'bg-accent/20 text-accent'
                          : 'text-muted hover:bg-surface-light/40'
                      }`}
                    >
                      {mode === '2d' ? '2D' : '3D'}
                    </button>
                  ))}
                </div>
              </div>
              {terrainMode === '3d' ? (
                <Route3D
                  polyline={route.encoded_polyline}
                  elevations={
                    route.elevation_profile?.elevations?.filter(
                      (v): v is number => typeof v === 'number',
                    ) ?? null
                  }
                  name={route.name}
                />
              ) : (
                <RouteMap
                  encodedPolyline={route.encoded_polyline}
                  isLoop={route.is_loop}
                  className="h-[260px]"
                />
              )}
              {route.elevation_profile?.elevations && (
                <ElevationProfile
                  encodedPolyline={route.encoded_polyline}
                  elevations={route.elevation_profile.elevations.filter(
                    (v): v is number => typeof v === 'number',
                  )}
                />
              )}
              {route.surface_profile && <SurfaceBreakdown surfaceProfile={route.surface_profile} />}
            </section>

            <Card>
              <div className="p-3">
                <RouteWeatherCard route={route} />
              </div>
            </Card>

            <Card>
              <div className="p-3">
                <EffortEstimateCard routeId={route.id} />
              </div>
            </Card>

            <Card>
              <div className="p-3">
                <SegmentsCard routeId={route.id} />
              </div>
            </Card>

            {route.sources.length > 1 && <MergedRouteDetail routeId={route.id} />}

            <Card>
              <div className="p-3">
                <SimilarRoutesSection routeId={route.id} />
              </div>
            </Card>
          </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this route?"
        description="This removes the route from your library. Rides that used it are not deleted."
        confirmLabel="Delete"
        danger
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-background/60 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-0.5 truncate text-xs font-medium tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function MergedRouteDetail({ routeId }: { routeId: string }) {
  const { token } = useAuthFetch();
  const { data, isLoading, isError } = useQuery<MergedRouteView>({
    queryKey: ['merged-route', routeId],
    queryFn: () => getMergedRouteView(routeId, token),
    enabled: !!token,
    staleTime: 300_000,
  });

  if (isLoading) {
    return <div className="h-24 animate-pulse rounded bg-surface/50" />;
  }
  if (isError || !data) {
    return <p className="text-xs text-muted">Unable to load the merged view.</p>;
  }
  return <MergedRouteMapView mergedRoute={data} />;
}
