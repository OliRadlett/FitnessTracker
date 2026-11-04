'use client';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { listGoals, useAuthFetch } from '@/lib/api';
import type { Event, Goal, TrainingPlan } from '@/lib/api';
import { usePageTitle } from '@/lib/usePageTitle';
import { useDeepLink } from '@/lib/useDeepLink';
import { useTrainingShell } from '@/lib/training/useTrainingShell';
import {
  planCoverage,
  todayStr,
  weekNumberForDate,
  type Coverage,
} from '@/lib/training/coverage';
import { getTotalWeeks } from '@/lib/training/week';
import { TrainingSpine, type TrainingView } from '@/components/training/week/TrainingSpine';
import { WeekSurface } from '@/components/training/week/WeekSurface';
import { PlanCoverage } from '@/components/training/week/PlanCoverage';
import { EventsView } from '@/components/training/week/EventsView';
import { PlansModal } from '@/components/training/week/PlansModal';
import { SkeletonRow } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';

/**
 * `/training` — two surfaces and one question.
 *
 * **Week** (default): what you are doing this week, whether the plan still covers
 * it, and the one change worth making.
 * **Plan**: the 20-week object, with the boundary where the written plan stops.
 *
 * Replaces the Plan · Review · Peaks · Plans mode switcher. Review's charts live on
 * `/analytics`. Plans management is a modal from the spine. Peaks keeps its own
 * view (`?view=events`) rather than becoming a strip on the coverage grid — an
 * event editor is a surface, and deleting a working one is worse than one extra
 * view. Recorded as a deviation in `PRODUCTION.md`.
 */
export default function TrainingPage() {
  usePageTitle('Training');
  const { authFetch, token } = useAuthFetch();
  const { getParam, setParam } = useDeepLink();
  const shell = useTrainingShell();
  const [plansOpen, setPlansOpen] = useState(false);

  const today = todayStr();

  const viewParam = getParam('view');
  const view: TrainingView | 'events' =
    viewParam === 'plan' ? 'plan' : viewParam === 'events' ? 'events' : 'week';

  const setView = (next: TrainingView | 'events') => setParam('view', next === 'week' ? null : next);

  const coverage: Coverage | null = useMemo(
    () => (shell.selectedPlan ? planCoverage(shell.selectedPlan, today) : null),
    [shell.selectedPlan, today],
  );

  const totalWeeks = shell.selectedPlan
    ? getTotalWeeks(shell.selectedPlan.start_date, shell.selectedPlan.end_date)
    : 1;
  const currentWeek = shell.selectedPlan
    ? weekNumberForDate(shell.selectedPlan.start_date, shell.selectedPlan.end_date, today)
    : 1;
  const weekParam = Number(getParam('w'));
  const weekNumber =
    Number.isFinite(weekParam) && weekParam >= 1 && weekParam <= totalWeeks ? weekParam : currentWeek;

  const setWeek = (n: number) => setParam('w', n === currentWeek ? null : String(n));

  const { data: events } = useQuery<Event[]>({
    queryKey: ['events', 'upcoming'],
    queryFn: () => authFetch<Event[]>('/api/v1/events?upcoming_only=true'),
    enabled: !!token,
  });

  const { data: activeGoals } = useQuery<Goal[]>({
    queryKey: ['goals', 'active'],
    queryFn: () => listGoals(authFetch, 'active'),
    enabled: !!token,
  });

  const plan: TrainingPlan | null = shell.selectedPlan ?? null;

  return (
    <div className="pb-28 md:pb-6">
      <TrainingSpine
        plan={plan}
        coverage={coverage}
        plans={shell.plans}
        view={view === 'events' ? 'plan' : view}
        weekNumber={weekNumber}
        onView={setView}
        onWeek={(n) => {
          setWeek(n);
          if (view === 'events') setView('week');
        }}
        onSelectPlan={shell.setSelectedPlanId}
        onOpenPlans={() => setPlansOpen(true)}
        onMore={() => setPlansOpen(true)}
      />

      <div className="px-4 md:px-6">
        {shell.planLoading && !plan ? (
          <div className="mx-auto w-full max-w-[1180px] space-y-3" aria-label="Loading plan">
            <SkeletonRow className="h-20" />
            <SkeletonRow className="h-40" />
          </div>
        ) : shell.plansError ? (
          <ErrorState
            title="Couldn't load plans"
            message="Check your connection and try again."
            onRetry={() => shell.refetchPlans()}
          />
        ) : !plan || !coverage ? (
          <div className="mx-auto w-full max-w-[1180px] rounded-xl border border-surface-light/50 bg-surface p-8 text-center">
            <h2 className="mb-2 text-lg font-semibold text-foreground">No plan yet</h2>
            <p className="mb-6 text-muted">
              The training page is the plan&apos;s control room — create one and this page becomes
              the week you are actually running.
            </p>
            <button
              type="button"
              onClick={() => setPlansOpen(true)}
              className="inline-flex min-h-[44px] items-center rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Create a plan
            </button>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[1180px]">
            {view === 'week' && (
              <WeekSurface
                plan={plan}
                coverage={coverage}
                weekNumber={weekNumber}
                today={today}
                goals={activeGoals ?? []}
                highlightDate={shell.highlightDate}
                onViewPlan={() => setView('plan')}
              />
            )}

            {view === 'plan' && (
              <>
                <PlanCoverage
                  plan={plan}
                  coverage={coverage}
                  today={today}
                  onWeek={(n) => {
                    setWeek(n);
                    setView('week');
                  }}
                />
                <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-3">
                  <button
                    type="button"
                    onClick={() => setView('events')}
                    className="inline-flex min-h-[44px] items-center rounded-lg border border-white/10 px-3 text-sm text-foreground hover:bg-white/[0.05]"
                  >
                    Events &amp; races
                    {events && events.length > 0 ? ` · ${events.length}` : ''}
                  </button>
                  <span className="text-xs text-muted">
                    A race or target ride gives the plan a taper to work back from.
                  </span>
                </div>
              </>
            )}

            {view === 'events' && <EventsView onBack={() => setView('plan')} />}
          </div>
        )}
      </div>

      {plan && (
        <PlansModal
          open={plansOpen}
          onClose={() => setPlansOpen(false)}
          plans={shell.plans}
          selectedPlanId={plan.id}
          plansLoading={shell.plansLoading}
          onSelect={(id) => {
            shell.setSelectedPlanId(id);
            setPlansOpen(false);
          }}
          onChanged={() => {
            if (plan) shell.invalidatePlan(plan.id);
          }}
        />
      )}
    </div>
  );
}
