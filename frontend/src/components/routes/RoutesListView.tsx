'use client';

import type { RouteSummary } from '@/lib/api/types';
import { Card } from '@/components/ui/Card';
import { Badge, getSportBadgeVariant } from '@/components/ui/Badge';
import { ProviderIcon, PROVIDER_COLORS } from '@/components/ui/ProviderBadge';
import { QualityBadge } from '@/components/routes/QualityBadge';
import { computeDifficulty, DifficultyBadge, fmtElevation, fmtDurationShort } from '@/lib/routeUtils';
import { formatDistance } from '@/lib/utils';
import { useRoutesStore } from '@/lib/stores/routesStore';

const RouteRow = ({
  route,
  onSelect,
}: {
  route: RouteSummary;
  onSelect: (route: RouteSummary) => void;
}) => {
  const diff = computeDifficulty(route.elevation_gain_meters, route.distance_meters);
  const { compareRouteA, compareRouteB, toggleCompare } = useRoutesStore();
  const isCompareSelected = compareRouteA === route.id || compareRouteB === route.id;

  return (
    <Card
      onClick={() => onSelect(route)}
      className="mx-3 my-2 cursor-pointer transition-all hover:border-accent/50"
    >
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-foreground font-medium truncate flex-1 min-w-0">{route.name}</h3>
              {route.is_favorite && (
                <span className="text-yellow-400 text-xs">★</span>
              )}
              {route.quality_score != null && (
                <QualityBadge score={route.quality_score} size="sm" />
              )}
              <label
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] -m-2 rounded-lg cursor-pointer hover:bg-surface-light/50"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={isCompareSelected}
                  onChange={() => toggleCompare(route.id)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
                  }}
                  aria-label={`Compare ${route.name}`}
                  className="w-4 h-4 accent-accent cursor-pointer"
                />
              </label>
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge variant={getSportBadgeVariant(route.sport_type)}>
                {route.sport_type}
              </Badge>
              {Array.from(
                new Map(route.sources.map((s) => [s.provider, s])).values()
              ).map((s) => (
                <span
                  key={s.provider}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full text-foreground ${
                    PROVIDER_COLORS[s.provider] || 'bg-muted'
                  }`}
                >
                  <ProviderIcon provider={s.provider} size={12} /> {s.provider}
                </span>
              ))}
              {route.is_loop && <Badge variant="positive">Loop</Badge>}
              {route.ride_count > 0 ? (
                <Badge variant="positive">✓ Ridden ({route.ride_count})</Badge>
              ) : (
                <Badge variant="muted">New</Badge>
              )}
              {route.tags && route.tags.length > 0 && (
                <div className="flex gap-1">
                  {route.tags.slice(0, 2).map((tag) => (
                    <span
                      key={tag.id}
                      className="text-xs px-1.5 py-0.25 rounded"
                      style={{
                        backgroundColor: `${tag.color || '#64748b'}33`,
                        color: tag.color || '#94a3b8',
                      }}
                    >
                      {tag.name}
                    </span>
                  ))}
                  {route.tags.length > 2 && (
                    <span className="text-xs text-muted">+{route.tags.length - 2}</span>
                  )}
                </div>
              )}
              {diff && <DifficultyBadge level={diff} />}
            </div>
          </div>

          <div className="flex items-center gap-4 text-sm text-muted flex-wrap ml-4 min-w-0 max-w-[62%]">
            <span>📏 {formatDistance(route.distance_meters)}</span>
            {route.elevation_gain_meters && (
              <span>⛰️ {fmtElevation(route.elevation_gain_meters)}</span>
            )}
            {route.estimated_time_seconds && (
              <span>⏱️ {fmtDurationShort(route.estimated_time_seconds)}</span>
            )}
            {route.last_ridden_date && (
              <span className="text-xs text-accent">
                🚴 {new Date(route.last_ridden_date).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
};

export function RoutesListView({
  routes,
  onSelect,
}: {
  routes: RouteSummary[];
  onSelect: (route: RouteSummary) => void;
}) {
  if (routes.length === 0) {
    return null;
  }

  return (
    <div className="divide-y divide-surface-light/30">
      {routes.map((route) => (
        <RouteRow key={route.id} route={route} onSelect={onSelect} />
      ))}
    </div>
  );
}
