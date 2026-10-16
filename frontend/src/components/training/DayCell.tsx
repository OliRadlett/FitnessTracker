'use client';

/**
 * DayCell — V3 reusable plan-day card.
 *
 * Extracted from WeeklyView's former `DayCard` so the weekly master bar
 * (WeekMasterBar) and any other consumer can render one date with the same
 * status colouring, badges, planned/actual summaries and weather.
 *
 * A date may hold more than one session (a morning ride and an evening lift).
 * One session renders exactly as it always has; several render as compact
 * chips (two visible, then a "+N" overflow) because a 160px cell cannot hold
 * two full session bodies.
 */

import React from 'react';
import Link from 'next/link';
import { MapPin, Check, Target, AlertTriangle, CalendarClock, Plus } from 'lucide-react';
import type { TrainingWeekDay } from '@/lib/api';
import { formatDuration, weatherEmoji } from '@/lib/utils';
import { ConformityBadge } from './ConformityBadge';
import {
  SPORT_ICON,
  DAY_TYPE_BADGES,
  FOCUS_LABELS,
  STATUS_LABEL,
  getStatus,
  getCellStatus,
  getBadgeStatus,
  fmtKg,
  type DayStatus,
} from './dayCellShared';
import { addableSports, visibleSessions, type AddableSport } from '@/lib/training/sessionGroups';

/** Status dot on a session chip. */
const CHIP_DOT: Record<DayStatus, string> = {
  done: 'bg-positive',
  partial: 'bg-yellow-400',
  missed: 'bg-amber-400',
  planned: 'bg-muted/60',
  neutral: 'bg-muted/40',
};

export interface DayCellProps {
  date: string;
  dowLabel: string;
  dayLabel: string;
  isToday: boolean;
  /** Every session planned on this date (0..N), in payload order. */
  sessions: TrainingWeekDay[];
  todayStr: string;
  /** Id of the session whose editor is open; the cell highlights when it owns one. */
  expandedDayId?: string | null;
  /** Phase 2 `?day=` deep-link highlight for this card's date. */
  highlighted?: boolean;
  /** Phase 2: number of active goals this date supports (badge, non-interactive). */
  goalCount?: number;
  /** Phase 2: supporting goal names for the badge tooltip. */
  goalNames?: string[];
  /** Expand (or collapse) one session's editor. */
  onToggleExpand: (dayId: string) => void;
  onToggleCompleted: (dayId: string, completed: boolean) => void;
  /** Opens the missed-day quick actions (only shown when a session is missed). */
  onOpenMissed?: (dayId: string) => void;
  /** Adds a session of `sport` on this date (409 when that sport is taken). */
  onAddSession?: (date: string, sport: AddableSport) => void;
  busy: boolean;
  /** Desktop drag-and-drop: drag a day card onto another to swap or move it. */
  draggable?: boolean;
  onDragStart?: (dayId: string) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
  isDropTarget?: boolean;
}

export function DayCell({
  date,
  dowLabel,
  dayLabel,
  isToday,
  sessions,
  todayStr,
  expandedDayId,
  highlighted,
  goalCount,
  goalNames,
  onToggleExpand,
  onToggleCompleted,
  onOpenMissed,
  onAddSession,
  busy,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDropTarget,
}: DayCellProps) {
  const single = sessions.length === 1 ? sessions[0] : null;
  const expanded = !!expandedDayId && sessions.some((s) => s.id === expandedDayId);
  const status = getCellStatus(sessions, todayStr);
  const badgeStatus = getBadgeStatus(single ?? sessions[0], status);
  const missedSession = sessions.find((s) => getStatus(s, todayStr) === 'missed');
  const { shown, overflow } = visibleSessions(sessions);
  const addable = addableSports(sessions);

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

  const expandPrimary = () => {
    const target = sessions[0];
    if (target) onToggleExpand(target.id);
  };

  return (
    <div
      id={`plan-day-${date}`}
      className={`rounded-xl border p-3 space-y-2 cursor-pointer transition-colors scroll-mt-4 ${
        expanded
          ? 'bg-surface-light/40 border-accent/40'
          : 'bg-surface-light/20 border-surface-light/50 hover:bg-surface-light/30'
      } ${isToday ? 'ring-1 ring-accent/60' : ''} ${highlighted ? 'ring-2 ring-accent' : ''} ${missedRing} ${isDropTarget ? 'ring-2 ring-accent border-accent' : ''} ${statusColor ? `border-l-2 ${statusColor}` : ''}`}
      onClick={expandPrimary}
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={() => sessions[0] && onDragStart?.(sessions[0].id)}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') expandPrimary();
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
          {missedSession && onOpenMissed && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenMissed(missedSession.id);
              }}
              className="text-[10px] px-1 rounded text-amber-400 hover:text-amber-300"
              aria-label="Missed day options"
              title="Missed — quick actions"
            >
              <CalendarClock className="w-3 h-3" />
            </button>
          )}
          {single?.sport === 'cycle' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(single.id);
              }}
              className="text-[10px] px-1 rounded text-muted hover:text-accent"
              title={single.planned_route_id ? 'Change route' : 'Assign route'}
            >
              <MapPin className="w-3 h-3" />
            </button>
          )}
          <ConformityBadge
            status={badgeStatus}
            title={STATUS_LABEL[status]}
          />
          {single && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleCompleted(single.id, !single.completed);
              }}
              disabled={busy}
              aria-label={single.completed ? 'Mark not completed' : 'Mark completed'}
              className={`text-xs px-1 rounded disabled:opacity-30 ${
                single.completed ? 'text-positive' : 'text-muted hover:text-foreground'
              }`}
            >
              <Check className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {sessions.length === 0 ? (
        <p className="text-xs text-muted italic">No plan entry</p>
      ) : single ? (
        <SessionBody
          day={single}
          date={date}
          todayStr={todayStr}
          expanded={expanded}
          goalCount={goalCount}
          goalNames={goalNames}
        />
      ) : (
        <div className="space-y-1">
          {shown.map((session) => (
            <SessionChip
              key={session.id}
              session={session}
              todayStr={todayStr}
              onOpen={() => onToggleExpand(session.id)}
              onDragStart={onDragStart}
            />
          ))}
          {overflow > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(sessions[shown.length].id);
              }}
              title={sessions
                .slice(shown.length)
                .map((s) => chipTitle(s))
                .join(', ')}
              className="text-[10px] text-muted hover:text-foreground px-1.5"
            >
              +{overflow}
            </button>
          )}
          {(goalCount ?? 0) > 0 && (
            <GoalHint count={goalCount ?? 0} names={goalNames ?? []} />
          )}
        </div>
      )}

      {sessions.length > 0 && (
        <div
          className="flex items-center gap-2 pt-1 border-t border-surface-light/40"
          onClick={(e) => e.stopPropagation()}
        >
          {addable.length > 0 && onAddSession ? (
            addable.map((sport) => {
              const Icon = SPORT_ICON[sport];
              return (
                <button
                  key={sport}
                  onClick={() => onAddSession(date, sport)}
                  disabled={busy}
                  title={`Add a ${sport} session on ${date}`}
                  className="text-[10px] text-muted hover:text-accent inline-flex items-center gap-0.5 disabled:opacity-40"
                >
                  <Plus className="w-3 h-3" />
                  {Icon && <Icon className="w-3 h-3" />}
                </button>
              );
            })
          ) : (
            <button
              disabled
              title={
                sessions.some((s) => s.sport === 'rest')
                  ? 'Rest days take no sessions'
                  : 'This date already holds every sport'
              }
              className="text-[10px] text-muted/50 inline-flex items-center gap-0.5 cursor-not-allowed"
            >
              <Plus className="w-3 h-3" />
              Add session
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** One session on a multi-session date: icon, summary, status dot, expand target. */
function SessionChip({
  session,
  todayStr,
  onOpen,
  onDragStart,
}: {
  session: TrainingWeekDay;
  todayStr: string;
  onOpen: () => void;
  onDragStart?: (dayId: string) => void;
}) {
  const Icon = SPORT_ICON[session.sport];
  const status = getStatus(session, todayStr);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      title={chipTitle(session)}
      draggable={!session.completed}
      onDragStart={(e) => {
        e.stopPropagation();
        onDragStart?.(session.id);
      }}
      className="w-full flex items-center gap-1.5 text-left rounded-md px-1.5 py-1 bg-surface-light/30 hover:bg-surface-light/60 transition-colors"
    >
      {Icon ? <Icon className="w-3 h-3 shrink-0" /> : <span className="text-[10px]">?</span>}
      <span className="text-[10px] text-foreground truncate">{chipLabel(session)}</span>
      <span className={`ml-auto h-1.5 w-1.5 rounded-full shrink-0 ${CHIP_DOT[status]}`} />
    </button>
  );
}

/** Short chip text: the session's type, plus TSS for a ride. */
function chipLabel(session: TrainingWeekDay): string {
  if (session.sport === 'rest') return 'Rest';
  if (session.sport === 'strength') {
    return session.planned_focus
      ? FOCUS_LABELS[session.planned_focus] ?? session.planned_focus
      : 'Strength';
  }
  return session.planned_tss != null
    ? `${session.planned_type} · ${Math.round(session.planned_tss)} TSS`
    : session.planned_type;
}

/** Fuller chip description for the tooltip. */
function chipTitle(session: TrainingWeekDay): string {
  if (session.sport === 'rest') return 'Rest day';
  if (session.sport === 'strength') {
    const exercises = session.planned_exercises?.length ?? 0;
    return `Strength · ${session.planned_focus ?? 'no focus'}${
      exercises ? ` · ${exercises} exercises` : ''
    }`;
  }
  const parts = ['Ride', session.planned_type];
  if (session.planned_duration_min) parts.push(`${session.planned_duration_min} min`);
  if (session.planned_tss != null) parts.push(`${Math.round(session.planned_tss)} TSS`);
  return parts.join(' · ');
}

/** Phase 2 plan → goal cross-link hint, shared by the one- and many-session bodies. */
function GoalHint({ count, names }: { count: number; names: string[] }) {
  return (
    <p
      className="text-xs text-muted truncate"
      title={`Supports goals: ${names.join(', ')} — expand for details`}
    >
      <Target className="w-3 h-3 text-accent" />
      {count} goal{count === 1 ? '' : 's'}
    </p>
  );
}

/**
 * The full body of a single session — planned line, description, weather,
 * route and the linked actual. Unchanged from the one-session-per-date card.
 */
function SessionBody({
  day,
  date,
  todayStr,
  expanded,
  goalCount,
  goalNames,
}: {
  day: TrainingWeekDay;
  date: string;
  todayStr: string;
  expanded: boolean;
  goalCount?: number;
  goalNames?: string[];
}) {
  return (
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

      {(goalCount ?? 0) > 0 && <GoalHint count={goalCount ?? 0} names={goalNames ?? []} />}

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
  );
}
