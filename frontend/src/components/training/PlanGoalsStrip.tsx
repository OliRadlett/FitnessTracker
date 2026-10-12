'use client';

/**
 * PlanGoalsStrip — V3 compact strip of active goals above the weekly master bar.
 *
 * Keeps goals visible where the user plans training, without the full /goals
 * surface. Renders nothing when there are no active goals (the goals page is
 * the place to create them).
 */

import React from 'react';
import Link from 'next/link';
import { Target } from 'lucide-react';
import type { Goal } from '@/lib/api';
import { goalProgressPct, formatGoalValue } from '@/components/ui/GoalCard';

export interface PlanGoalsStripProps {
  goals: Goal[];
}

export function PlanGoalsStrip({ goals }: PlanGoalsStripProps) {
  const active = goals.filter((g) => g.status === 'active');
  if (active.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted uppercase tracking-wide">
          <Target className="w-3.5 h-3.5 text-accent" />
          Goals this plan supports
        </span>
        <Link
          href="/goals"
          className="text-xs text-accent hover:text-accent-hover transition-colors"
        >
          View all →
        </Link>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 snap-x">
        {active.map((goal) => {
          const pct = Math.round(goalProgressPct(goal));
          const label = goal.metric_label || goal.metric;
          return (
            <Link
              key={goal.id}
              href="/goals"
              className="shrink-0 w-[200px] snap-start rounded-xl border border-surface-light/50 bg-surface-light/20 hover:bg-surface-light/30 p-3 space-y-1.5 transition-colors"
            >
              <p className="text-xs font-medium text-foreground truncate" title={label}>
                {label}
              </p>
              <div className="w-full bg-surface-light rounded-full h-1.5">
                <div
                  className={`rounded-full h-1.5 ${pct >= 100 ? 'bg-positive' : 'bg-accent'}`}
                  style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                />
              </div>
              <p className="text-[10px] text-muted">
                {pct}%
                {' · '}
                {goal.current_value != null
                  ? `${formatGoalValue(goal.current_value, goal.metric_unit)} / ${formatGoalValue(goal.target_value, goal.metric_unit)}`
                  : `Target: ${formatGoalValue(goal.target_value, goal.metric_unit)}`}
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
