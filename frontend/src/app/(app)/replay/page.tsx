'use client';

/**
 * 3D Replay — V2 standalone page.
 *
 * Lists cycling activities with GPS data + stream availability.
 * Each activity links to the 3D Theater via ?replay=<id> on the
 * activities page (detail view still owns the Theater component).
 */

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { Activity } from '@/lib/api';
import { usePageTitle } from '@/lib/usePageTitle';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge, getSportBadgeVariant } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { formatDistance, formatDuration, getActiveLocale } from '@/lib/utils';
import { Play } from 'lucide-react';
import Link from 'next/link';

export default function ReplayPage() {
  usePageTitle('3D Replays');
  const { authFetch, token } = useAuthFetch();

  const { data: activities, isLoading, isError } = useQuery<Activity[]>({
    queryKey: ['replay-activities'],
    queryFn: async () => {
      const result = await authFetch<Activity[]>(
        '/api/v1/activities?limit=100&sort_by=start_date&sort_order=desc&include_context=true',
      );
      return result;
    },
    enabled: !!token,
  });

  const replays = useMemo(() => {
    return activities?.filter((a) => a.has_streams && a.encoded_polyline) ?? [];
  }, [activities]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="3D Replays" subtitle="Loading your rides…" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-surface-light/50 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="3D Replays"
        subtitle={`${replays.length} ride${replays.length !== 1 ? 's' : ''} available`}
      />
      <ErrorState variant="inline" show={isError} message="Failed to load rides." />

      {!isError && replays.length === 0 ? (
        <EmptyState
          title="No rides yet"
          description="Activities with GPS data and power/cadence streams appear here."
          icon={<Play className="w-8 h-8 text-muted" />}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {replays.map((activity) => {
            const date = new Date(activity.start_date);
            const duration = activity.duration_seconds
              ? formatDuration(activity.duration_seconds)
              : '';
            return (
              <Link
                key={activity.id}
                href={`/activities?replay=${activity.id}`}
                className="group block"
              >
                <Card className="p-3 hover:border-accent/40 transition-colors">
                  <div className="flex items-start gap-3">
                    <Play className="w-5 h-5 text-accent shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={getSportBadgeVariant(activity.sport_type)}>
                          {activity.sport_type}
                        </Badge>
                        <p className="font-medium text-foreground truncate group-hover:text-accent transition-colors">
                          {activity.name || 'Untitled ride'}
                        </p>
                      </div>
                      <p className="text-sm text-muted mt-1">
                        {date.toLocaleDateString(getActiveLocale(), {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                      <div className="flex items-center gap-4 text-xs text-muted mt-2">
                        {activity.distance_meters && (
                          <span>{formatDistance(activity.distance_meters)}</span>
                        )}
                        {duration && <span>{duration}</span>}
                        {activity.tss != null && (
                          <span>TSS {activity.tss.toFixed(0)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
