'use client';

/**
 * ConformityTrendCard — plan adherence as a *trend*, not just the viewed week.
 *
 * `GET /training-plans/{id}/conformity?weeks=N` gives the overall %, the
 * direction, per-week percentages and human-readable patterns. Lives in Review
 * mode (read-only evidence).
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, TrendingDown, TrendingUp } from 'lucide-react';

import { getPlanConformity, useAuthFetch } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';

const TREND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  improving: TrendingUp,
  declining: TrendingDown,
  stable: Clock,
};

export interface ConformityTrendCardProps {
  planId: string;
  weeks?: number;
}

export function ConformityTrendCard({ planId, weeks = 8 }: ConformityTrendCardProps) {
  const { token } = useAuthFetch();
  const query = useQuery({
    queryKey: ['plan-conformity-trend', planId, weeks],
    queryFn: () => getPlanConformity(planId, weeks, token),
    staleTime: 60_000,
    enabled: !!token,
  });

  const data = query.data;
  const scored = (data?.weeks ?? []).filter((w) => w.pct != null);
  const TrendIcon = data?.trend ? TREND_ICON[data.trend] : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <CardTitle>Conformity trend</CardTitle>
          {data?.overall_pct != null && (
            <span
              className={`text-2xl font-bold leading-none ${
                data.overall_pct >= 80 ? 'text-positive' : 'text-warning'
              }`}
            >
              {Math.round(data.overall_pct)}%
            </span>
          )}
          {TrendIcon && <TrendIcon className="w-4 h-4 text-muted" />}
        </div>
      </CardHeader>

      {query.isLoading && <p className="text-sm text-muted">Loading…</p>}
      {query.isError && (
        <p className="text-sm text-warning">Couldn&apos;t load conformity.</p>
      )}

      {data && scored.length === 0 && (
        <p className="text-sm text-muted italic">
          Not enough logged sessions to score yet.
        </p>
      )}

      {scored.length > 0 && (
        <div className="space-y-3">
          {/* Per-week bars */}
          <div className="flex items-end gap-1.5 h-24">
            {scored.map((w) => {
              const pct = w.pct ?? 0;
              return (
                <div key={w.week_number} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                  <div className="w-full flex-1 flex items-end">
                    <div
                      className={`w-full rounded-t ${pct >= 80 ? 'bg-positive/70' : 'bg-warning/70'}`}
                      style={{ height: `${Math.max(4, pct)}%` }}
                      title={`Week ${w.week_number}: ${Math.round(pct)}%`}
                    />
                  </div>
                  <span className="text-[9px] text-muted truncate">W{w.week_number}</span>
                </div>
              );
            })}
          </div>

          {/* Patterns */}
          {(data?.patterns ?? []).length > 0 && (
            <div className="rounded-lg bg-warning/5 border border-warning/20 px-3 py-2">
              <ul className="space-y-0.5">
                {(data?.patterns ?? []).map((p, i) => (
                  <li key={i} className="text-[11px] text-warning/90 flex gap-1.5">
                    <span className="shrink-0">•</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
