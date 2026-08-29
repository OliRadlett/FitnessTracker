'use client';

import { format, isSameDay, isSameMonth, isToday } from 'date-fns';
import { formatDuration, formatDistance } from '@/lib/utils';
import type { ActivityCalendarEntry, DailyMetricSummary } from '@/lib/api';
import {
  getSportColor,
  getSportTextColor,
  getSportBorderColor,
  getSportEmoji,
  isStrengthType,
} from '@/lib/sportUtils';

// ── Calendar Agenda View ─────────────────────────────────────────────────────

function formatStat(activity: ActivityCalendarEntry): string {
  if (isStrengthType(activity.sport_type)) {
    if (activity.focus) {
      return activity.focus;
    }
    return activity.name;
  }
  const parts: string[] = [];
  if (activity.distance_meters != null) {
    parts.push(formatDistance(activity.distance_meters));
  }
  if (activity.duration_seconds != null) {
    parts.push(formatDuration(activity.duration_seconds));
  }
  if (activity.tss != null) {
    parts.push(`${Math.round(activity.tss)} TSS`);
  }
  return parts.join(' \u00B7 ') || activity.name;
}

// ── Calendar Agenda View ─────────────────────────────────────────────────────

export function CalendarAgendaView({
  calendarDays,
  currentMonth,
  selectedDay,
  activitiesByDate,
  metricsByDate,
  setSelectedDay,
  isLoading,
}: {
  calendarDays: Date[];
  currentMonth: Date;
  selectedDay: Date;
  activitiesByDate: Map<string, ActivityCalendarEntry[]>;
  metricsByDate: Map<string, DailyMetricSummary>;
  setSelectedDay: (day: Date) => void;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-12 bg-surface-light/40 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {calendarDays
        .filter((day) => isSameMonth(day, currentMonth))
        .map((day) => {
          const dateKey = format(day, 'yyyy-MM-dd');
          const dayActivities = activitiesByDate.get(dateKey) || [];
          const isSelected = isSameDay(day, selectedDay);
          const isTodayDate = isToday(day);
          const dm = metricsByDate.get(dateKey);

          return (
            <button
              key={dateKey}
              onClick={() => setSelectedDay(day)}
              className={`
                w-full text-left rounded-lg px-3 py-2 transition-all flex items-center gap-3
                ${isSelected
                  ? 'bg-accent/15 border-2 border-accent ring-1 ring-accent/30'
                  : isTodayDate
                    ? 'border-2 border-accent/50 bg-surface-light/30 hover:bg-surface-light/50'
                    : 'border border-surface-light/60 bg-surface-light/20 hover:bg-surface-light/40'
                }
              `}
            >
              {/* Day number */}
              <div className="shrink-0 w-10 text-center">
                <span className={`text-lg font-bold ${
                  isTodayDate ? 'text-accent' : isSelected ? 'text-white' : 'text-white/80'
                }`}>
                  {format(day, 'd')}
                </span>
                <div className="text-[10px] text-muted uppercase">{format(day, 'EEE')}</div>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                {dayActivities.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {dayActivities.map((a) => (
                      <span
                        key={a.id}
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] border ${getSportBorderColor(a.sport_type)} ${getSportColor(a.sport_type)}/10`}
                      >
                        <span className={getSportTextColor(a.sport_type)}>
                          {getSportEmoji(a.sport_type)} {formatStat(a)}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-muted/50">No activities</span>
                )}
              </div>

              {/* Recovery badge */}
              {dm?.recovery_score != null && (
                <span className={`shrink-0 text-xs font-mono font-bold ${
                  dm.recovery_score >= 70 ? 'text-positive'
                  : dm.recovery_score >= 50 ? 'text-amber-400'
                  : 'text-warning'
                }`}>
                  {Math.round(dm.recovery_score)}%
                </span>
              )}
            </button>
          );
        })}
    </div>
  );
}
