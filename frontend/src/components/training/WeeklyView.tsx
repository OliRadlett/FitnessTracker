'use client';

/**
 * WeeklyView — Phase 5B weekly planning view.
 *
 * A sibling of PlanBuilder (5A) that shows ONE Monday-aligned week of the
 * active plan at a time: readiness strip (CTL/ATL/TSB + recommended zone),
 * 7 day cards with weather + actuals, and an expandable detail panel with
 * route matching ("Assign") and quick-edit fields.
 *
 * Data comes from GET /training-plans/{id}/week/{n}?include_weather=true
 * and edits go through targeted single-day PATCHes — unlike PlanBuilder,
 * which saves the FULL days array. These two views never share save state.
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Flag, X } from 'lucide-react';
import type {
  TrainingPlan,
  TrainingWeekDay,
  PlanDayType,
  RefreshTargetsResponse,
  Event,
} from '@/lib/api';
import { useAuthFetch, getPlanWeek, updatePlanDay, getPlanConformity, linkPlanActivities, refreshTargets, listGoals } from '@/lib/api';
import { apiFetch } from '@/lib/api/fetch';
import type { TsbProjectionResponse } from '@/lib/api';
import { getActiveLocale } from '@/lib/utils';
import {
  toDateStr,
  addDays,
  diffDays,
  getWeek1Start,
  getTotalWeeks,
  getCurrentWeek,
} from '@/lib/training/week';
import { usePlanDayOps } from '@/lib/training/usePlanDayOps';
import { useToast } from '@/components/ui/Toast';
import { WeekMasterBar } from './WeekMasterBar';
import { ConformitySummaryCard } from './ConformitySummaryCard';
import { PlanGoalsStrip } from './PlanGoalsStrip';
import { MissedDayPopover } from './MissedDayPopover';
import { SPORT_ICON } from './dayCellShared';
import { DayEditor } from './plan/DayEditor';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { useIsMobile } from '@/lib/useIsMobile';
import { UnplannedStrip } from './plan/UnplannedStrip';
import { ProgramMatrix } from './plan/ProgramMatrix';
import { BlockTools } from './plan/BlockTools';
import { RoutePickerModal } from './RoutePickerModal';
import { AdaptiveSuggestionsCard } from './AdaptiveSuggestionsCard';
import { WahooPushModal } from './WahooPushModal';
import { StrengthSuggestionsCard } from './StrengthSuggestionsCard';

// ─── Constants ────────────────────────────────────────────────────────────

/** Zone ceiling → dot colour for the readiness strip. */
const ZONE_DOT_COLORS: Record<string, string> = {
  z1: 'bg-green-400',
  z2: 'bg-green-400',
  z3: 'bg-yellow-400',
  z4: 'bg-orange-400',
  z5: 'bg-red-400',
};

// ─── Date helpers ─────────────────────────────────────────────────────────

// Week math lives in @/lib/training/week (shared with PlanBuilder / Today)
// and mirrors the backend exactly:
//   week1_start = plan.start_date − weekday(plan.start_date)
//   total_weeks = ((end − week1_start).days // 7) + 1

// ─── Small formatters ─────────────────────────────────────────────────────

function tsbColor(tsb: number): string {
  if (tsb > 5) return 'text-positive';
  if (tsb >= -10) return 'text-warning';
  if (tsb >= -20) return 'text-orange-400';
  return 'text-warning';
}

/** Short day label, e.g. "Mon 6 Oct". */
function fmtDayLabel(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(getActiveLocale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** One step easier — the default substitute for a missed session. */
function downgradeType(t: PlanDayType): PlanDayType {
  switch (t) {
    case 'race':
      return 'hard';
    case 'hard':
      return 'moderate';
    case 'moderate':
      return 'easy';
    default:
      return 'easy';
  }
}

// ─── Component ────────────────────────────────────────────────────────────

interface WeeklyViewProps {
  plan: TrainingPlan;
  events?: Event[];
  /**
   * Phase 2 deep-link landing (`?day=YYYY-MM-DD` from goal cards): the week
   * containing this date opens initially, the day auto-expands, and the card
   * scrolls into view + highlights. Null when no deep link is present.
   */
  highlightDate?: string | null;
}

/** 1-based week number containing `dateStr`, clamped to the plan's range. */
function weekNumberForDate(startDate: string, endDate: string, dateStr: string): number {
  const total = getTotalWeeks(startDate, endDate);
  const raw = Math.floor(diffDays(getWeek1Start(startDate), dateStr) / 7) + 1;
  return Math.min(total, Math.max(1, raw));
}

export function WeeklyView({ plan, events, highlightDate }: WeeklyViewProps) {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();

  const totalWeeks = useMemo(
    () => getTotalWeeks(plan.start_date, plan.end_date),
    [plan.start_date, plan.end_date],
  );
  const [currentWeek, setCurrentWeek] = useState(() =>
    highlightDate
      ? weekNumberForDate(plan.start_date, plan.end_date, highlightDate)
      : getCurrentWeek(plan.start_date, plan.end_date),
  );
  const [expandedDayId, setExpandedDayId] = useState<string | null>(null);
  const [view, setView] = useState<'week' | 'all' | 'program'>('week');
  const isMobile = useIsMobile();
  const [showRoutePicker, setShowRoutePicker] = useState(false);
  const [showWahooPush, setShowWahooPush] = useState(false);
  const [missedDayId, setMissedDayId] = useState<string | null>(null);

  const realCurrentWeek = getCurrentWeek(plan.start_date, plan.end_date);
  const todayStr = toDateStr(new Date());

  // FL1 — last refresh-targets result (counts + CP/FTP cross-check), shown
  // until the next week navigation or refresh.
  const [refreshResult, setRefreshResult] = useState<RefreshTargetsResponse | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // ── Query ───────────────────────────────────────────────────────────────
  const weekQuery = useQuery({
    queryKey: ['plan-week', plan.id, currentWeek],
    queryFn: () => getPlanWeek(authFetch, plan.id, currentWeek),
    staleTime: 60_000,
    enabled: !!token,
  });

  // Phase 5C — plan-wide conformity for the summary strip (overall %, trend,
  // per-sport chips, patterns). staleTime 60s to match the week query.
  const conformityQuery = useQuery({
    queryKey: ['plan-conformity', plan.id],
    queryFn: () => getPlanConformity(plan.id, undefined, token),
    staleTime: 60_000,
    enabled: !!token,
  });

  // Phase 7 — TSB projection. Available for every plan: the backend no longer
  // requires an event link, so an unlinked plan projects to its window end
  // (labelled "Projected TSB") while an event-linked plan projects to race day.
  const tsbProjectionQuery = useQuery({
    queryKey: ['tsb-projection', plan.id],
    queryFn: () =>
      apiFetch<TsbProjectionResponse>(
        `/api/v1/projections/tsb/${plan.id}?days=14`,
        {},
        token,
      ),
    staleTime: 5 * 60_000,
    enabled: !!token,
  });

   // Phase 2 — active goals for the plan → goal direction (day cards show a
  // target count badge, the expanded panel lists supporting goals). Shares the
  // ['goals', 'active'] cache entry with the goals page — no extra fetch.
  const goalsQuery = useQuery({
    queryKey: ['goals', 'active'],
    queryFn: () => listGoals(authFetch, 'active'),
    staleTime: 60_000,
    enabled: !!token,
  });
  const activeGoals = useMemo(() => goalsQuery.data ?? [], [goalsQuery.data]);

  const invalidateWeeks = () => {    queryClient.invalidateQueries({ queryKey: ['plan-week', plan.id] });
    // Completion toggles / edits change scoring inputs → refresh both.
    queryClient.invalidateQueries({ queryKey: ['plan-conformity', plan.id] });
    queryClient.invalidateQueries({ queryKey: ['day-conformity'] });
    queryClient.invalidateQueries({ queryKey: ['adaptive-suggestions', plan.id] });
    // Keep PlanBuilder's local state in sync when user switches views.
    queryClient.invalidateQueries({ queryKey: ['training-plan', plan.id] });
    queryClient.invalidateQueries({ queryKey: ['training-plans'] });
  };

  // FL1 — re-anchor upcoming cycle (+%e1RM strength) targets to current FTP/PRs.
  const refreshTargetsMutation = useMutation({
    mutationFn: () => refreshTargets(authFetch, plan.id),
    onSuccess: (data) => {
      setRefreshResult(data);
      setRefreshError(null);
      queryClient.invalidateQueries({ queryKey: ['plan-week', plan.id, currentWeek] });
      queryClient.invalidateQueries({ queryKey: ['plan-conformity', plan.id] });
      queryClient.invalidateQueries({ queryKey: ['adaptive-suggestions', plan.id] });
    },
    onError: (err: Error) => {
      setRefreshError(err.message);
    },
  });

  const linkActivities = useMutation({
    mutationFn: () => linkPlanActivities(plan.id, token),
    onSuccess: () => {
      invalidateWeeks();
    },
    onError: (err: Error) => {
      console.error('[WeeklyView] Link activities failed:', err);
    },
  });

  // ── Mutations ───────────────────────────────────────────────────────────
  const toggleCompleted = useMutation({
    mutationFn: ({ dayId, completed }: { dayId: string; completed: boolean }) =>
      updatePlanDay(authFetch, plan.id, dayId, { completed }),
    onSuccess: invalidateWeeks,
    onError: (err: Error) => {
      console.error('[WeeklyView] Toggle completed failed:', err);
    },
  });

  const assignRoute = useMutation({
    mutationFn: ({ dayId, routeId }: { dayId: string; routeId: string }) =>
      updatePlanDay(authFetch, plan.id, dayId, { planned_route_id: routeId }),
    onSuccess: invalidateWeeks,
    onError: (err: Error) => {
      console.error('[WeeklyView] Assign route failed:', err);
    },
  });

  const unassignRoute = useMutation({
    mutationFn: (dayId: string) =>
      updatePlanDay(authFetch, plan.id, dayId, { planned_route_id: null }),
    onSuccess: invalidateWeeks,
    onError: (err: Error) => {
      console.error('[WeeklyView] Unassign route failed:', err);
    },
  });

  const { error: toastError } = useToast();
  const ops = usePlanDayOps(plan.id);
  const opBusy = ops.moveDay.isPending || ops.substituteDay.isPending;

  // Missed-day quick actions — real operations. The PATCH API cannot change a
  // day's date, so "move" uses the dedicated /reschedule endpoint (409 when the
  // target slot is taken); "substitute"/"mark rest" use /substitute.
  const handleMissedReschedule = () => {
    if (!missedDay || !missedNextDay) return;
    ops.moveDay.mutate(
      { dayId: missedDay.id, targetDate: missedNextDay.day_date.slice(0, 10) },
      { onError: (err: Error) => toastError(err.message || 'Could not move that day') },
    );
    setMissedDayId(null);
  };

  const handleMissedSubstitute = () => {
    if (!missedDay) return;
    ops.substituteDay.mutate(
      {
        dayId: missedDay.id,
        payload: { sport: missedDay.sport, planned_type: downgradeType(missedDay.planned_type) },
      },
      { onError: (err: Error) => toastError(err.message || 'Could not substitute that day') },
    );
    setMissedDayId(null);
  };

  const handleMissedMarkRest = () => {
    if (!missedDay) return;
    ops.substituteDay.mutate(
      { dayId: missedDay.id, payload: { sport: 'rest', planned_type: 'rest' } },
      { onError: (err: Error) => toastError(err.message || 'Could not mark that day as rest') },
    );
    setMissedDayId(null);
  };

  // Drag-and-drop on the week grid: drop onto an occupied (uncompleted) day to
  // swap, or onto an empty slot to move. Completed days are refused.
  const handleDropDate = (sourceDate: string, targetDate: string) => {
    const source = daysByDate.get(sourceDate);
    if (!source || source.completed) {
      toastError("Completed days can't be moved");
      return;
    }
    const target = daysByDate.get(targetDate);
    if (target) {
      if (target.completed) {
        toastError("Completed days can't be swapped");
        return;
      }
      ops.swapDays.mutate(
        { dayId: source.id, targetDayId: target.id },
        { onError: (err: Error) => toastError(err.message || 'Could not swap those days') },
      );
    } else {
      ops.moveDay.mutate(
        { dayId: source.id, targetDate },
        { onError: (err: Error) => toastError(err.message || 'Could not move that day') },
      );
    }
  };

  // ── Derived data ────────────────────────────────────────────────────────
  const weekData = weekQuery.data;
  const weekStart = weekData?.week_start ?? addDays(getWeek1Start(plan.start_date), (currentWeek - 1) * 7);
  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const daysByDate = useMemo(() => {
    const map = new Map<string, TrainingWeekDay>();
    weekData?.days.forEach((d) => map.set(d.day_date.slice(0, 10), d));
    return map;
  }, [weekData]);

  // All-weeks overview: per-week planned load + sport mix, from the plan's days.
  const weekSummaries = useMemo(
    () =>
      Array.from({ length: totalWeeks }, (_, wi) => {
        const dates = Array.from({ length: 7 }, (_, i) =>
          addDays(getWeek1Start(plan.start_date), wi * 7 + i),
        );
        const days = dates.map((d) => plan.days.find((pd) => pd.day_date.slice(0, 10) === d));
        return {
          weekIndex: wi,
          totalTss: Math.round(days.reduce((s, d) => s + (d?.planned_tss || 0), 0)),
          rides: days.filter((d) => d?.sport === 'cycle').length,
          strength: days.filter((d) => d?.sport === 'strength').length,
          rest: days.filter((d) => !d || d.sport === 'rest').length,
        };
      }),
    [totalWeeks, plan.start_date, plan.days],
  );

  const readiness = weekData?.readiness ?? null;

  // Expanded day lookup — the day object for the currently expanded card, used
  // by the full-width ExpandedPanel rendered below the 7-column grid.
  const expandedDay = useMemo(() => {
    if (!expandedDayId) return null;
    return weekDates.map((d) => daysByDate.get(d)).find((d) => d?.id === expandedDayId) ?? null;
  }, [expandedDayId, weekDates, daysByDate]);

  // Missed-day quick actions (V3): the missed day + the following day it can
  // move to (within the visible week only — the PATCH cannot change day_date,
  // so a "move" swaps the two days' planned content instead).
  const missedDay = useMemo(() => {
    if (!missedDayId) return null;
    return weekDates.map((d) => daysByDate.get(d)).find((d) => d?.id === missedDayId) ?? null;
  }, [missedDayId, weekDates, daysByDate]);
  const missedNextDay = useMemo(() => {
    if (!missedDay) return null;
    const idx = weekDates.indexOf(missedDay.day_date.slice(0, 10));
    if (idx < 0 || idx >= weekDates.length - 1) return null;
    return daysByDate.get(weekDates[idx + 1]) ?? null;
  }, [missedDay, weekDates, daysByDate]);

  // Phase 2 `?day=` landing: jump to the week holding the date, auto-expand
  // the day, scroll its card into view. Runs once per deep-link date — week
  // jumps wait for the new week's data before expanding.
  const highlightDone = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightDate || highlightDone.current === highlightDate) return;
    const targetWeek = weekNumberForDate(plan.start_date, plan.end_date, highlightDate);
    if (targetWeek !== currentWeek) {
      setCurrentWeek(targetWeek);
      return;
    }
    // Only latch once the day is actually present — otherwise the effect marks
    // itself done before the week payload resolves and never expands the day.
    const day = weekData?.days.find((d) => d.day_date.slice(0, 10) === highlightDate);
    if (!day) return;
    highlightDone.current = highlightDate;
    setExpandedDayId(day.id);
    requestAnimationFrame(() => {
      document.getElementById(`plan-day-${highlightDate}`)?.scrollIntoView({ block: 'center' });
    });
  }, [highlightDate, weekData, currentWeek, plan.start_date, plan.end_date]);

  // Conformity strip data: overall/trend are plan-wide; per-sport chips come
  // from the currently viewed week when available (else the latest scored one).
  const conformity = conformityQuery.data ?? null;
  const sportChips = useMemo(() => {
    if (!conformity?.weeks.length) return [] as Array<[string, number]>;
    const week =
      conformity.weeks.find((w) => w.week_number === currentWeek) ??
      [...conformity.weeks].reverse().find((w) => w.days_scored > 0);
    const entries = Object.entries(week?.by_sport ?? {}).filter(
      ([sport, pct]) => sport !== 'rest' && pct != null,
    );
    return entries as Array<[string, number]>;
  }, [conformity, currentWeek]);

  // FL1 — upcoming cycle days whose stored targets drifted from current FTP.
  const staleDays = useMemo(
    () => (weekData?.days ?? []).filter((d) => d.targets_stale),
    [weekData],
  );

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-lg font-semibold text-foreground">
          Week {currentWeek} of {totalWeeks}
          <span className="text-sm font-normal text-muted ml-2">
            {weekStart} → {addDays(weekStart, 6)}
          </span>
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-surface-light/30">
            {(['week', 'all', 'program'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  view === v ? 'bg-accent text-white' : 'text-muted hover:text-foreground'
                }`}
              >
                {v === 'week' ? 'Week' : v === 'all' ? 'All weeks' : 'Program'}
              </button>
            ))}
          </div>
          {/* FL1 — week-level target refresh, emphasised while days are stale */}
          <button
            onClick={() => refreshTargetsMutation.mutate()}
            disabled={refreshTargetsMutation.isPending}
            title={
              staleDays.length > 0
                ? `${staleDays.length} day${staleDays.length > 1 ? 's' : ''} with stale targets — recompute from current FTP/PRs`
                : 'Recompute upcoming targets from current FTP/PRs'
            }
            className={`px-3 py-1 text-xs rounded-lg transition-colors disabled:opacity-40 ${
              staleDays.length > 0
                ? 'bg-accent text-white hover:bg-accent/80 font-medium'
                : 'bg-surface-light/50 text-muted hover:text-foreground hover:bg-surface-light'
            }`}
          >
            {refreshTargetsMutation.isPending
              ? 'Refreshing…'
              : staleDays.length > 0
                ? `⟳ Refresh targets (${staleDays.length} stale)`
                : '⟳ Refresh targets'}
          </button>
          {currentWeek !== realCurrentWeek && (
            <button
              onClick={() => setCurrentWeek(realCurrentWeek)}
              className="px-3 py-1 text-xs rounded-lg bg-surface-light/50 text-foreground hover:bg-surface-light"
            >
              Current
            </button>
          )}
          <button
            onClick={() => setCurrentWeek((w) => Math.max(1, w - 1))}
            disabled={currentWeek <= 1}
            aria-label="Previous week"
            className="px-3 py-1 rounded-lg bg-surface-light/50 text-foreground hover:bg-surface-light disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ‹
          </button>
          {/* Week jump (2.5) — dropdown instead of a 20-pill wrap */}
          <select
            value={currentWeek}
            onChange={(e) => setCurrentWeek(Number(e.target.value))}
            aria-label="Jump to week"
            className="px-2 py-1 text-xs rounded-lg bg-surface-light/50 text-foreground hover:bg-surface-light focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {Array.from({ length: totalWeeks }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>
                Week {w}{w === realCurrentWeek ? ' •' : ''}
              </option>
            ))}
          </select>
          <button
            onClick={() => setCurrentWeek((w) => Math.min(totalWeeks, w + 1))}
            disabled={currentWeek >= totalWeeks}
            aria-label="Next week"
            className="px-3 py-1 rounded-lg bg-surface-light/50 text-foreground hover:bg-surface-light disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ›
          </button>
        </div>
      </div>

      {/* FL1 — refresh outcome + CP/FTP cross-check */}
      {refreshError && (
        <p className="text-xs text-warning">Refresh failed: {refreshError}</p>
      )}
      {refreshResult && !refreshError && (
        <div className="space-y-1">
          <p className="text-xs text-muted">
          <Check className="w-3 h-3 text-positive inline mr-1" />
          Refreshed {refreshResult.refreshed.length} cycle day
            {refreshResult.refreshed.length === 1 ? '' : 's'}
            {refreshResult.strength_refreshed.length > 0 &&
              ` + ${refreshResult.strength_refreshed.length} strength exercise${refreshResult.strength_refreshed.length === 1 ? '' : 's'}`}
            {refreshResult.stale_but_unchanged.length > 0 &&
              ` (${refreshResult.stale_but_unchanged.length} stale but unchanged)`}
            .
          </p>
          {refreshResult.cp_ftp_mismatch && (
            <p
              className="text-xs text-warning"
              title="Zones stay FTP-anchored; fitted critical power is shown for reference only"
            >
               <AlertTriangle className="w-3 h-3 text-warning inline mr-1" />
               Fitted critical power ({Math.round(refreshResult.cp_ftp_mismatch.critical_power)}W)
              differs from FTP ({Math.round(refreshResult.cp_ftp_mismatch.ftp)}W) by{' '}
              {refreshResult.cp_ftp_mismatch.pct_diff.toFixed(0)}% — check your FTP is current.
            </p>
          )}
        </div>
      )}

      {/* Readiness strip */}
      {readiness && (
        <div className="flex items-center gap-3 flex-wrap px-3 py-2 rounded-lg bg-surface-light/30 border border-surface-light/50">
          <span className="text-xs font-medium text-muted uppercase tracking-wide">Readiness</span>
          <span className="text-xs text-foreground">
            CTL <span className="font-semibold">{readiness.ctl.toFixed(0)}</span>
          </span>
          <span className="text-xs text-foreground">
            ATL <span className="font-semibold">{readiness.atl.toFixed(0)}</span>
          </span>
          <span className={`text-xs ${tsbColor(readiness.tsb)}`}>
            TSB <span className="font-semibold">{readiness.tsb.toFixed(1)}</span>
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span
              className={`h-2 w-2 rounded-full ${
                ZONE_DOT_COLORS[readiness.recommended_max_zone.toLowerCase()] ?? 'bg-muted'
              }`}
            />
            Up to {readiness.recommended_max_zone.toUpperCase()} this week
          </span>
        </div>
      )}

      {/* Conformity summary strip (Phase 5C) — extracted to ConformitySummaryCard */}
      <ConformitySummaryCard
        conformity={conformity}
        sportChips={sportChips}
        onLinkActivities={() => linkActivities.mutate()}
        linking={linkActivities.isPending}
      />

      {/* Active goals this plan supports — V3 goals strip */}
      <PlanGoalsStrip goals={activeGoals} />

      {/* Adaptive suggestions card (§3.11) */}
      <AdaptiveSuggestionsCard planId={plan.id} />

      {/* Smart strength suggestions — weight updates based on prior-week conformity */}
      {plan.plan_type === 'strength' && (
        <StrengthSuggestionsCard planId={plan.id} />
      )}

      {/* TSB projection strip (Phase 7) — event-linked plans only */}
      {tsbProjectionQuery.data && (() => {
        const tsb = tsbProjectionQuery.data;
        const assessment = tsb.freshness_assessment;
        const raceDayTsb = tsb.race_day_tsb;
        const assessmentColor = assessment === 'Optimal freshness'
          ? 'text-positive'
          : assessment === 'Neutral'
            ? 'text-foreground'
            : assessment === 'Slightly fatigued'
              ? 'text-warning'
              : 'text-warning';
        return (
          <div className="flex items-center gap-3 flex-wrap px-3 py-2 rounded-lg bg-surface-light/20 border border-surface-light/40">
            <span className="text-xs font-medium text-muted uppercase tracking-wide">
              {tsb.event_date ? 'Race TSB' : 'Projected TSB'}
            </span>
            {raceDayTsb != null && (
              <span className={`text-sm font-semibold ${tsbColor(raceDayTsb)}`}>
                {raceDayTsb >= 0 ? '+' : ''}{raceDayTsb.toFixed(1)}
              </span>
            )}
            {assessment && (
              <span className={`text-xs font-medium ${assessmentColor}`}>
                — {assessment}
              </span>
            )}
            {tsb.event_date && (
              <span className="text-[10px] text-muted ml-auto">
                {tsb.event_date}
              </span>
            )}
          </div>
        );
      })()}

      {/* Loading / error states */}
      {weekQuery.isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-44 rounded-xl bg-surface-light/30 animate-pulse" />
          ))}
        </div>
      )}
      {weekQuery.isError && (
        <p className="text-sm text-warning">
          Failed to load week: {(weekQuery.error as Error).message}
        </p>
      )}
      {conformityQuery.isError && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-warning text-sm">
          Failed to load conformity: {(conformityQuery.error as Error)?.message}
        </div>
      )}
      {tsbProjectionQuery.isError && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-warning text-sm">
          Failed to load TSB projection: {(tsbProjectionQuery.error as Error)?.message}
        </div>
      )}

      {/* All-weeks overview — per-week planned load + sport mix. */}
      {view === 'all' && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {weekSummaries.map((ws) => (
            <button
              key={ws.weekIndex}
              onClick={() => {
                setCurrentWeek(ws.weekIndex + 1);
                setView('week');
              }}
              className="bg-surface rounded-lg border border-surface-light/50 p-3 text-left hover:border-accent/40 transition-colors"
            >
              <p className="text-xs text-muted mb-1 font-semibold uppercase tracking-wider">
                Week {ws.weekIndex + 1}
              </p>
              <p className="text-lg font-bold text-foreground">
                {ws.totalTss} <span className="text-xs font-normal text-muted">TSS</span>
              </p>
              <p className="text-xs text-muted mt-1">
                {ws.rides} ride{ws.rides === 1 ? '' : 's'} · {ws.strength} strength · {ws.rest} rest
              </p>
            </button>
          ))}
        </div>
      )}

      {view === 'program' && <ProgramMatrix plan={plan} />}

      {/* 7 day cards — responsive master bar (scroll on mobile, grid on xl) */}
      {view === 'week' && !weekQuery.isLoading && (
        <WeekMasterBar
          weekDates={weekDates}
          daysByDate={daysByDate}
          todayStr={todayStr}
          expandedDayId={expandedDayId}
          highlightDate={highlightDate}
          activeGoals={activeGoals}
          onToggleExpand={setExpandedDayId}
          onToggleCompleted={(dayId, completed) => toggleCompleted.mutate({ dayId, completed })}
          onOpenMissed={setMissedDayId}
          onDropDate={handleDropDate}
          busy={
            toggleCompleted.isPending ||
            assignRoute.isPending ||
            unassignRoute.isPending ||
            opBusy
          }
        />
      )}

      {view === 'week' && (
        <BlockTools
          planId={plan.id}
          week={currentWeek}
          planStart={plan.start_date}
          weekDays={weekData?.days ?? []}
        />
      )}

      {view === 'week' && (
        <UnplannedStrip planId={plan.id} week={currentWeek} days={weekData?.days ?? []} />
      )}

      {/* Day detail — inline on desktop, a bottom sheet on phones. */}
      {view === 'week' && expandedDay && !isMobile && (
        <div className="rounded-xl border border-accent/40 bg-surface-light/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground">
            {(() => { const Icon = SPORT_ICON[expandedDay.sport]; return Icon ? <Icon className="w-4 h-4 inline" /> : null; })()}
            {expandedDay.day_date.slice(0, 10)} details
            </h4>
            <button
              onClick={() => setExpandedDayId(null)}
              className="text-xs text-muted hover:text-foreground px-2 py-0.5 rounded hover:bg-surface-light/50 transition-colors"
            >
              <X className="w-3 h-3 mr-1" /> Close
            </button>
          </div>
          <DayEditor
            planId={plan.id}
            week={currentWeek}
            day={expandedDay}
            goals={activeGoals}
            onOpenRoutePicker={() => setShowRoutePicker(true)}
            onOpenWahooPush={() => setShowWahooPush(true)}
            onDeleted={() => setExpandedDayId(null)}
          />
        </div>
      )}

      {view === 'week' && expandedDay && isMobile && (
        <Modal open onClose={() => setExpandedDayId(null)} size="lg" aria-label="Day editor">
          <ModalHeader
            title={`${expandedDay.day_date.slice(0, 10)} details`}
            onClose={() => setExpandedDayId(null)}
            icon={(() => {
              const Icon = SPORT_ICON[expandedDay.sport];
              return Icon ? <Icon className="w-5 h-5" /> : undefined;
            })()}
          />
          <DayEditor
            planId={plan.id}
            week={currentWeek}
            day={expandedDay}
            goals={activeGoals}
            onOpenRoutePicker={() => setShowRoutePicker(true)}
            onOpenWahooPush={() => setShowWahooPush(true)}
            onDeleted={() => setExpandedDayId(null)}
          />
        </Modal>
      )}

      {/* Wahoo push modal — opened from the expanded panel */}
      <WahooPushModal
        open={showWahooPush}
        onClose={() => setShowWahooPush(false)}
        planId={plan.id}
        day={expandedDay}
      />

      {/* Route picker modal — opened from the expanded panel */}
      <RoutePickerModal
        open={showRoutePicker}
        onClose={() => setShowRoutePicker(false)}
        onSelect={(routeId) => {
          if (expandedDay) {
            assignRoute.mutate({ dayId: expandedDay.id, routeId });
          }
          setShowRoutePicker(false);
        }}
        onUnassign={() => {
          if (expandedDay) {
            unassignRoute.mutate(expandedDay.id);
          }
          setShowRoutePicker(false);
        }}
        currentRouteId={expandedDay?.planned_route_id}
      />

      {/* Missed-day quick actions (V3) — opened from a missed day cell */}
      <MissedDayPopover
        open={!!missedDay}
        onClose={() => setMissedDayId(null)}
        dayLabel={missedDay ? fmtDayLabel(missedDay.day_date.slice(0, 10)) : ''}
        nextDayLabel={missedNextDay ? fmtDayLabel(missedNextDay.day_date.slice(0, 10)) : null}
        onReschedule={handleMissedReschedule}
        onSubstitute={handleMissedSubstitute}
        onMarkRest={handleMissedMarkRest}
        busy={opBusy}
      />

      {/* Events context (read-only hint when this week contains an event) */}
      {events?.some(
        (e) => e.event_date >= weekStart && e.event_date <= addDays(weekStart, 6),
      ) && (
        <p className="text-xs text-muted">
          <Flag className="w-3 h-3 inline mr-1" />Event this week:{' '}
          {events
            .filter((e) => e.event_date >= weekStart && e.event_date <= addDays(weekStart, 6))
            .map((e) => e.name)
            .join(', ')}
        </p>
      )}
    </div>
  );
}

// ─── (the expanded day panel moved to plan/DayEditor) ─────────────────────
