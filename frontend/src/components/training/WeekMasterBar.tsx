'use client';

/**
 * WeekMasterBar — V3 responsive weekly day strip.
 *
 * Owns the responsive layout for the seven day cards of one plan week:
 *   - desktop (xl+): a 7-column grid
 *   - mobile/tablet: a horizontally scrollable strip of fixed-width cells
 *
 * The card itself is `DayCell`; this component only lays them out and maps
 * each cell's date onto the sessions planned on it, today/highlight state and
 * goal hints. A date may hold more than one session, so drag-and-drop carries
 * a *session id*, not a date.
 */

import React from 'react';
import { getActiveLocale } from '@/lib/utils';
import type { Goal, TrainingWeekDay } from '@/lib/api';
import { goalsForPlanDate, goalShortLabel } from '@/components/goals/goalPlanLinks';
import type { AddableSport } from '@/lib/training/sessionGroups';
import { DayCell } from './DayCell';

export interface WeekMasterBarProps {
  /** Seven Monday-aligned dates (YYYY-MM-DD) for the visible week. */
  weekDates: string[];
  /** Sessions planned on each date, in payload order (absent = no plan entry). */
  sessionsByDate: Map<string, TrainingWeekDay[]>;
  todayStr: string;
  expandedDayId: string | null;
  /** Phase 2 `?day=` deep-link highlight. */
  highlightDate?: string | null;
  /** Active goals for the plan → goal cross-link hint. */
  activeGoals: Goal[];
  onToggleExpand: (dayId: string) => void;
  onToggleCompleted: (dayId: string, completed: boolean) => void;
  /** Opens the missed-day quick actions for the given day id. */
  onOpenMissed: (dayId: string) => void;
  /** Adds a session of `sport` on `date` (409 when that sport is taken). */
  onAddSession?: (date: string, sport: AddableSport) => void;
  busy: boolean;
  /** Desktop drag-and-drop: called with (sourceDayId, targetDate) on drop. */
  onDropSession?: (sourceDayId: string, targetDate: string) => void;
}

export function WeekMasterBar({
  weekDates,
  sessionsByDate,
  todayStr,
  expandedDayId,
  highlightDate,
  activeGoals,
  onToggleExpand,
  onToggleCompleted,
  onOpenMissed,
  onAddSession,
  busy,
  onDropSession,
}: WeekMasterBarProps) {
  const [dragSource, setDragSource] = React.useState<string | null>(null);

  return (
    <div
      className="flex gap-3 overflow-x-auto pb-1 snap-x snap-mandatory xl:grid xl:grid-cols-7 xl:overflow-visible xl:pb-0"
      role="group"
      aria-label="Plan week"
    >
      {weekDates.map((date) => {
        const sessions = sessionsByDate.get(date) ?? [];
        const dowLabel = new Date(date + 'T00:00:00').toLocaleDateString(getActiveLocale(), {
          weekday: 'short',
        });
        const dayLabel = new Date(date + 'T00:00:00').toLocaleDateString(getActiveLocale(), {
          day: 'numeric',
          month: 'short',
        });
        const isToday = date === todayStr;
        const highlighted = highlightDate === date;
        const dayGoals = goalsForPlanDate(activeGoals, sessions);
        // Dropping a session on its own date is a no-op, and a date may only
        // take one session per sport.
        const isOwnDate = sessions.some((s) => s.id === dragSource);

        return (
          <div
            key={date}
            className="shrink-0 w-[160px] snap-start xl:w-auto xl:shrink"
          >
            <DayCell
              date={date}
              dowLabel={dowLabel}
              dayLabel={dayLabel}
              isToday={isToday}
              sessions={sessions}
              todayStr={todayStr}
              expandedDayId={expandedDayId}
              highlighted={highlighted}
              goalCount={dayGoals.length}
              goalNames={dayGoals.map((g) => goalShortLabel(g))}
              onToggleExpand={onToggleExpand}
              onToggleCompleted={onToggleCompleted}
              onOpenMissed={onOpenMissed}
              onAddSession={onAddSession}
              busy={busy}
              draggable={sessions.length === 1 && !sessions[0].completed}
              onDragStart={setDragSource}
              onDragOver={(e) => {
                if (dragSource && !isOwnDate) e.preventDefault();
              }}
              onDrop={() => {
                if (dragSource && !isOwnDate) onDropSession?.(dragSource, date);
                setDragSource(null);
              }}
              onDragEnd={() => setDragSource(null)}
              isDropTarget={!!dragSource && !isOwnDate}
            />
          </div>
        );
      })}
    </div>
  );
}
