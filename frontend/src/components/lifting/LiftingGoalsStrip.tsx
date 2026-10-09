'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch, listGoals } from '@/lib/api';
import type { Goal } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import {
  goalProgressPct,
  goalDisplayBadge,
  isLiftingMetric,
} from '@/components/ui/GoalCard';
import { GoalCreateModal } from '@/components/goals/GoalCreateModal';
import { useGoalProjections } from '@/components/goals/useGoalProjections';
import { getActiveLocale } from '@/lib/utils';

export interface GoalPrefill {
  metric: string;
  exercise?: string;
  /** Increment to re-trigger when the same exercise is picked twice. */
  nonce: number;
}

/**
 * Lifting → goals surface (frontend P1 two-way).
 *
 * The goals page already links lifting goals back to `/lifting` (GoalCard
 * cross-link); this is the return path: active lifting goals rendered on the
 * lifting PRs tab with progress + projection badge, a "View all →" link to
 * `/goals`, and a "+ New goal" entry point. A PR card's "🎯 Set goal" drives
 * the same create modal via the `prefill` prop (estimated_1rm + exercise).
 *
 * Query keys deliberately match the goals page (`['goals','active']`) and the
 * detail modal (`['goal-projection', id]`) so all three share one cache —
 * opening a goal after this strip renders hits cache, never refetches.
 */
export function LiftingGoalsStrip({
  prefill,
  onPrefillConsumed,
}: {
  prefill: GoalPrefill | null;
  onPrefillConsumed: () => void;
}) {
  const { authFetch, token } = useAuthFetch();
  const [showCreate, setShowCreate] = useState(false);
  const [modalSeed, setModalSeed] = useState<{ metric?: string; exercise?: string }>({});

  const { data: goals } = useQuery<Goal[]>({
    queryKey: ['goals', 'active'],
    queryFn: () => listGoals(authFetch, 'active'),
    enabled: !!token,
    staleTime: 60_000,
  });

  const liftingGoals = useMemo(() => {
    const mine = (goals ?? []).filter(isLiftingMetric);
    // Most urgent first: dated goals before undated, then earliest due,
    // then most-progressed — same tiebreak family as the goals page sort.
    mine.sort((a, b) => {
      const ad = a.target_date ?? '';
      const bd = b.target_date ?? '';
      if ((ad === '') !== (bd === '')) return ad === '' ? 1 : -1;
      if (ad !== bd) return ad.localeCompare(bd);
      return goalProgressPct(b) - goalProgressPct(a);
    });
    return mine.slice(0, 3);
  }, [goals]);

  const projections = useGoalProjections(liftingGoals);

  // PR-card "Set goal" entry: open the create modal prefilled and ack the
  // signal so a second tap on the same exercise re-fires via a new nonce.
  useEffect(() => {
    if (!prefill) return;
    setModalSeed({ metric: prefill.metric, exercise: prefill.exercise });
    setShowCreate(true);
    onPrefillConsumed();
    // onPrefillConsumed is stable (useCallback) — safe to run once per nonce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.nonce]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true">🎯</span>
              Lifting Goals
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setModalSeed({});
                setShowCreate(true);
              }}
              className="min-h-[44px] px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
            >
              + New goal
            </button>
          </div>
        </div>
      </CardHeader>

      {liftingGoals.length === 0 ? (
        <p className="text-sm text-muted">
          No active lifting goals.{' '}
          <button
            onClick={() => {
              setModalSeed({ metric: 'estimated_1rm' });
              setShowCreate(true);
            }}
            className="text-accent hover:text-accent-hover transition-colors"
          >
            Set a 1RM target →
          </button>
        </p>
      ) : (
        <ul className="space-y-2">
          {liftingGoals.map((goal) => {
            const progress = goalProgressPct(goal);
            const badge = goalDisplayBadge(goal, projections.get(goal.id) ?? null);
            const label = goal.metric_label || goal.metric;
            const filterLabel = goal.filter_json?.exercise;
            return (
              <li key={goal.id}>
                <Link
                  href="/goals"
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-light/40 transition-colors"
                  title={`${label}${filterLabel ? ` — ${filterLabel}` : ''}: ${progress.toFixed(0)}%`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {filterLabel || label}
                    </p>
                    <div className="h-1.5 bg-surface-light/40 rounded-full overflow-hidden mt-1">
                      <div
                        className="h-full bg-accent rounded-full transition-all duration-700"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-xs text-muted tabular-nums shrink-0">
                    {progress.toFixed(0)}%
                  </span>
                  {badge && (
                    <span className={`text-[11px] px-2 py-0.5 rounded font-medium shrink-0 ${badge.className}`}>
                      {badge.label}
                    </span>
                  )}
                  {goal.target_date && (
                    <span className="text-[11px] text-muted shrink-0 hidden sm:inline">
                      {new Date(goal.target_date).toLocaleDateString(getActiveLocale(), {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Link
        href="/goals"
        className="mt-3 inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover transition-colors"
      >
        View all goals
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </Link>

      {showCreate && (
        <GoalCreateModal
          key={`${modalSeed.metric ?? ''}:${modalSeed.exercise ?? ''}`}
          initialMetric={modalSeed.metric}
          initialExercise={modalSeed.exercise}
          onClose={() => setShowCreate(false)}
        />
      )}
    </Card>
  );
}
