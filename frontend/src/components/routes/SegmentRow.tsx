'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getSegmentDetail, useAuthFetch } from '@/lib/api';
import type { Segment } from '@/lib/api/types';
import { SkeletonLine } from '@/components/ui/Skeleton';
import { getActiveLocale } from '@/lib/utils';

export const CATEGORY_STYLES: Record<string, string> = {
  HC: 'bg-red-600/20 text-red-400 border-red-600/30',
  '1': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  '2': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  '3': 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  '4': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};

export const CLIMB_TYPE_LABELS: Record<string, string> = {
  kick: 'Steep Kick',
  punchy: 'Punchy',
  steady: 'Steady',
  wall: 'Wall',
  hc: 'HC',
};

export function fmtSegTime(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtKm(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Cat / climb-type / difficulty chips. */
export function SegmentBadges({ seg }: { seg: Segment }) {
  const cat = seg.climb_category ? seg.climb_category.toUpperCase() : null;
  const catStyle = cat ? CATEGORY_STYLES[cat] ?? null : null;
  return (
    <>
      {cat && catStyle ? (
        <span className={`border rounded px-1.5 py-0.5 text-[10px] font-bold ${catStyle}`}>
          Cat {cat}
        </span>
      ) : null}
      {seg.climb_type ? (
        <span className="border rounded px-1.5 py-0.5 text-[10px] font-bold bg-blue-500/20 text-blue-400 border-blue-500/30">
          {CLIMB_TYPE_LABELS[seg.climb_type] ?? seg.climb_type}
        </span>
      ) : null}
      {seg.difficulty_score != null ? (
        <span className="border rounded px-1.5 py-0.5 text-[10px] font-bold bg-purple-500/20 text-purple-400 border-purple-500/30">
          {seg.difficulty_score.toFixed(1)} diff
        </span>
      ) : null}
    </>
  );
}

/**
 * One climb segment, expandable to the leaderboard-of-self.
 *
 * Owns its own `getSegmentDetail` query (keyed per segment) so a list of 200
 * segments issues one request for the row the user actually opens, and the
 * result is cached per segment rather than held in a single parent's state —
 * which is what previously made a single expanded row the limit.
 */
export function SegmentRow({ segment }: { segment: Segment }) {
  const { authFetch, token } = useAuthFetch();
  const [open, setOpen] = useState(false);

  const { data: detail, isLoading } = useQuery({
    queryKey: ['segment-detail', segment.id],
    queryFn: () => getSegmentDetail(authFetch, segment.id),
    enabled: open && !!token,
    staleTime: 300_000,
  });

  return (
    <div className="rounded-lg bg-surface-light/40 border border-surface-light/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground truncate">{segment.name}</span>
            <SegmentBadges seg={segment} />
          </div>
          <p className="text-[11px] text-muted mt-0.5">
            {fmtKm(segment.distance_m)} · {segment.avg_gradient_pct.toFixed(1)}% avg ·{' '}
            {segment.elevation_gain_m.toFixed(0)} m gain
          </p>
        </div>
        <div className="text-right shrink-0">
          <p
            className={`text-sm font-semibold ${segment.has_pr ? 'text-positive' : 'text-muted'}`}
          >
            {fmtSegTime(segment.pr_seconds)}
          </p>
          <p className="text-[10px] text-muted">
            {segment.times_ridden} ride{segment.times_ridden === 1 ? '' : 's'}{' '}
            {segment.best_avg_power_watts
              ? `· ${Math.round(segment.best_avg_power_watts)} W`
              : ''}
          </p>
        </div>
      </button>

      {open ? (
        <div className="border-t border-surface-light/60 px-3 py-2">
          {isLoading ? (
            <SkeletonLine className="h-10 w-full" />
          ) : detail && detail.efforts.length > 0 ? (
            <div>
              {detail.efforts.map((e, i) => (
                <div
                  key={e.id}
                  className="flex items-center gap-3 py-1.5 text-xs border-b border-surface-light/40 last:border-0"
                >
                  <span className="w-5 text-muted">{i + 1}</span>
                  <span className="flex-1 truncate text-foreground">
                    {e.activity_name ?? '—'}
                  </span>
                  {e.is_pr ? (
                    <span className="text-[10px] font-bold text-yellow-400">PR</span>
                  ) : null}
                  <span className="text-muted tabular-nums">{fmtSegTime(e.elapsed_seconds)}</span>
                  {e.avg_power_watts != null ? (
                    <span className="text-muted tabular-nums w-16 text-right">
                      {Math.round(e.avg_power_watts)} W
                    </span>
                  ) : null}
                  {(e.effort_vam ?? 0) > 0 ? (
                    <span className="text-muted tabular-nums w-16 text-right">
                      {Math.round(e.effort_vam ?? 0)} VAM
                    </span>
                  ) : null}
                  {e.started_at ? (
                    <span className="text-muted w-24 text-right hidden sm:inline">
                      {new Date(e.started_at).toLocaleDateString(getActiveLocale())}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted py-1">
              No efforts recorded — link rides to this route to build the leaderboard.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
