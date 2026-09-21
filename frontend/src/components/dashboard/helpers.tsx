'use client';

import React from 'react';
import Link from 'next/link';
import type {
  Activity,
  LiftingSession,
} from '@/lib/api';
import { Badge, getSportBadgeVariant } from '@/components/ui/Badge';
import { SkeletonRow } from '@/components/ui/Skeleton';
import { formatDistance, formatDuration } from '@/lib/utils';

export function ActivityRow({ activity }: { activity: Activity }) {
  return (
    <Link
      href={`/activities?activity=${activity.id}`}
      className="flex items-center justify-between p-3 bg-surface-light/30 rounded-lg hover:bg-surface-light/50 transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <Badge variant={getSportBadgeVariant(activity.sport_type)}>
          {activity.sport_type}
        </Badge>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{activity.name}</p>
          <p className="text-xs text-muted">
            {new Date(activity.start_date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </p>
        </div>
      </div>
      <div className="text-right shrink-0 ml-3">
        {activity.distance_meters && !['weighttraining', 'workout', 'crossfit', 'strength_training'].includes(activity.sport_type) && (
          <p className="text-sm text-muted">{formatDistance(activity.distance_meters)}</p>
        )}
        {activity.duration_seconds && (
          <p className="text-xs text-muted">{formatDuration(activity.duration_seconds)}</p>
        )}
      </div>
    </Link>
  );
}

export function SessionRow({ session }: { session: LiftingSession }) {
  return (
    <Link
      href={`/lifting?session=${session.id}`}
      className="flex items-center justify-between p-3 bg-surface-light/30 rounded-lg hover:bg-surface-light/50 transition-colors"
    >
      <div>
        <p className="text-sm font-medium text-foreground">{session.focus || 'General'}</p>
        <p className="text-xs text-muted">
          {new Date(session.session_date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm text-purple-400">
          {session.sets?.length ?? 0} sets
        </p>
        {session.total_volume_kg !== undefined && (
          <p className="text-xs text-muted">
            {session.total_volume_kg.toLocaleString()} kg vol
          </p>
        )}
      </div>
    </Link>
  );
}

export function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2" aria-label="Loading data">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}
