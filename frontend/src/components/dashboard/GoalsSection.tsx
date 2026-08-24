'use client';

import React from 'react';
import Link from 'next/link';
import type { Goal } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { GoalCard } from '@/components/ui/GoalCard';

/**
 * Compact dashboard goals section — top-3 active goals with progress bars,
 * plus a "View all →" link to the dedicated /goals page.
 */
export function GoalsSection({ goals }: { goals: Goal[] | undefined }) {
  const activeGoals = (goals ?? [])
    .filter((g) => g.status === 'active')
    .sort((a, b) => (b.progress_pct ?? 0) - (a.progress_pct ?? 0))
    .slice(0, 3);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-muted uppercase tracking-wider">Goals</h2>
        <Link
          href="/goals"
          className="text-xs text-accent hover:text-accent-hover transition-colors"
        >
          View all →
        </Link>
      </div>

      {activeGoals.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeGoals.map((goal) => (
            <GoalCard key={goal.id} goal={goal} />
          ))}
        </div>
      ) : (
        <Card>
          <div className="text-center py-6">
            <p className="text-3xl mb-2">🎯</p>
            <p className="text-muted text-sm">No active goals</p>
            <Link
              href="/goals"
              className="text-accent hover:text-accent-hover text-xs mt-1 inline-block"
            >
              Set your first goal
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
