'use client';

import React from 'react';
import { ChevronLeft, ChevronRight, Ellipsis } from 'lucide-react';

import type { TrainingPlan, TrainingPlanSummary } from '@/lib/api';
import type { Coverage } from '@/lib/training/coverage';
import { CoverageRail } from './CoverageRail';
import { PlanSwitcher } from '../PlanSwitcher';

const shortDate = (iso: string): string => {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`;
};

const STATUS_STYLE: Record<string, string> = {
  draft: 'border-white/10 text-muted',
  active: 'border-accent/25 bg-accent/10 text-accent',
  completed: 'border-info/30 bg-info/10 text-info',
  archived: 'border-white/10 text-muted',
};

export type TrainingView = 'week' | 'plan';

/**
 * The persistent plan context bar: which plan, how much of it exists, and how to
 * move through it.
 *
 * The coverage sentence is the load-bearing line. It answers the question the old
 * page could not — *is the plan still covering today?* — before any other content
 * on the page.
 */
export function TrainingSpine({
  plan,
  coverage,
  plans,
  view,
  weekNumber,
  onView,
  onWeek,
  onSelectPlan,
  onOpenPlans,
  onMore,
}: {
  plan: TrainingPlan | null;
  coverage: Coverage | null;
  plans: TrainingPlanSummary[];
  view: TrainingView;
  weekNumber: number;
  onView: (v: TrainingView) => void;
  onWeek: (n: number) => void;
  onSelectPlan: (id: string) => void;
  onOpenPlans: () => void;
  onMore?: () => void;
}) {
  const stopsEarly = coverage != null && coverage.uncoveredWeeks > 0;

  return (
    <header className="sticky top-0 z-10 -mx-4 mb-4 border-b border-white/[0.07] bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
              {plan?.name ?? 'Training'}
            </h1>
            {plan && (
              <>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${
                    STATUS_STYLE[plan.status] ?? STATUS_STYLE.draft
                  }`}
                >
                  {plan.status}
                </span>
                <span className="hidden rounded-full border border-white/10 px-2 py-0.5 text-xs capitalize text-muted sm:inline">
                  {plan.plan_type}
                </span>
              </>
            )}
          </div>

          {coverage && (
            <p className="mt-1 text-sm leading-snug" data-testid="coverage-sentence">
              <span className="text-foreground">
                {coverage.writtenWeeks} of {coverage.totalWeeks} weeks written
              </span>
              {coverage.lastSessionDate && (
                <span className="text-muted"> · last session {shortDate(coverage.lastSessionDate)}</span>
              )}
              {stopsEarly && (
                <>
                  <span className="text-muted"> · </span>
                  <span className="font-medium text-caution">
                    {coverage.uncoveredWeeks} weeks have no sessions
                  </span>
                </>
              )}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1">
          <div
            role="tablist"
            aria-label="Training view"
            className="flex items-center gap-0.5 rounded-lg bg-white/[0.04] p-0.5"
          >
            {(['week', 'plan'] as const).map((v) => (
              <button
                key={v}
                role="tab"
                type="button"
                aria-selected={view === v}
                onClick={() => onView(v)}
                className={`min-h-[44px] rounded-md px-3 text-sm font-medium capitalize transition-colors ${
                  view === v ? 'bg-accent text-white' : 'text-muted hover:text-foreground'
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          <div className="ml-1 flex items-center rounded-lg border border-white/10">
            <button
              type="button"
              aria-label="Previous week"
              onClick={() => onWeek(Math.max(1, weekNumber - 1))}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-white/[0.05] hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="tnum min-w-[62px] text-center text-sm text-foreground">
              Week {weekNumber}
            </span>
            <button
              type="button"
              aria-label="Next week"
              onClick={() => onWeek(Math.min(coverage?.totalWeeks ?? weekNumber, weekNumber + 1))}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-white/[0.05] hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {plans.length > 1 && (
            // Hidden below md: at 390 the switcher clipped to "Base Buildin…" and
            // pushed the overflow menu off the row entirely.
            <div className="hidden md:block">
              <PlanSwitcher
                plans={plans}
                selectedPlanId={plan?.id ?? null}
                onSelect={onSelectPlan}
                onManage={onOpenPlans}
              />
            </div>
          )}

          <button
            type="button"
            aria-label="More plan actions"
            onClick={onMore}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-white/[0.05] hover:text-foreground"
          >
            <Ellipsis className="h-4 w-4" />
          </button>
        </div>
      </div>

      {coverage && (
        <div className="mt-3" data-testid="coverage-rail">
          <CoverageRail
            weeks={coverage.weeks}
            onSelect={onWeek}
            interactive={view === 'plan' || false}
          />
          <div className="mt-1.5 flex items-center justify-between text-xs text-muted">
            <span>{plan ? shortDate(plan.start_date) : ''}</span>
            <span className="hidden sm:inline">
              {coverage.sessions} sessions · {coverage.restDays} rest days
            </span>
            <span>{plan ? shortDate(plan.end_date) : ''}</span>
          </div>
        </div>
      )}
    </header>
  );
}
