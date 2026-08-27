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

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  TrainingPlan,
  TrainingWeekDay,
  WeekRouteMatchEntry,
  UpdateTrainingPlanDayPayload,
  Event,
} from '@/lib/api';
import { useAuthFetch, getPlanWeek, updatePlanDay, getPlanConformity, linkPlanActivities } from '@/lib/api';
import { apiFetch } from '@/lib/api/fetch';
import type { TsbProjectionResponse } from '@/lib/api';
import { formatDuration, weatherEmoji } from '@/lib/utils';
import { ConformityBadge } from './ConformityBadge';
import { DayConformityPanel } from './DayConformityPanel';
import { RoutePickerModal } from './RoutePickerModal';

// ─── Constants ────────────────────────────────────────────────────────────

const SPORT_EMOJI: Record<string, string> = {
  cycle: '🚴',
  strength: '🏋️',
  rest: '😴',
};

const DAY_TYPE_BADGES: Record<string, string> = {
  rest: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  easy: 'bg-green-500/15 text-green-300 border-green-500/30',
  moderate: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  hard: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  race: 'bg-red-500/15 text-red-300 border-red-500/30',
};

const FOCUS_LABELS: Record<string, string> = {
  squat: 'Squat',
  bench: 'Bench',
  deadlift: 'Deadlift',
  overhead_press: 'Overhead Press',
  accessories: 'Accessories',
  full_body: 'Full Body',
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  upper: 'Upper',
  lower: 'Lower',
};

/** Zone ceiling → dot colour for the readiness strip. */
const ZONE_DOT_COLORS: Record<string, string> = {
  z1: 'bg-green-400',
  z2: 'bg-green-400',
  z3: 'bg-yellow-400',
  z4: 'bg-orange-400',
  z5: 'bg-red-400',
};

// ─── Date helpers ─────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

function diffDays(a: string, b: string): number {
  return Math.round(
    (new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000,
  );
}

function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  // JS getDay(): 0=Sun…6=Sat → convert to Mon-based offset
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return toDateStr(d);
}

/**
 * Week math mirrors the backend exactly:
 *   week1_start = plan.start_date − weekday(plan.start_date)
 *   total_weeks = ((end − week1_start).days // 7) + 1
 */
function getWeek1Start(plan: TrainingPlan): string {
  return mondayOf(plan.start_date);
}

function getTotalWeeks(plan: TrainingPlan): number {
  if (!plan.end_date) return 1;
  return Math.max(1, Math.floor(diffDays(getWeek1Start(plan), plan.end_date) / 7) + 1);
}

function getCurrentRealWeek(plan: TrainingPlan): number {
  const totalWeeks = getTotalWeeks(plan);
  const today = toDateStr(new Date());
  const raw = Math.floor(diffDays(getWeek1Start(plan), today) / 7) + 1;
  return Math.min(totalWeeks, Math.max(1, raw));
}

// ─── Small formatters ─────────────────────────────────────────────────────

/** Route match / confidence scores are 0–1 ratios; tolerate 0–100 too. */
function toPercent(v: number | null | undefined): string {
  if (v == null) return '—';
  const pct = v > 1 ? v : v * 100;
  return `${Math.round(pct)}%`;
}

function fmtKg(v: number | null | undefined): string {
  if (v == null) return '—';
  return v >= 1000 ? `${(v / 1000).toFixed(1)}t` : `${Math.round(v)}kg`;
}

function tsbColor(tsb: number): string {
  if (tsb > 5) return 'text-positive';
  if (tsb >= -10) return 'text-warning';
  if (tsb >= -20) return 'text-orange-400';
  return 'text-warning';
}

/** Simple status heuristic — real conformity scoring lands in Phase 5C. */
type DayStatus = 'done' | 'planned' | 'missed' | 'neutral';

function getStatus(day: TrainingWeekDay, todayStr: string): DayStatus {
  if (day.actual_activity || day.actual_lifting_session || day.completed) return 'done';
  if (day.sport === 'rest') return day.day_date >= todayStr ? 'planned' : 'neutral';
  if (day.day_date >= todayStr) return 'planned';
  return 'missed';
}

const STATUS_LABEL: Record<DayStatus, string> = {
  done: 'Done',
  planned: 'Planned',
  missed: 'Missed',
  neutral: '—',
};

/**
 * Phase 5C — map the card heuristic onto conformity badge statuses.
 * Rest days render nothing; future days are "pending"; past unlogged days
 * "missed"; logged/completed days "done" (score appears once the backend
 * has scored them via the expanded panel).
 */
function getBadgeStatus(day: TrainingWeekDay | undefined, status: DayStatus): string {
  if (!day || day.sport === 'rest') return 'rest';
  if (status === 'done') return 'done';
  if (status === 'missed') return 'missed';
  return 'pending';
}

/** Trend arrow for the weekly conformity strip. */
const TREND_ARROW: Record<string, { symbol: string; className: string }> = {
  improving: { symbol: '↑', className: 'text-positive' },
  declining: { symbol: '↓', className: 'text-warning' },
  stable: { symbol: '→', className: 'text-muted' },
};

// ─── Component ────────────────────────────────────────────────────────────

interface WeeklyViewProps {
  plan: TrainingPlan;
  events?: Event[];
}

export function WeeklyView({ plan, events }: WeeklyViewProps) {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();

  const totalWeeks = useMemo(() => getTotalWeeks(plan), [plan]);
  const [currentWeek, setCurrentWeek] = useState(() => getCurrentRealWeek(plan));
  const [expandedDayId, setExpandedDayId] = useState<string | null>(null);

  const realCurrentWeek = getCurrentRealWeek(plan);
  const todayStr = toDateStr(new Date());

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

  // Phase 7 — TSB projection for event-linked plans.
  const tsbProjectionQuery = useQuery({
    queryKey: ['tsb-projection', plan.id],
    queryFn: () =>
      apiFetch<TsbProjectionResponse>(
        `/api/v1/projections/tsb/${plan.id}?days=14`,
        {},
        token,
      ),
    staleTime: 5 * 60_000,
    enabled: !!token && !!plan.event_id,
  });

  const invalidateWeeks = () => {
    queryClient.invalidateQueries({ queryKey: ['plan-week', plan.id] });
    // Completion toggles / edits change scoring inputs → refresh both.
    queryClient.invalidateQueries({ queryKey: ['plan-conformity', plan.id] });
    queryClient.invalidateQueries({ queryKey: ['day-conformity'] });
    // Keep PlanBuilder's local state in sync when user switches views.
    queryClient.invalidateQueries({ queryKey: ['training-plan', plan.id] });
    queryClient.invalidateQueries({ queryKey: ['training-plans'] });
  };

  const linkActivities = useMutation({
    mutationFn: () => linkPlanActivities(plan.id, token),
    onSuccess: () => {
      invalidateWeeks();
    },
  });

  // ── Mutations ───────────────────────────────────────────────────────────
  const toggleCompleted = useMutation({
    mutationFn: ({ dayId, completed }: { dayId: string; completed: boolean }) =>
      updatePlanDay(authFetch, plan.id, dayId, { completed }),
    onSuccess: invalidateWeeks,
  });

  const assignRoute = useMutation({
    mutationFn: ({ dayId, routeId }: { dayId: string; routeId: string }) =>
      updatePlanDay(authFetch, plan.id, dayId, { planned_route_id: routeId }),
    onSuccess: invalidateWeeks,
  });

  const unassignRoute = useMutation({
    mutationFn: (dayId: string) =>
      updatePlanDay(authFetch, plan.id, dayId, { planned_route_id: null }),
    onSuccess: invalidateWeeks,
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
  });

  // ── Derived data ────────────────────────────────────────────────────────
  const weekData = weekQuery.data;
  const weekStart = weekData?.week_start ?? addDays(getWeek1Start(plan), (currentWeek - 1) * 7);
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

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-lg font-semibold text-white">
          Week {currentWeek} of {totalWeeks}
          <span className="text-sm font-normal text-muted ml-2">
            {weekStart} → {addDays(weekStart, 6)}
          </span>
        </h3>
        <div className="flex items-center gap-2">
          {currentWeek !== realCurrentWeek && (
            <button
              onClick={() => setCurrentWeek(realCurrentWeek)}
              className="px-3 py-1 text-xs rounded-lg bg-surface-light/50 text-white hover:bg-surface-light"
            >
              Current
            </button>
          )}
          <button
            onClick={() => setCurrentWeek((w) => Math.max(1, w - 1))}
            disabled={currentWeek <= 1}
            aria-label="Previous week"
            className="px-3 py-1 rounded-lg bg-surface-light/50 text-white hover:bg-surface-light disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ‹
          </button>
          <button
            onClick={() => setCurrentWeek((w) => Math.min(totalWeeks, w + 1))}
            disabled={currentWeek >= totalWeeks}
            aria-label="Next week"
            className="px-3 py-1 rounded-lg bg-surface-light/50 text-white hover:bg-surface-light disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ›
          </button>
        </div>
      </div>

      {/* Readiness strip */}
      {readiness && (
        <div className="flex items-center gap-3 flex-wrap px-3 py-2 rounded-lg bg-surface-light/30 border border-surface-light/50">
          <span className="text-xs font-medium text-muted uppercase tracking-wide">Readiness</span>
          <span className="text-xs text-white">
            CTL <span className="font-semibold">{readiness.ctl.toFixed(0)}</span>
          </span>
          <span className="text-xs text-white">
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

      {/* Conformity summary strip (Phase 5C) */}
      {conformity && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap px-3 py-2 rounded-lg bg-surface-light/30 border border-surface-light/50">
            <span className="text-xs font-medium text-muted uppercase tracking-wide">
              Conformity
            </span>
            {conformity.overall_pct != null ? (
              <span className="flex items-baseline gap-1">
                <span
                  className={`text-xl font-bold leading-none ${
                    conformity.overall_pct >= 80
                      ? 'text-positive'
                      : conformity.overall_pct >= 60
                        ? 'text-warning'
                        : 'text-warning'
                  }`}
                >
                  {Math.round(conformity.overall_pct)}%
                </span>
                <span className="text-[10px] text-muted">overall</span>
              </span>
            ) : (
              <span className="text-xs text-muted italic">No scored days yet</span>
            )}
            {conformity.trend && TREND_ARROW[conformity.trend] && (
              <span
                title={`${conformity.trend} vs previous weeks`}
                className={`text-base font-semibold ${TREND_ARROW[conformity.trend].className}`}
              >
                {TREND_ARROW[conformity.trend].symbol}
              </span>
            )}
            {sportChips.map(([sport, pct]) => (
              <span
                key={sport}
                className="inline-flex items-center gap-1 text-xs text-white bg-surface-light/60 rounded-full px-2 py-0.5"
                title={`${sport} adherence`}
              >
                <span>{SPORT_EMOJI[sport] ?? '📌'}</span>
                <span className="font-medium">{Math.round(pct)}%</span>
              </span>
            ))}
            <button
              onClick={() => linkActivities.mutate()}
              disabled={linkActivities.isPending}
              title="Auto-link synced activities/lifting sessions to plan days"
              className="ml-auto px-2 py-0.5 text-[10px] rounded-lg bg-surface-light/60 text-muted hover:text-white hover:bg-surface-light transition-colors disabled:opacity-40"
            >
              {linkActivities.isPending ? 'Linking…' : '🔗 Link activities'}
            </button>
          </div>

          {/* Detected patterns — subtle warning-tinted callout */}
          {conformity.patterns.length > 0 && (
            <div className="rounded-lg bg-warning/5 border border-warning/20 px-3 py-2">
              <ul className="space-y-0.5">
                {conformity.patterns.map((p, i) => (
                  <li key={i} className="text-[11px] text-warning/90 flex gap-1.5">
                    <span className="shrink-0">•</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* TSB projection strip (Phase 7) — event-linked plans only */}
      {tsbProjectionQuery.data && (() => {
        const tsb = tsbProjectionQuery.data;
        const assessment = tsb.freshness_assessment;
        const raceDayTsb = tsb.race_day_tsb;
        const assessmentColor = assessment === 'Optimal freshness'
          ? 'text-positive'
          : assessment === 'Neutral'
            ? 'text-white'
            : assessment === 'Slightly fatigued'
              ? 'text-warning'
              : 'text-warning';
        return (
          <div className="flex items-center gap-3 flex-wrap px-3 py-2 rounded-lg bg-surface-light/20 border border-surface-light/40">
            <span className="text-xs font-medium text-muted uppercase tracking-wide">Race TSB</span>
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

      {/* 7 day cards */}
      {!weekQuery.isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          {weekDates.map((date) => {
            const day = daysByDate.get(date);
            const dowLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
              weekday: 'short',
            });
            const dayLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
              day: 'numeric',
              month: 'short',
            });
            const isToday = date === todayStr;
            const expanded = !!day && expandedDayId === day.id;

            return (
              <DayCard
                key={date}
                date={date}
                dowLabel={dowLabel}
                dayLabel={dayLabel}
                isToday={isToday}
                day={day}
                todayStr={todayStr}
                expanded={expanded}
                planId={plan.id}
                onToggleExpand={() => day && setExpandedDayId(expanded ? null : day.id)}
                onToggleCompleted={(completed) =>
                  day &&
                  toggleCompleted.mutate({
                    dayId: day.id,
                    completed,
                  })
                }
                onAssignRoute={(routeId) =>
                  day && assignRoute.mutate({ dayId: day.id, routeId })
                }
                onUnassignRoute={() =>
                  day && unassignRoute.mutate(day.id)
                }
                onQuickEdit={(payload) => day && quickEdit.mutate({ dayId: day.id, payload })}
                busy={
                  toggleCompleted.isPending ||
                  assignRoute.isPending ||
                  unassignRoute.isPending ||
                  quickEdit.isPending
                }
              />
            );
          })}
        </div>
      )}

      {/* Events context (read-only hint when this week contains an event) */}
      {events?.some(
        (e) => e.event_date >= weekStart && e.event_date <= addDays(weekStart, 6),
      ) && (
        <p className="text-xs text-muted">
          🏁 Event this week:{' '}
          {events
            .filter((e) => e.event_date >= weekStart && e.event_date <= addDays(weekStart, 6))
            .map((e) => e.name)
            .join(', ')}
        </p>
      )}
    </div>
  );
}

// ─── Day card ─────────────────────────────────────────────────────────────

interface DayCardProps {
  date: string;
  dowLabel: string;
  dayLabel: string;
  isToday: boolean;
  day?: TrainingWeekDay;
  todayStr: string;
  expanded: boolean;
  planId: string;
  onToggleExpand: () => void;
  onToggleCompleted: (completed: boolean) => void;
  onAssignRoute: (routeId: string) => void;
  onUnassignRoute: () => void;
  onQuickEdit: (payload: UpdateTrainingPlanDayPayload) => void;
  busy: boolean;
}

function DayCard({
  date,
  dowLabel,
  dayLabel,
  isToday,
  day,
  todayStr,
  expanded,
  planId,
  onToggleExpand,
  onToggleCompleted,
  onAssignRoute,
  onUnassignRoute,
  onQuickEdit,
  busy,
}: DayCardProps) {
  const status = day ? getStatus(day, todayStr) : 'neutral';
  const badgeStatus = getBadgeStatus(day, status);
  const [showRoutePicker, setShowRoutePicker] = useState(false);

  return (
    <div
      className={`rounded-xl border p-3 space-y-2 cursor-pointer transition-colors ${
        expanded
          ? 'bg-surface-light/40 border-accent/40'
          : 'bg-surface-light/20 border-surface-light/50 hover:bg-surface-light/30'
      } ${isToday ? 'ring-1 ring-accent/60' : ''}`}
      onClick={onToggleExpand}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onToggleExpand();
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-1">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">
            {dowLabel}{' '}
            <span className="text-xs font-normal text-muted">{dayLabel}</span>
            {isToday && <span className="text-[10px] text-accent ml-1">•</span>}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {day?.sport === 'cycle' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowRoutePicker(true);
              }}
              className="text-[10px] px-1 rounded text-muted hover:text-accent"
              title={day?.planned_route_id ? 'Change route' : 'Assign route'}
            >
              🗺️
            </button>
          )}
          <ConformityBadge
            status={badgeStatus}
            title={STATUS_LABEL[status]}
          />
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (day) onToggleCompleted(!day.completed);
            }}
            disabled={!day || busy}
            aria-label={day?.completed ? 'Mark not completed' : 'Mark completed'}
            className={`text-xs px-1 rounded disabled:opacity-30 ${
              day?.completed ? 'text-positive' : 'text-muted hover:text-white'
            }`}
          >
            ✓
          </button>
        </div>
      </div>

      {!day ? (
        <p className="text-xs text-muted italic">No plan entry</p>
      ) : (
        <>
          {/* Type row */}
          <div className="flex items-center gap-1.5">
            <span>{SPORT_EMOJI[day.sport] ?? '📌'}</span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                DAY_TYPE_BADGES[day.planned_type] ?? 'bg-gray-500/20 text-gray-400 border-gray-500/30'
              }`}
            >
              {day.planned_type}
            </span>
          </div>

          {/* Planned line */}
          {day.sport === 'cycle' && (
            <p className="text-xs text-muted">
              {day.planned_duration_min ? `${day.planned_duration_min} min` : '—'}
              {day.planned_tss != null && ` · ${Math.round(day.planned_tss)} TSS`}
              {day.planned_power_watts != null && ` · ${Math.round(day.planned_power_watts)}W`}
              {day.planned_zone && ` · ${day.planned_zone.toUpperCase()}`}
            </p>
          )}
          {day.sport === 'strength' && (
            <p className="text-xs text-muted">
              {day.planned_focus
                ? FOCUS_LABELS[day.planned_focus] ?? day.planned_focus
                : 'Strength'}
              {day.planned_exercises?.length ? ` · ${day.planned_exercises.length} exercises` : ''}
              {day.planned_volume_kg != null && ` · ${fmtKg(day.planned_volume_kg)} target`}
            </p>
          )}
          {day.sport === 'rest' && <p className="text-xs text-muted">Rest day</p>}
          {day.workout_description && !expanded && (
            <p className="text-xs text-white/70 truncate" title={day.workout_description}>
              {day.workout_description}
            </p>
          )}

          {/* Weather (cycle days) */}
          {day.sport === 'cycle' && day.weather && (
            <div className="space-y-1">
              <p className="text-[11px] text-muted">
                {weatherEmoji(day.weather.conditions)}{' '}
                {day.weather.temp_max != null && day.weather.temp_min != null
                  ? `${Math.round(day.weather.temp_max)}°/${Math.round(day.weather.temp_min)}°`
                  : '—'}
                {day.weather.precipitation_probability != null &&
                  ` · 💧${Math.round(day.weather.precipitation_probability)}%`}
              </p>
              {day.bad_weather && (
                <span
                  className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full border ${
                    day.bad_weather.level === 'danger'
                      ? 'bg-red-500/20 text-red-300 border-red-500/40'
                      : 'bg-orange-500/15 text-orange-300 border-orange-500/40'
                  }`}
                  title={day.bad_weather.level}
                >
                  ⚠️ {day.bad_weather.reason}
                </span>
              )}
            </div>
          )}

          {/* Actual block */}
          {(day.actual_activity || day.actual_lifting_session) && (
            <div className="rounded-lg bg-positive/10 border border-positive/20 px-2 py-1.5">
              {day.actual_activity ? (
                <>
                  <p className="text-[11px] text-positive font-medium truncate">
                    {day.actual_activity.name}
                  </p>
                  <p className="text-[10px] text-muted">
                    {formatDuration(day.actual_activity.duration_seconds)}
                    {day.actual_activity.distance_meters != null &&
                      ` · ${(day.actual_activity.distance_meters / 1000).toFixed(1)}km`}
                    {day.actual_activity.tss != null &&
                      ` · ${Math.round(day.actual_activity.tss)} TSS`}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[11px] text-positive font-medium">
                    {day.actual_lifting_session!.focus
                      ? FOCUS_LABELS[day.actual_lifting_session!.focus!] ??
                        day.actual_lifting_session!.focus!
                      : 'Lifting'}
                  </p>
                  <p className="text-[10px] text-muted">
                    {fmtKg(day.actual_lifting_session!.total_volume_kg)} volume
                  </p>
                </>
              )}
            </div>
          )}
          {!day.actual_activity && !day.actual_lifting_session && date < todayStr && (
            <p className="text-[11px] text-muted/70 italic">Not logged</p>
          )}

          {/* Expanded panel */}
          {expanded && (
            <ExpandedPanel
              day={day}
              planId={planId}
              busy={busy}
              onAssignRoute={onAssignRoute}
              onUnassignRoute={onUnassignRoute}
              onQuickEdit={onQuickEdit}
              onOpenRoutePicker={() => setShowRoutePicker(true)}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Expanded panel ───────────────────────────────────────────────────────

function ExpandedPanel({
  day,
  planId,
  busy,
  onAssignRoute,
  onUnassignRoute,
  onQuickEdit,
  onOpenRoutePicker,
}: {
  day: TrainingWeekDay;
  planId: string;
  busy: boolean;
  onAssignRoute: (routeId: string) => void;
  onUnassignRoute: () => void;
  onQuickEdit: (payload: UpdateTrainingPlanDayPayload) => void;
  onOpenRoutePicker: () => void;
}) {
  const [duration, setDuration] = useState(day.planned_duration_min?.toString() ?? '');
  const [tss, setTss] = useState(day.planned_tss?.toString() ?? '');
  const [notes, setNotes] = useState(day.notes ?? '');

  const handleSave = () => {
    const payload: UpdateTrainingPlanDayPayload = {};
    if (duration !== '') payload.planned_duration_min = parseInt(duration, 10) || null;
    if (tss !== '') payload.planned_tss = parseFloat(tss) || null;
    payload.notes = notes;
    onQuickEdit(payload);
  };

  return (
    <div
      className="pt-2 mt-1 border-t border-surface-light/50 space-y-2"
      onClick={(e) => e.stopPropagation()}
    >
      {day.workout_description && (
        <p className="text-[11px] text-white/80 whitespace-pre-wrap">{day.workout_description}</p>
      )}

      {/* Strength exercise table */}
      {day.sport === 'strength' && day.planned_exercises && day.planned_exercises.length > 0 && (
        <div className="overflow-x-auto">
        <table className="w-full text-[10px] text-muted">
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
                <td className="py-0.5 text-white/90 truncate max-w-[90px]" title={ex.exercise}>
                  {ex.exercise}
                </td>
                <td className="py-0.5">
                  {ex.sets}×{ex.reps}
                </td>
                <td className="py-0.5">{ex.weight_kg != null ? ex.weight_kg : '—'}</td>
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
                {day.actual_activity.route_name || 'Linked route ✓'}
              </span>
            </div>
          ) : day.planned_route_id ? (
            <div className="flex items-center gap-2">
              <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-positive/15 text-positive border border-positive/30 truncate">
                {day.route_matches?.find(m => m.route_id === day.planned_route_id)?.name || 'Route assigned ✓'}
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
                className="text-[10px] text-warning hover:text-red-300 disabled:opacity-50 shrink-0"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenRoutePicker}
              className="text-[10px] text-accent hover:text-accent/80"
            >
              🗺️ Pick a route...
            </button>
          )}
        </div>
      )}

      {/* Notes */}
      {day.notes && !notes && <p className="text-[11px] text-muted italic">{day.notes}</p>}

      {/* Quick edit */}
      <div className="flex gap-1.5">
        <label className="block flex-1">
          <span className="block text-[9px] text-muted mb-0.5">Min</span>
          <input
            type="number"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="w-full px-1.5 py-1 bg-background border border-surface-light rounded text-white text-[11px] focus:outline-none focus:border-accent"
          />
        </label>
        <label className="block flex-1">
          <span className="block text-[9px] text-muted mb-0.5">TSS</span>
          <input
            type="number"
            value={tss}
            onChange={(e) => setTss(e.target.value)}
            className="w-full px-1.5 py-1 bg-background border border-surface-light rounded text-white text-[11px] focus:outline-none focus:border-accent"
          />
        </label>
      </div>
      <input
        type="text"
        placeholder="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="w-full px-1.5 py-1 bg-background border border-surface-light rounded text-white text-[11px] focus:outline-none focus:border-accent"
      />
      <button
        onClick={handleSave}
        disabled={busy}
        className="w-full px-2 py-1 bg-accent/20 text-accent rounded text-[11px] font-medium hover:bg-accent/30 disabled:opacity-50"
      >
        Save
      </button>

      {/* Phase 5C — plan-vs-actual conformity scoring for this day.
          Mounted only while expanded → lazy query runs on open. */}
      <DayConformityPanel planId={planId} day={day} />
    </div>
  );
}
