'use client';

import { useRoutesStore } from '@/lib/stores/routesStore';
import type { RouteSummary } from '@/lib/api/types';
import { Card } from '@/components/ui/Card';
import { Badge, getSportBadgeVariant } from '@/components/ui/Badge';
import { ProviderIcon, PROVIDER_COLORS } from '@/components/ui/ProviderBadge';
import { QualityBadge } from '@/components/routes/QualityBadge';
import { computeDifficulty, DifficultyBadge, fmtElevation, fmtDurationShort } from '@/lib/routeUtils';
import { formatDistance } from '@/lib/utils';

export function RoutesGridView({
  routes,
  onSelect,
}: {
  routes: RouteSummary[];
  onSelect: (route: RouteSummary) => void;
}) {
  const { selectedRouteId, toggleCompare } = useRoutesStore();

  if (routes.length === 0) {
    return (
      <div className="text-center py-12 text-muted">
        <p className="text-4xl mb-3">🗺️</p>
        <p>No routes match your current filters</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {routes.map((route) => {
        const diff = computeDifficulty(route.elevation_gain_meters, route.distance_meters);
        const isSelected = selectedRouteId === route.id;

        return (
          <Card
            key={route.id}
            className={`cursor-pointer transition-all hover:shadow-lg ${
              isSelected ? 'border-accent ring-1 ring-accent/30' : ''
            }`}
          >
            <div className="p-4" onClick={() => onSelect(route)}>
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-white font-medium text-sm truncate flex-1">
                  {route.name}
                  {route.is_favorite && <span className="text-yellow-400 ml-1">★</span>}
                </h3>
                {route.quality_score != null && (
                  <QualityBadge score={route.quality_score} size="sm" />
                )}
              </div>

              <Badge
                variant={getSportBadgeVariant(route.sport_type)}
                className="text-xs"
              >
                {route.sport_type}
              </Badge>

              <div className="mt-3 space-y-2 text-sm text-muted">
                <div className="flex justify-between">
                  <span>Distance</span>
                  <span className="text-white">{formatDistance(route.distance_meters)}</span>
                </div>
                {route.elevation_gain_meters && (
                  <div className="flex justify-between">
                    <span>Elevation</span>
                    <span className="text-white">{fmtElevation(route.elevation_gain_meters)}</span>
                  </div>
                )}
                {route.estimated_time_seconds && (
                  <div className="flex justify-between">
                    <span>Est. Time</span>
                    <span className="text-white">{fmtDurationShort(route.estimated_time_seconds)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Rides</span>
                  <span className="text-white">{route.ride_count > 0 ? `⛽ ${route.ride_count}` : 'New'}</span>
                </div>
              </div>

              {diff && (
                <div className="mt-3">
                  <DifficultyBadge level={diff} />
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-1">
                {Array.from(
                  new Map(route.sources.map((s) => [s.provider, s])).values()
                ).map((s) => (
                  <span
                    key={s.provider}
                    className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full text-white ${
                      PROVIDER_COLORS[s.provider] || 'bg-gray-500'
                    }`}
                    title={s.provider}
                  >
                    <ProviderIcon provider={s.provider} size={10} />
                  </span>
                ))}
              </div>

              {/* Compare checkbox */}
              <div
                className="mt-3 pt-2 border-t border-surface-light/30 flex justify-between items-center"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCompare(route.id);
                }}
              >
                <label className="flex items-center gap-1 text-xs text-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={false}
                    readOnly
                    className="w-3 h-3 rounded border-surface-light bg-surface-light text-accent focus:ring-accent focus:ring-offset-0 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCompare(route.id);
                    }}
                  />
                  <span>Compare</span>
                </label>
                {route.is_loop && (
                  <Badge variant="muted" className="text-xs">
                    🔄 Loop
                  </Badge>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
