'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type {
  LiftingSession,
  PersonalRecord,
  VolumeTrendPoint,
  VolumeTrendResponse,
  CreateSessionPayload,
  UpdateSessionPayload,
  CreatePRPayload,
  ChartData,
  LinkedActivity,
  ReadinessResponse,
  LiftingAnalysis,
  DeficiencyResponse,
} from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ChartBody } from '@/components/charts/Chart';
import { SkeletonRow } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { LinkActivityModal } from '@/components/lifting/LinkActivityModal';
import { WarmupTemplateManager } from '@/components/lifting/WarmupTemplateManager';
import { AddExerciseForm } from '@/components/lifting/AddExerciseForm';
import { ExerciseGroup } from '@/components/lifting/ExerciseGroup';
import { ManualPRForm } from '@/components/lifting/ManualPRForm';
import { ExerciseProgressSection } from '@/components/lifting/ExerciseProgressSection';
import { LiftingAnalysisCard } from '@/components/lifting/LiftingAnalysisCard';
import { SessionAiAnalysisCard } from '@/components/lifting/SessionAiAnalysisCard';
import { ReadinessIndicator } from '@/components/ui/ReadinessIndicator';
import { PRCelebration, type PREvent } from '@/components/ui/PRCelebration';
import { DeficiencyCard } from '@/components/dashboard/DeficiencyCard';

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildVolumeChart(volumeData: VolumeTrendPoint[]): ChartData {
  return {
    chart_type: 'bar' as const,
    title: 'Volume Trend (12 weeks)',
    labels: volumeData.map((d) => d.week_start),
    x_label: 'Week',
    y_label: 'Volume (kg)',
    series: [{ name: 'Total Volume', data: volumeData.map((d) => d.total_volume_kg) }],
  };
}

function formatDuration(seconds?: number | null): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Group lifting sets by exercise name, preserving order of first appearance. */
function groupSetsByExercise(sets: { exercise_name: string }[]): Map<string, typeof sets> {
  const groups = new Map<string, typeof sets>();
  for (const set of sets) {
    const existing = groups.get(set.exercise_name);
    if (existing) {
      existing.push(set);
    } else {
      groups.set(set.exercise_name, [set]);
    }
  }
  return groups;
}

// ── Linked Activity Card ─────────────────────────────────────────────────────

function LinkedActivityCard({ activity, onUnlink }: { activity: LinkedActivity; onUnlink: () => void }) {
  return (
    <div className="p-3 bg-surface-light/40 rounded-lg border border-accent/20">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded">Strava</span>
          <span className="text-sm font-medium text-white truncate max-w-[200px]">{activity.name}</span>
        </div>
        <button onClick={onUnlink} className="text-xs text-muted hover:text-warning transition-colors">
          Unlink
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        {activity.duration_seconds && (
          <div>
            <span className="text-muted">Duration</span>
            <p className="text-white">{formatDuration(activity.duration_seconds)}</p>
          </div>
        )}
        {activity.average_heartrate && (
          <div>
            <span className="text-muted">Avg HR</span>
            <p className="text-red-400">{Math.round(activity.average_heartrate)} bpm</p>
          </div>
        )}
        {activity.calories && (
          <div>
            <span className="text-muted">Calories</span>
            <p className="text-yellow-400">{Math.round(activity.calories)} kcal</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function LiftingPage() {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [showNewSession, setShowNewSession] = useState(false);
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [showEditSession, setShowEditSession] = useState(false);
  const [confirmDeleteSession, setConfirmDeleteSession] = useState(false);
  const [showManualPR, setShowManualPR] = useState(false);
  const [showAccessories, setShowAccessories] = useState(false);
  const [linkModalSessionId, setLinkModalSessionId] = useState<string | null>(null);
  const [celebrationPR, setCelebrationPR] = useState<PREvent | null>(null);
  const previousPRsRef = useRef<Map<string, number>>(new Map());

  const [newSession, setNewSession] = useState<CreateSessionPayload>({
    session_date: new Date().toISOString().split('T')[0],
    focus: '',
    notes: '',
  });

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: sessions, isLoading: sessionsLoading } = useQuery<LiftingSession[]>({
    queryKey: ['lifting-sessions'],
    queryFn: () => authFetch<LiftingSession[]>('/api/v1/lifting/sessions'),
    staleTime: 60_000,  // 1 min
  });

  const { data: strengthBalanceChart, isLoading: strengthBalanceLoading } = useQuery<ChartData>({
    queryKey: ['chart-strength-balance'],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/strength_balance'),
    staleTime: 300_000,
  });

  const { data: sessionDetail } = useQuery<LiftingSession>({
    queryKey: ['lifting-session', selectedSessionId],
    queryFn: () => authFetch<LiftingSession>(`/api/v1/lifting/sessions/${selectedSessionId}`),
    enabled: !!selectedSessionId,
  });

  const { data: sessionAnalysis } = useQuery<LiftingAnalysis>({
    queryKey: ['lifting-analysis', selectedSessionId],
    queryFn: () => authFetch<LiftingAnalysis>(`/api/v1/lifting/sessions/${selectedSessionId}/analysis`),
    enabled: !!selectedSessionId,
  });

  const { data: personalRecords, isLoading: prLoading } = useQuery<PersonalRecord[]>({
    queryKey: ['personal-records'],
    queryFn: () => authFetch<PersonalRecord[]>('/api/v1/lifting/prs'),
    staleTime: 300_000,  // 5 min — PRs change rarely
  });

  const { data: deficiency, isLoading: deficiencyLoading } = useQuery<DeficiencyResponse>({
    queryKey: ['deficiency'],
    queryFn: () => authFetch<DeficiencyResponse>('/api/v1/deficiency?weeks=8'),
    staleTime: 600_000,  // 10 min — expensive server-side computation
  });

  // ── PR Celebration Detection ────────────────────────────────────────────
  // Track PR changes and trigger celebration when a PR improves
  useEffect(() => {
    if (!personalRecords) return;

    const currentMap = new Map<string, number>();
    for (const pr of personalRecords) {
      if (pr.record_type === '1rm' && pr.estimated_1rm) {
        const existing = currentMap.get(pr.exercise_name);
        if (!existing || pr.estimated_1rm > existing) {
          currentMap.set(pr.exercise_name, pr.estimated_1rm);
        }
      }
    }

    // Only detect changes after we have a previous snapshot (skip first load)
    if (previousPRsRef.current.size > 0) {
      for (const [exercise, new1rm] of currentMap.entries()) {
        const prev1rm = previousPRsRef.current.get(exercise);
        if (prev1rm !== undefined && new1rm > prev1rm) {
          const improvementPct = ((new1rm - prev1rm) / prev1rm) * 100;
          setCelebrationPR({
            exercise_name: exercise,
            new_1rm: new1rm,
            previous_1rm: prev1rm,
            improvement_pct: improvementPct,
          });
          break; // celebrate one at a time
        } else if (prev1rm === undefined) {
          // Brand new exercise PR
          setCelebrationPR({
            exercise_name: exercise,
            new_1rm: new1rm,
            previous_1rm: null,
            improvement_pct: null,
          });
          break;
        }
      }
    }

    previousPRsRef.current = currentMap;
  }, [personalRecords]);

  const { data: volumeResponse, isLoading: volumeLoading } = useQuery<VolumeTrendResponse>({
    queryKey: ['lifting-volume'],
    queryFn: () => authFetch<VolumeTrendResponse>('/api/v1/lifting/volume-trends?weeks=12'),
    staleTime: 300_000,  // 5 min — volume trends are expensive
  });
  const volumeData = volumeResponse?.data;

  // Phase 5.2 — Readiness indicator
  const { data: readiness } = useQuery<ReadinessResponse>({
    queryKey: ['readiness'],
    queryFn: () => authFetch<ReadinessResponse>('/api/v1/metrics/readiness'),
    staleTime: 300_000,
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  const createSessionMutation = useMutation({
    mutationFn: (payload: CreateSessionPayload) =>
      authFetch<LiftingSession>('/api/v1/lifting/sessions', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: (newSession) => {
      queryClient.invalidateQueries({ queryKey: ['lifting-sessions'] });
      setShowNewSession(false);
      setSelectedSessionId(newSession.id);
      setNewSession({ session_date: new Date().toISOString().split('T')[0], focus: '', notes: '' });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (sessionId: string) =>
      authFetch<LiftingSession>(`/api/v1/lifting/sessions/${sessionId}/link`, {
        method: 'PUT',
        body: JSON.stringify({ activity_id: null }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lifting-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['lifting-session', selectedSessionId] });
    },
  });

  const backfillMutation = useMutation({
    mutationFn: () => authFetch<{ linked_count: number }>('/api/v1/lifting/backfill-links', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lifting-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['lifting-session', selectedSessionId] });
    },
  });

  const updateSetMutation = useMutation({
    mutationFn: ({ setId, data }: { setId: string; data: Record<string, unknown> }) =>
      authFetch<LiftingSession>(`/api/v1/lifting/sets/${setId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lifting-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['lifting-session', selectedSessionId] });
      queryClient.invalidateQueries({ queryKey: ['lifting-volume'] });
    },
  });

  const deleteSetMutation = useMutation({
    mutationFn: (setId: string) =>
      authFetch<void>(`/api/v1/lifting/sets/${setId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lifting-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['lifting-session', selectedSessionId] });
      queryClient.invalidateQueries({ queryKey: ['lifting-volume'] });
    },
  });

  const updateSessionMutation = useMutation({
    mutationFn: ({ sessionId, data }: { sessionId: string; data: UpdateSessionPayload }) =>
      authFetch<LiftingSession>(`/api/v1/lifting/sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lifting-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['lifting-session', selectedSessionId] });
      setShowEditSession(false);
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: (sessionId: string) =>
      authFetch<void>(`/api/v1/lifting/sessions/${sessionId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lifting-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['personal-records'] });
      setSelectedSessionId(null);
      setConfirmDeleteSession(false);
    },
  });

  const createPRMutation = useMutation({
    mutationFn: (payload: CreatePRPayload) =>
      authFetch<PersonalRecord>('/api/v1/lifting/prs', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personal-records'] });
      setShowManualPR(false);
    },
  });

  const volumeChart = volumeData ? buildVolumeChart(volumeData) : null;

  // Compute exercise groups for detail view
  const exerciseGroups = sessionDetail?.sets ? groupSetsByExercise(sessionDetail.sets) : new Map();

  return (
    <div className="space-y-6">
      {/* PR Celebration Toast */}
      <PRCelebration pr={celebrationPR} onDismiss={() => setCelebrationPR(null)} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Lifting</h1>
          <p className="text-muted">Track your strength training sessions</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => backfillMutation.mutate()}
            disabled={backfillMutation.isPending}
            className="px-4 py-2 bg-surface-light hover:bg-surface text-muted hover:text-white text-sm font-medium rounded-lg transition-colors border border-surface-light disabled:opacity-50"
            title="Auto-link Strava strength activities to lifting sessions"
          >
            {backfillMutation.isPending ? 'Linking...' : '🔗 Auto-Link Strava'}
          </button>
          <button
            onClick={() => setShowNewSession(!showNewSession)}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-colors"
          >
            {showNewSession ? 'Cancel' : '+ New Session'}
          </button>
        </div>
      </div>

      {/* Live Lift entry point */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-surface-light/40 rounded-xl border border-surface-light/50">
        <div>
          <p className="text-white font-semibold">⚡ Track a session live</p>
          <p className="text-sm text-muted">
            Log sets as you lift — one tap per set, works offline, Whoop strain attaches automatically.
          </p>
        </div>
        <a
          href="/lifting/live"
          className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-background font-bold rounded-xl transition-colors whitespace-nowrap"
        >
          Start Live Session
        </a>
      </div>

      {/* Whoop unmatched-session warning (live sessions only) */}
      {(() => {
        const THREE_H = 3 * 60 * 60 * 1000;
        const unmatched = (sessions ?? []).filter(
          (s) =>
            s.started_at &&
            s.ended_at &&
            !s.whoop_strain &&
            Date.now() - new Date(s.ended_at).getTime() > THREE_H
        );
        if (unmatched.length === 0) return null;
        const latest = unmatched[0];
        const start = new Date(latest.started_at!).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        const end = new Date(latest.ended_at!).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        return (
          <div className="p-4 bg-warning/10 border border-warning/30 rounded-xl text-sm">
            <p className="text-warning font-semibold">
              ⚠ No Whoop workout matched{' '}
              {unmatched.length > 1 ? `${unmatched.length} recent live sessions` : 'a recent live session'}
            </p>
            <p className="text-muted mt-1">
              If you wore your Whoop, add the activity in the Whoop app with the exact
              time range ({start}–{end}) and it will attach after the next sync.
            </p>
          </div>
        );
      })()}

      {/* Readiness Indicator */}
      {readiness && readiness.readiness !== 'unknown' && (
        <ReadinessIndicator
          recoveryScore={readiness.recovery_score ?? undefined}
          readiness={readiness.readiness}
          hrvMs={readiness.hrv_ms ?? undefined}
          restingHr={readiness.resting_hr ?? undefined}
          message={readiness.message}
        />
      )}

      {/* Backfill result */}
      {backfillMutation.isSuccess && backfillMutation.data && (
        <div className="p-3 bg-positive/10 border border-positive/30 rounded-lg text-sm text-positive" role="status" aria-live="polite">
          Linked {backfillMutation.data.linked_count} Strava activities to lifting sessions
        </div>
      )}

      {/* New Session Form */}
      {showNewSession && (
        <Card>
          <CardHeader><CardTitle>New Lifting Session</CardTitle></CardHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); createSessionMutation.mutate(newSession); }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-muted mb-1">Date *</label>
                <input
                  type="date"
                  value={newSession.session_date}
                  onChange={(e) => setNewSession({ ...newSession, session_date: e.target.value })}
                  className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Focus</label>
                <input
                  type="text"
                  placeholder="e.g. Upper Body, Legs, Push"
                  value={newSession.focus || ''}
                  onChange={(e) => setNewSession({ ...newSession, focus: e.target.value })}
                  className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Notes</label>
                <input
                  type="text"
                  placeholder="Optional notes"
                  value={newSession.notes || ''}
                  onChange={(e) => setNewSession({ ...newSession, notes: e.target.value })}
                  className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={createSessionMutation.isPending}
              className="px-6 py-2 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {createSessionMutation.isPending ? 'Creating...' : 'Create Session'}
            </button>
            {createSessionMutation.isError && <p className="text-warning text-sm" role="alert" aria-live="assertive">Failed to create session</p>}
          </form>
        </Card>
      )}

      {/* Sessions + Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Session List */}
        <div className="lg:col-span-1 space-y-3">
          <h2 className="text-lg font-semibold text-white">Sessions</h2>
          <div aria-live="polite">
          {sessionsLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))
          ) : sessions && sessions.length > 0 ? (
            sessions.map((session) => (
              <Card
                key={session.id}
                onClick={() => { setSelectedSessionId(selectedSessionId === session.id ? null : session.id); setShowAddExercise(false); }}
                className={selectedSessionId === session.id ? 'border-accent/50' : ''}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white">{session.focus || 'General Session'}</p>
                      {session.linked_activity && (
                        <span className="text-[10px] text-orange-400 bg-orange-400/10 px-1.5 py-0.5 rounded font-medium">Strava</span>
                      )}
                    </div>
                    <p className="text-xs text-muted">{new Date(session.session_date).toLocaleDateString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-purple-400">{session.sets?.length ?? 0} sets</p>
                    {session.total_volume_kg !== undefined && (
                      <p className="text-xs text-muted">{session.total_volume_kg.toLocaleString()} kg</p>
                    )}
                  </div>
                </div>
              </Card>
            ))
          ) : (
            <EmptyState
              icon="🏋️"
              title="No lifting sessions recorded"
              description="Create your first session above to start tracking your strength training."
            />
          )}
          </div>
        </div>

        {/* Session Detail */}
        <div className="lg:col-span-2">
          {selectedSessionId && sessionDetail ? (
            <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{sessionDetail.focus || 'Session Detail'}</CardTitle>
                    <p className="text-sm text-muted mt-1">
                      {new Date(sessionDetail.session_date).toLocaleDateString()}
                      {sessionDetail.notes && ` · ${sessionDetail.notes}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowEditSession(!showEditSession)}
                      className="px-3 py-1.5 text-muted hover:text-accent text-sm transition-colors"
                      aria-label="Edit session"
                      title="Edit session"
                    >
                      ✏️
                    </button>
                    {confirmDeleteSession ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => deleteSessionMutation.mutate(selectedSessionId)}
                          disabled={deleteSessionMutation.isPending}
                          className="text-xs text-white bg-warning/80 hover:bg-warning px-2 py-1 rounded disabled:opacity-50"
                        >
                          Delete
                        </button>
                        <button onClick={() => setConfirmDeleteSession(false)} className="text-xs text-muted hover:text-white px-2 py-1">Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteSession(true)}
                        className="px-3 py-1.5 text-muted hover:text-warning text-sm transition-colors"
                        aria-label="Delete session"
                        title="Delete session"
                      >
                        🗑️
                      </button>
                    )}
                    <button
                      onClick={() => setShowAddExercise(!showAddExercise)}
                      className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      {showAddExercise ? 'Cancel' : '+ Add Exercise'}
                    </button>
                  </div>
                </div>
              </CardHeader>

              {/* Edit Session Form */}
              {showEditSession && (
                <div className="mb-4 p-4 bg-surface-light/30 rounded-lg space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs text-muted mb-1">Date</label>
                      <input
                        type="date"
                        defaultValue={sessionDetail.session_date}
                        onBlur={(e) => updateSessionMutation.mutate({ sessionId: selectedSessionId, data: { session_date: e.target.value } })}
                        className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted mb-1">Focus</label>
                      <input
                        type="text"
                        defaultValue={sessionDetail.focus || ''}
                        onBlur={(e) => updateSessionMutation.mutate({ sessionId: selectedSessionId, data: { focus: e.target.value || undefined } })}
                        placeholder="e.g. Upper Body"
                        className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted mb-1">Notes</label>
                      <input
                        type="text"
                        defaultValue={sessionDetail.notes || ''}
                        onBlur={(e) => updateSessionMutation.mutate({ sessionId: selectedSessionId, data: { notes: e.target.value || undefined } })}
                        placeholder="Optional notes"
                        className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                  </div>
                  <button onClick={() => setShowEditSession(false)} className="px-3 py-1.5 text-muted hover:text-white text-sm transition-colors">Done</button>
                </div>
              )}

              {/* Linked Strava Activity */}
              {sessionDetail.linked_activity ? (
                <div className="mb-4">
                  <LinkedActivityCard
                    activity={sessionDetail.linked_activity}
                    onUnlink={() => unlinkMutation.mutate(selectedSessionId)}
                  />
                </div>
              ) : (
                <div className="mb-4">
                  <button
                    onClick={() => setLinkModalSessionId(selectedSessionId)}
                    className="text-sm text-accent hover:text-accent-hover transition-colors flex items-center gap-1"
                  >
                    <span>🔗</span> Link Strava activity
                  </button>
                </div>
              )}

              {/* Add Exercise Form */}
              {showAddExercise && (
                <div className="mb-4">
                  <AddExerciseForm
                    sessionId={selectedSessionId}
                    onDone={() => setShowAddExercise(false)}
                  />
                </div>
              )}

              {/* Exercise Groups */}
              {exerciseGroups.size > 0 ? (
                <div className="space-y-3">
                  {Array.from(exerciseGroups.entries()).map(([exerciseName, sets]) => (
                    <ExerciseGroup
                      key={exerciseName}
                      exerciseName={exerciseName}
                      sets={sets}
                      onUpdateSet={(setId, data) => updateSetMutation.mutate({ setId, data })}
                      onDeleteSet={(setId) => deleteSetMutation.mutate(setId)}
                      isUpdating={updateSetMutation.isPending}
                      isDeleting={deleteSetMutation.isPending}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-muted text-center py-8">No exercises yet. Add your first exercise above.</p>
              )}
            </Card>

            {/* Static Session Analysis */}
            {sessionAnalysis && (
              <div className="mt-6">
                <LiftingAnalysisCard analysis={sessionAnalysis} />
              </div>
            )}

            {/* AI Session Analysis */}
            <div className="mt-6">
              <SessionAiAnalysisCard sessionId={selectedSessionId} />
            </div>
            </div>
          ) : (
            <Card><p className="text-muted text-center py-12">Select a session to view details</p></Card>
          )}
        </div>
      </div>

      {/* Warmup Templates */}
      <WarmupTemplateManager />

      {/* Personal Records */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Personal Records</CardTitle>
            <button
              onClick={() => setShowManualPR(!showManualPR)}
              className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
            >
              {showManualPR ? 'Cancel' : '+ Add PR'}
            </button>
          </div>
        </CardHeader>

        {/* Manual PR Form */}
        {showManualPR && <ManualPRForm onSubmit={(data) => createPRMutation.mutate(data)} onCancel={() => setShowManualPR(false)} isPending={createPRMutation.isPending} />}

        {prLoading ? (
          <SkeletonRow className="h-40" />
        ) : personalRecords && personalRecords.length > 0 ? (() => {
          // Group and sort PRs: Big 3 first, then compounds, then accessories
          const BIG_3 = ['Back Squat', 'Bench Press', 'Deadlift'];
          const big3PRs: PersonalRecord[] = [];
          const compoundPRs: PersonalRecord[] = [];
          const accessoryPRs: PersonalRecord[] = [];
          const big3Seen = new Set<string>();

          for (const pr of personalRecords) {
            const name = pr.exercise_name;
            if (BIG_3.includes(name) && !big3Seen.has(name)) {
              big3PRs.push(pr);
              big3Seen.add(name);
            } else if (!BIG_3.includes(name)) {
              // Heuristic: compound exercises are typically barbell/multi-joint
              const compoundHints = ['squat', 'press', 'deadlift', 'row', 'pull', 'dip', 'lunge', 'thrust', 'clean', 'snatch', 'hip'];
              const isCompound = compoundHints.some(h => name.toLowerCase().includes(h));
              if (isCompound) compoundPRs.push(pr);
              else accessoryPRs.push(pr);
            }
          }
          // Sort Big 3 in canonical order
          big3PRs.sort((a, b) => BIG_3.indexOf(a.exercise_name) - BIG_3.indexOf(b.exercise_name));
          compoundPRs.sort((a, b) => a.exercise_name.localeCompare(b.exercise_name));
          accessoryPRs.sort((a, b) => a.exercise_name.localeCompare(b.exercise_name));

          function PRCard({ pr }: { pr: PersonalRecord }) {
            return (
              <div className="p-4 bg-surface-light/30 rounded-lg">
                <p className="text-sm font-medium text-white mb-2">{pr.exercise_name}</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-lg font-bold text-blue-400">{pr.weight_kg} kg</p>
                    <p className="text-xs text-muted">Weight</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-green-400">{pr.reps}</p>
                    <p className="text-xs text-muted">Reps</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-purple-400">{pr.estimated_1rm?.toFixed(1)} kg</p>
                    <p className="text-xs text-muted">Est. 1RM</p>
                  </div>
                </div>
                <p className="text-xs text-muted mt-2 text-center">
                  {new Date(pr.achieved_date).toLocaleDateString()}
                </p>
                {pr.notes && <p className="text-xs text-accent mt-1 text-center">{pr.notes}</p>}
              </div>
            );
          }

          // Calculate Big 3 total
          const big3Total = big3PRs.reduce((sum, pr) => sum + (pr.estimated_1rm || pr.weight_kg), 0);

          return (
            <div className="space-y-4">
              {/* Big 3 */}
              {big3PRs.length > 0 && (
                <div>
                  <div className="flex items-center gap-4 mb-3">
                    <h3 className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Big 3</h3>
                    {big3Total > 0 && (
                      <span className="text-xs font-bold text-white bg-blue-500/20 px-3 py-1 rounded-full">
                        Total: {Math.round(big3Total)} kg
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {big3PRs.map((pr) => <PRCard key={pr.id} pr={pr} />)}
                  </div>
                </div>
              )}
              {/* Other Compounds */}
              {compoundPRs.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-3">Compounds</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {compoundPRs.map((pr) => <PRCard key={pr.id} pr={pr} />)}
                  </div>
                </div>
              )}
              {/* Accessories (behind toggle) */}
              {accessoryPRs.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowAccessories(!showAccessories)}
                    className="text-xs font-semibold text-muted hover:text-white uppercase tracking-wider mb-3 transition-colors flex items-center gap-1"
                  >
                    <span>{showAccessories ? '▾' : '▸'}</span> Accessories ({accessoryPRs.length})
                  </button>
                  {showAccessories && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {accessoryPRs.map((pr) => <PRCard key={pr.id} pr={pr} />)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })() : (
          <p className="text-muted text-center py-8">No personal records yet</p>
        )}
      </Card>

      {/* Weakness / Deficiency Analysis */}
      <DeficiencyCard data={deficiency} isLoading={deficiencyLoading} />

      {/* Volume Trend */}
      <Card>
        <CardHeader><CardTitle>Volume Trend</CardTitle></CardHeader>
        <ChartBody
          isLoading={volumeLoading}
          data={volumeChart}
          emptyMessage="No volume data available"
          height={320}
        />
      </Card>

      {/* Strength Balance */}
      <Card>
        <CardHeader><CardTitle>Strength Balance</CardTitle></CardHeader>
        <ChartBody
          isLoading={strengthBalanceLoading}
          data={strengthBalanceChart}
          emptyMessage="Log lifts with estimated 1RM to see your strength balance"
          height={280}
        />
      </Card>

      {/* Exercise Progress */}
      <ExerciseProgressSection sessions={sessions} />

      {/* Link Activity Modal */}
      {linkModalSessionId && (
        <LinkActivityModal sessionId={linkModalSessionId} onClose={() => setLinkModalSessionId(null)} />
      )}
    </div>
  );
}
