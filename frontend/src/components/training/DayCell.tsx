'use client';

/**
 * DayCell — V3 reusable plan-day card.
 *
 * Extracted from WeeklyView's former `DayCard` so the weekly master bar
 * (WeekMasterBar) and any other consumer can render one day with the same
 * status colouring, badges, planned/actual summaries and weather.
 */

import React from 'react';
import Link from 'next/link';
import { MapPin, Check, Target, AlertTriangle, CalendarClock } from 'lucide-react';
import type { TrainingWeekDay } from '@/lib/api';
import { formatDuration, weatherEmoji } from '@/lib/utils';
import { ConformityBadge } from './ConformityBadge';
import {
  SPORT_ICON,
  DAY_TYPE_BADGES,
  FOCUS_LABELS,
  STATUS_LABEL,
  getStatus,
  getBadgeStatus,
  fmtKg,
} from './dayCellShared';

export interface DayCellProps {
  date: string;
  dowLabel: string;
  dayLabel: string;
  isToday: boolean;
  day?: TrainingWeekDay;
  todayStr: string;
  expanded: boolean;
  /** Phase 2 `?day=` deep-link highlight for this card's date. */
  highlighted?: boolean;
  /** Phase 2: number of active goals this day supports (badge, non-interactive). */
  goalCount?: number;
  /** Phase 2: supporting goal names for the badge tooltip. */
  goalNames?: string[];
  onToggleExpand: () => void;
  onToggleCompleted: (completed: boolean) => void;
  /** Opens the missed-day quick actions (only shown when status is 'missed'). */
  onOpenMissed?: () => void;
  busy: boolean;
}

export function DayCell({
  date,
  dowLabel,
  dayLabel,
  isToday,
  day,
  todayStr,
  expanded,
  highlighted,
  goalCount,
  goalNames,
  onToggleExpand,
  onToggleCompleted,
  onOpenMissed,
  busy,
}: DayCellProps) {
  const status = day ? getStatus(day, todayStr) : 'neutral';
  const badgeStatus = getBadgeStatus(day, status);

  const statusColor = status === 'missed'
    ? 'border-l-warning/60'
    : status === 'partial'
      ? 'border-l-yellow-400/60'
      : status === 'done'
        ? 'border-l-positive/60'
        : '';

  // Missed days get an amber ring so they stand out from past-neutral days.
  const missedRing = status === 'missed' && !expanded && !isToday && !highlighted
    ? 'ring-1 ring-amber-400/40'
    : '';

  return (
    <div
      id={`plan-day-${date}`}
      className={`rounded-xl border p-3 space-y-2 cursor-pointer transition-colors scroll-mt-4 ${
        expanded
          ? 'bg-surface-light/40 border-accent/40'
          : 'bg-surface-light/20 border-surface-light/50 hover:bg-surface-light/30'
      } ${isToday ? 'ring-1 ring-accent/60' : ''} ${highlighted ? 'ring-2 ring-accent' : ''} ${missedRing} ${statusColor ? `border-l-2 ${statusColor}` : ''}`}
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
          <p className="text-sm font-semibold text-foreground">
            {dowLabel}{' '}
            <span className="text-xs font-normal text-muted">{dayLabel}</span>
            {isToday && <span className="text-[10px] text-accent ml-1">•</span>}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {status === 'missed' && onOpenMissed && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenMissed();
              }}
              className="text-[10px] px-1 rounded text-amber-400 hover:text-amber-300"
              aria-label="Missed day options"
              title="Missed — quick actions"
            >
              <CalendarClock className="w-3 h-3" />
            </button>
          )}
          {day?.sport === 'cycle' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand();
              }}
              className="text-[10px] px-1 rounded text-muted hover:text-accent"
              title={day?.planned_route_id ? 'Change route' : 'Assign route'}
            >
              <MapPin className="w-3 h-3" />
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
              day?.completed ? 'text-positive' : 'text-muted hover:text-foreground'
            }`}
          >
            <Check className="w-3 h-3" />
          </button>
        </div>
      </div>

      {!day ? (
        <p className="text-xs text-muted italic">No plan entry</p>
      ) : (
        <>
          {/* Type row */}
          <div className="flex items-center gap-1.5">
             {(() => { const Icon = SPORT_ICON[day.sport]; return Icon ? <Icon className="w-3 h-3" /> : <span className="text-xs">?</span>; })()}
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                DAY_TYPE_BADGES[day.planned_type] ?? 'bg-surface-light/20 text-muted border-muted/30'
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
              {day.targets_stale && (
                <span
                  className="ml-1 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border bg-warning/15 text-warning border-warning/30"
                  title="Stored targets drifted from your current FTP — use Refresh targets above"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
                  stale
                </span>
              )}
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
            <p className="text-xs text-foreground/70 truncate" title={day.workout_description}>
              {day.workout_description}
            </p>
          )}

          {/* Phase 2 plan → goal cross-link hint: how many active goals this
              day supports. Non-interactive badge (the expanded panel below
              carries the tappable goal rows); tooltip names the goals. */}
          {(goalCount ?? 0) > 0 && (
            <p
              className="text-xs text-muted truncate"
              title={`Supports goals: ${(goalNames ?? []).join(', ')} — expand for details`}
            >
               <Target className="w-3 h-3 text-accent" />
               {goalCount} goal{goalCount === 1 ? '' : 's'}
            </p>
          )}

          {/* Route indicator (cycle days — collapsed card) */}
          {day.sport === 'cycle' && !expanded && (day.planned_route_id || day.actual_activity?.route_id) && (
            <p className="text-[10px] text-muted truncate" title={day.actual_activity?.route_name || undefined}>
               <MapPin className="w-3 h-3 text-muted" />
               {day.actual_activity?.route_name || 'Route assigned'}
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
                  ` · ${Math.round(day.weather.precipitation_probability)}% precip`}
              </p>
              {day.bad_weather && (
                <span
                  className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full border ${
                    day.bad_weather.level === 'danger'
                      ? 'bg-warning/20 text-warning border-warning/40'
                      : 'bg-orange-500/15 text-orange-300 border-orange-500/40'
                  }`}
                  title={day.bad_weather.level}
                >
                   <AlertTriangle className="w-3 h-3 text-orange-400 inline mr-1" />
                 {day.bad_weather.reason}
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
                  <Link
                    href={`/activities?activity=${day.actual_activity.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-[10px] text-accent/70 hover:text-accent transition-colors"
                  >
                    View activity →
                  </Link>
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

        </>
      )}
    </div>
  );
}
