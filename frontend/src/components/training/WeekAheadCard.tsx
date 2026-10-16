'use client';

/**
 * WeekAheadCard — the persisted C3 weekly review as a read-out.
 *
 * The payload's `adaptive.suggestions` carry one-tap apply actions; those belong
 * to AdaptiveSuggestionsCard, so this card shows the adaptive summary line only.
 * Refresh is the single write: `?refresh=true` recomputes the review and persists it.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import { getPlanReview, useAuthFetch } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { buildWeekAheadModel } from './weekAhead';

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-surface-light/40 border border-surface-light/60 px-3 py-2">
      <p className="text-lg font-semibold text-foreground leading-none">{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-muted mt-1">{label}</p>
    </div>
  );
}

export function WeekAheadCard({ planId }: { planId: string }) {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['plan-review', planId],
    queryFn: () => getPlanReview(authFetch, planId),
    staleTime: 5 * 60_000,
    enabled: !!token && !!planId,
  });

  const refresh = useMutation({
    mutationFn: () => getPlanReview(authFetch, planId, { refresh: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan-review', planId] });
    },
  });

  if (query.isError || !query.data) {
    return null;
  }

  const model = buildWeekAheadModel(query.data);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-baseline gap-3 flex-wrap">
            <CardTitle>Week ahead</CardTitle>
            <span className="text-xs uppercase tracking-wide text-muted">{model.weekLabel}</span>
          </div>
          <button
            type="button"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-surface-light text-muted hover:text-foreground hover:border-accent/50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refresh.isPending ? 'animate-spin' : ''}`} />
            {refresh.isPending ? 'Recomputing…' : 'Recompute & save'}
          </button>
        </div>
      </CardHeader>

      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Missed" value={model.missedDays} />
          <Stat label="Upcoming" value={model.upcomingDays} />
          <Stat label="Active goals" value={model.activeGoals} />
        </div>

        {model.missedDatesLabel && (
          <div className="rounded-lg bg-warning/5 border border-warning/20 px-3 py-2">
            <p className="text-xs text-warning/90">
              {model.missedDays} missed · {model.missedDatesLabel}
            </p>
          </div>
        )}

        {model.loadLabel && (
          <p className="text-sm text-muted">
            Load <span className="text-foreground">{model.loadLabel}</span>
          </p>
        )}

        {model.conformityLabel && (
          <p className="text-sm text-muted">
            Conformity <span className="text-foreground">{model.conformityLabel}</span>
          </p>
        )}

        {model.adaptiveSummary && (
          <p className="text-sm text-muted">{model.adaptiveSummary}</p>
        )}

        {model.unavailable.length > 0 && (
          <p className="text-xs text-muted italic">
            Not available this week: {model.unavailable.join(', ')}.
          </p>
        )}
      </div>
    </Card>
  );
}
