'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { DuplicatePair, RouteData } from '@/lib/api/types';
import {
  getDuplicateRoutes,
  autoMergeDuplicates,
  mergeRoutes,
} from '@/lib/api/routes';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatDistance } from '@/lib/utils';
import { fmtElevation, computeDifficulty, DifficultyBadge } from '@/lib/routeUtils';
import {
  Trash2,
  Check,
  X,
  GitMerge,
  RefreshCw,
  AlertTriangle,
  MapPin,
} from 'lucide-react';

export default function DuplicatesPage() {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();

  const [autoMerging, setAutoMerging] = useState(false);

  const { data: pairs = [], isLoading, refetch } = useQuery({
    queryKey: ['route-duplicates'],
    queryFn: () => getDuplicateRoutes(token),
    staleTime: 60_000,
  });

  const autoMergeMutation = useMutation({
    mutationFn: (threshold: number) => autoMergeDuplicates(threshold, token),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['route-duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['routes'] });
    },
    onSettled: () => setAutoMerging(false),
  });

  const manualMergeMutation = useMutation({
    mutationFn: ({ a, b }: { a: string; b: string }) => mergeRoutes(a, b, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['route-duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['routes'] });
    },
  });

  const handleAutoMerge = () => {
    setAutoMerging(true);
    autoMergeMutation.mutate(0.9);
  };

  const handleAutoMergeLower = () => {
    setAutoMerging(true);
    autoMergeMutation.mutate(0.75);
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
        <h1 className="text-2xl font-bold text-white">Duplicate Routes</h1>
        <p className="text-muted">Scanning for potential duplicates...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Duplicate Routes</h1>
          <div className="flex gap-2">
            <button
              onClick={() => refetch()}
              className="px-3 py-2 text-sm bg-surface-light hover:bg-surface-light/80 text-white rounded-lg transition-colors flex items-center gap-1"
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
              disabled={autoMerging || mediumConfidence.length === 0}
              className="px-3 py-2 text-sm bg-accent hover:bg-accent/80 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              <GitMerge className="w-4 h-4" />
              {`Auto-Merge All (${visiblePairs.length})`}
            </button>
          </div>
        </div>

        {autoMergeMutation.isSuccess && autoMergeMutation.data && (
          <Card className="mb-4">
            <div className="p-4 text-sm">
              ✅ Merged {autoMergeMutation.data.merged} duplicate pairs
              (threshold: {autoMergeMutation.data.threshold.toFixed(2)})
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
  const scoreColor =
    pair.score >= 0.9
      ? 'text-warning'
      : pair.score >= 0.75
      ? 'text-yellow-400'
      : 'text-muted';

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
          <div className="flex gap-2">
            <button
              onClick={() => onDismiss(pair.route_a.id, pair.route_b.id)}
              className="p-1 text-muted hover:text-white bg-surface-light/50 rounded transition-colors"
              aria-label="Dismiss pair"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-white flex items-center gap-1">
              <span className="text-accent">A</span>
              {pair.route_a.name}
            </h3>
            <RouteMiniStats route={pair.route_a} />
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-white flex items-center gap-1">
              <span className="text-accent">B</span>
              {pair.route_b.name}
            </h3>
            <RouteMiniStats route={pair.route_b} />
          </div>
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
