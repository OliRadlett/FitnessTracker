'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  getSegments,
  getSegmentDetail,
  recomputeRouteSegments,
  useAuthFetch,
} from '@/lib/api';
import type { Segment, SegmentDetail } from '@/lib/api/types';
import { SkeletonLine } from '@/components/ui/Skeleton';

const CATEGORY_STYLES: Record<string, string> = {
  HC: 'bg-red-600/20 text-red-400 border-red-600/30',
  '1': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  '2': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  '3': 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  '4': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};

function fmtSegTime(seconds: number | null): string {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtKm(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

export function SegmentsCard({ routeId }: { routeId: string }) {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SegmentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const { data: segments, isLoading } = useQuery<Segment[]>({
    queryKey: ['route-segments', routeId],
    queryFn: () => getSegments(authFetch, routeId),
    enabled: !!token,
    staleTime: 300_000,
  });

  const recompute = useMutation({
    mutationFn: () => recomputeRouteSegments(authFetch, routeId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['route-segments', routeId] });
      setExpandedId(null);
      console.log(`[Segments] recomputed ${res.recomputed} segment(s)`);
    },
    onError: (err: Error) => {
      console.error('[Segments] recompute failed:', err);
    },
  });

  const toggleDetail = async (segmentId: string) => {
    if (expandedId === segmentId) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(segmentId);
    setDetail(null);
    setDetailLoading(true);
    try {
      setDetail(await getSegmentDetail(authFetch, segmentId));
    } finally {
      setDetailLoading(false);
    }
  };

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
          <p className="text-white font-medium mb-1">No climb segments on this route yet.</p>
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
          className="px-2.5 py-1 text-xs rounded-lg bg-surface-light/60 text-muted hover:text-white hover:bg-surface-light transition-colors disabled:opacity-40"
        >
          {recompute.isPending ? 'Recomputing…' : '↻ Recompute'}
        </button>
      </div>

      <div className="space-y-2">
        {segments.map((seg) => {
          const cat = seg.climb_category ? seg.climb_category.toUpperCase() : null;
          const catStyle = cat ? CATEGORY_STYLES[cat] ?? null : null;
          const isOpen = expandedId === seg.id;
          return (
            <div
              key={seg.id}
              className="rounded-lg bg-surface-light/40 border border-surface-light/60"
            >
              <button
                type="button"
                onClick={() => toggleDetail(seg.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-white truncate">
                      {seg.name}
                    </span>
                    {cat && catStyle && (
                      <span
                        className={`border rounded px-1.5 py-0.5 text-[10px] font-bold ${catStyle}`}
                      >
                        Cat {cat}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted mt-0.5">
                    {fmtKm(seg.distance_m)} · {seg.avg_gradient_pct.toFixed(1)}% avg ·{' '}
                    {seg.elevation_gain_m.toFixed(0)} m gain
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p
                    className={`text-sm font-semibold ${seg.has_pr ? 'text-positive' : 'text-muted'}`}
                  >
                    {fmtSegTime(seg.pr_seconds)}
                  </p>
                  <p className="text-[10px] text-muted">
                    {seg.times_ridden} ride{seg.times_ridden === 1 ? '' : 's'}{' '}
                    {seg.best_avg_power_watts ? `· ${Math.round(seg.best_avg_power_watts)} W` : ''}
                  </p>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-surface-light/60 px-3 py-2">
                  {detailLoading ? (
                    <SkeletonLine className="h-10 w-full" />
                  ) : detail && detail.efforts.length > 0 ? (
                    <div>
                      {detail.efforts.map((e, i) => (
                        <div
                          key={e.id}
                          className="flex items-center gap-3 py-1.5 text-xs border-b border-surface-light/40 last:border-0"
                        >
                          <span className="w-5 text-muted">{i + 1}</span>
                          <span className="flex-1 truncate text-white">
                            {e.activity_name ?? '—'}
                          </span>
                          {e.is_pr && (
                            <span className="text-[10px] font-bold text-yellow-400">PR</span>
                          )}
                          <span className="text-muted tabular-nums">
                            {fmtSegTime(e.elapsed_seconds)}
                          </span>
                          {e.avg_power_watts != null && (
                            <span className="text-muted tabular-nums w-16 text-right">
                              {Math.round(e.avg_power_watts)} W
                            </span>
                          )}
                          {(e.effort_vam ?? 0) > 0 && (
                            <span className="text-muted tabular-nums w-16 text-right">
                              {Math.round(e.effort_vam ?? 0)} VAM
                            </span>
                          )}
                          {e.started_at && (
                            <span className="text-muted w-24 text-right hidden sm:inline">
                              {new Date(e.started_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted py-1">
                      No efforts recorded — link rides to this route to build the leaderboard.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}