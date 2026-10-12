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
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, MapPin, Target, Check, Flag, X, Upload } from 'lucide-react';
import type {
  Goal,
  TrainingPlan,
  TrainingWeekDay,
  UpdateTrainingPlanDayPayload,
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
import { goalProgressPct } from '@/components/ui/GoalCard';
import { goalsForPlanDay, goalShortLabel } from '@/components/goals/goalPlanLinks';
import { WeekMasterBar } from './WeekMasterBar';
import { ConformitySummaryCard } from './ConformitySummaryCard';
import { PlanGoalsStrip } from './PlanGoalsStrip';
import { MissedDayPopover } from './MissedDayPopover';
import { SPORT_ICON } from './dayCellShared';
import { useAutoregulationMap } from '@/components/lifting/AutoregulationCard';
import { DayConformityPanel } from './DayConformityPanel';
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

/** Extract the PATCH-able planning fields from a day (used for day→day moves). */
function planningFields(day: TrainingWeekDay): UpdateTrainingPlanDayPayload {
  return {
    sport: day.sport,
    planned_type: day.planned_type,
    planned_tss: day.planned_tss,
    planned_duration_min: day.planned_duration_min,
    workout_description: day.workout_description,
    planned_focus: day.planned_focus ?? null,
    planned_exercises: day.planned_exercises ?? null,
    planned_rpe: day.planned_rpe ?? null,
    planned_power_watts: day.planned_power_watts,
    planned_zone: day.planned_zone ?? null,
    planned_route_id: day.planned_route_id ?? null,
    warmup_template_id: day.warmup_template_id ?? null,
    notes: day.notes ?? null,
  };
}

/** A rest day's planning fields — clears any planned workout. */
const REST_FIELDS: UpdateTrainingPlanDayPayload = {
  sport: 'rest',
  planned_type: 'rest',
  planned_tss: null,
  planned_duration_min: null,
  workout_description: null,
  planned_focus: null,
  planned_exercises: null,
  planned_rpe: null,
  planned_power_watts: null,
  planned_zone: null,
  planned_route_id: null,
  warmup_template_id: null,
};

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

  const quickEdit = useMutation({
    mutationFn: ({
      dayId,
      payload,
    }: {
      dayId: string;
      payload: UpdateTrainingPlanDayPayload;
    }) => updatePlanDay(authFetch, plan.id, dayId, payload),
    onSuccess: invalidateWeeks,
    onError: (err: Error) => {
      console.error('[WeeklyView] Quick edit failed:', err);
    },
  });

  // V3 missed-day quick actions. A true date-move is not PATCH-able, so
  // "move to next day" swaps the two days' planned content.
  const handleMissedReschedule = () => {
    if (!missedDay) return;
    if (missedNextDay) {
      const srcFields = planningFields(missedDay);
      const nextFields = planningFields(missedNextDay);
      quickEdit.mutate({ dayId: missedNextDay.id, payload: srcFields });
      quickEdit.mutate({ dayId: missedDay.id, payload: nextFields });
    } else {
      quickEdit.mutate({ dayId: missedDay.id, payload: REST_FIELDS });
    }
    setMissedDayId(null);
  };

  const handleMissedMarkRest = () => {
    if (!missedDay) return;
    quickEdit.mutate({ dayId: missedDay.id, payload: REST_FIELDS });
    setMissedDayId(null);
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
    highlightDone.current = highlightDate;
    const day = weekData?.days.find((d) => d.day_date.slice(0, 10) === highlightDate);
    if (!day) return;
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
        <div className="flex items-center gap-2">
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

      {/* 7 day cards — responsive master bar (scroll on mobile, grid on xl) */}
      {!weekQuery.isLoading && (
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
          busy={
            toggleCompleted.isPending ||
            assignRoute.isPending ||
            unassignRoute.isPending ||
            quickEdit.isPending
          }
        />
      )}

      {/* Full-width expanded day detail panel — renders UNDERNEATH the 7-column grid */}
      {expandedDay && (
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
          <ExpandedPanel
            day={expandedDay}
            planId={plan.id}
            goals={activeGoals}
            busy={
              toggleCompleted.isPending ||
              assignRoute.isPending ||
              unassignRoute.isPending ||
              quickEdit.isPending
             }
            onUnassignRoute={() => unassignRoute.mutate(expandedDay.id)}
            onQuickEdit={(payload) =>
              quickEdit.mutate({ dayId: expandedDay.id, payload })
            }
            onOpenRoutePicker={() => setShowRoutePicker(true)}
            onOpenWahooPush={() => setShowWahooPush(true)}
          />
        </div>
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
        onMarkRest={handleMissedMarkRest}
        busy={quickEdit.isPending}
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

// ─── Expanded panel ───────────────────────────────────────────────────────

function ExpandedPanel({
  day,
  planId,
  goals,
  busy,
  onUnassignRoute,
  onQuickEdit,
  onOpenRoutePicker,
  onOpenWahooPush,
}: {
  day: TrainingWeekDay;
  planId: string;
  /** Active goals (Phase 2 plan → goal cross-links). */
  goals: Goal[];
  busy: boolean;
  onUnassignRoute: () => void;
  onQuickEdit: (payload: UpdateTrainingPlanDayPayload) => void;
  onOpenRoutePicker: () => void;
  onOpenWahooPush: () => void;
}) {
  const [duration, setDuration] = useState(day.planned_duration_min?.toString() ?? '');
  const [tss, setTss] = useState(day.planned_tss?.toString() ?? '');
  const [notes, setNotes] = useState(day.notes ?? '');
  // B-17: autoregulated suggestions for planned strength exercises.
  const autoMap = useAutoregulationMap();
  // Phase 2: active goals this day's training supports (display-only match).
  const dayGoals = useMemo(() => goalsForPlanDay(goals, day), [goals, day]);

  const handleSave = () => {
    const payload: UpdateTrainingPlanDayPayload = {};
    if (duration !== '') payload.planned_duration_min = parseInt(duration, 10) || null;
    if (tss !== '') payload.planned_tss = parseFloat(tss) || null;
    payload.notes = notes;
    onQuickEdit(payload);
  };

  return (
    <div
      className="pt-2 mt-1 border-t border-surface-light/50 space-y-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      {day.workout_description && (
        <p className="text-[11px] text-foreground/80 whitespace-pre-wrap">{day.workout_description}</p>
      )}

      {/* Strength exercise table */}
      {day.sport === 'strength' && day.planned_exercises && day.planned_exercises.length > 0 && (
        <div className="overflow-x-auto -mx-1">
        <table className="w-full text-[9px] text-muted">
          <thead>
            <tr className="text-left">
              <th className="font-medium">Exercise</th>
              <th className="font-medium">Sets×Reps</th>
              <th className="font-medium">kg</th>
              <th className="font-medium">RPE</th>
            </tr>
          </thead>
          <tbody>
            {day.planned_exercises.map((ex, i) => (
              <tr key={`${ex.exercise}-${i}`} className="border-t border-surface-light/30">
                <td className="py-0.5 text-foreground/90 truncate max-w-[80px]" title={ex.exercise}>
                  {ex.exercise}
                </td>
                <td className="py-0.5">
                  {ex.sets}×{ex.reps}
                </td>
                <td className="py-0.5">
                  {ex.weight_kg != null ? ex.weight_kg : '—'}
                  {(() => {
                    const hint = autoMap.get((ex.exercise ?? '').toLowerCase());
                    if (!hint || hint.suggestedWeightKg == null || hint.deltaKg === 0) return null;
                    return (
                      <span className="text-accent" title={hint.reason}>
                        {' '}→{hint.suggestedWeightKg}
                      </span>
                    );
                  })()}
                </td>
                <td className="py-0.5">{ex.rpe != null ? ex.rpe : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {/* Cycle power targets */}
      {day.sport === 'cycle' && (day.planned_power_watts != null || day.planned_zone) && (
        <p className="text-[10px] text-muted">
          Targets:{' '}
          {[
            day.planned_power_watts != null && `${Math.round(day.planned_power_watts)}W`,
            day.planned_zone && day.planned_zone.toUpperCase(),
          ]
            .filter(Boolean)
            .join(' · ') || '—'}
        </p>
      )}

      {/* Route assignment (cycle days only) */}
      {day.sport === 'cycle' && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-muted uppercase tracking-wide">
            Route
          </p>
          {day.actual_activity?.route_id ? (
            <div className="flex items-center gap-2">
              <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-positive/15 text-positive border border-positive/30 truncate">
                {day.actual_activity.route_name || 'Linked route'}
              </span>
            </div>
          ) : day.planned_route_id ? (
            <div className="flex items-center gap-2">
              <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-positive/15 text-positive border border-positive/30 truncate">
                {day.route_matches?.find(m => m.route_id === day.planned_route_id)?.name || 'Route assigned'}
              </span>
              <button
                onClick={onOpenRoutePicker}
                className="text-[10px] text-accent hover:text-accent/80 shrink-0"
              >
                Change
              </button>
              <button
                onClick={onUnassignRoute}
                disabled={busy}
                className="text-[10px] text-warning hover:text-warning/80 disabled:opacity-50 shrink-0"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenRoutePicker}
              className="text-[10px] text-accent hover:text-accent/80"
            >
              <MapPin className="w-3 h-3 mr-1" /> Pick a route...
            </button>
          )}
        </div>
      )}

      {/* Wahoo push (cycle days only) */}
      {day.sport === 'cycle' && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-muted uppercase tracking-wide">
            Wahoo
          </p>
          {day.wahoo_pushed_at ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30">
                Pushed {new Date(day.wahoo_pushed_at).toLocaleDateString(getActiveLocale())}
                {day.wahoo_push_workout ? ' · workout' : ''}
                {day.wahoo_route_id ? ' · route' : ''}
              </span>
              <button
                onClick={onOpenWahooPush}
                className="text-[10px] text-accent hover:text-accent/80 shrink-0"
              >
                Manage
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenWahooPush}
              className="text-[10px] text-accent hover:text-accent/80"
            >
              <Upload className="w-3 h-3 inline mr-1" /> Push to Wahoo
            </button>
          )}
        </div>
      )}

      {/* Phase 2 plan → goal cross-links: active goals this day supports. */}
      {dayGoals.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted uppercase tracking-wide">
            Supports goals
          </p>
          {dayGoals.map((g) => {
            const progress = goalProgressPct(g);
            return (
              <Link
                key={g.id}
                href="/goals"
                title={`View ${goalShortLabel(g)} in goals`}
                className="flex min-h-[44px] items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-surface-light/40 transition-colors"
              >
                <Target className="w-3 h-3 text-accent" aria-hidden="true" />
                <span className="text-xs text-foreground truncate">{goalShortLabel(g)}</span>
                <span className="text-xs text-muted tabular-nums shrink-0">{progress.toFixed(0)}%</span>
                <span className="ml-auto text-accent text-xs shrink-0" aria-hidden="true">→</span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Notes */}
      {day.notes && !notes && <p className="text-[11px] text-muted italic">{day.notes}</p>}

       {/* Quick edit (cycle days only — strength/week view is read-only for metrics) */}
      {day.sport === 'cycle' && (
        <div className="flex gap-1">
          <label className="block flex-1">
            <span className="block text-[9px] text-muted mb-0.5">Min</span>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-full px-1 py-0.5 bg-background border border-surface-light rounded text-foreground text-[10px] focus:outline-none focus:border-accent"
            />
          </label>
          <label className="block flex-1">
            <span className="block text-[9px] text-muted mb-0.5">TSS</span>
            <input
              type="number"
              value={tss}
              onChange={(e) => setTss(e.target.value)}
              className="w-full px-1 py-0.5 bg-background border border-surface-light rounded text-foreground text-[10px] focus:outline-none focus:border-accent"
            />
          </label>
        </div>
      )}
       {/* Notes (all sport types) */}
       <input
        type="text"
        placeholder="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="w-full px-1 py-0.5 bg-background border border-surface-light rounded text-foreground text-[10px] focus:outline-none focus:border-accent"
      />
      <button
        onClick={handleSave}
        disabled={busy}
        className="w-full px-2 py-1 bg-accent/20 text-accent rounded text-[10px] font-medium hover:bg-accent/30 disabled:opacity-50"
      >
        Save
      </button>

      {/* Phase 5C — plan-vs-actual conformity scoring for this day.
          Mounted only while expanded → lazy query runs on open. */}
      <DayConformityPanel planId={planId} day={day} />
    </div>
  );
}
