'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { RouteHistoryResponse } from '@/lib/api/types';
import { SkeletonLine } from '@/components/ui/Skeleton';
import { formatDistance, formatDuration } from '@/lib/utils';
import Link from 'next/link';

export function RouteHistorySection({ routeId }: { routeId: string }) {
  const { authFetch, token } = useAuthFetch();

  const { data: history, isLoading } = useQuery<RouteHistoryResponse>({
    queryKey: ['route-history', routeId],
    queryFn: () => authFetch<RouteHistoryResponse>(`/api/v1/routes/${routeId}/history`),
    enabled: !!token,
    staleTime: 300_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <SkeletonLine className="h-4 w-32" />
        <SkeletonLine className="h-3 w-48" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonLine key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!history) return null;

  return (
    <div>
      <h4 className="text-xs text-muted mb-3 uppercase tracking-wider">Ride History</h4>

      {/* Summary strip */}
      <div className="flex items-center gap-4 p-3 bg-accent/10 border border-accent/20 rounded-lg mb-3">
        <div>
          <p className="text-lg font-bold text-accent">{history.total_rides}</p>
          <p className="text-xs text-muted">Total Rides</p>
        </div>
        {history.personal_best && (
          <>
            <div className="w-px h-8 bg-accent/20" />
            <div>
              <p className="text-sm font-semibold text-positive">
                {formatDuration(history.personal_best.duration_seconds)}
              </p>
              <p className="text-xs text-muted">Personal Best</p>
            </div>
            <div>
              <p className="text-sm text-white">
                {new Date(history.personal_best.date).toLocaleDateString()}
              </p>
              <p className="text-xs text-muted">PB Date</p>
            </div>
            {history.personal_best.average_power != null && (
              <div>
                <p className="text-sm text-yellow-400">{Math.round(history.personal_best.average_power)} W</p>
                <p className="text-xs text-muted">PB Avg Power</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Rides table */}
      {history.rides.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted border-b border-surface-light/50">
                <th className="text-left py-2 pr-3">Date</th>
                <th className="text-right py-2 px-3">Duration</th>
                <th className="text-right py-2 px-3">Distance</th>
                <th className="text-right py-2 px-3">Avg Power</th>
                <th className="text-right py-2 pl-3">TSS</th>
              </tr>
            </thead>
            <tbody>
              {history.rides.map((ride) => (
                <tr key={ride.activity_id} className="border-b border-surface-light/30 hover:bg-surface-light/20">
                  <td className="py-2 pr-3 text-white">
                    <Link
                      href={`/activities?activity=${ride.activity_id}`}
                      className="hover:text-accent transition-colors"
                      title="View this ride in Activities"
                    >
                      {new Date(ride.date).toLocaleDateString()}
                    </Link>
                  </td>
                  <td className="py-2 px-3 text-right text-muted">
                    {ride.duration_seconds ? formatDuration(ride.duration_seconds) : '—'}
                  </td>
                  <td className="py-2 px-3 text-right text-muted">
                    {ride.distance_meters ? formatDistance(ride.distance_meters) : '—'}
                  </td>
                  <td className="py-2 px-3 text-right text-yellow-400">
                    {ride.average_power != null ? `${Math.round(ride.average_power)} W` : '—'}
                  </td>
                  <td className="py-2 pl-3 text-right text-blue-400">
                    {ride.tss != null ? Math.round(ride.tss) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted">No rides recorded on this route yet</p>
      )}
    </div>
  );
}
