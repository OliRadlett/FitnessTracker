'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { formatDuration, formatDistance } from '@/lib/utils';
import type {
  ActivityCalendarEntry,
  Activity,
  LiftingSession,
  UpdateSessionPayload,
  DailyMetricSummary,
  SleepLogSummary,
} from '@/lib/api';
import {
  getSportEmoji,
  getSportTextColor,
  isStrengthType,
  isCyclingOrRunning,
} from '@/lib/sportUtils';

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

// ─── Day Detail Panel ──────────────────────────────────────────────────────

export function DayDetailPanel({
  selectedDay,
  calendarActivities,
  dayMetric,
  daySleepLog,
  authFetch,
}: {
  selectedDay: Date;
  calendarActivities: ActivityCalendarEntry[];
  dayMetric?: DailyMetricSummary;
  daySleepLog?: SleepLogSummary;
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

  // Format helpers for sleep
  const formatSleepHrs = (seconds: number) => `${(seconds / 3600).toFixed(1)}h`;
  const formatTime = (iso?: string) => {
    if (!iso) return '\u2014';
    try {
      return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch { return '\u2014'; }
  };

  const hasRecovery = dayMetric?.recovery_score != null || dayMetric?.hrv_ms != null || dayMetric?.resting_hr != null;
  const hasSleep = daySleepLog != null || dayMetric?.sleep_duration_minutes != null;

  return (
    <div className="space-y-4">
      {/* Recovery & Sleep Summary */}
      {(hasRecovery || hasSleep) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Recovery Card */}
          {hasRecovery && (
            <div className="bg-surface-light/50 rounded-xl border border-surface-light p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">{'\u2764\uFE0F'}</span>
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Recovery</h3>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {dayMetric?.recovery_score != null && (
                  <div className="text-center">
                    <div className="text-xs text-muted mb-1">Score</div>
                    <div className={`text-lg font-bold ${
                      dayMetric.recovery_score >= 67 ? 'text-green-400'
                      : dayMetric.recovery_score >= 34 ? 'text-yellow-400'
                      : 'text-red-400'
                    }`}>
                      {Math.round(dayMetric.recovery_score)}%
                    </div>
                  </div>
                )}
                {dayMetric?.hrv_ms != null && (
                  <div className="text-center">
                    <div className="text-xs text-muted mb-1">HRV</div>
                    <div className="text-lg font-bold text-blue-400">{Math.round(dayMetric.hrv_ms)}ms</div>
                  </div>
                )}
                {dayMetric?.resting_hr != null && (
                  <div className="text-center">
                    <div className="text-xs text-muted mb-1">RHR</div>
                    <div className="text-lg font-bold text-orange-400">{Math.round(dayMetric.resting_hr)} bpm</div>
                  </div>
                )}
              </div>
              {dayMetric?.strain != null && (
                <div className="mt-3 pt-2 border-t border-surface-light">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted">Strain</span>
                    <span className={`text-sm font-semibold ${
                      dayMetric.strain >= 14 ? 'text-red-400'
                      : dayMetric.strain >= 10 ? 'text-yellow-400'
                      : 'text-green-400'
                    }`}>{dayMetric.strain.toFixed(1)} / 21</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Sleep Card */}
          {hasSleep && (
            <div className="bg-surface-light/50 rounded-xl border border-surface-light p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">{'\U0001F634'}</span>
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Sleep</h3>
              </div>
              {daySleepLog ? (
                <>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="text-center">
                      <div className="text-xs text-muted mb-1">Total</div>
                      <div className={`text-lg font-bold ${
                        (daySleepLog.total_sleep_seconds ?? 0) >= 25200 ? 'text-green-400'
                        : (daySleepLog.total_sleep_seconds ?? 0) >= 21600 ? 'text-yellow-400'
                        : 'text-red-400'
                      }`}>
                        {daySleepLog.total_sleep_seconds ? formatSleepHrs(daySleepLog.total_sleep_seconds) : '\u2014'}
                      </div>
                    </div>
                    {daySleepLog.sleep_efficiency != null && (
                      <div className="text-center">
                        <div className="text-xs text-muted mb-1">Efficiency</div>
                        <div className="text-lg font-bold text-blue-400">{Math.round(daySleepLog.sleep_efficiency)}%</div>
                      </div>
                    )}
                  </div>
                  {/* Sleep stages */}
                  <div className="space-y-1.5">
                    {daySleepLog.deep_sleep_seconds != null && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-indigo-300">Deep</span>
                        <span className="text-white">{formatSleepHrs(daySleepLog.deep_sleep_seconds)}</span>
                      </div>
                    )}
                    {daySleepLog.rem_sleep_seconds != null && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-purple-300">REM</span>
                        <span className="text-white">{formatSleepHrs(daySleepLog.rem_sleep_seconds)}</span>
                      </div>
                    )}
                    {daySleepLog.light_sleep_seconds != null && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-sky-300">Light</span>
                        <span className="text-white">{formatSleepHrs(daySleepLog.light_sleep_seconds)}</span>
                      </div>
                    )}
                    {daySleepLog.awake_seconds != null && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-400">Awake</span>
                        <span className="text-white">{formatSleepHrs(daySleepLog.awake_seconds)}</span>
                      </div>
                    )}
                  </div>
                  {/* Bedtime / Wake */}
                  {(daySleepLog.sleep_start || daySleepLog.sleep_end) && (
                    <div className="mt-2 pt-2 border-t border-surface-light flex justify-between text-xs text-muted">
                      <span>{'\U0001F6CF\uFE0F'} {formatTime(daySleepLog.sleep_start)}</span>
                      <span>{'\u23F0'} {formatTime(daySleepLog.sleep_end)}</span>
                    </div>
                  )}
                </>
              ) : dayMetric?.sleep_duration_minutes != null ? (
                <div className="text-center">
                  <div className="text-xs text-muted mb-1">Duration</div>
                  <div className="text-lg font-bold text-blue-400">
                    {(dayMetric.sleep_duration_minutes / 60).toFixed(1)}h
                  </div>
                  {dayMetric.sleep_efficiency != null && (
                    <div className="text-xs text-muted mt-1">Efficiency: {Math.round(dayMetric.sleep_efficiency)}%</div>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

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
                      {'\u23F1'} {formatDuration(activity.duration_seconds)}
                    </span>
                  )}
                {activity.average_heartrate != null && (
                  <span>{'\u2764\uFE0F'} {Math.round(activity.average_heartrate)} bpm</span>
                )}
                {activity.calories != null && (
                  <span>{'\U0001F525'} {Math.round(activity.calories)} cal</span>
                )}
                {activity.elevation_gain_meters != null && (
                  <span>
                    {'\u26F0\uFE0F'} {Math.round(activity.elevation_gain_meters)}m elev
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
                <span>{'\u23F1'} {formatDuration(entry.duration_seconds)}</span>
              )}
              {entry.distance_meters != null && (
                <span>{'\U0001F4CF'} {formatDistance(entry.distance_meters)}</span>
              )}
              {entry.tss != null && (
                <span>{'\u26A1'} {Math.round(entry.tss)} TSS</span>
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
              <span className="text-2xl">{'\U0001F3CB\uFE0F'}</span>
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
                              {set.weight_kg}kg {'\u00D7'} {set.reps}
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
