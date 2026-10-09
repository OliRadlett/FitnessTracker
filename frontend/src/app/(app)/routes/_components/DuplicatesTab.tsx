'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { DuplicatePair, RouteData, RouteMergeLogEntry } from '@/lib/api/types';
import {
  getDuplicateRoutes,
  autoMergeDuplicates,
  mergeRoutes,
  undoRouteMerge,
  listRouteMerges,
  classifyRouteMerge,
  resetRouteMergeClassification,
  type MergeKind,
} from '@/lib/api/routes';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { formatDistance, getActiveLocale } from '@/lib/utils';
import { fmtElevation, computeDifficulty, DifficultyBadge, routeNamesDiffer } from '@/lib/routeUtils';
import {
  X,
  GitMerge,
  RefreshCw,
  AlertTriangle,
  MapPin,
  ChevronDown,
  ChevronRight,
  History,
  Undo2,
} from 'lucide-react';
import { CompareRoutesMap } from '@/components/maps/CompareRoutesMap';
import { OrphanReviewSection } from '@/components/routes/OrphanReviewSection';

// Phase 2 (ui-redesign-v2 §1.2 + §5-Phase 2): duplicate-review queue + orphan
// review live here as the Routes "Duplicates" tab (?tab=duplicates). Verbatim
// move of the former /routes/duplicates page body — no computation/API changes.
export function DuplicatesTab() {
  const { token } = useAuthFetch();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [autoMerging, setAutoMerging] = useState(false);
  const [lastMergeLogId, setLastMergeLogId] = useState<string | null>(null);
  const [undoMessage, setUndoMessage] = useState<string | null>(null);

  const { data: pairs = [], isLoading, isError: pairsError, refetch } = useQuery({
    queryKey: ['route-duplicates'],
    queryFn: () => getDuplicateRoutes(token),
    enabled: !!token,
    staleTime: 60_000,
  });

  const hasQueryError = pairsError;

  const autoMergeMutation = useMutation({
    mutationFn: (threshold: number) => autoMergeDuplicates(threshold, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['route-duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['routes'] });
    },
    onError: (err) => toast.error(`Auto-merge failed: ${(err as Error)?.message || 'please try again.'}`),
    onSettled: () => setAutoMerging(false),
  });

  const manualMergeMutation = useMutation({
    mutationFn: ({
      a,
      b,
      mergeKind,
    }: {
      a: string;
      b: string;
      mergeKind: 'identical' | 'variant';
    }) => mergeRoutes(a, b, token, mergeKind),
    onSuccess: (result) => {
      setLastMergeLogId(result.merge_log_id);
      setUndoMessage(null);
      queryClient.invalidateQueries({ queryKey: ['route-duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['route-merges'] });
      queryClient.invalidateQueries({ queryKey: ['routes'] });
    },
    onError: (err) => toast.error(`Merge failed: ${(err as Error)?.message || 'please try again.'}`),
  });

  const classifyMutation = useMutation({
    mutationFn: ({ logId, kind }: { logId: string; kind: MergeKind }) =>
      classifyRouteMerge(logId, kind, token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['route-merges'] }),
    onError: (err) => toast.error(`Couldn't update classification: ${(err as Error)?.message || 'try again.'}`),
  });

  const resetClassificationMutation = useMutation({
    mutationFn: () => resetRouteMergeClassification(token),
    onSuccess: (res) => {
      setUndoMessage(
        `Cleared classification on ${res.reset} merge${res.reset === 1 ? '' : 's'} — ` +
          'they no longer influence training until you reclassify them.',
      );
      queryClient.invalidateQueries({ queryKey: ['route-merges'] });
    },
    onError: (err) => toast.error(`Reset failed: ${(err as Error)?.message || 'try again.'}`),
  });

  const undoMutation = useMutation({
    mutationFn: (logId: string) => undoRouteMerge(logId, token),
    onSuccess: () => {
      setLastMergeLogId(null);
      setUndoMessage('Merge undone — the route was restored.');
      queryClient.invalidateQueries({ queryKey: ['route-duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['route-merges'] });
      queryClient.invalidateQueries({ queryKey: ['routes'] });
    },
    onError: (err) => toast.error(`Undo merge failed: ${(err as Error)?.message || 'please try again.'}`),
  });

  const { data: merges = [] } = useQuery({
    queryKey: ['route-merges'],
    queryFn: () => listRouteMerges(token),
    enabled: !!token,
    staleTime: 30_000,
  });

  const handleAutoMerge = () => {
    setAutoMerging(true);
    autoMergeMutation.mutate(0.9);
  };

  const handleAutoMergeLower = () => {
    const needsConfirmation = visiblePairs.some(
      (p) => p.score >= 0.4 && p.score < 0.9 && p.requires_confirmation,
    );
    if (needsConfirmation) {
      if (
        !confirm(
          'This will auto-merge pairs below the 90% confidence threshold, ' +
          'including some that require manual review. Are you sure?',
        )
      ) {
        return;
      }
    }
    setAutoMerging(true);
    autoMergeMutation.mutate(0.4);
  };

  const handleMergePair = (a: string, b: string, mergeKind: 'identical' | 'variant') => {
    manualMergeMutation.mutate({ a, b, mergeKind });
  };

  const handleDismissPair = (a: string, b: string) => {
    // We can't truly "dismiss" without a DB flag, but we can hide the pair
    // by storing dismissed IDs in localStorage
    const dismissed = JSON.parse(localStorage.getItem('route-duplicates-dismissed') || '[]');
    const newDismissed = [...new Set([...dismissed, a, b])];
    localStorage.setItem('route-duplicates-dismissed', JSON.stringify(newDismissed));
    refetch();
  };

  const dismissed = new Set(
    JSON.parse(localStorage.getItem('route-duplicates-dismissed') || '[]')
  );

  const visiblePairs = pairs.filter(
    (p) => !dismissed.has(p.route_a.id) && !dismissed.has(p.route_b.id)
  );

  const highConfidence = visiblePairs.filter((p) => p.score >= 0.9);
  const mediumConfidence = visiblePairs.filter((p) => p.score >= 0.75 && p.score < 0.9);
  const lowConfidence = visiblePairs.filter((p) => p.score < 0.75);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <h2 className="text-2xl font-bold text-foreground">Duplicate Routes</h2>
        <p className="text-muted">Scanning for potential duplicates...</p>
      </div>
    );
  }

  return (
    <div className="bg-background">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-foreground">Duplicate Routes</h2>
          <div className="flex gap-2">
            <button
              onClick={() => refetch()}
              className="min-h-[44px] px-3 py-2 text-sm bg-surface-light hover:bg-surface-light/80 text-foreground rounded-lg transition-colors flex items-center gap-1"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <button
              onClick={handleAutoMerge}
              disabled={autoMerging || highConfidence.length === 0}
              className="min-h-[44px] px-3 py-2 text-sm bg-positive hover:bg-positive/80 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              <GitMerge className="w-4 h-4" />
              {highConfidence.length > 0
                ? `Auto-Merge High (${highConfidence.length})`
                : 'No high-confidence duplicates'}
            </button>
            <button
              onClick={handleAutoMergeLower}
              disabled={autoMerging || (mediumConfidence.length + lowConfidence.length) === 0}
              className="min-h-[44px] px-3 py-2 text-sm bg-accent hover:bg-accent/80 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              <GitMerge className="w-4 h-4" />
              {`Auto-Merge All (${mediumConfidence.length + lowConfidence.length})`}
            </button>
          </div>
        </div>

        <ErrorState variant="inline" show={hasQueryError} message="Duplicate routes failed to load." />

        <OrphanReviewSection />

        {autoMergeMutation.isSuccess && autoMergeMutation.data && (
          <Card className="mb-4">
            <div className="p-4 text-sm">
              ✅ Merged {autoMergeMutation.data.merged} duplicate pairs
              (threshold: {autoMergeMutation.data.threshold.toFixed(2)})
            </div>
          </Card>
        )}

        {undoMessage && (
          <Card className="mb-4">
            <div className="p-4 text-sm text-positive">{undoMessage}</div>
          </Card>
        )}

        {lastMergeLogId && (
          <Card className="mb-4">
            <div className="p-4 flex items-center justify-between gap-3 text-sm">
              <span className="text-muted">
                Merge completed. You can undo it if it was a mistake.
              </span>
              <button
                onClick={() => lastMergeLogId && undoMutation.mutate(lastMergeLogId)}
                disabled={undoMutation.isPending}
                className="min-h-[44px] px-3 py-1.5 text-sm bg-surface-light hover:bg-surface-light/80 text-foreground rounded-lg transition-colors disabled:opacity-50"
              >
                {undoMutation.isPending ? 'Undoing…' : 'Undo merge'}
              </button>
            </div>
          </Card>
        )}

        {visiblePairs.length === 0 ? (
          <Card>
            <div className="p-12 text-center text-muted">
              <MapPin className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-lg mb-2">No duplicate routes found</p>
              <p className="text-sm">
                Your routes are clean — no potential duplicates detected.
              </p>
            </div>
          </Card>
        ) : (
          <div className="space-y-4">
            {highConfidence.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-warning mb-2 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" />
                  High Confidence (≥90% match)
                </h3>
                {highConfidence.map((pair) => (
                  <DuplicatePairCard
                    key={`${pair.route_a.id}-${pair.route_b.id}`}
                    pair={pair}
                    onMerge={handleMergePair}
                    onDismiss={handleDismissPair}
                    isMerging={manualMergeMutation.isPending}
                  />
                ))}
              </div>
            )}

            {mediumConfidence.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-muted mb-2">
                  Medium Confidence (75–89% match)
                </h3>
                {mediumConfidence.map((pair) => (
                  <DuplicatePairCard
                    key={`${pair.route_a.id}-${pair.route_b.id}`}
                    pair={pair}
                    onMerge={handleMergePair}
                    onDismiss={handleDismissPair}
                    isMerging={manualMergeMutation.isPending}
                  />
                ))}
              </div>
            )}

            {lowConfidence.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-muted mb-2">
                  Low Confidence (40–74% match)
                </h3>
                {lowConfidence.map((pair) => (
                  <DuplicatePairCard
                    key={`${pair.route_a.id}-${pair.route_b.id}`}
                    pair={pair}
                    onMerge={handleMergePair}
                    onDismiss={handleDismissPair}
                    isMerging={manualMergeMutation.isPending}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {merges.length > 0 && (
          <MergeHistorySection
            merges={merges}
            onUndo={(logId) => undoMutation.mutate(logId)}
            onClassify={(logId, kind) => classifyMutation.mutate({ logId, kind })}
            onResetClassification={() => resetClassificationMutation.mutate()}
            undoing={undoMutation.isPending}
            classifying={classifyMutation.isPending}
            resetting={resetClassificationMutation.isPending}
            undoMessage={undoMessage}
          />
        )}
      </div>
    </div>
  );
}

function MergeHistorySection({
  merges,
  onUndo,
  onClassify,
  onResetClassification,
  undoing,
  classifying,
  resetting,
  undoMessage,
}: {
  merges: RouteMergeLogEntry[];
  onUndo: (logId: string) => void;
  onClassify: (logId: string, kind: MergeKind) => void;
  onResetClassification: () => void;
  undoing: boolean;
  classifying: boolean;
  resetting: boolean;
  undoMessage: string | null;
}) {
  const active = merges.filter((m) => !m.undone_at);
  const undone = merges.filter((m) => m.undone_at);
  const unclassified = active.filter((m) => !m.merge_kind).length;

  return (
    <div className="mt-10">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <History className="w-5 h-5 text-muted" />
          Merge history
        </h3>
        {active.length > 0 && (
          <button
            onClick={onResetClassification}
            disabled={resetting}
            title="Clear the identical/variant label on all merges so you can re-judge them. Unclassified merges never train the matcher."
            className="min-h-[44px] px-3 py-1.5 text-xs bg-surface-light hover:bg-surface-light/80 text-foreground rounded-lg transition-colors disabled:opacity-50"
          >
            {resetting ? 'Resetting…' : 'Reset classification'}
          </button>
        )}
      </div>

      <p className="mb-3 text-xs text-muted">
        A merge only teaches the matcher that two routes are the same when marked
        <span className="text-foreground"> &ldquo;the same route twice&rdquo;</span>.
        Mark loop/lap variants as <span className="text-foreground">&ldquo;same kind of ride&rdquo;</span>
        {' '}so they stay merged but don&apos;t widen matching.
        {unclassified > 0 && (
          <span className="text-warning"> {unclassified} unclassified (not training).</span>
        )}
      </p>

      {undoMessage && <p className="mb-3 text-sm text-positive">{undoMessage}</p>}

      <div className="space-y-2">
        {active.length === 0 && undone.length > 0 && (
          <p className="text-sm text-muted">No active merges — all have been undone.</p>
        )}

        {active.map((m) => (
          <Card key={m.id}>
            <div className="p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-foreground truncate">
                    <span className="font-medium">{m.primary_name}</span>
                    <span className="text-muted"> absorbed </span>
                    <span className="text-muted line-through">{m.merged_name}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <Badge variant="muted" className="text-xs">
                      {Math.round(m.score * 100)}% match
                    </Badge>
                    {m.created_at && (
                      <span>{new Date(m.created_at).toLocaleString(getActiveLocale())}</span>
                    )}
                    {!m.primary_exists && (
                      <span className="text-warning">
                        primary since merged/removed — restore may not be possible
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => onUndo(m.id)}
                  disabled={undoing || !m.primary_exists}
                  title={
                    m.primary_exists
                      ? 'Restore the merged-away route'
                      : 'The primary route no longer exists'
                  }
                  className="min-h-[44px] shrink-0 px-3 py-1.5 text-sm bg-surface-light hover:bg-surface-light/80 text-foreground rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  <Undo2 className="w-4 h-4" />
                  {undoing ? 'Undoing…' : 'Undo'}
                </button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="text-muted">Treated as:</span>
                {(['identical', 'variant'] as const).map((kind) => (
                  <label key={kind} className="flex items-center gap-1.5 cursor-pointer min-h-[44px]">
                    <input
                      type="radio"
                      name={`hist-kind-${m.id}`}
                      checked={m.merge_kind === kind}
                      disabled={classifying}
                      onChange={() => onClassify(m.id, kind)}
                    />
                    <span className={m.merge_kind === kind ? 'text-foreground' : 'text-muted'}>
                      {kind === 'identical'
                        ? 'the same route twice'
                        : 'same kind of ride'}
                    </span>
                  </label>
                ))}
                {!m.merge_kind && (
                  <Badge variant="muted" className="text-xs">
                    unclassified · not training
                  </Badge>
                )}
              </div>
            </div>
          </Card>
        ))}

        {undone.map((m) => (
          <Card key={m.id}>
            <div className="p-3 flex items-center justify-between gap-3 opacity-60">
              <div className="text-sm text-muted truncate">
                <span className="line-through">{m.primary_name}</span>
                <span> / </span>
                <span className="line-through">{m.merged_name}</span>
              </div>
              <Badge variant="muted" className="text-xs shrink-0">
                Undone
              </Badge>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function DuplicatePairCard({
  pair,
  onMerge,
  onDismiss,
  isMerging,
}: {
  pair: DuplicatePair;
  onMerge: (a: string, b: string, mergeKind: 'identical' | 'variant') => void;
  onDismiss: (a: string, b: string) => void;
  isMerging: boolean;
}) {
  // Preview off by default so the queue stays scannable; opened on demand when
  // a pair needs a judgement call.
  const [showPreview, setShowPreview] = useState(false);
  // Default to "same route twice" — the common case for a true duplicate.
  const [mergeKind, setMergeKind] = useState<'identical' | 'variant'>('identical');

  return (
    <Card>
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <Badge
            variant={pair.score >= 0.9 ? 'warning' : 'muted'}
            className="text-xs"
          >
            {Math.round(pair.score * 100)}% match
          </Badge>
          <Badge variant="muted" className="text-xs ml-2">
            {pair.tier === 'auto' ? 'Auto' : 'Review'}
          </Badge>
          {pair.requires_confirmation && (
            <Badge variant="muted" className="text-xs ml-2">
              Review required
            </Badge>
          )}
          {pair.jev_decision && (
            <Badge
              variant="muted"
              className="text-xs ml-2"
              title="Jev's read on whether these are the same route"
            >
              Jev: {pair.jev_decision}
            </Badge>
          )}
          {pair.breakdown && (
            <div className="mt-3 text-xs text-muted flex flex-wrap gap-x-3 gap-y-1">
              <span>overlap {Math.round((pair.breakdown.min_coverage ?? 0) * 100)}%</span>
              <span>shape {Math.round((pair.breakdown.frechet_similarity ?? 0) * 100)}%</span>
              {pair.breakdown.lap_ratio != null && (
                <span>≈{pair.breakdown.lap_ratio} lap route</span>
              )}
              {pair.breakdown.reversed && <span className="text-warning">reversed</span>}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => onDismiss(pair.route_a.id, pair.route_b.id)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center p-1 text-muted hover:text-foreground bg-surface-light/50 rounded transition-colors"
              aria-label="Dismiss pair"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-foreground flex items-center gap-1">
              <span className="text-accent">A</span>
              {pair.route_a.name}
            </h4>
            <RouteMiniStats route={pair.route_a} />
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-foreground flex items-center gap-1">
              <span className="text-accent">B</span>
              {pair.route_b.name}
            </h4>
            <RouteMiniStats route={pair.route_b} />
          </div>
        </div>

        {/* Overlay preview — the decisive tool for "same roads or not?" */}
        <div className="mt-3">
          <button
            onClick={() => setShowPreview((v) => !v)}
            aria-expanded={showPreview}
            className="flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors min-h-[44px]"
          >
            {showPreview ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            {showPreview ? 'Hide map preview' : 'Show map preview (A vs B overlaid)'}
          </button>

          {showPreview && (
            <div className="mt-2">
              <CompareRoutesMap
                encodedA={pair.route_a.encoded_polyline}
                encodedB={pair.route_b.encoded_polyline}
                labelA={pair.route_a.name}
                labelB={pair.route_b.name}
                className="h-[260px]"
              />
              <p className="mt-1 text-xs text-muted">
                A is dashed blue, B is solid amber. Fully overlapping traces mean the
                same roads; divergent sections are where they differ.
              </p>
            </div>
          )}
        </div>

        {/* Why are these the same? Drives whether the merge trains the matcher. */}
        <div className="mt-4 pt-3 border-t border-surface-light/30">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="text-muted">These routes are:</span>
            <label className="flex items-center gap-1.5 cursor-pointer min-h-[44px]">
              <input
                type="radio"
                name={`kind-${pair.route_a.id}-${pair.route_b.id}`}
                checked={mergeKind === 'identical'}
                onChange={() => setMergeKind('identical')}
              />
              <span className="text-foreground">
                the same route twice
                <span className="text-muted"> (trains matching)</span>
              </span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer min-h-[44px]">
              <input
                type="radio"
                name={`kind-${pair.route_a.id}-${pair.route_b.id}`}
                checked={mergeKind === 'variant'}
                onChange={() => setMergeKind('variant')}
              />
              <span className="text-foreground">
                same kind of ride
                <span className="text-muted"> (won&apos;t train matching)</span>
              </span>
            </label>
          </div>

          {/* An `identical` merge is the only kind that trains the matcher, so
              it is the one where a wrong call is permanent. Differently-named
              pairs are where the doubt belongs: Strava auto-generates names,
              so the same ride can arrive under two. */}
          {mergeKind === 'identical' &&
            routeNamesDiffer(pair.route_a.name, pair.route_b.name) && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  These routes have different names, and this merge will{' '}
                  <strong>train the matcher</strong> that they are the same
                  ride. Check the map first. If one is a shorter or partial
                  recording of the other, choose &ldquo;same kind of
                  ride&rdquo; instead — that merge is excluded from training
                  and can be reclassified later.
                </span>
              </p>
            )}

          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => onMerge(pair.route_a.id, pair.route_b.id, mergeKind)}
              disabled={isMerging}
              className="min-h-[44px] px-3 py-1.5 text-sm bg-accent hover:bg-accent/80 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              <GitMerge className="w-4 h-4" />
              {isMerging ? 'Merging...' : 'Merge (keep A)'}
            </button>
            <button
              onClick={() => onMerge(pair.route_b.id, pair.route_a.id, mergeKind)}
              disabled={isMerging}
              className="min-h-[44px] px-3 py-1.5 text-sm bg-accent hover:bg-accent/80 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              <GitMerge className="w-4 h-4" />
              {isMerging ? 'Merging...' : 'Merge (keep B)'}
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function RouteMiniStats({ route }: { route: RouteData }) {
  const diff = computeDifficulty(route.elevation_gain_meters, route.distance_meters);

  return (
    <div className="text-xs text-muted space-y-1">
      <div className="flex items-center gap-3 flex-wrap">
        <span>📏 {formatDistance(route.distance_meters)}</span>
        {route.elevation_gain_meters && (
          <span>⛰️ {fmtElevation(route.elevation_gain_meters)}</span>
        )}
        {diff && <DifficultyBadge level={diff} />}
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="cycling" className="text-xs">
          {route.sport_type}
        </Badge>
        {route.sources.length > 0 && (
          <Badge variant="muted" className="text-xs">
            {route.sources[0].provider}
          </Badge>
        )}
        {route.is_loop && <span className="text-green-400">🔄 Loop</span>}
      </div>
    </div>
  );
}
