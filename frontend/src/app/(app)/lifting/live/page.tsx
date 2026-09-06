'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getLiftingSessions,
  getPersonalRecords,
  getWarmupTemplates,
  getActiveLiftingSession,
  getTrainingPlans,
  getPlanWeek,
  updateLiftingSession,
} from '@/lib/api';
import { useAuthFetch } from '@/lib/api/fetch';
import type { WarmupTemplate, TrainingPlanSummary, TrainingWeekDay } from '@/lib/api/types';
import { LiveWorkout } from '@/components/lifting/LiveWorkout';
import {
  buildLastSessionMap,
  recentExerciseNames,
  type ExerciseReference,
} from '@/lib/lifting/reference';
import { useLiveSession } from '@/lib/lifting/useLiveSession';
import { getCurrentWeek, toDateStr } from '@/lib/training/week';
import { usePageTitle } from '@/lib/usePageTitle';

const FOCUS_OPTIONS = ['squat', 'bench', 'deadlift', 'overhead_press', 'accessories'];

export default function LiveLiftPage() {
  usePageTitle('Live Lift');
  const { authFetch } = useAuthFetch();
  const live = useLiveSession(authFetch);
  const queryClient = useQueryClient();

  // Reference data for prefill / last-session lines
  const { data: sessions } = useQuery({
    queryKey: ['lifting-sessions'],
    queryFn: () => getLiftingSessions(authFetch),
    staleTime: 60_000,
  });
  const { data: prs } = useQuery({
    queryKey: ['personal-records'],
    queryFn: () => getPersonalRecords(authFetch),
    staleTime: 60_000,
  });
  const { data: templates } = useQuery({
    queryKey: ['warmup-templates'],
    queryFn: () => getWarmupTemplates(authFetch),
    staleTime: 300_000,
  });

  // An orphaned server-side session that never finished (e.g. a previous tab
  // was killed after the first sync but before Finish) pollutes the lifting
  // history and Whoop matching. Surface it on the pre-start screen so the user
  // can close it (B8).
  const { data: remoteActive } = useQuery({
    queryKey: ['lifting-active-session'],
    queryFn: () => getActiveLiftingSession(authFetch),
    staleTime: 60_000,
    enabled: !live.state && !!live.hydrated,
  });
  const [remoteCleanupState, setRemoteCleanupState] = useState<'idle' | 'cleaning' | 'error'>('idle');
  const handleCleanupRemoteActive = async () => {
    if (!remoteActive) return;
    setRemoteCleanupState('cleaning');
    try {
      await updateLiftingSession(authFetch, remoteActive.id, {
        ended_at: new Date().toISOString(),
        notes: '(discarded from Live Lift)',
      });
      await queryClient.invalidateQueries({ queryKey: ['lifting-active-session'] });
    } catch {
      setRemoteCleanupState('error');
    } finally {
      setRemoteCleanupState('idle');
    }
  };

  // Today's strength plan day (if any) — powers the "Load from today's plan"
  // suggestion chip. Suggest-only: nothing auto-applies until the user taps it.
  const { data: planDayForToday } = useQuery({
    queryKey: ['live-plan-today'],
    queryFn: async (): Promise<{ planName: string; planDay: TrainingWeekDay } | null> => {
      const plans = await getTrainingPlans(authFetch, 'active');
      const today = toDateStr(new Date());
      const plan: TrainingPlanSummary | undefined = plans.find(
        (p) => p.start_date <= today && today <= p.end_date
      );
      if (!plan) return null;
      const week = getCurrentWeek(plan.start_date, plan.end_date);
      const weekData = await getPlanWeek(authFetch, plan.id, week);
      const day = weekData.days.find(
        (d) =>
          d.day_date === today &&
          d.sport === 'strength' &&
          (d.planned_exercises?.length ?? 0) > 0 &&
          !d.completed
      );
      return day ? { planName: plan.name, planDay: day } : null;
    },
    staleTime: 10 * 60_000,
    enabled: !live.state && !!live.hydrated,
  });
  const [planPreset, setPlanPreset] = useState<{
    planName: string;
    focus: string | null;
    firstExercise: string;
  } | null>(null);
  const handleLoadPlan = () => {
    if (!planDayForToday) return;
    const { planName, planDay } = planDayForToday;
    setPlanPreset({
      planName,
      focus: planDay.planned_focus ?? null,
      firstExercise: planDay.planned_exercises?.[0]?.exercise ?? '',
    });
    setFocus(planDay.planned_focus ?? null);
  };

  const referenceMap = useMemo<Record<string, ExerciseReference>>(
    () =>
      buildLastSessionMap(
        sessions ?? [],
        live.state?.sessionId ?? undefined
      ),
    [sessions, live.state?.sessionId]
  );
  const recentNames = useMemo(
    () => recentExerciseNames(sessions ?? []),
    [sessions]
  );

  // Pre-session form state
  const [focus, setFocus] = useState<string | null>(null);
  const [programName, setProgramName] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<WarmupTemplate | null>(null);
  const [showFinish, setShowFinish] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  // Snapshot captured at finish so the summary survives the state clear.
  const [finishedSummary, setFinishedSummary] = useState<{
    sessionId: string | null;
    durationSeconds: number;
    totalVolume: number;
    workingSets: number;
    exercises: string[];
    rpe: number | null;
  } | null>(null);

  // Complete any interrupted finish flow from a previous session
  useEffect(() => {
    if (live.hydrated && live.state?.phase === 'finishing') {
      void live.retrySync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.hydrated]);

  // Warn before leaving mid-session
  useEffect(() => {
    if (!live.state || live.state.phase !== 'active') return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [live.state]);

  const handleStart = () => {
    live.startSession({
      programName: planPreset ? planPreset.planName : programName,
      focus: planPreset ? planPreset.focus ?? undefined : focus ?? undefined,
    });
    if (planPreset?.firstExercise) live.setCurrentExercise(planPreset.firstExercise);
    if (selectedTemplate) {
      const exerciseName = selectedTemplate.exercise_name || 'Warm-up';
      for (const step of selectedTemplate.steps) {
        live.logSet({
          exercise_name: exerciseName,
          weight_kg: step.weight_kg,
          reps: step.reps,
          is_warmup: true,
        });
      }
      live.setCurrentExercise(exerciseName);
    }
  };

  const handleFinish = async (rpe: number | null, notes: string) => {
    setFinishError(null);
    // Snapshot before the session state clears on success.
    const snapshot = {
      sessionId: live.state?.sessionId ?? null,
      durationSeconds: live.state
        ? (Date.now() - new Date(live.state.startedAt).getTime()) / 1000
        : 0,
      totalVolume: live.totalVolume,
      workingSets: live.state?.sets.filter((s) => !s.is_warmup).length ?? 0,
      exercises: live.exercises,
      rpe,
    };
    const ok = await live.requestFinish({
      rpe_session: rpe ?? undefined,
      notes: notes || undefined,
    });
    if (ok) {
      setShowFinish(false);
      setFinishedSummary(snapshot);
      // Session saved — refresh the reference data so "Last session" weights
      // are correct next time instead of showing a stale older session.
      await queryClient.invalidateQueries({ queryKey: ['lifting-sessions'] });
      await queryClient.invalidateQueries({ queryKey: ['personal-records'] });
      // If this session was resumed, the orphan box cache now points at a
      // finished session — clear it so it doesn't reappear on the pre-start.
      await queryClient.invalidateQueries({ queryKey: ['lifting-active-session'] });
    } else {
      setFinishError('Sync failed — will retry automatically when back online.');
    }
  };

  // ── Rendering ──

  if (!live.hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted">Loading…</p>
      </div>
    );
  }

  // Interrupted finish — complete it in the background
  if (live.state?.phase === 'finishing') {
    const handleDiscard = async () => {
      await live.discardSession();
      await queryClient.invalidateQueries({ queryKey: ['lifting-active-session'] });
    };
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div className="space-y-3">
          <p className="text-white font-semibold">Finishing session…</p>
          <p className="text-muted text-sm">
            Waiting for the network to save your session.
            {live.syncError && ' You can leave this page — it will resume automatically.'}
          </p>
          <button
            onClick={live.retrySync}
            className="px-4 py-2 rounded-lg bg-accent text-background font-semibold"
          >
            Retry now
          </button>
          <p>
            <Link href="/lifting" className="text-accent text-sm underline">
              Back to Lifting
            </Link>
          </p>
          <p className="text-xs text-muted pt-2">Session not saving?</p>
          <button
            onClick={handleDiscard}
            className="px-4 py-2 rounded-lg bg-warning/15 text-warning font-semibold text-sm w-full"
          >
            Discard session (don&apos;t save)
          </button>
        </div>
      </div>
    );
  }

  if (live.state) {
    return (
      <>
        <LiveWorkout
          live={live}
          prs={prs}
          referenceMap={referenceMap}
          onRequestFinish={() => setShowFinish(true)}
        />
        {showFinish && (
          <FinishSheet
            durationSeconds={
              (Date.now() - new Date(live.state.startedAt).getTime()) / 1000
            }
            totalVolume={live.totalVolume}
            workingSets={live.state.sets.filter((s) => !s.is_warmup).length}
            exercises={live.exercises}
            error={finishError}
            onCancel={() => setShowFinish(false)}
            onFinish={handleFinish}
          />
        )}
      </>
    );
  }

  // ── Post-finish summary ──
  if (finishedSummary) {
    const mins = Math.round(finishedSummary.durationSeconds / 60);
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-5 text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-positive/15 text-positive flex items-center justify-center text-3xl">
            ✓
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-2">Session saved</h1>
            <p className="text-muted text-sm">
              {mins > 0 && <>{mins} min · </>}
              {finishedSummary.workingSets} working
              set{finishedSummary.workingSets === 1 ? '' : 's'} ·{' '}
              {Math.round(finishedSummary.totalVolume)} kg total
              {finishedSummary.rpe != null && (
                <> · RPE {finishedSummary.rpe}</>
              )}
            </p>
          </div>
          {finishedSummary.exercises.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1.5">
              {finishedSummary.exercises.map((name) => (
                <span
                  key={name}
                  className="px-3 py-1 rounded-full bg-surface-light text-muted text-xs capitalize"
                >
                  {name.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          )}
          <p className="text-xs text-muted">
            Whoop matching runs shortly after — recovery/HRV updates usually land
            within ~30 minutes.
          </p>
          <div className="space-y-2 pt-2">
            {finishedSummary.sessionId && (
              <Link
                href={`/lifting?session=${finishedSummary.sessionId}`}
                className="block w-full px-4 py-3 rounded-lg bg-accent text-background font-semibold text-center"
              >
                View session log
              </Link>
            )}
            <button
              onClick={() => setFinishedSummary(null)}
              className="w-full px-4 py-3 rounded-lg bg-surface-light text-white font-semibold"
            >
              Start another session
            </button>
            <Link
              href="/lifting"
              className="block w-full text-sm text-muted transition-colors hover:text-white pt-1"
            >
              Back to Lifting
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Pre-start ──
  return (
    <div className="max-w-md mx-auto px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <Link
        href="/lifting"
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-white transition-colors mb-3"
      >
        ← Back to Lifting
      </Link>
      <h1 className="text-2xl font-bold text-white mb-1">Live Lift</h1>
      <p className="text-muted text-sm mb-6">
        Track your session as it happens. Sets sync automatically — no signal needed.
      </p>

      {/* Resume check happens server-side too; local state is authoritative */}
      <section className="space-y-5 mb-8">
        <div>
          <label className="block text-xs uppercase tracking-wider text-muted mb-2">
            Focus (optional)
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => { setFocus(null); setPlanPreset(null); }}
              className={`px-4 py-2.5 rounded-full text-sm transition-colors ${
                focus === null && !planPreset ? 'bg-accent text-background font-semibold' : 'bg-surface-light text-muted'
              }`}
            >
              Skip
            </button>
            {FOCUS_OPTIONS.map((f) => (
              <button
                key={f}
                onClick={() => { setFocus(f); setPlanPreset(null); }}
                className={`px-4 py-2.5 rounded-full text-sm capitalize transition-colors ${
                  focus === f && !planPreset ? 'bg-accent text-background font-semibold' : 'bg-surface-light text-muted'
                }`}
              >
                {f.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {planDayForToday && (
          <div>
            <button
              type="button"
              onClick={planPreset ? () => { setPlanPreset(null); setFocus(null); } : handleLoadPlan}
              className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                planPreset
                  ? 'bg-accent/15 border-accent/40 text-white'
                  : 'bg-surface-light/50 border-surface-light/50 text-muted hover:border-accent/40 hover:text-white'
              }`}
            >
              <span className="font-semibold text-sm block">
                {planPreset ? '✓ Loaded from today\'s plan' : 'Load from today\'s plan'}
              </span>
              <span className="text-xs block mt-0.5 opacity-80">
                {planDayForToday.planName} ·{' '}
                {planDayForToday.planDay.planned_focus ??
                  'strength'} ·{' '}
                {planDayForToday.planDay.planned_exercises
                  ?.map((e) => e.exercise.replace(/_/g, ' '))
                  .join(', ')}
              </span>
            </button>
          </div>
        )}

        <div>
          <label
            htmlFor="live-program"
            className="block text-xs uppercase tracking-wider text-muted mb-2"
          >
            Program (optional)
          </label>
          <input
            id="live-program"
            type="text"
            value={programName}
            onChange={(e) => setProgramName(e.target.value)}
            placeholder="e.g. 5/3/1 — Week 3"
            className="w-full bg-surface-light border border-surface-light/50 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {(templates?.length ?? 0) > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wider text-muted mb-2">
              Warm-up template (optional)
            </p>
            <div className="flex flex-wrap gap-2">
              {(templates ?? []).map((t) => (
                <button
                  key={t.id}
                  onClick={() =>
                    setSelectedTemplate(selectedTemplate?.id === t.id ? null : t)
                  }
                  className={`px-4 py-2.5 rounded-full text-sm transition-colors ${
                    selectedTemplate?.id === t.id
                      ? 'bg-accent text-background font-semibold'
                      : 'bg-surface-light text-muted'
                  }`}
                >
                  {t.name}
                  <span className="ml-1.5 opacity-60">({t.steps.length})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {recentNames.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wider text-muted mb-2">Recent exercises</p>
            <div className="flex flex-wrap gap-2">
              {recentNames.map((name) => (
                <span
                  key={name}
                  className="px-3 py-1.5 rounded-full bg-surface-light/60 text-xs text-muted"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

{remoteActive && (
          <div className="mb-4 p-3 rounded-lg border text-sm bg-warning/10 border-warning/30 text-warning">
            <p className="font-semibold">Unfinished session found</p>
            <p className="text-xs mt-1">
              {remoteActive.sets.length > 0
                ? `A session from ${remoteActive.session_date} with ${remoteActive.sets.length} set${remoteActive.sets.length === 1 ? '' : 's'} was never finished. Pick it back up or close it.`
                : `A session from ${remoteActive.session_date} was started but never finished. Resume it or close it.`}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => live.resumeSession(remoteActive)}
                className="px-4 py-2 rounded-lg bg-accent text-background font-semibold text-xs"
              >
                Resume session
              </button>
              <button
                onClick={handleCleanupRemoteActive}
                disabled={remoteCleanupState === 'cleaning'}
                className="px-3 py-1.5 rounded-lg bg-warning/20 text-warning font-semibold text-xs disabled:opacity-50"
              >
                {remoteCleanupState === 'cleaning' ? 'Closing…' : 'Close it'}
              </button>
            </div>
            {remoteCleanupState === 'error' && (
              <p className="text-xs mt-1 text-warning">Couldn&apos;t close it — try again.</p>
            )}
          </div>
        )}

        <button
          onClick={handleStart}
          className="w-full min-h-[64px] rounded-2xl bg-accent text-background text-xl font-bold active:scale-[0.98] transition-transform"
        >
        START SESSION
      </button>

      <p className="text-center text-xs text-muted mt-4">
        Your sets save on-device first and sync when possible — a dropped gym
        connection never loses data.
      </p>
    </div>
  );

}

// ─── Finish sheet ────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function FinishSheet({
  durationSeconds,
  totalVolume,
  workingSets,
  exercises,
  error,
  onCancel,
  onFinish,
}: {
  durationSeconds: number;
  totalVolume: number;
  workingSets: number;
  exercises: string[];
  error: string | null;
  onCancel: () => void;
  onFinish: (rpe: number | null, notes: string) => Promise<void>;
}) {
  const [rpe, setRpe] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleFinish = async () => {
    setSaving(true);
    await onFinish(rpe, notes.trim());
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/60" role="dialog" aria-label="Finish session">
      <div className="bg-surface rounded-t-2xl border-t border-surface-light/50 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-4">
        <h2 className="text-lg font-bold text-white">Session summary</h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center">
          <div className="bg-surface-light/50 rounded-xl py-3">
            <p className="text-xl font-bold text-white">{formatDuration(durationSeconds)}</p>
            <p className="text-xs text-muted">Duration</p>
          </div>
          <div className="bg-surface-light/50 rounded-xl py-3">
            <p className="text-xl font-bold text-white">{Math.round(totalVolume)}kg</p>
            <p className="text-xs text-muted">Volume</p>
          </div>
          <div className="bg-surface-light/50 rounded-xl py-3">
            <p className="text-xl font-bold text-white">{workingSets}</p>
            <p className="text-xs text-muted">Working sets</p>
          </div>
        </div>

        {exercises.length > 0 && (
          <p className="text-sm text-muted">{exercises.join(' · ')}</p>
        )}

        <div>
          <label className="block text-xs uppercase tracking-wider text-muted mb-2">
            Session RPE (optional)
          </label>
          <input
            type="range"
            min={5}
            max={10}
            step={0.5}
            value={rpe ?? 7}
            onChange={(e) => setRpe(parseFloat(e.target.value))}
            className="w-full accent-[color:var(--accent)]"
          />
          <p className="text-sm text-white text-center font-semibold">
            {rpe !== null ? `RPE ${rpe}` : 'Not set'}
          </p>
        </div>

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          rows={2}
          className="w-full bg-surface-light border border-surface-light/50 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />

        {error && (
          <p className="text-warning text-sm">{error}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 min-h-[52px] rounded-xl bg-surface-light text-muted font-semibold"
          >
            Keep training
          </button>
          <button
            onClick={handleFinish}
            disabled={saving}
            className="flex-1 min-h-[52px] rounded-xl bg-accent text-background font-bold disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Finish'}
          </button>
        </div>

        <p className="text-xs text-muted text-center">
          Whoop strain/HR will attach to this session after your next sync (~30 min).
        </p>
      </div>
    </div>
  );
}
