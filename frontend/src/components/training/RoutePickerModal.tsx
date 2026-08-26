'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { RouteSummary } from '@/lib/api';
import { Modal, ModalHeader } from '@/components/ui/Modal';

interface RoutePickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (routeId: string) => void;
  onUnassign: () => void;
  currentRouteId?: string | null;
  /** Pre-filter to cycling routes only */
  sportType?: string;
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function formatElevation(meters?: number): string {
  if (!meters) return '—';
  return `${Math.round(meters)} m`;
}

export function RoutePickerModal({
  open,
  onClose,
  onSelect,
  onUnassign,
  currentRouteId,
  sportType = 'cycling',
}: RoutePickerModalProps) {
  const { authFetch } = useAuthFetch();
  const [search, setSearch] = useState('');
  const [minDist, setMinDist] = useState('');
  const [maxDist, setMaxDist] = useState('');

  const { data: routes, isLoading } = useQuery<RouteSummary[]>({
    queryKey: ['route-picker', search, minDist, maxDist, sportType],
    queryFn: () => {
      const params = new URLSearchParams();
      if (sportType) params.append('sport_type', sportType);
      if (search) params.append('q', search);
      if (minDist) params.append('min_distance', String(parseFloat(minDist) * 1000));
      if (maxDist) params.append('max_distance', String(parseFloat(maxDist) * 1000));
      params.append('limit', '200');
      params.append('sort_by', 'ride_count');
      params.append('sort_order', 'desc');
      return authFetch<RouteSummary[]>(`/api/v1/routes/?${params.toString()}`);
    },
    enabled: open,
    staleTime: 60_000,
  });

  const handleSelect = (routeId: string) => {
    onSelect(routeId);
    onClose();
  };

  const handleUnassign = () => {
    onUnassign();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} size="xl" aria-label="Pick a route">
      <ModalHeader title="Pick a Route" onClose={onClose} icon="🗺️" />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          type="text"
          placeholder="Search routes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 bg-background border border-surface-light rounded-lg text-white text-sm focus:outline-none focus:border-accent"
        />
        <input
          type="number"
          placeholder="Min km"
          value={minDist}
          onChange={(e) => setMinDist(e.target.value)}
          className="w-24 px-3 py-2 bg-background border border-surface-light rounded-lg text-white text-sm focus:outline-none focus:border-accent"
          step="0.5"
          min="0"
        />
        <input
          type="number"
          placeholder="Max km"
          value={maxDist}
          onChange={(e) => setMaxDist(e.target.value)}
          className="w-24 px-3 py-2 bg-background border border-surface-light rounded-lg text-white text-sm focus:outline-none focus:border-accent"
          step="0.5"
          min="0"
        />
      </div>

      {/* Unassign button */}
      {currentRouteId && (
        <button
          onClick={handleUnassign}
          className="mb-3 px-3 py-1.5 text-xs font-medium text-warning hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
        >
          Remove assigned route
        </button>
      )}

      {/* Route list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-accent" />
        </div>
      ) : routes && routes.length > 0 ? (
        <div className="space-y-1 max-h-[50vh] overflow-y-auto">
          {routes.map((route) => (
            <button
              key={route.id}
              onClick={() => handleSelect(route.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                route.id === currentRouteId
                  ? 'bg-accent/20 border border-accent/30'
                  : 'hover:bg-surface-light/30'
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{route.name}</p>
                <div className="flex items-center gap-3 text-xs text-muted mt-0.5">
                  <span>{formatDistance(route.distance_meters)}</span>
                  <span>↗ {formatElevation(route.elevation_gain_meters)}</span>
                  {route.is_loop && <span className="text-accent">Loop</span>}
                  {route.ride_count > 0 && (
                    <span>{route.ride_count} ride{route.ride_count !== 1 ? 's' : ''}</span>
                  )}
                </div>
              </div>
              {route.id === currentRouteId && (
                <span className="text-xs text-accent font-medium">Assigned</span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center py-8">
          <p className="text-sm text-muted">No routes found</p>
        </div>
      )}
    </Modal>
  );
}
