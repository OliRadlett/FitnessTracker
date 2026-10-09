'use client';

import React, { useMemo } from 'react';
import { useIsFetching, useQuery } from '@tanstack/react-query';
import { useAuthFetch, listGoals } from '@/lib/api';
import type { Goal } from '@/lib/api';
import { getActiveLocale } from '@/lib/utils';
import { useGoalProjections } from '@/components/goals/useGoalProjections';

const BADGE_STYLES: Record<string, string> = {
  'On Track': 'bg-green-500/20 text-positive',
  'At Risk': 'bg-yellow-500/20 text-yellow-400',
  'Unlikely': 'bg-warning/20 text-warning',
  'Not enough data': 'bg-muted/20 text-muted',
};

/**
 * Compact projection summary strip — renders below the goal grid.
 * Fetches projections for up to 5 active goals that have a target_date.
 *
 * Honest-empty rules (Phase 0):
 * - Goals loading → skeleton strip matching the card shape.
 * - Goals with no projectable data are hidden (never bare `—` chips).
 * - When no eligible goal has data yet → one honest empty (what + how + CTA)
 *   whose action opens the first dated goal so the athlete can log a check-in.
 * - When there are no dated active goals at all → render nothing (hide the
 *   section rather than a void card; the goal grid above is the surface).
 */
export function ProjectionCard({ onSelectGoal }: { onSelectGoal: (goal: Goal) => void }) {
  const { authFetch, token } = useAuthFetch();

  // Fetch active goals
  const { data: goals, isLoading } = useQuery<Goal[]>({
    queryKey: ['goals', 'active'],
    queryFn: () => listGoals(authFetch, 'active'),
    enabled: !!token,
    staleTime: 60_000,
  });

  // Filter to goals with target_date — most urgent first.
  const eligibleGoals = useMemo(
    () =>
      (goals ?? [])
        .filter((g) => g.target_date)
        .sort((a, b) => (a.target_date ?? '').localeCompare(b.target_date ?? ''))
        .slice(0, 5),
    [goals],
  );

  // Per-goal projection queries (useGoalProjections) — shares the
  // ['goal-projection', id] cache with GoalDetailModal instead of a bespoke
  // aggregated key that would fetch everything twice.
  const projections = useGoalProjections(eligibleGoals);
  const fetchingProjectionCount = useIsFetching({ queryKey: ['goal-projection'] });

  const withData = useMemo(
    () =>
      eligibleGoals.filter((g) => {
        const proj = projections.get(g.id);
        return !!proj?.projection && proj.badge !== 'Not enough data';
      }),
    [eligibleGoals, projections],
  );

  // Still settling when some eligible goal has no cached projection yet and
  // projection queries are in flight.
  const projectionsSettling =
    eligibleGoals.length > 0 &&
    projections.size < eligibleGoals.length &&
    fetchingProjectionCount > 0;

  // No dated active goals → hide the section (the goal grid is the surface).
  if (!isLoading && eligibleGoals.length === 0) return null;

  if (isLoading) {
    return (
      <div
        className="rounded-xl border border-surface-light/50 bg-surface-light/10 p-4"
        role="status"
        aria-label="Loading projections"
      >
        <div className="h-3 w-24 mb-3 animate-pulse bg-surface-light/60 rounded" aria-hidden="true" />
        <div className="flex flex-wrap gap-3" aria-hidden="true">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 w-36 animate-pulse bg-surface-light/40 rounded-lg" />
          ))}
        </div>
        <span className="sr-only">Loading projections…</span>
      </div>
    );
  }

  // Settling with nothing projectable yet → skeleton chips, not `—` placeholders.
  if (withData.length === 0 && projectionsSettling) {
    return (
      <div
        className="rounded-xl border border-surface-light/50 bg-surface-light/10 p-4"
        role="status"
        aria-label="Loading projections"
      >
        <h3 className="text-xs font-medium text-muted uppercase tracking-wider mb-3">
          Projections
        </h3>
        <div className="flex flex-wrap gap-3" aria-hidden="true">
          {eligibleGoals.slice(0, 3).map((g) => (
            <div key={g.id} className="h-12 w-36 animate-pulse bg-surface-light/40 rounded-lg" />
          ))}
        </div>
        <span className="sr-only">Loading projections…</span>
      </div>
    );
  }

  // Settled and nothing projectable → the Honest Empty (what + how + CTA).
  if (withData.length === 0) {
    const firstGoal = eligibleGoals[0];
    return (
      <div className="rounded-xl border border-surface-light/50 bg-surface-light/10 p-4">
        <h3 className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
          Projections
        </h3>
        <p className="text-sm font-medium text-foreground">Projections need a little history</p>
        <p className="text-xs text-muted mt-1 max-w-xl">
          Log check-ins on your dated goals — after a few entries (plus the weekly auto
          snapshot) each goal projects its finish date here.
        </p>
        {firstGoal && (
          <button
            onClick={() => onSelectGoal(firstGoal)}
            className="mt-3 min-h-[44px] px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
          >
            Log a check-in
          </button>
        )}
      </div>
    );
  }

  const pendingCount = eligibleGoals.length - withData.length;

  return (
    <div className="rounded-xl border border-surface-light/50 bg-surface-light/10 p-4">
      <h3 className="text-xs font-medium text-muted uppercase tracking-wider mb-3">
        Projections
      </h3>
      <div className="flex flex-wrap gap-3">
        {withData.map((goal) => {
          const proj = projections.get(goal.id);
          const badge = proj?.badge ?? 'Not enough data';
          const badgeStyle = BADGE_STYLES[badge] ?? BADGE_STYLES['Not enough data'];
          const label = goal.metric_label || goal.metric;
          const filterLabel = goal.filter_json?.exercise || goal.filter_json?.sport;

          // withData guarantees a projected date; overshoots read as "Behind".
          let dateText = '';
          if (proj?.projection) {
            const projDate = new Date(proj.projection.projected_date);
            const targetDate = goal.target_date ? new Date(goal.target_date) : null;
            if (targetDate && projDate > targetDate) {
              dateText = 'Behind';
            } else {
              dateText = projDate.toLocaleDateString(getActiveLocale(), {
                month: 'short',
                day: 'numeric',
              });
            }
          }

          return (
            <button
              key={goal.id}
              onClick={() => onSelectGoal(goal)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-light/30 border border-surface-light/50 hover:border-accent/40 transition-colors text-left min-w-0"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground truncate max-w-[120px]">
                  {filterLabel || label}
                </p>
                <p className="text-xs text-muted">{dateText}</p>
              </div>
              <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded-full font-medium ${badgeStyle}`}>
                {badge}
              </span>
            </button>
          );
        })}
        {projectionsSettling &&
          eligibleGoals
            .filter((g) => !withData.includes(g))
            .slice(0, 2)
            .map((g) => (
              <div
                key={g.id}
                className="h-12 w-36 animate-pulse bg-surface-light/40 rounded-lg"
                aria-hidden="true"
              />
            ))}
      </div>
      {!projectionsSettling && pendingCount > 0 && (
        <p className="text-xs text-muted mt-3">
          Plus {pendingCount} more building history — log check-ins to unlock{' '}
          {pendingCount === 1 ? 'its' : 'their'} projection.
        </p>
      )}
    </div>
  );
}
