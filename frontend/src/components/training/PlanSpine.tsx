'use client';

import React, { useMemo } from 'react';
import { Calendar, Plus } from 'lucide-react';

import type { Event, TrainingPlan, TrainingPlanSummary } from '@/lib/api';
import { PlanSwitcher } from './PlanSwitcher';
import { LoadStrip } from './LoadStrip';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-surface-light/20 text-muted border-muted/30',
  active: 'bg-green-500/20 text-positive border-green-500/30',
  completed: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  archived: 'bg-surface-light/20 text-muted border-muted/30',
};

export interface PlanSpineProps {
  plan: TrainingPlan | null;
  plans: TrainingPlanSummary[];
  plansLoading?: boolean;
  events: Event[];
  onSelectPlan: (planId: string) => void;
  /** Opens the Plans surface (`?mode=plans`) — switcher "Manage plans" + New. */
  onOpenPlans: () => void;
}

/**
 * PlanSpine — the persistent plan context bar that frames every training mode:
 * which plan, how far through, and the way to switch or manage plans.
 *
 * Read-only in this phase: renaming/activating/deleting still live in
 * `PlanBuilder`'s header until the Plan mode owns them (Phase 1), so the spine
 * deliberately does not duplicate those controls.
 */
export function PlanSpine({
  plan,
  plans,
  plansLoading,
  events,
  onSelectPlan,
  onOpenPlans,
}: PlanSpineProps) {
  const summary = useMemo(
    () => plans.find((p) => p.id === plan?.id),
    [plans, plan?.id],
  );
  const pct =
    summary && summary.day_count > 0
      ? Math.round((summary.completed_days / summary.day_count) * 100)
      : 0;

  return (
    <div className="rounded-xl border border-surface-light/60 bg-surface p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {plan ? (
            <>
              <h2 className="text-xl font-bold text-foreground truncate" title={plan.name}>
                {plan.name}
              </h2>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border capitalize ${
                    STATUS_COLORS[plan.status] ?? STATUS_COLORS.draft
                  }`}
                >
                  {plan.status}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full border bg-accent/10 border-accent/30 text-accent capitalize">
                  {plan.plan_type}
                </span>
                <span className="text-xs text-muted hidden sm:inline-flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {plan.start_date} → {plan.end_date}
                </span>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">
              {plansLoading ? 'Loading plans…' : 'No plan selected'}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <PlanSwitcher
            plans={plans}
            selectedPlanId={plan?.id ?? null}
            onSelect={onSelectPlan}
            onManage={onOpenPlans}
          />
          <button
            type="button"
            onClick={onOpenPlans}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New plan
          </button>
        </div>
      </div>

      {plan && summary && (
        <div>
          <div className="w-full bg-surface-light rounded-full h-1.5">
            <div className="bg-accent rounded-full h-1.5" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-muted mt-0.5">
            {summary.completed_days}/{summary.day_count} days · {pct}%
          </p>
        </div>
      )}

      {plan && (
        <div className="hidden sm:block">
          <LoadStrip plan={plan} events={events} />
        </div>
      )}
    </div>
  );
}
