'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getClimbDetail, getSegmentDetail, useAuthFetch } from '@/lib/api';
import type { Segment } from '@/lib/api/types';
import { SectionLabel } from '@/components/ui/SectionLabel';
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

/**
 * Confidence as a word, not a number.
 *
 * `_predict_segment_effort` floors confidence at 0.2 and returns 0.2 whenever
 * there are no similar efforts to borrow from — which is routine, not failure.
 * Rendering "0.2" beside a prediction would read as "this prediction is broken"
 * when it actually means "there was nothing to base it on". The number is kept
 * out of the UI and only the band is shown.
 */
export function confidenceBand(confidence: number | null): {
  label: string;
  className: string;
} | null {
  if (confidence == null) return null;
  if (confidence < 0.4) {
    return {
      label: 'low confidence',
      className: 'text-muted',
    };
  }
  if (confidence < 0.7) {
    return {
      label: 'medium confidence',
      className: 'text-warning',
    };
  }
  return {
    label: 'high confidence',
    className: 'text-positive',
  };
}

/**
 * Humanize a raw `climb_type` for display.
 *
 * Known keys get their short label; anything else (e.g. `sustained_steep`)
 * is title-cased with underscores as spaces instead of leaking the raw
 * snake_case into the row. Display-only — the stored value is untouched.
 */
export function humanizeClimbType(raw: string): string {
  const known = CLIMB_TYPE_LABELS[raw];
  if (known) return known;
  return raw
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export interface SegmentBadgeItem {
  key: string;
  label: string;
  className: string;
  title?: string;
}

/**
 * The chips a row shows, de-duplicated.
 *
 * A climb typed `hc` in category `HC` would otherwise render two chips that
 * say the same thing ("Cat HC" + "HC") — the type chip is dropped when its
 * label matches the category. Pure (no hooks) so the rule is unit-testable.
 */
export function segmentBadgeItems(seg: Segment): SegmentBadgeItem[] {
  const items: SegmentBadgeItem[] = [];
  const cat = seg.climb_category ? seg.climb_category.toUpperCase() : null;
  const catStyle = cat ? CATEGORY_STYLES[cat] ?? null : null;
  if (cat && catStyle) {
    items.push({
      key: 'cat',
      label: `Cat ${cat}`,
      className: `border rounded px-1.5 py-0.5 text-xs font-bold ${catStyle}`,
    });
  }
  if (seg.climb_type) {
    const label = humanizeClimbType(seg.climb_type);
    // Merge identical chips: "HC" type on a "HC" climb adds no information.
    if (!cat || label.toLowerCase() !== cat.toLowerCase()) {
      items.push({
        key: 'type',
        label,
        className:
          'border rounded px-1.5 py-0.5 text-xs font-bold bg-blue-500/20 text-blue-400 border-blue-500/30',
      });
    }
  }
  if (seg.difficulty_score != null) {
    items.push({
      key: 'diff',
      label: `${seg.difficulty_score.toFixed(1)} diff`,
      className:
        'border rounded px-1.5 py-0.5 text-xs font-bold bg-purple-500/20 text-purple-400 border-purple-500/30',
    });
  }
  if (seg.sustainedness != null) {
    items.push({
      key: 'sust',
      label: `sust ${Math.round(seg.sustainedness * 100)}%`,
      className:
        'border rounded px-1.5 py-0.5 text-xs font-bold bg-surface border-surface-light/60 text-muted',
      title: 'Sustainedness — how evenly the gradient holds up through the climb',
    });
  }
  return items;
}

/** Cat / climb-type / difficulty chips. */
export function SegmentBadges({ seg }: { seg: Segment }) {
  return (
    <>
      {segmentBadgeItems(seg).map((b) => (
        <span key={b.key} className={b.className} title={b.title}>
          {b.label}
        </span>
      ))}
    </>
  );
}

/**
 * The prediction line: expected time and VAM for this climb.
 *
 * Rendered only when a prediction exists, and always with a tilde — it is an
 * expectation borrowed from similar climbs, not a measurement of this one.
 */
export function SegmentPrediction({ seg }: { seg: Segment }) {
  const hasTime = seg.predicted_time_seconds != null;
  const hasVam = seg.predicted_vam != null;
  if (!hasTime && !hasVam) return null;
  const band = confidenceBand(seg.prediction_confidence);

  return (
    <p className="text-xs text-muted mt-0.5 tabular-nums">
      {hasTime ? (
        <span title="Predicted time for this climb">
          pred {fmtSegTime(seg.predicted_time_seconds)}
        </span>
      ) : null}
      {hasTime && hasVam ? ' · ' : null}
      {hasVam && seg.predicted_vam != null ? (
        <span title="Predicted vertical ascent rate">
          ~{Math.round(seg.predicted_vam)} VAM
        </span>
      ) : null}
      {band ? <span className={band.className}> · {band.label}</span> : null}
    </p>
  );
}

/**
 * The merged leaderboard for one hill, across every route it appears on.
 *
 * Only mounted when `geo_cluster_size > 1` and the row is open — one request
 * for the whole hill, not one per member segment.
 */
export function ClimbDetailPanel({ geoClusterId }: { geoClusterId: string }) {
  const { authFetch, token } = useAuthFetch();

  const { data, isLoading, isError } = useQuery({
    // Domain-prefixed and keyed on the cluster, not a segment id (AGENTS
    // pitfall 11 family: `enabled` gates on the token so the query does not fire
    // before auth is ready and 401 into the void).
    queryKey: ['climb-detail', geoClusterId],
    queryFn: () => getClimbDetail(authFetch, geoClusterId),
    enabled: !!token,
    staleTime: 300_000,
  });

  if (isLoading) return <SkeletonLine className="h-10 w-full" />;
  if (isError) {
    return <p className="text-xs text-muted py-1">Could not load this climb.</p>;
  }
  if (!data || data.efforts.length === 0) {
    return (
      <p className="text-xs text-muted py-1">
        No efforts recorded for this climb yet.
      </p>
    );
  }

  return (
    <div>
      <p className="text-xs text-muted mb-1.5">
        Merged across {data.route_count} route
        {data.route_count === 1 ? '' : 's'} · ranked by VAM, since routes detect
        the same hill with slightly different windows and elapsed seconds are
        not comparable between them
      </p>
      {data.efforts.map((e, i) => (
        <div
          key={e.id}
          className="flex items-center gap-3 py-1.5 text-xs border-b border-surface-light/40 last:border-0"
        >
          <span className="w-5 text-muted">{i + 1}</span>
          <span className="flex-1 truncate text-foreground">
            {e.activity_name ?? '—'}
          </span>
          {e.is_pr ? (
            <span className="text-xs font-bold text-yellow-400">PR</span>
          ) : null}
          {/* Seconds are shown but explicitly labelled: they belong to this
              route's detection window, not a shared one. */}
          <span
            className="text-muted tabular-nums"
            title="Elapsed time for this route's detection window — not comparable across routes"
          >
            {fmtSegTime(e.elapsed_seconds)}
          </span>
          {(e.effort_vam ?? 0) > 0 ? (
            <span className="text-muted tabular-nums w-16 text-right">
              {Math.round(e.effort_vam ?? 0)} VAM
            </span>
          ) : null}
        </div>
      ))}
    </div>
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

  // A hill seen on more than one route is worth opening as a hill; a hill seen
  // on one route has nothing to merge, so the per-route leaderboard is the
  // whole story and the panel would be a duplicate request.
  const isSharedHill =
    segment.geo_cluster_id != null && segment.geo_cluster_size > 1;

  // Fill the right half: an unridden climb has no PR, but the stored
  // prediction is already on the row — show it (tilde-marked, never as a
  // measurement) instead of leaving the half empty with a bare dash.
  const hasPr = segment.pr_seconds != null;
  const showPredictedBest =
    !hasPr && segment.predicted_time_seconds != null;

  return (
    <div className="rounded-lg bg-surface-light/40 border border-surface-light/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left min-h-[44px]"
      >
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
            {/* Over-long hill names (route name + km-range) truncate; the
                full title stays one hover away. */}
            <span
              className="min-w-0 flex-1 basis-32 truncate text-xs font-semibold text-foreground"
              title={segment.name}
            >
              {segment.name}
            </span>
            <span className="flex flex-wrap items-center gap-1">
              <SegmentBadges seg={segment} />
            </span>
          </div>
          <p className="text-xs text-muted mt-0.5 tabular-nums">
            {fmtKm(segment.distance_m)} · {segment.avg_gradient_pct.toFixed(1)}% avg ·{' '}
            {segment.elevation_gain_m.toFixed(0)} m gain
          </p>
          <SegmentPrediction seg={segment} />
        </div>
        <div className="text-right shrink-0 tabular-nums">
          <p
            className={`text-sm font-semibold ${segment.has_pr ? 'text-positive' : 'text-muted'}`}
            title={
              hasPr
                ? undefined
                : showPredictedBest
                  ? 'Predicted time — no ridden effort yet, not a measurement'
                  : undefined
            }
          >
            {hasPr
              ? fmtSegTime(segment.pr_seconds)
              : showPredictedBest && segment.predicted_time_seconds != null
                ? `~${fmtSegTime(segment.predicted_time_seconds)}`
                : fmtSegTime(segment.pr_seconds)}
          </p>
          <p className="text-xs text-muted">
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
                    <span className="text-xs font-bold text-yellow-400">PR</span>
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

      {/*
        The merged view sits *below* the per-route leaderboard rather than
        replacing it, because the two answer different questions: "how did I do
        on this route's version of the hill" versus "what is my best on the hill
        at all". Collapsing them into one list would hide the per-route context
        that makes the merged number meaningful.
      */}
      {isSharedHill && open && segment.geo_cluster_id ? (
        <div className="border-t border-surface-light/60 px-3 py-2">
          <SectionLabel>Across every route</SectionLabel>
          <ClimbDetailPanel geoClusterId={segment.geo_cluster_id} />
        </div>
      ) : null}
    </div>
  );
}
