'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type {
  ActivityCalendarEntry,
  Activity,
  LiftingSession,
  UpdateSessionPayload,
  CalendarDayData,
  DailyMetricSummary,
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

// ─── Sport type helpers ────────────────────────────────────────────────────

function getSportColor(sportType: string): string {
  const n = sportType.toLowerCase();
  if (n.includes('cycl') || n.includes('bike')) return 'bg-blue-500';
  if (n.includes('run')) return 'bg-green-500';
  if (
    n.includes('strength') ||
    n.includes('weight') ||
    n.includes('workout') ||
    n.includes('lift')
  )
    return 'bg-purple-500';
  if (n.includes('swim')) return 'bg-cyan-500';
  if (n.includes('walk') || n.includes('hik')) return 'bg-amber-500';
  return 'bg-gray-500';
}

function getSportTextColor(sportType: string): string {
  const n = sportType.toLowerCase();
  if (n.includes('cycl') || n.includes('bike')) return 'text-blue-400';
  if (n.includes('run')) return 'text-green-400';
  if (
    n.includes('strength') ||
    n.includes('weight') ||
    n.includes('workout') ||
    n.includes('lift')
  )
    return 'text-purple-400';
  if (n.includes('swim')) return 'text-cyan-400';
  if (n.includes('walk') || n.includes('hik')) return 'text-amber-400';
  return 'text-gray-400';
}

function getSportBorderColor(sportType: string): string {
  const n = sportType.toLowerCase();
  if (n.includes('cycl') || n.includes('bike')) return 'border-blue-500/30';
  if (n.includes('run')) return 'border-green-500/30';
  if (
    n.includes('strength') ||
    n.includes('weight') ||
    n.includes('workout') ||
    n.includes('lift')
  )
    return 'border-purple-500/30';
  if (n.includes('swim')) return 'border-cyan-500/30';
  if (n.includes('walk') || n.includes('hik')) return 'border-amber-500/30';
  return 'border-gray-500/30';
}

function getSportEmoji(sportType: string): string {
  const n = sportType.toLowerCase();
  if (n.includes('cycl') || n.includes('bike')) return '🚴';
  if (n.includes('run')) return '🏃';
  if (
    n.includes('strength') ||
    n.includes('weight') ||
    n.includes('workout') ||
    n.includes('lift')
  )
    return '🏋️';
  if (n.includes('swim')) return '🏊';
  if (n.includes('walk') || n.includes('hik')) return '🥾';
  return '⚡';
}

function isStrengthType(sportType: string): boolean {
  const n = sportType.toLowerCase();
  return (
    n.includes('strength') ||
    n.includes('weight') ||
    n.includes('workout') ||
    n.includes('lift')
  );
}

function isCyclingOrRunning(sportType: string): boolean {
  const n = sportType.toLowerCase();
  return (
    n.includes('cycl') ||
    n.includes('bike') ||
    n.includes('run')
  );
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function formatDistance(meters: number): string {
  const km = meters / 1000;
  return `${km.toFixed(1)} km`;
}

function formatStat(activity: ActivityCalendarEntry): string {
  if (isStrengthType(activity.sport_type)) {
    // Show focus if available, otherwise fall back to activity name
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
  return parts.join(' · ') || activity.name;
}

// ─── Calendar grid builder ─────────────────────────────────────────────────

function buildCalendarDays(currentMonth: Date): Date[] {
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  return eachDayOfInterval({ start: calStart, end: calEnd });
}

// ─── Day Detail Panel ──────────────────────────────────────────────────────

function DayDetailPanel({
  selectedDay,
  calendarActivities,
  authFetch,
}: {
  selectedDay: Date;
  calendarActivities: ActivityCalendarEntry[];
  authFetch: <T>(path: string, options?: RequestInit) => Promise<T>;
}) {
  const queryClient = useQueryClient();
  const dateStr = format(selectedDay, 'yyyy-MM-dd');
  const nextDateStr = format(
    new Date(selectedDay.getTime() + 86400000),
    'yyyy-MM-dd',
  );

  // Fetch full activity details for this day
  const { data: activities, isLoading: loadingActivities } = useQuery<
    Activity[]
  >({
    queryKey: ['activities-detail', dateStr],
    queryFn: () =>
      authFetch<Activity[]>(
        `/api/v1/activities?start_date_after=${dateStr}T00:00:00&start_date_before=${nextDateStr}T00:00:00`,
      ),
    enabled: calendarActivities.length > 0,
  });

  // Fetch lifting sessions and filter to this day
  const { data: allSessions, isLoading: loadingSessions } = useQuery<
    LiftingSession[]
  >({
    queryKey: ['lifting-sessions-calendar'],
    queryFn: () => authFetch<LiftingSession[]>('/api/v1/lifting/sessions'),
    enabled: calendarActivities.some((a) => isStrengthType(a.sport_type)),
  });

  const daySessions = useMemo(() => {
    if (!allSessions) return [];
    return allSessions.filter((s) => s.session_date === dateStr);
  }, [allSessions, dateStr]);

  // Notes editing state
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({});

  const updateSessionMutation = useMutation({
    mutationFn: ({
      sessionId,
      payload,
    }: {
      sessionId: string;
      payload: UpdateSessionPayload;
    }) =>
      authFetch<LiftingSession>(`/api/v1/lifting/sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lifting-sessions-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['lifting-sessions'] });
    },
  });

  const handleSaveNotes = useCallback(
    (sessionId: string) => {
      const notes = editingNotes[sessionId];
      if (notes === undefined) return;
      updateSessionMutation.mutate({
        sessionId,
        payload: { notes },
      });
    },
    [editingNotes, updateSessionMutation],
  );

  const isLoading = loadingActivities || loadingSessions;

  return (
    <div className="space-y-4">
      {/* Activity details */}
      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-32 bg-surface-light rounded-lg" />
          ))}
        </div>
      ) : activities && activities.length > 0 ? (
        activities.map((activity) => {
          const matchingSession = daySessions.find(
            (s) => s.activity_id === activity.id,
          );

          return (
            <div
              key={activity.id}
              className="bg-surface-light/50 rounded-xl border border-surface-light hover:border-accent/30 transition-colors p-5"
            >
              {/* Header */}
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">
                  {getSportEmoji(activity.sport_type)}
                </span>
                <div className="flex-1 min-w-0">
                  <h3 className="text-white font-semibold text-lg truncate">
                    {activity.name}
                  </h3>
                  <span
                    className={`text-sm font-medium ${getSportTextColor(activity.sport_type)}`}
                  >
                    {activity.sport_type}
                  </span>
                </div>
              </div>

              {/* Stats grid for cycling/running */}
              {isCyclingOrRunning(activity.sport_type) && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  {activity.distance_meters != null && (
                    <div className="bg-surface/60 rounded-lg p-3 text-center">
                      <div className="text-xs text-muted mb-1">Distance</div>
                      <div className="text-white font-semibold">
                        {formatDistance(activity.distance_meters)}
                      </div>
                    </div>
                  )}
                  {activity.duration_seconds != null && (
                    <div className="bg-surface/60 rounded-lg p-3 text-center">
                      <div className="text-xs text-muted mb-1">Duration</div>
                      <div className="text-white font-semibold">
                        {formatDuration(activity.duration_seconds)}
                      </div>
                    </div>
                  )}
                  {activity.average_power != null && (
                    <div className="bg-surface/60 rounded-lg p-3 text-center">
                      <div className="text-xs text-muted mb-1">Avg Power</div>
                      <div className="text-white font-semibold">
                        {Math.round(activity.average_power)} W
                      </div>
                    </div>
                  )}
                  {activity.tss != null && (
                    <div className="bg-surface/60 rounded-lg p-3 text-center">
                      <div className="text-xs text-muted mb-1">TSS</div>
                      <div className="text-white font-semibold">
                        {Math.round(activity.tss)}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Extra stats */}
              <div className="flex flex-wrap gap-4 text-sm text-muted mb-3">
                {activity.duration_seconds != null &&
                  !isCyclingOrRunning(activity.sport_type) && (
                    <span>
                      ⏱ {formatDuration(activity.duration_seconds)}
                    </span>
                  )}
                {activity.average_heartrate != null && (
                  <span>❤️ {Math.round(activity.average_heartrate)} bpm</span>
                )}
                {activity.calories != null && (
                  <span>🔥 {Math.round(activity.calories)} cal</span>
                )}
                {activity.elevation_gain_meters != null && (
                  <span>
                    ⛰️ {Math.round(activity.elevation_gain_meters)}m elev
                  </span>
                )}
              </div>

              {/* Lifting session details */}
              {matchingSession && (
                <LiftingSessionDetail
                  session={matchingSession}
                  editingNotes={editingNotes}
                  setEditingNotes={setEditingNotes}
                  onSaveNotes={handleSaveNotes}
                  isSaving={updateSessionMutation.isPending}
                />
              )}
            </div>
          );
        })
      ) : calendarActivities.length > 0 ? (
        /* Fallback: show calendar-level summaries if full fetch returned empty */
        calendarActivities.map((entry) => (
          <div
            key={entry.id}
            className="bg-surface-light/50 rounded-xl border border-surface-light p-5"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">
                {getSportEmoji(entry.sport_type)}
              </span>
              <div className="flex-1 min-w-0">
                <h3 className="text-white font-semibold truncate">
                  {entry.name}
                </h3>
                <span
                  className={`text-sm ${getSportTextColor(entry.sport_type)}`}
                >
                  {entry.sport_type}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-muted">
              {entry.duration_seconds != null && (
                <span>⏱ {formatDuration(entry.duration_seconds)}</span>
              )}
              {entry.distance_meters != null && (
                <span>📏 {formatDistance(entry.distance_meters)}</span>
              )}
              {entry.tss != null && (
                <span>⚡ {Math.round(entry.tss)} TSS</span>
              )}
            </div>
          </div>
        ))
      ) : (
        <div className="text-center py-12 text-muted">
          <p className="text-lg mb-1">No activities</p>
          <p className="text-sm">Nothing logged for this day</p>
        </div>
      )}

      {/* Standalone lifting sessions (not linked to an activity) */}
      {daySessions
        .filter((s) => !s.activity_id)
        .map((session) => (
          <div
            key={session.id}
            className="bg-surface-light/50 rounded-xl border border-purple-500/20 p-5"
          >
            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl">🏋️</span>
              <div className="flex-1 min-w-0">
                <h3 className="text-white font-semibold text-lg truncate">
                  {session.focus || session.program_name || 'Lifting Session'}
                </h3>
                <span className="text-sm text-purple-400">Strength</span>
              </div>
              {session.total_volume_kg != null && (
                <div className="text-right">
                  <div className="text-xs text-muted">Volume</div>
                  <div className="text-white font-semibold">
                    {Math.round(session.total_volume_kg).toLocaleString()} kg
                  </div>
                </div>
              )}
            </div>

            {/* Set details */}
            {session.sets.length > 0 && (
              <div className="mb-4">
                <div className="text-xs text-muted mb-2 font-medium uppercase tracking-wider">
                  Exercises
                </div>
                <div className="space-y-2">
                  {Object.entries(
                    session.sets.reduce(
                      (acc, set) => {
                        if (!acc[set.exercise_name]) acc[set.exercise_name] = [];
                        acc[set.exercise_name].push(set);
                        return acc;
                      },
                      {} as Record<string, typeof session.sets>,
                    ),
                  ).map(([exercise, sets]) => (
                    <div
                      key={exercise}
                      className="bg-surface/60 rounded-lg p-3"
                    >
                      <div className="text-white font-medium text-sm mb-1">
                        {exercise}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {sets
                          .sort((a, b) => a.set_number - b.set_number)
                          .map((set) => (
                            <span
                              key={set.id}
                              className={`text-xs px-2 py-1 rounded ${
                                set.is_warmup
                                  ? 'bg-surface-light text-muted'
                                  : 'bg-purple-500/15 text-purple-300'
                              }`}
                            >
                              {set.is_warmup ? '(w) ' : ''}
                              {set.weight_kg}kg × {set.reps}
                              {set.is_amrap ? '+' : ''}
                            </span>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Editable notes */}
            <LiftingSessionDetail
              session={session}
              editingNotes={editingNotes}
              setEditingNotes={setEditingNotes}
              onSaveNotes={handleSaveNotes}
              isSaving={updateSessionMutation.isPending}
            />
          </div>
        ))}
    </div>
  );
}

// ─── Lifting Session Notes Editor ──────────────────────────────────────────

function LiftingSessionDetail({
  session,
  editingNotes,
  setEditingNotes,
  onSaveNotes,
  isSaving,
}: {
  session: LiftingSession;
  editingNotes: Record<string, string>;
  setEditingNotes: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  onSaveNotes: (sessionId: string) => void;
  isSaving: boolean;
}) {
  const currentNotes =
    editingNotes[session.id] !== undefined
      ? editingNotes[session.id]
      : session.notes || '';
  const hasChanges =
    editingNotes[session.id] !== undefined &&
    editingNotes[session.id] !== (session.notes || '');

  return (
    <div className="mt-3 pt-3 border-t border-surface-light">
      <div className="text-xs text-muted mb-2 font-medium uppercase tracking-wider">
        Notes
      </div>
      <textarea
        className="w-full bg-surface/80 border border-surface-light rounded-lg p-3 text-sm text-white placeholder-muted resize-none focus:outline-none focus:border-accent/50 transition-colors"
        rows={3}
        placeholder="Add session notes..."
        value={currentNotes}
        onChange={(e) =>
          setEditingNotes((prev) => ({
            ...prev,
            [session.id]: e.target.value,
          }))
        }
      />
      {hasChanges && (
        <button
          onClick={() => onSaveNotes(session.id)}
          disabled={isSaving}
          className="mt-2 px-4 py-1.5 bg-accent/20 hover:bg-accent/30 text-accent text-sm font-medium rounded-lg border border-accent/30 transition-colors disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save Notes'}
        </button>
      )}
    </div>
  );
}

// ─── Calendar Page ─────────────────────────────────────────────────────────

export default function CalendarPage() {
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

  // Selected day activities
  const selectedDayActivities = useMemo(() => {
    const key = format(selectedDay, 'yyyy-MM-dd');
    return activitiesByDate.get(key) || [];
  }, [selectedDay, activitiesByDate]);

  // Helper to get recovery color class
  const getRecoveryColor = (score: number): string => {
    if (score >= 70) return 'text-green-400';
    if (score >= 40) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getRecoveryBg = (score: number): string => {
    if (score >= 70) return 'bg-green-500/15';
    if (score >= 40) return 'bg-yellow-500/15';
    return 'bg-red-500/15';
  };

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
                    {metricsByDate.has(dateKey) && (() => {
                      const dm = metricsByDate.get(dateKey)!;
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
                    })()}

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

        {/* Legend */}
        <div className="px-6 pb-5 pt-2 border-t border-surface-light/50" aria-live="polite">
          {!isLoading && activities && activities.length === 0 && (
            <p className="text-xs text-muted/60 mb-2">No data for this period</p>
          )}
          <div className="flex flex-wrap gap-4">
            {[
              { label: 'Cycling', emoji: '🚴', color: 'text-blue-400' },
              { label: 'Running', emoji: '🏃', color: 'text-green-400' },
              { label: 'Strength', emoji: '🏋️', color: 'text-purple-400' },
              { label: 'Swimming', emoji: '🏊', color: 'text-cyan-400' },
              { label: 'Walking / Hiking', emoji: '🥾', color: 'text-amber-400' },
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
            authFetch={authFetch}
          />
        </div>
      </Card>
    </div>
  );
}
