'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { SimilarRoute } from '@/lib/api/types';
import { getSimilarRoutes } from '@/lib/api/routes';
import { Card, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatDistance } from '@/lib/utils';
import { fmtElevation, computeDifficulty, DifficultyBadge } from '@/lib/routeUtils';

/**
 * Read-only "Similar routes" block, sourced from the cached Modal similarity
 * graph (`GET /routes/{id}/similar`). Renders nothing until the weekly
 * `recompute_route_similarity` task has produced a graph for the user.
 */
export function SimilarRoutesSection({ routeId }: { routeId: string }) {
  const { token } = useAuthFetch();

  const { data: similar = [], isLoading } = useQuery<SimilarRoute[]>({
    queryKey: ['route-similar', routeId],
    queryFn: () => getSimilarRoutes(routeId, token),
    enabled: !!token && !!routeId,
    staleTime: 300_000,
  });

  if (isLoading || similar.length === 0) return null;

  return (
    <Card>
      <CardTitle>Similar routes</CardTitle>
      <div className="p-3 pt-0 space-y-2">
        {similar.slice(0, 5).map((item) => {
          const diff = computeDifficulty(
            item.route.elevation_gain_meters,
            item.route.distance_meters,
          );
          return (
            <div
              key={item.route.id}
              className="flex items-center justify-between gap-3 rounded border border-surface-light/40 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-foreground">{item.route.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                  <span>{formatDistance(item.route.distance_meters)}</span>
                  {item.route.elevation_gain_meters != null && (
                    <span>{fmtElevation(item.route.elevation_gain_meters)}</span>
                  )}
                  {diff && <DifficultyBadge level={diff} />}
                  {item.breakdown?.lap_ratio != null && (
                    <span>≈{item.breakdown.lap_ratio} lap route</span>
                  )}
                </div>
              </div>
              <Badge variant={item.tier === 'auto' ? 'warning' : 'muted'} className="shrink-0 text-xs">
                {Math.round(item.score * 100)}%
              </Badge>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
