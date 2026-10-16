'use client';

/**
 * WeekAheadCard — the persisted C3 weekly review as a read-out.
 *
 * Read-only by construction. `docs/review-vs-act.md` gate 4 forbids a review
 * component from importing a mutation hook or invalidating a query, and it names
 * refresh actions as action content, so this card renders and nothing more.
 *
 * The payload's `adaptive.suggestions` carry one-tap apply actions, which belong
 * to AdaptiveSuggestionsCard, so this card shows the adaptive summary line only.
 * The on-demand `?refresh=true` recompute has no surface yet: the beat task owns
 * scheduled writes, and a refresh belongs in the action layer.
 */

import { useQuery } from '@tanstack/react-query';

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

  const query = useQuery({
    queryKey: ['plan-review', planId],
    queryFn: () => getPlanReview(authFetch, planId),
    staleTime: 5 * 60_000,
    enabled: !!token && !!planId,
  });

  // Review mode must render for a plan that has no review yet, so a missing or
  // failed payload shows nothing rather than an error card. A hard failure is
  // therefore indistinguishable from "no review" here, which is deliberate: the
  // endpoint already degrades section by section.
  if (!query.data) {
    return null;
  }

  const model = buildWeekAheadModel(query.data);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline gap-3 flex-wrap">
          <CardTitle>Week ahead</CardTitle>
          <span className="text-xs uppercase tracking-wide text-muted">{model.weekLabel}</span>
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
