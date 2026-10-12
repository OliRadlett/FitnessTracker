'use client';

/**
 * WeekMasterBar — V3 responsive weekly day strip.
 *
 * Owns the responsive layout for the seven day cards of one plan week:
 *   - desktop (xl+): a 7-column grid
 *   - mobile/tablet: a horizontally scrollable strip of fixed-width cells
 *
 * The card itself is `DayCell`; this component only lays them out and maps
 * each cell's date onto its plan day, today/highlight state and goal hints.
 */

import React from 'react';
import { getActiveLocale } from '@/lib/utils';
import type { Goal, TrainingWeekDay } from '@/lib/api';
import { goalsForPlanDay, goalShortLabel } from '@/components/goals/goalPlanLinks';
import { DayCell } from './DayCell';

export interface WeekMasterBarProps {
  /** Seven Monday-aligned dates (YYYY-MM-DD) for the visible week. */
  weekDates: string[];
  daysByDate: Map<string, TrainingWeekDay>;
  todayStr: string;
  expandedDayId: string | null;
  /** Phase 2 `?day=` deep-link highlight. */
  highlightDate?: string | null;
  /** Active goals for the plan → goal cross-link hint. */
  activeGoals: Goal[];
  onToggleExpand: (dayId: string | null) => void;
  onToggleCompleted: (dayId: string, completed: boolean) => void;
  /** Opens the missed-day quick actions for the given day id. */
  onOpenMissed: (dayId: string) => void;
  busy: boolean;
}

export function WeekMasterBar({
  weekDates,
  daysByDate,
  todayStr,
  expandedDayId,
  highlightDate,
  activeGoals,
  onToggleExpand,
  onToggleCompleted,
  onOpenMissed,
  busy,
}: WeekMasterBarProps) {
  return (
    <div
      className="flex gap-3 overflow-x-auto pb-1 snap-x snap-mandatory xl:grid xl:grid-cols-7 xl:overflow-visible xl:pb-0"
      role="group"
      aria-label="Plan week"
    >
      {weekDates.map((date) => {
        const day = daysByDate.get(date);
        const dowLabel = new Date(date + 'T00:00:00').toLocaleDateString(getActiveLocale(), {
          weekday: 'short',
        });
        const dayLabel = new Date(date + 'T00:00:00').toLocaleDateString(getActiveLocale(), {
          day: 'numeric',
          month: 'short',
        });
        const isToday = date === todayStr;
        const expanded = !!day && expandedDayId === day.id;
        const highlighted = highlightDate === date;
        const dayGoals = day ? goalsForPlanDay(activeGoals, day) : [];

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
              day={day}
              todayStr={todayStr}
              expanded={expanded}
              highlighted={highlighted}
              goalCount={dayGoals.length}
              goalNames={dayGoals.map((g) => goalShortLabel(g))}
              onToggleExpand={() => day && onToggleExpand(expanded ? null : day.id)}
              onToggleCompleted={(completed) =>
                day && onToggleCompleted(day.id, completed)
              }
              onOpenMissed={day ? () => onOpenMissed(day.id) : undefined}
              busy={busy}
            />
          </div>
        );
      })}
    </div>
  );
}
