'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getSegments, recomputeRouteSegments, useAuthFetch } from '@/lib/api';
import type { Segment } from '@/lib/api/types';
import { SkeletonLine } from '@/components/ui/Skeleton';
import { SegmentRow } from '@/components/routes/SegmentRow';

export function SegmentsCard({ routeId }: { routeId: string }) {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();

  const { data: segments, isLoading } = useQuery<Segment[]>({
    queryKey: ['route-segments', routeId],
    queryFn: () => getSegments(authFetch, routeId),
    enabled: !!token,
    staleTime: 300_000,
  });

  const recompute = useMutation({
    mutationFn: () => recomputeRouteSegments(authFetch, routeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['route-segments', routeId] });
    },
    onError: (err: Error) => {
      console.error('[Segments] recompute failed:', err);
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <SkeletonLine className="h-4 w-36" />
        <SkeletonLine className="h-3 w-56" />
        {Array.from({ length: 2 }).map((_, i) => (
          <SkeletonLine key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (!segments) return null;

  if (segments.length === 0) {
    return (
      <div>
        <h4 className="text-xs text-muted mb-3 uppercase tracking-wider">Climb Segments</h4>
        <div className="rounded-lg bg-surface-light/40 border border-surface-light/60 p-4 text-sm text-muted">
          <p className="text-foreground font-medium mb-1">No climb segments on this route yet.</p>
          <p className="text-xs">
            Segments are detected from the route's elevation profile (sustained
            climbs ≥ ~150 m gaining ≥ ~30 m at ≥ 3% average) and populated from
            rides linked to this route. Recompute to re-run detection.
          </p>
          <button
            type="button"
            onClick={() => recompute.mutate()}
            disabled={recompute.isPending}
            className="mt-3 px-3 py-1.5 text-xs rounded-lg bg-accent text-surface hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {recompute.isPending ? 'Recomputing…' : 'Recompute'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs text-muted uppercase tracking-wider">Climb Segments</h4>
        <button
          type="button"
          onClick={() => recompute.mutate()}
          disabled={recompute.isPending}
          className="px-2.5 py-1 text-xs rounded-lg bg-surface-light/60 text-muted hover:text-foreground hover:bg-surface-light transition-colors disabled:opacity-40"
        >
          {recompute.isPending ? 'Recomputing…' : '↻ Recompute'}
        </button>
      </div>

      <div className="space-y-2">
        {segments.map((seg) => (
          <SegmentRow key={seg.id} segment={seg} />
        ))}
      </div>
    </div>
  );
}
