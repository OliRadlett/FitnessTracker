'use client';

import { CheckSquare2, Square } from 'lucide-react';
import type { RouteSummary } from '@/lib/api/types';
import {
  formatClimb,
  formatDate,
  formatDuration,
  formatKm,
  hasShape,
  providerChain,
  riddenLabel,
} from '@/lib/routeAtlas';
import { RouteShape } from './RouteShape';

function providerTone(provider: string | undefined): string {
  switch (provider) {
    case 'strava':
      return 'text-orange-400';
    case 'komoot':
      return 'text-emerald-400';
    default:
      return 'text-slate-400';
  }
}

export function RouteRow({
  route,
  selected,
  compared,
  compareMode,
  onSelect,
  onHover,
  onCompare,
}: {
  route: RouteSummary;
  selected: boolean;
  compared: boolean;
  compareMode: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onCompare: (id: string) => void;
}) {
  const active = selected || compared;
  return (
    <button
      type="button"
      onClick={() => (compareMode ? onCompare(route.id) : onSelect(route.id))}
      onMouseEnter={() => onHover(route.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(route.id)}
      onBlur={() => onHover(null)}
      aria-pressed={active}
      className={`group flex w-full items-center gap-3 border-l-2 px-3 py-2.5 text-left transition-colors ${
        selected
          ? 'border-accent bg-accent/10'
          : compared
            ? 'border-amber-400/70 bg-amber-400/5'
            : 'border-transparent hover:border-surface-light hover:bg-surface/70'
      }`}
    >
      <span
        className={`shrink-0 rounded-md bg-[#0d1418] p-1 ${
          selected
            ? 'text-accent'
            : compared
              ? 'text-amber-300'
              : hasShape(route)
                ? 'text-slate-300'
                : 'text-slate-500'
        }`}
      >
        <RouteShape encoded={route.preview_polyline} width={84} height={54} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-foreground">{route.name}</span>
          {route.is_loop && (
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted">Loop</span>
          )}
        </span>

        <span className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted">
          <span className="tabular-nums text-foreground/90">{formatKm(route.distance_meters)}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{formatClimb(route.elevation_gain_meters)}</span>
          {route.estimated_time_seconds ? (
            <>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{formatDuration(route.estimated_time_seconds)}</span>
            </>
          ) : null}
        </span>

        <span className="mt-1 flex items-center gap-2 text-[11px] text-muted">
          <span className={route.is_ridden ? 'text-emerald-400/90' : ''}>{riddenLabel(route)}</span>
          <span aria-hidden className="text-surface-light">
            |
          </span>
          <span className={`capitalize ${providerTone(route.sources[0]?.provider)}`}>
            {providerChain(route)}
          </span>
          {route.last_ridden_date && (
            <>
              <span aria-hidden className="text-surface-light">
                |
              </span>
              <span>Last {formatDate(route.last_ridden_date)}</span>
            </>
          )}
        </span>
      </span>

      {compareMode && (
        <span className="shrink-0 text-muted" aria-hidden>
          {compared ? (
            <CheckSquare2 className="h-5 w-5 text-amber-300" />
          ) : (
            <Square className="h-5 w-5" />
          )}
        </span>
      )}
    </button>
  );
}

export function RouteList({
  routes,
  total,
  selectedId,
  compareIds,
  compareMode,
  filtersActive,
  onSelect,
  onHover,
  onCompare,
}: {
  routes: RouteSummary[];
  total: number;
  selectedId: string | null;
  compareIds: string[];
  compareMode: boolean;
  filtersActive: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onCompare: (id: string) => void;
}) {
  if (routes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium text-foreground">No routes match these filters</p>
        <p className="text-xs text-muted">
          {filtersActive
            ? 'Clear the search or a filter to see the library.'
            : total > 0
              ? `${total} routes in the library.`
              : 'Nothing here yet.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-surface-light/40 px-3 py-2">
        <p className="text-xs text-muted">
          <span className="tabular-nums text-foreground">{routes.length}</span>
          {routes.length !== total ? ` of ${total}` : ''} routes
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {routes.map((route) => (
          <RouteRow
            key={route.id}
            route={route}
            selected={selectedId === route.id}
            compared={compareIds.includes(route.id)}
            compareMode={compareMode}
            onSelect={onSelect}
            onHover={onHover}
            onCompare={onCompare}
          />
        ))}
      </div>
    </div>
  );
}
