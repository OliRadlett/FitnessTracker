'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { RouteData } from '@/lib/api/types';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { TabGroup } from '@/components/ui/TabGroup';
import { ProviderIcon, PROVIDER_COLORS } from '@/components/ui/ProviderBadge';
import { QualityBadge } from '@/components/routes/QualityBadge';
import { EffortEstimateCard } from '@/components/routes/EffortEstimateCard';
import { RouteMap } from '@/components/maps/RouteMap';
import { ElevationProfile } from '@/components/maps/ElevationProfile';
import { SurfaceBreakdown } from '@/components/maps/SurfaceBreakdown';
import { RouteHistorySection } from '@/components/routes/RouteHistorySection';
import { RouteWeatherCard } from '@/components/routes/RouteWeatherCard';
import { computeDifficulty, DifficultyBadge, fmtElevation, fmtDurationShort } from '@/lib/routeUtils';
import { formatDistance } from '@/lib/utils';
import { X, Edit2, Download, Trash2, Star } from 'lucide-react';

interface RouteDetailPanelProps {
  route: RouteData | null;
  onClose: () => void;
  onOpenWeatherTab?: () => void;
}

export function RouteDetailPanel({ route, onClose, onOpenWeatherTab }: RouteDetailPanelProps) {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [detailTab, setDetailTab] = useState<'overview' | 'map' | 'history'>('overview');

  const deleteMutation = useMutation({
    mutationFn: (id: string) => authFetch(`/api/v1/routes/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] });
      onClose();
    },
  });

  const favoriteMutation = useMutation({
    mutationFn: ({ id, is_favorite }: { id: string; is_favorite: boolean }) =>
      authFetch(`/api/v1/routes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_favorite }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] });
      queryClient.invalidateQueries({ queryKey: ['route', route?.id] });
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      authFetch(`/api/v1/routes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] });
      queryClient.invalidateQueries({ queryKey: ['route', route?.id] });
      setIsRenaming(false);
    },
  });

  if (!route) {
    return (
      <div className="w-full max-w-sm lg:max-w-md bg-surface border-l border-surface-light flex flex-col">
        <div className="p-6 border-b border-surface-light flex justify-between items-center">
          <h2 className="text-lg font-semibold text-white">Route Details</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center text-muted">
          <p>Select a route to view details</p>
        </div>
      </div>
    );
  }

  const diff = computeDifficulty(route.elevation_gain_meters, route.distance_meters);

  return (
    <div className="w-full max-w-sm lg:max-w-md bg-surface border-l border-surface-light flex flex-col overflow-y-auto">
      <div className="sticky top-0 z-10 bg-surface border-b border-surface-light p-4 flex justify-between items-center">
        <h2 className="text-lg font-semibold text-white truncate pr-2">
          Route Details
        </h2>
        <button
          onClick={onClose}
          className="text-muted hover:text-white transition-colors"
          aria-label="Close details"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-4">
          {/* Header with name + actions */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {isRenaming ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (renameValue.trim() && renameValue.trim() !== route.name) {
                      renameMutation.mutate({ id: route.id, name: renameValue.trim() });
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
                  />
                  <button type="submit" className="text-xs text-accent hover:text-accent/80">
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
                  <CardTitle>{route.name}</CardTitle>
                  <button
                    onClick={() => {
                      setRenameValue(route.name);
                      setIsRenaming(true);
                    }}
                    className="text-xs text-muted hover:text-accent transition-colors"
                    aria-label="Rename route"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                </>
              )}
              {diff && <DifficultyBadge level={diff} />}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => favoriteMutation.mutate({ id: route.id, is_favorite: !route.is_favorite })}
                className={`p-1.5 rounded transition-colors ${
                  route.is_favorite
                    ? 'text-yellow-400 hover:text-yellow-300 bg-surface-light/50'
                    : 'text-muted hover:text-white bg-surface-light/50'
                }`}
                aria-label={route.is_favorite ? 'Unfavorite' : 'Favorite'}
              >
                <Star className="w-4 h-4" fill={route.is_favorite ? 'currentColor' : 'none'} />
              </button>
              <button
                onClick={() => {
                  const link = document.createElement('a');
                  link.href = `/api/v1/routes/${route.id}/gpx`;
                  link.download = `${route.name}.gpx`;
                  link.target = '_blank';
                  link.rel = 'noopener noreferrer';
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
                aria-label="Download GPX"
                className="p-1.5 text-muted hover:text-white bg-surface-light/50 hover:bg-surface-light rounded transition-colors"
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  if (confirm('Delete this route? This cannot be undone.')) {
                    deleteMutation.mutate(route.id);
                  }
                }}
                aria-label="Delete route"
                className="p-1.5 text-warning hover:text-red-300 hover:bg-red-500/10 bg-surface-light/50 rounded transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Quality badge */}
          {route.quality_score != null && (
            <div className="flex items-center gap-2">
              <QualityBadge score={route.quality_score} showLabel />
              <span className="text-xs text-muted">overall route quality</span>
            </div>
          )}

          {/* Quick stats */}
          <div className="flex flex-wrap gap-4 text-sm text-muted">
            <span>📏 {formatDistance(route.distance_meters)}</span>
            {route.elevation_gain_meters && (
              <span>⛰️ {fmtElevation(route.elevation_gain_meters)}</span>
            )}
            {route.estimated_time_seconds && (
              <span>⏱️ {fmtDurationShort(route.estimated_time_seconds)}</span>
            )}
            <span>{route.is_loop ? '🔄 Loop' : '➡️ Point to Point'}</span>
            {route.country && (
              <span>📍 {route.locality ? `${route.locality}, ` : ''}{route.country}</span>
            )}
          </div>

          {/* Provider sources */}
          <div>
            <h4 className="text-xs text-muted mb-2 uppercase tracking-wider">Provider Sources</h4>
            <div className="flex flex-wrap gap-2">
              {route.sources.map((s) => (
                <span
                  key={s.id}
                  className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-white ${
                    PROVIDER_COLORS[s.provider] || 'bg-gray-500'
                  }`}
                >
                  <ProviderIcon provider={s.provider} size={14} /> {s.provider_name}
                  <span className="text-white/60 text-[10px]">({s.provider})</span>
                </span>
              ))}
            </div>
          </div>

          {/* Tags */}
          {route.tags && route.tags.length > 0 && (
            <div>
              <h4 className="text-xs text-muted mb-2 uppercase tracking-wider">Tags</h4>
              <div className="flex flex-wrap gap-1.5">
                {route.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="text-xs px-2 py-1 rounded"
                    style={{
                      backgroundColor: `${tag.color || '#64748b'}33`,
                      color: tag.color || '#94a3b8',
                    }}
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Detail Tabs */}
          <Card>
            <div className="px-4 pb-2 pt-4">
              <TabGroup
                tabs={[
                  { key: 'overview', label: 'Overview' },
                  { key: 'map', label: 'Map & Profile' },
                  { key: 'history', label: 'History' },
                ]}
                active={detailTab}
                onChange={(key) => setDetailTab(key as typeof detailTab)}
              />
            </div>

            {/* Overview Tab */}
            {detailTab === 'overview' && (
              <div className="px-4 pb-4 space-y-4">
                <EffortEstimateCard routeId={route.id} distanceMeters={route.distance_meters} />
              </div>
            )}

            {/* Map & Profile Tab */}
            {detailTab === 'map' && (
              <div className="px-4 pb-4 space-y-4">
                <RouteMap
                  encodedPolyline={route.encoded_polyline}
                  isLoop={route.is_loop}
                  className="h-[300px]"
                />
                {route.elevation_profile?.elevations && (
                  <ElevationProfile
                    encodedPolyline={route.encoded_polyline}
                    elevations={route.elevation_profile.elevations}
                  />
                )}
                {route.surface_profile ? (
                  <SurfaceBreakdown surfaceProfile={route.surface_profile} />
                ) : (
                  <p className="text-xs text-muted">Surface data not available for this route</p>
                )}
              </div>
            )}

            {/* History Tab */}
            {detailTab === 'history' && (
              <div className="px-4 pb-4">
                <RouteHistorySection routeId={route.id} />
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
