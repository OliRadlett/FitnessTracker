'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  getLiftingSessions,
  getPersonalRecords,
  getWarmupTemplates,
} from '@/lib/api';
import type { WarmupTemplate } from '@/lib/api/types';
import { LiveWorkout } from '@/components/lifting/LiveWorkout';
import {
  buildLastSessionMap,
  recentExerciseNames,
  type ExerciseReference,
} from '@/lib/lifting/reference';
import { useLiveSession } from '@/lib/lifting/useLiveSession';

const FOCUS_OPTIONS = ['squat', 'bench', 'deadlift', 'overhead_press', 'accessories'];

export default function LiveLiftPage() {
  const live = useLiveSession();

  // Reference data for prefill / last-session lines
  const { data: sessions } = useQuery({
    queryKey: ['lifting-sessions'],
    queryFn: getLiftingSessions,
    staleTime: 60_000,
  });
  const { data: prs } = useQuery({
    queryKey: ['prs'],
    queryFn: getPersonalRecords,
    staleTime: 60_000,
  });
  const { data: templates } = useQuery({
    queryKey: ['warmup-templates'],
    queryFn: () => getWarmupTemplates(),
    staleTime: 300_000,
  });

  const referenceMap = useMemo<Record<string, ExerciseReference>>(
    () => buildLastSessionMap(sessions ?? []),
    [sessions]
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
    live.startSession({ programName: programName, focus: focus ?? undefined });
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
    const ok = await live.requestFinish({
      rpe_session: rpe ?? undefined,
      notes: notes || undefined,
    });
    if (ok) {
      setShowFinish(false);
      // Session saved — the lifting page will show it after refresh
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

  // ── Pre-start ──
  return (
    <div className="max-w-md mx-auto px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
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
              onClick={() => setFocus(null)}
              className={`px-4 py-2.5 rounded-full text-sm transition-colors ${
                focus === null ? 'bg-accent text-background font-semibold' : 'bg-surface-light text-muted'
              }`}
            >
              Skip
            </button>
            {FOCUS_OPTIONS.map((f) => (
              <button
                key={f}
                onClick={() => setFocus(f)}
                className={`px-4 py-2.5 rounded-full text-sm capitalize transition-colors ${
                  focus === f ? 'bg-accent text-background font-semibold' : 'bg-surface-light text-muted'
                }`}
              >
                {f.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

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

        <div className="grid grid-cols-3 gap-2 text-center">
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
