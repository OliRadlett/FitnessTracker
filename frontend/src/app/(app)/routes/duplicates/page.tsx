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
} from '@/lib/api/routes';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { formatDistance } from '@/lib/utils';
import { fmtElevation, computeDifficulty, DifficultyBadge } from '@/lib/routeUtils';
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

export default function DuplicatesPage() {
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
    mutationFn: ({ a, b }: { a: string; b: string }) => mergeRoutes(a, b, token),
    onSuccess: (result) => {
      setLastMergeLogId(result.merge_log_id);
      setUndoMessage(null);
      queryClient.invalidateQueries({ queryKey: ['route-duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['routes'] });
    },
    onError: (err) => toast.error(`Merge failed: ${(err as Error)?.message || 'please try again.'}`),
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

  const handleMergePair = (a: string, b: string) => {
    manualMergeMutation.mutate({ a, b });
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
        <h1 className="text-2xl font-bold text-foreground">Duplicate Routes</h1>
        <p className="text-muted">Scanning for potential duplicates...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-foreground">Duplicate Routes</h1>
          <div className="flex gap-2">
            <button
              onClick={() => refetch()}
              className="px-3 py-2 text-sm bg-surface-light hover:bg-surface-light/80 text-foreground rounded-lg transition-colors flex items-center gap-1"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <button
              onClick={handleAutoMerge}
              disabled={autoMerging || highConfidence.length === 0}
              className="px-3 py-2 text-sm bg-positive hover:bg-positive/80 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              <GitMerge className="w-4 h-4" />
              {highConfidence.length > 0
                ? `Auto-Merge High (${highConfidence.length})`
                : 'No high-confidence duplicates'}
            </button>
            <button
              onClick={handleAutoMergeLower}
              disabled={autoMerging || (mediumConfidence.length + lowConfidence.length) === 0}
              className="px-3 py-2 text-sm bg-accent hover:bg-accent/80 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              <GitMerge className="w-4 h-4" />
              {`Auto-Merge All (${mediumConfidence.length + lowConfidence.length})`}
            </button>
          </div>
        </div>

        <ErrorState variant="inline" show={hasQueryError} message="Duplicate routes failed to load." />

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
                className="px-3 py-1.5 text-sm bg-surface-light hover:bg-surface-light/80 text-foreground rounded-lg transition-colors disabled:opacity-50"
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
                <h2 className="text-sm font-semibold text-warning mb-2 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" />
                  High Confidence (≥90% match)
                </h2>
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
                <h2 className="text-sm font-semibold text-muted mb-2">
                  Medium Confidence (75–89% match)
                </h2>
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
                <h2 className="text-sm font-semibold text-muted mb-2">
                  Low Confidence (40–74% match)
                </h2>
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
            undoing={undoMutation.isPending}
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
  undoing,
  undoMessage,
}: {
  merges: RouteMergeLogEntry[];
  onUndo: (logId: string) => void;
  undoing: boolean;
  undoMessage: string | null;
}) {
  const active = merges.filter((m) => !m.undone_at);
  const undone = merges.filter((m) => m.undone_at);

  return (
    <div className="mt-10">
      <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
        <History className="w-5 h-5 text-muted" />
        Merge history
      </h2>

      {undoMessage && <p className="mb-3 text-sm text-positive">{undoMessage}</p>}

      <div className="space-y-2">
        {active.length === 0 && undone.length > 0 && (
          <p className="text-sm text-muted">No active merges — all have been undone.</p>
        )}

        {active.map((m) => (
          <Card key={m.id}>
            <div className="p-3 flex items-center justify-between gap-3">
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
                    <span>{new Date(m.created_at).toLocaleString()}</span>
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
                className="shrink-0 px-3 py-1.5 text-sm bg-surface-light hover:bg-surface-light/80 text-foreground rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                <Undo2 className="w-4 h-4" />
                {undoing ? 'Undoing…' : 'Undo'}
              </button>
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
  onMerge: (a: string, b: string) => void;
  onDismiss: (a: string, b: string) => void;
  isMerging: boolean;
}) {
  // Preview off by default so the queue stays scannable; opened on demand when
  // a pair needs a judgement call.
  const [showPreview, setShowPreview] = useState(false);

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
              className="p-1 text-muted hover:text-foreground bg-surface-light/50 rounded transition-colors"
              aria-label="Dismiss pair"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-1">
              <span className="text-accent">A</span>
              {pair.route_a.name}
            </h3>
            <RouteMiniStats route={pair.route_a} />
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-1">
              <span className="text-accent">B</span>
              {pair.route_b.name}
            </h3>
            <RouteMiniStats route={pair.route_b} />
          </div>
        </div>

        {/* Overlay preview — the decisive tool for "same roads or not?" */}
        <div className="mt-3">
          <button
            onClick={() => setShowPreview((v) => !v)}
            aria-expanded={showPreview}
            className="flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors min-h-[32px]"
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

        <div className="mt-4 pt-3 border-t border-surface-light/30 flex justify-end gap-2">
          <button
            onClick={() => onMerge(pair.route_a.id, pair.route_b.id)}
            disabled={isMerging}
            className="px-3 py-1.5 text-sm bg-accent hover:bg-accent/80 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            <GitMerge className="w-4 h-4" />
            {isMerging ? 'Merging...' : 'Merge (keep A)'}
          </button>
          <button
            onClick={() => onMerge(pair.route_b.id, pair.route_a.id)}
            disabled={isMerging}
            className="px-3 py-1.5 text-sm bg-accent hover:bg-accent/80 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            <GitMerge className="w-4 h-4" />
            {isMerging ? 'Merging...' : 'Merge (keep B)'}
          </button>
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
