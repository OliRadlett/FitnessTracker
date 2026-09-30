'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  dismissOrphan,
  getOrphanCandidates,
  keepOrphan,
  mergeRoutes,
} from '@/lib/api/routes';
import type { OrphanBucket, OrphanReviewRow } from '@/lib/api/types';
import { useAuthFetch } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/ErrorState';
import { useToast } from '@/components/ui/Toast';
import { GitMerge, X, Undo2, AlertTriangle, MapPin } from 'lucide-react';

const BUCKET_LABEL: Record<OrphanBucket, string> = {
  near_certain: 'Near-certain match',
  likely: 'Likely match',
  ambiguous: 'Ambiguous',
  distinct: 'Probably distinct',
  unscorable: 'No geometry — cannot compare',
};

const BUCKET_STYLE: Record<OrphanBucket, string> = {
  near_certain: 'bg-positive/15 text-positive border-positive/30',
  likely: 'bg-accent/15 text-accent border-accent/30',
  ambiguous: 'bg-warning/15 text-warning border-warning/30',
  distinct: 'bg-surface-light text-muted border-border',
  unscorable: 'bg-surface-light text-muted border-border',
};

const BUCKET_ORDER: OrphanBucket[] = [
  'near_certain',
  'likely',
  'ambiguous',
  'distinct',
  'unscorable',
];

/**
 * One row of the orphan review queue.
 *
 * Both similarity numbers are shown rather than one blended score, because
 * they disagree exactly where it matters. A high containment with a low
 * Jaccard means the orphan is a *lap of a longer course*, not a duplicate
 * — folding it in would quietly shorten the course.
 */
function OrphanRow({
  row,
  onMerge,
  onKeep,
  onDismiss,
  busy,
}: {
  row: OrphanReviewRow;
  /** Narrowed from MergeKind: a new merge is either identical or variant,
   *  never 'unclassified' — that state only exists to re-open past merges. */
  onMerge: (row: OrphanReviewRow, kind: 'identical' | 'variant') => void;
  onKeep: (row: OrphanReviewRow) => void;
  onDismiss: (row: OrphanReviewRow) => void;
  busy: boolean;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const isLap = row.containment >= 0.9 && row.jaccard < 0.5;

  return (
    <div className="border-t border-border py-4 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-text">{row.orphan_name}</span>
            <span className="text-muted">→</span>
            {row.live_name ? (
              <span className="truncate font-medium text-text">{row.live_name}</span>
            ) : (
              <span className="flex items-center gap-1 text-sm text-muted">
                <AlertTriangle className="h-3.5 w-3.5" />
                no candidate
              </span>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge className={BUCKET_STYLE[row.bucket]}>{BUCKET_LABEL[row.bucket]}</Badge>
            {row.has_geometry ? (
              <>
                <span
                  className="font-mono text-xs text-muted"
                  title="Fraction of the smaller route's edges found in the larger. High on its own can mean a lap rather than a duplicate."
                >
                  containment {row.containment.toFixed(3)}
                </span>
                <span
                  className="font-mono text-xs text-muted"
                  title="Edge overlap over the union. Low here with high containment means the routes are different sizes — a lap, not a duplicate."
                >
                  jaccard {row.jaccard.toFixed(3)}
                </span>
              </>
            ) : (
              <span className="text-xs text-muted">
                No OSM road match — this route has no geometry to compare.
              </span>
            )}
          </div>

          {isLap && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Fully contained but low overlap — this looks like a <strong>lap of</strong>{' '}
                <strong>{row.live_name}</strong>, not a duplicate of it. Merging as
                &ldquo;identical&rdquo; would teach the matcher that a short lap and a full
                course are the same ride.
              </span>
            </p>
          )}

          {showWhy && (
            <p className="mt-2 rounded border border-border bg-surface-light p-2 text-xs text-muted">
              <strong>containment</strong> = shared edges ÷ edges of the{' '}
              <em>smaller</em> route. <strong>jaccard</strong> = shared edges ÷ edges in
              either route. High containment with low jaccard means the two routes share
              roads but differ in length — one is a lap or a partial recording of the
              other.
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            onClick={() => setShowWhy((v) => !v)}
            className="rounded border border-border px-2 py-1.5 text-xs text-muted hover:bg-surface-light"
            title="What do these numbers mean?"
          >
            ?
          </button>
          {row.live_id && (
            <>
              <button
                onClick={() => onMerge(row, 'identical')}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded bg-accent px-2.5 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
                title="Same route recorded twice"
              >
                <GitMerge className="h-3.5 w-3.5" />
                Duplicate
              </button>
              <button
                onClick={() => onMerge(row, 'variant')}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs text-text hover:bg-surface-light disabled:opacity-50"
                title="Same course, different form (e.g. a lap)"
              >
                <Undo2 className="h-3.5 w-3.5" />
                Variant
              </button>
            </>
          )}
          <button
            onClick={() => onKeep(row)}
            disabled={busy}
            className="rounded border border-border px-2.5 py-1.5 text-xs text-text hover:bg-surface-light disabled:opacity-50"
            title="This is a real route — use it in matching again"
          >
            Keep
          </button>
          <button
            onClick={() => onDismiss(row)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs text-muted hover:bg-surface-light disabled:opacity-50"
            title="Not a duplicate. Stays quarantined, but won't be suggested again."
          >
            <X className="h-3.5 w-3.5" />
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Review queue for quarantined routes.
 *
 * A quarantined route has no linked activities — the residue of an earlier
 * merge or an absorbed lap-variant twin. It is excluded from matching but
 * is still the user's data, so the decision (merge / keep / dismiss) is
 * theirs. Dismiss is durable: a rejected route is not re-proposed on the
 * next sweep, which is what lets this queue actually empty.
 */
export function OrphanReviewSection() {
  const { token } = useAuthFetch();
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['route-orphans'],
    queryFn: () => getOrphanCandidates(token),
    enabled: !!token,
    staleTime: 30_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['route-orphans'] });
    queryClient.invalidateQueries({ queryKey: ['routes'] });
    queryClient.invalidateQueries({ queryKey: ['route-duplicates'] });
    queryClient.invalidateQueries({ queryKey: ['route-merges'] });
  };

  const mergeMutation = useMutation({
    mutationFn: ({
      row,
      kind,
    }: {
      row: OrphanReviewRow;
      kind: 'identical' | 'variant';
    }) => {
      if (!row.live_id) throw new Error('No candidate to merge into');
      return mergeRoutes(row.live_id, row.orphan_id, token, kind);
    },
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(`Merge failed: ${(e as Error)?.message || 'try again.'}`),
  });

  const keepMutation = useMutation({
    mutationFn: (row: OrphanReviewRow) => keepOrphan(row.orphan_id, token),
    onSuccess: () => {
      toast.success('Route kept — it is used in matching again.');
      invalidate();
    },
    onError: (e) => toast.error(`Keep failed: ${(e as Error)?.message || 'try again.'}`),
  });

  const dismissMutation = useMutation({
    mutationFn: (row: OrphanReviewRow) => dismissOrphan(row.orphan_id, token),
    onSuccess: () => {
      toast.success('Dismissed — it stays out of matching and won’t be suggested again.');
      invalidate();
    },
    onError: (e) => toast.error(`Dismiss failed: ${(e as Error)?.message || 'try again.'}`),
  });

  const busy =
    mergeMutation.isPending || keepMutation.isPending || dismissMutation.isPending;

  if (isError) {
    return (
      <Card className="mt-6">
        <ErrorState
          title="Couldn't load quarantined routes"
          onRetry={() => refetch()}
        />
      </Card>
    );
  }

  const rows = data?.rows ?? [];
  const counts = data?.counts ?? {};

  return (
    <Card className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-text">Quarantined routes</h2>
          <p className="text-xs text-muted">
            Routes with no linked activities — merge residue. They are excluded from
            matching until you decide.
          </p>
        </div>
        {!isLoading && rows.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {BUCKET_ORDER.filter((b) => counts[b]).map((b) => (
              <Badge key={b} className={BUCKET_STYLE[b]}>
                {counts[b]} {BUCKET_LABEL[b].toLowerCase()}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {isLoading && <p className="py-4 text-sm text-muted">Loading…</p>}

      {!isLoading && rows.length === 0 && (
        <p className="py-4 text-sm text-muted">
          Nothing to review — every quarantined route has been dealt with.
        </p>
      )}

      {!isLoading && rows.length > 0 && (
        <>
          <div>
            {rows.map((row) => (
              <OrphanRow
                key={row.orphan_id}
                row={row}
                busy={busy}
                onMerge={(r, kind) => mergeMutation.mutate({ row: r, kind })}
                onKeep={(r) => keepMutation.mutate(r)}
                onDismiss={(r) => dismissMutation.mutate(r)}
              />
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            <strong>Duplicate</strong> = the same route recorded twice. <strong>Variant
            </strong> = same course, different form — only variants stay out of matcher
            training. <strong>Keep</strong> un-quarantines it. <strong>Dismiss</strong>{' '}
            keeps it out of matching permanently.
          </p>
        </>
      )}
    </Card>
  );
}