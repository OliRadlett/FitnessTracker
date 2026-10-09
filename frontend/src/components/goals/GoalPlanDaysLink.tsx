'use client';

// Compact goal → plan-day cross-link for goal cards (ui-redesign-v2 Phase 2):
// "3 push days scheduled →" deep-links to the earliest matching plan day.
// Renders nothing while loading, without an active plan, or with no upcoming
// matching days — an absent link is the honest state, never a placeholder.

import React, { useMemo } from 'react';
import Link from 'next/link';
import type { Goal } from '@/lib/api';
import { toDateStr } from '@/lib/training/week';
import { useGoalPlanSchedule } from './useGoalPlanSchedule';
import { buildPlanDayHref, describePlanMatch, matchGoalPlanDays } from './goalPlanLinks';

export function GoalPlanDaysLink({ goal }: { goal: Goal }) {
  const { planId, planName, days, isLoading } = useGoalPlanSchedule();
  const todayStr = useMemo(() => toDateStr(new Date()), []);

  const matched = useMemo(
    () => (planId ? matchGoalPlanDays(goal, days, todayStr) : []),
    [goal, days, todayStr, planId],
  );

  if (isLoading || !planId || matched.length === 0) return null;

  const summary = describePlanMatch(goal, matched);
  const firstDate = matched[0].day_date.slice(0, 10);

  return (
    <Link
      href={buildPlanDayHref(planId, firstDate)}
      onClick={(e) => e.stopPropagation()}
      title={planName ? `Scheduled in ${planName} — view in training plan` : 'View in training plan'}
      aria-label={`${summary} scheduled${planName ? ` in ${planName}` : ''} — view in training plan`}
      className="mt-2 inline-flex min-h-[44px] items-center gap-1 text-xs text-accent hover:text-accent-hover transition-colors"
    >
      {summary} scheduled
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}
