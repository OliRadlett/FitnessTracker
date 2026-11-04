'use client';

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';

import { ErrorState } from '@/components/ui/ErrorState';

import {
  extendPlan,
  getAdaptiveSuggestions,
  getPlanReview,
  getPlanWeek,
  getUnplannedActuals,
  useAuthFetch,
} from '@/lib/api';
import type { Goal, TrainingPlan, TrainingWeekResponse } from '@/lib/api';
import {
  planHasStrengthDays,
  planStopsBefore,
  weekDates,
  type Coverage,
} from '@/lib/training/coverage';
import { newSessionPayload } from '@/lib/training/sessionGroups';
import { usePlanDayOps } from '@/lib/training/usePlanDayOps';
import { PickActiveSport } from './PickActiveSport';
import { WeekRows } from './WeekRows';
import { EmptyWeek } from './EmptyWeek';
import { ChangesPanel } from './ChangesPanel';
import { RoutePickerModal } from '../RoutePickerModal';
import { WahooPushModal } from '../WahooPushModal';
import { StrengthSuggestionsCard } from '../StrengthSuggestionsCard';

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const rangeLabel = (start: string, end: string): string => {
  const a = new Date(start + 'T00:00:00');
  const b = new Date(end + 'T00:00:00');
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${MONTH[b.getMonth()]}`
    : `${a.getDate()} ${MONTH[a.getMonth()]} – ${b.getDate()} ${MONTH[b.getMonth()]}`;
};

/**
 * The week surface: what you are doing this week, whether the plan still covers
 * it, and the one change worth making.
 *
 * Requests: the week payload, the live suggestions, the persisted review and the
 * unplanned actuals. The old page additionally pulled four chart payloads on
 * every mode, gated only on a token — so visiting Plan mode downloaded Review's
 * charts too.
 */
export function WeekSurface({
  plan,
  coverage,
  weekNumber,
  today,
  goals,
  highlightDate,
  onViewPlan,
}: {
  plan: TrainingPlan;
  coverage: Coverage;
  weekNumber: number;
  today: string;
  goals: Goal[];
  highlightDate?: string | null;
  onViewPlan: () => void;
}) {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const ops = usePlanDayOps(plan.id);
  const [expandedDate, setExpandedDate] = useState<string | null>(highlightDate ?? null);
  const [routePicker, setRoutePicker] = useState(false);
  const [wahooPush, setWahooPush] = useState(false);
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [extendError, setExtendError] = useState<string | null>(null);

  const weekQuery = useQuery<TrainingWeekResponse>({
    queryKey: ['plan-week', plan.id, weekNumber],
    queryFn: () => getPlanWeek(authFetch, plan.id, weekNumber, { includeWeather: false }),
    enabled: !!token,
  });

  const suggestionsQuery = useQuery({
    queryKey: ['adaptive-suggestions', plan.id],
    queryFn: () => getAdaptiveSuggestions(authFetch, plan.id),
    enabled: !!token,
    staleTime: 60_000,
  });

  const reviewQuery = useQuery({
    queryKey: ['plan-review', plan.id],
    queryFn: () => getPlanReview(authFetch, plan.id),
    enabled: !!token,
    staleTime: 60_000,
  });

  const unplannedQuery = useQuery({
    queryKey: ['plan-unplanned', plan.id, 14],
    queryFn: () => getUnplannedActuals(authFetch, plan.id, 14),
    enabled: !!token,
    staleTime: 60_000,
  });

  /**
   * The seven dates come from the payload's `week_start` when the payload is in,
   * because the server is the authority on what "week N" means (plan weeks are
   * Monday-aligned from the plan's start, which need not be a Monday). Plan math
   * is only the pre-load stand-in.
   */
  const dates = useMemo(() => {
    const start = weekQuery.data?.week_start;
    if (start) {
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start.slice(0, 10) + 'T00:00:00');
        d.setDate(d.getDate() + i);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      });
    }
    return weekDates(plan.start_date, weekNumber);
  }, [weekQuery.data?.week_start, plan.start_date, weekNumber]);
  const days = weekQuery.data?.days ?? [];
  const written = days.length > 0;

  // `?day=` (goal cards link here): open that day and bring it into view. The
  // effect must re-run when the week payload lands — on a cold load the rows do
  // not exist yet, so a mount-only effect scrolls nothing.
  React.useEffect(() => {
    if (!highlightDate) return;
    const el = document.getElementById(`plan-day-${highlightDate}`);
    if (!el) return;
    setExpandedDate(highlightDate);
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightDate, weekNumber, days.length]);
  const sessions = days.filter((d) => d.sport !== 'rest').length;
  const missed = days.filter((d) => d.day_status === 'missed').length;
  const expandedDay = expandedDate ? days.find((d) => d.day_date.slice(0, 10) === expandedDate) : undefined;

  const addOn = (date: string) => setPickingFor(date);

  /**
   * Fill the plan forward. One primitive serves both empty-week actions: the
   * week, and the whole rest of the plan. The server fills only dates with no
   * day, so this is safe to retry and cannot overwrite authored work.
   */
  const extend = useMutation({
    mutationFn: (until: string) => extendPlan(authFetch, plan.id, until),
    onMutate: () => setExtendError(null),
    onError: (e: Error) => setExtendError(e.message || "Couldn't write the plan forward"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['training-plan', plan.id] });
      queryClient.invalidateQueries({ queryKey: ['plan-week', plan.id] });
      queryClient.invalidateQueries({ queryKey: ['training-plans'] });
      queryClient.invalidateQueries({ queryKey: ['plan-unplanned', plan.id] });
      queryClient.invalidateQueries({ queryKey: ['adaptive-suggestions', plan.id] });
      queryClient.invalidateQueries({ queryKey: ['plan-review', plan.id] });
    },
  });

  const add = (date: string, sport: 'cycle' | 'strength' | 'rest') => {
    setPickingFor(null);
    if (sport === 'rest') {
      ops.addDay.mutate({ day_date: date, sport: 'rest', planned_type: 'rest' });
    } else {
      ops.addDay.mutate(newSessionPayload(date, sport));
    }
  };

  const moveMissed = (dayId: string, date: string) => {
    const day = days.find((d) => d.id === dayId);
    if (!day) return;
    // Next date in this week that has no plan entry at all.
    const target = dates.find((d) => d > date && !days.some((x) => x.day_date.slice(0, 10) === d));
    if (!target) return;
    ops.moveDay.mutate({ dayId: day.id, targetDate: target });
  };

  const stopsEarly = planStopsBefore(plan, today);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 pb-3">
        <div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="text-base font-semibold text-foreground">Week {weekNumber}</h2>
            <span className="text-sm text-muted">
              {rangeLabel(dates[0], dates[6])}
            </span>
            {written ? (
              <span className="text-sm text-muted">· {sessions} {sessions === 1 ? 'session' : 'sessions'}</span>
            ) : (
              <span className="text-sm text-caution">· nothing written</span>
            )}
            {missed > 0 && <span className="text-sm font-medium text-warning">· {missed} missed</span>}
          </div>
          {written && (
            <p className="mt-0.5 text-xs text-muted">
              {days.some((d) => (d.planned_tss ?? 0) > 0)
                ? `Planned ${days.reduce((s, d) => s + (d.planned_tss ?? 0), 0)} TSS`
                : 'No planned load recorded'}
            </p>
          )}
        </div>
        {written && (
          <button
            type="button"
            onClick={() => setPickingFor(dates.find((d) => d >= today) ?? dates[0])}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" />
            Add a day
          </button>
        )}
      </div>

      {weekQuery.isLoading ? (
        <div className="space-y-2" aria-label="Loading week">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-surface-light/30" />
          ))}
        </div>
      ) : weekQuery.isError ? (
        <ErrorState
          title="Couldn't load this week"
          message="Check your connection and try again."
          onRetry={() => weekQuery.refetch()}
        />
      ) : !written ? (
        <EmptyWeek
          weekNumber={weekNumber}
          dates={dates}
          coverage={coverage}
          planEnd={plan.end_date}
          unplannedCount={(unplannedQuery.data?.activities?.length ?? 0) + (unplannedQuery.data?.lifting_sessions?.length ?? 0)}
          unplannedDays={unplannedQuery.data?.days ?? 14}
          today={today}
          busy={ops.addDay.isPending || extend.isPending}
          onAdd={add}
          onWriteWeek={() => extend.mutate(dates[6])}
          onExtend={() => extend.mutate(plan.end_date)}
          onViewPlan={onViewPlan}
        />
      ) : (
        <WeekRows
          planId={plan.id}
          weekNumber={weekNumber}
          dates={dates}
          days={days}
          today={today}
          expandedDate={expandedDate}
          onExpand={setExpandedDate}
          goals={goals}
          onOpenRoutePicker={() => setRoutePicker(true)}
          onOpenWahooPush={() => setWahooPush(true)}
          onMoveMissed={moveMissed}
          onAddOn={addOn}
        />
      )}

      {extendError && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
        >
          {extendError}
        </p>
      )}

      <ChangesPanel suggestions={suggestionsQuery.data} review={reviewQuery.data} />

      {/*
        S1–S4 strength programming. Previously gated on `plan_type === 'strength'`,
        which meant a `custom` plan — including the owner's — never rendered it.
        The correct key is whether the plan has strength days at all.
      */}
      {planHasStrengthDays(plan) && (
        <div className="mt-4">
          <StrengthSuggestionsCard planId={plan.id} />
        </div>
      )}

      {stopsEarly && coverage.firstUnwrittenWeek != null && (
        <p className="mt-3 text-xs text-muted">
          Week {weekNumber} is inside the plan&apos;s range; the plan itself stops at{' '}
          {coverage.lastSessionDate ? coverage.lastSessionDate.slice(8, 10) : '—'} {coverage.lastSessionDate
            ? MONTH[Number(coverage.lastSessionDate.slice(5, 7)) - 1]
            : ''}
          .{' '}
          <button type="button" onClick={onViewPlan} className="text-accent hover:underline">
            See where it stops
          </button>
        </p>
      )}

      {pickingFor && (
        <PickActiveSport
          date={pickingFor}
          busy={ops.addDay.isPending}
          onPick={(sport) => add(pickingFor, sport)}
          onCancel={() => setPickingFor(null)}
        />
      )}

      <RoutePickerModal
        open={routePicker}
        onClose={() => setRoutePicker(false)}
        onSelect={() => setRoutePicker(false)}
        onUnassign={() => setRoutePicker(false)}
        currentRouteId={expandedDay?.planned_route_id ?? undefined}
      />

      <WahooPushModal
        open={wahooPush}
        onClose={() => setWahooPush(false)}
        planId={plan.id}
        day={expandedDay ?? null}
      />
    </>
  );
}
