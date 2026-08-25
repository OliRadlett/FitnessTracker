'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import { formatDuration, formatDistance } from '@/lib/utils';
import { usePageTitle } from '@/lib/usePageTitle';
import type {
  ActivityCalendarEntry,
  CalendarDayData,
  DailyMetricSummary,
  SleepLogSummary,
} from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  addMonths,
  subMonths,
  isToday,
} from 'date-fns';
import {
  getSportColor,
  getSportTextColor,
  getSportBorderColor,
  getSportEmoji,
  isStrengthType,
  getRecoveryColor,
} from '@/lib/sportUtils';
import { DayDetailPanel } from '@/components/calendar/DayDetailPanel';
import { CalendarAgendaView } from '@/components/calendar/CalendarAgendaView';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getRecoveryBg(score: number): string {
  if (score >= 70) return 'bg-green-500/15';
  if (score >= 40) return 'bg-yellow-500/15';
  return 'bg-red-500/15';
}

function DayMetricsBadges({ dm }: { dm: DailyMetricSummary }) {
  const hasRecovery = dm.recovery_score != null;
  const hasSleep = dm.sleep_duration_minutes != null;
  if (!hasRecovery && !hasSleep) return null;
  return (
    <div className="flex gap-1 mb-0.5">
      {hasRecovery && (
        <span
          className={`text-[9px] font-medium px-1 py-0.5 rounded ${getRecoveryBg(dm.recovery_score!)} ${getRecoveryColor(dm.recovery_score!)}`}
        >
          {Math.round(dm.recovery_score!)}%
        </span>
      )}
      {hasSleep && (
        <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-indigo-500/15 text-indigo-300">
          {Math.round(dm.sleep_duration_minutes! / 60)}h
        </span>
      )}
    </div>
  );
}

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

// ─── Calendar grid builder ─────────────────────────────────────────────────

function buildCalendarDays(currentMonth: Date): Date[] {
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  return eachDayOfInterval({ start: calStart, end: calEnd });
}

// ─── Calendar Page ─────────────────────────────────────────────────────────

export default function CalendarPage() {
  usePageTitle('Calendar');
  const { authFetch } = useAuthFetch();
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());

  // Calculate the fetch range covering all visible calendar cells
  const { fetchStart, fetchEnd } = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    return {
      fetchStart: format(startOfWeek(monthStart, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      fetchEnd: format(endOfWeek(monthEnd, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    };
  }, [currentMonth]);

  const { data: calendarData, isLoading } = useQuery<CalendarDayData>({
    queryKey: ['activities-calendar', fetchStart, fetchEnd],
    queryFn: () =>
      authFetch<CalendarDayData>(
        `/api/v1/activities/calendar?start_date=${fetchStart}&end_date=${fetchEnd}`,
      ),
  });

  const activities = calendarData?.activities;
  const dailyMetrics = calendarData?.daily_metrics;
  const sleepLogs = calendarData?.sleep_logs;

  // Build calendar grid days
  const calendarDays = useMemo(
    () => buildCalendarDays(currentMonth),
    [currentMonth],
  );

  // Group activities by date
  const activitiesByDate = useMemo(() => {
    const map = new Map<string, ActivityCalendarEntry[]>();
    if (!activities) return map;
    for (const activity of activities) {
      const key = activity.date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(activity);
    }
    return map;
  }, [activities]);

  // Group daily metrics by date
  const metricsByDate = useMemo(() => {
    const map = new Map<string, DailyMetricSummary>();
    if (!dailyMetrics) return map;
    for (const m of dailyMetrics) {
      map.set(m.date, m);
    }
    return map;
  }, [dailyMetrics]);

  // Group sleep logs by date
  const sleepLogsByDate = useMemo(() => {
    const map = new Map<string, SleepLogSummary>();
    if (!sleepLogs) return map;
    for (const sl of sleepLogs) {
      // Prefer whoop source (most complete data)
      if (!map.has(sl.sleep_date) || sl.source === 'whoop') {
        map.set(sl.sleep_date, sl);
      }
    }
    return map;
  }, [sleepLogs]);

  // Selected day activities
  const selectedDayActivities = useMemo(() => {
    const key = format(selectedDay, 'yyyy-MM-dd');
    return activitiesByDate.get(key) || [];
  }, [selectedDay, activitiesByDate]);

  // Selected day metric and sleep log
  const selectedDayKey = format(selectedDay, 'yyyy-MM-dd');
  const selectedDayMetric = metricsByDate.get(selectedDayKey);
  const selectedDaySleepLog = sleepLogsByDate.get(selectedDayKey);

  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Calendar</h1>
        <p className="text-muted">View your activities at a glance</p>
      </div>

      {/* Calendar Card */}
      <Card>
        {/* Month navigation */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <button
            onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
            className="p-2.5 rounded-lg bg-surface-light hover:bg-accent/20 text-white transition-colors border border-surface-light"
            aria-label="Previous month"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>

          <h2 className="text-xl font-bold text-white">
            {format(currentMonth, 'MMMM yyyy')}
          </h2>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentMonth(new Date())}
              className="px-3 py-1.5 text-sm text-muted hover:text-white bg-surface-light hover:bg-accent/20 rounded-lg border border-surface-light transition-colors"
            >
              Today
            </button>
            <button
              onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
              className="p-2.5 rounded-lg bg-surface-light hover:bg-accent/20 text-white transition-colors border border-surface-light"
              aria-label="Next month"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Weekday headers + Month grid — desktop only */}
        <div className="hidden md:block">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 px-4">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="text-center text-sm font-medium text-muted py-3"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        {isLoading ? (
          <div className="px-4 pb-4">
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 35 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[120px] bg-surface-light/40 rounded-lg animate-pulse"
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="px-4 pb-4">
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((day) => {
                const dateKey = format(day, 'yyyy-MM-dd');
                const dayActivities = activitiesByDate.get(dateKey) || [];
                const inCurrentMonth = isSameMonth(day, currentMonth);
                const isSelected = isSameDay(day, selectedDay);
                const isTodayDate = isToday(day);

                return (
                  <button
                    key={dateKey}
                    onClick={() => setSelectedDay(day)}
                    aria-label={format(day, 'MMMM d, yyyy') + (dayActivities.length > 0 ? `, ${dayActivities.length} activities` : '')}
                    className={`
                      relative h-[120px] rounded-lg p-2 text-left transition-all
                      flex flex-col overflow-hidden
                      ${!inCurrentMonth ? 'opacity-30' : ''}
                      ${isSelected
                        ? 'bg-accent/15 border-2 border-accent ring-1 ring-accent/30'
                        : isTodayDate
                          ? 'border-2 border-accent/50 bg-surface-light/30 hover:bg-surface-light/50'
                          : 'border border-surface-light/60 bg-surface-light/20 hover:bg-surface-light/40'
                      }
                    `}
                  >
                    {/* Day number */}
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className={`text-sm font-semibold ${
                          isTodayDate
                            ? 'text-accent'
                            : isSelected
                              ? 'text-white'
                              : inCurrentMonth
                                ? 'text-white/80'
                                : 'text-muted/50'
                        }`}
                      >
                        {format(day, 'd')}
                      </span>
                      {isTodayDate && !isSelected && (
                        <span className="w-2 h-2 rounded-full bg-accent" />
                      )}
                    </div>

                    {/* Health metric badges (recovery, sleep) */}
                    {metricsByDate.has(dateKey) && (
                      <DayMetricsBadges dm={metricsByDate.get(dateKey)!} />
                    )}

                    {/* Activity badges */}
                    {dayActivities.length > 0 && (
                      <div className="flex-1 flex flex-col gap-1 overflow-hidden">
                        {dayActivities.slice(0, 2).map((activity) => (
                          <div
                            key={activity.id}
                            className={`rounded px-1.5 py-0.5 text-[11px] leading-tight truncate border ${getSportBorderColor(activity.sport_type)} ${getSportColor(activity.sport_type)}/10`}
                          >
                            <span className={getSportTextColor(activity.sport_type)}>
                              {getSportEmoji(activity.sport_type)}{' '}
                              {formatStat(activity)}
                            </span>
                          </div>
                        ))}
                        {dayActivities.length > 3 && (
                          <div className="text-[10px] text-muted px-1.5">
                            +{dayActivities.length - 3} more
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        </div>

        {/* Mobile agenda view — phones only */}
        <div className="md:hidden px-4 pb-4">
          <CalendarAgendaView
            calendarDays={calendarDays}
            currentMonth={currentMonth}
            selectedDay={selectedDay}
            activitiesByDate={activitiesByDate}
            metricsByDate={metricsByDate}
            setSelectedDay={setSelectedDay}
            isLoading={isLoading}
          />
        </div>

        {/* Legend */}
        <div className="px-6 pb-5 pt-2 border-t border-surface-light/50" aria-live="polite">
          {!isLoading && activities && activities.length === 0 && (
            <p className="text-xs text-muted/60 mb-2">No data for this period</p>
          )}
          <div className="flex flex-wrap gap-4">
            {[
              { label: 'Cycling', emoji: '\U0001F6B4', color: 'text-blue-400' },
              { label: 'Running', emoji: '\U0001F3C3', color: 'text-green-400' },
              { label: 'Strength', emoji: '\U0001F3CB\uFE0F', color: 'text-purple-400' },
              { label: 'Swimming', emoji: '\U0001F3CA', color: 'text-cyan-400' },
              { label: 'Walking / Hiking', emoji: '\U0001F97E', color: 'text-amber-400' },
            ].map(({ label, emoji, color }) => (
              <div key={label} className="flex items-center gap-1.5 text-xs">
                <span>{emoji}</span>
                <span className={`${color}`}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Day Detail Panel - below calendar */}
      <Card>
        <CardHeader>
          <CardTitle>
            {format(selectedDay, 'EEEE, MMMM d, yyyy')}
            {selectedDayActivities.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted">
                ({selectedDayActivities.length}{' '}
                {selectedDayActivities.length === 1 ? 'activity' : 'activities'})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <div className="px-6 pb-6">
          <DayDetailPanel
            selectedDay={selectedDay}
            calendarActivities={selectedDayActivities}
            dayMetric={selectedDayMetric}
            daySleepLog={selectedDaySleepLog}
            authFetch={authFetch}
          />
        </div>
      </Card>
    </div>
  );
}
