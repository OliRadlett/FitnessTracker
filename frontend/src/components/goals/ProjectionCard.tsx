'use client';

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch, listGoals, getGoalProjection } from '@/lib/api';
import type { Goal, GoalProjectionResponse } from '@/lib/api';

const BADGE_STYLES: Record<string, string> = {
  'On Track': 'bg-green-500/20 text-positive',
  'At Risk': 'bg-yellow-500/20 text-yellow-400',
  'Unlikely': 'bg-red-500/20 text-warning',
  'Not enough data': 'bg-muted/20 text-muted',
};

/**
 * Compact projection summary strip — renders below the goal grid.
 * Fetches projections for up to 5 active goals that have a target_date.
 */
export function ProjectionCard({ onSelectGoal }: { onSelectGoal: (goal: Goal) => void }) {
  const { authFetch } = useAuthFetch();

  // Fetch active goals
  const { data: goals } = useQuery<Goal[]>({
    queryKey: ['goals', 'active'],
    queryFn: () => listGoals(authFetch, 'active'),
    staleTime: 60_000,
  });

  // Filter to goals with target_date, take first 5
  const eligibleGoals = useMemo(
    () => (goals ?? []).filter((g) => g.target_date).slice(0, 5),
    [goals],
  );

  // Fetch projections for each eligible goal
  const projectionQueries = useQuery({
    queryKey: ['goal-projections', eligibleGoals.map((g) => g.id).join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        eligibleGoals.map((g) =>
          getGoalProjection(authFetch, g.id).catch(() => null),
        ),
      );
      return results.filter(Boolean) as GoalProjectionResponse[];
    },
    enabled: eligibleGoals.length > 0,
    staleTime: 5 * 60_000,
  });

  const projections = projectionQueries.data ?? [];

  if (eligibleGoals.length === 0) return null;

  return (
    <div className="rounded-xl border border-surface-light/50 bg-surface-light/10 p-4">
      <h3 className="text-xs font-medium text-muted uppercase tracking-wider mb-3">
        Projections
      </h3>
      <div className="flex flex-wrap gap-3">
        {eligibleGoals.map((goal) => {
          const proj = projections.find((p) => p.goal_id === goal.id);
          const badge = proj?.badge ?? 'Not enough data';
          const badgeStyle = BADGE_STYLES[badge] ?? BADGE_STYLES['Not enough data'];
          const label = goal.metric_label || goal.metric;
          const filterLabel = goal.filter_json?.exercise || goal.filter_json?.sport;

          let dateText = '—';
          if (proj?.projection) {
            const projDate = new Date(proj.projection.projected_date);
            const targetDate = goal.target_date ? new Date(goal.target_date) : null;
            if (targetDate && projDate > targetDate) {
              dateText = 'Behind';
            } else {
              dateText = projDate.toLocaleDateString(undefined, {
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
                <p className="text-xs font-medium text-white truncate max-w-[120px]">
                  {filterLabel || label}
                </p>
                <p className="text-[10px] text-muted">{dateText}</p>
              </div>
              <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badgeStyle}`}>
                {badge === 'Not enough data' ? '—' : badge.split(' ')[0]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
