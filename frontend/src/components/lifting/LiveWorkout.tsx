'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ExerciseAutocomplete } from '@/components/ui/ExerciseAutocomplete';
import type { PersonalRecord } from '@/lib/api/types';
import { detectPr, type ExerciseReference } from '@/lib/lifting/reference';
import { useLiveSession } from '@/lib/lifting/useLiveSession';

// ─── Timers ──────────────────────────────────────────────────────────────────

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Re-renders every second; value derived from a timestamp so it survives backgrounding. */
function useTicker(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// ─── Stepper ─────────────────────────────────────────────────────────────────

interface StepperProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  min?: number;
}

function Stepper({ label, value, onChange, step, min = 0 }: StepperProps) {
  // Draft buffer holds raw keystrokes while editing so intermediate states
  // ("7", "72.", "0.") survive without being parsed away; commits happen on
  // every parseable prefix so LOG SET always uses what's on screen.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (raw: string) => {
    const parsed = parseFloat(raw.replace(',', '.'));
    if (!Number.isNaN(parsed)) onChange(Math.max(min, parsed));
    setDraft(null);
  };

  return (
    <div className="flex-1">
      <p className="text-xs uppercase tracking-wider text-muted mb-1.5 text-center">{label}</p>
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          onClick={() => {
            setDraft(null);
            onChange(Math.max(min, +(value - step).toFixed(2)));
          }}
          className="w-14 min-h-[56px] rounded-xl bg-surface-light text-white text-2xl font-semibold active:bg-surface-light/60 active:scale-95 transition-transform"
        >
          −
        </button>
        <input
          type="text"
          inputMode="decimal"
          value={draft ?? String(value)}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            const parsed = parseFloat(raw.replace(',', '.'));
            if (!Number.isNaN(parsed)) onChange(Math.max(min, parsed));
          }}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            }
          }}
          className="flex-1 min-h-[56px] w-full text-center bg-surface-light border border-surface-light/50 rounded-xl text-white text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="button"
          aria-label={`Increase ${label}`}
          onClick={() => {
            setDraft(null);
            onChange(+(value + step).toFixed(2));
          }}
          className="w-14 min-h-[56px] rounded-xl bg-surface-light text-white text-2xl font-semibold active:bg-surface-light/60 active:scale-95 transition-transform"
        >
          +
        </button>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

const STEP_SIZES = [1, 2.5, 5];
const STEP_SIZE_KEY = 'fittrack-live-step-size';

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}
type WakeLockNav = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
};

interface LiveWorkoutProps {
  live: ReturnType<typeof useLiveSession>;
  prs: PersonalRecord[] | undefined;
  referenceMap: Record<string, ExerciseReference>;
  onRequestFinish: () => void;
}

export function LiveWorkout({ live, prs, referenceMap, onRequestFinish }: LiveWorkoutProps) {
  const { state } = live;
  const now = useTicker();
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  // Entry inputs
  const [exercise, setExercise] = useState(state?.currentExercise ?? '');
  const [weight, setWeight] = useState(20);
  const [reps, setReps] = useState(5);
  const [rpe, setRpe] = useState<number | null>(null);
  const [showRpe, setShowRpe] = useState(false);
  const [isWarmup, setIsWarmup] = useState(false);
  const [stepSizeIdx, setStepSizeIdx] = useState(1); // default 2.5kg
  const [undoArmed, setUndoArmed] = useState(false);
  const [logLocked, setLogLocked] = useState(false);

  const stepSize = STEP_SIZES[stepSizeIdx];

  // Load persisted step size preference
  useEffect(() => {
    const stored = Number(window.localStorage.getItem(STEP_SIZE_KEY));
    if (STEP_SIZES.includes(stored)) setStepSizeIdx(STEP_SIZES.indexOf(stored));
  }, []);

  const cycleStepSize = () => {
    const next = (stepSizeIdx + 1) % STEP_SIZES.length;
    setStepSizeIdx(next);
    window.localStorage.setItem(STEP_SIZE_KEY, String(STEP_SIZES[next]));
  };

  // Keep screen on while the workout is active
  useEffect(() => {
    let cancelled = false;
    async function acquire() {
      try {
        const nav = navigator as WakeLockNav;
        if (nav.wakeLock && !wakeLockRef.current) {
          const lock = await nav.wakeLock.request('screen');
          if (cancelled) {
            void lock.release();
            return;
          }
          wakeLockRef.current = lock;
        }
      } catch {
        // Wake Lock unsupported/denied — non-critical
      }
    }
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
      else {
        wakeLockRef.current = null;
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      wakeLockRef.current = null;
    };
  }, []);

  // Smart prefill whenever the exercise changes: prefer this session's last
  // set for it, then last-session reference, then defaults
  const prefillFor = useMemo(() => {
    return (name: string) => {
      const sessionSets = live.setsForExercise(name).filter((s) => !s.is_warmup);
      if (sessionSets.length > 0) {
        const last = sessionSets[sessionSets.length - 1];
        setWeight(last.weight_kg);
        setReps(last.reps);
        return;
      }
      const ref = referenceMap[name];
      if (ref && ref.sets.length > 0) {
        // Most common working prescription from last time
        const top = [...ref.sets].sort(
          (a, b) => b.weight_kg * b.reps - a.weight_kg * a.reps
        )[0];
        setWeight(top.weight_kg);
        setReps(top.reps);
        return;
      }
    };
  }, [live, referenceMap]);

  const selectExercise = (name: string) => {
    setExercise(name);
    if (name.trim()) prefillFor(name.trim());
  };

  const currentSets = live.setsForExercise(exercise || null);
  const lastSetToday =
    currentSets.length > 0 ? currentSets[currentSets.length - 1] : null;

  const reference = exercise ? referenceMap[exercise.trim()] : undefined;

  const elapsedSeconds = state ? (now - new Date(state.startedAt).getTime()) / 1000 : 0;
  const sinceLastSetSeconds =
    state?.lastSetAt ? (now - new Date(state.lastSetAt).getTime()) / 1000 : null;

  const handleLogSet = () => {
    const name = exercise.trim();
    if (!name || logLocked) return;
    setLogLocked(true);
    setTimeout(() => setLogLocked(false), 600); // debounce double-taps
    const prText = isWarmup
      ? undefined
      : detectPr(name, weight, reps, prs, currentSets.filter((s) => !s.is_warmup)) ?? undefined;
    live.logSet(
      { exercise_name: name, weight_kg: weight, reps, rpe: rpe ?? undefined, is_warmup: isWarmup },
      prText
    );
    setUndoArmed(false);
    // Straight-set flow: everything stays as-is, just clear optional RPE
    setRpe(null);
  };

  const handleUndo = () => {
    if (!undoArmed) {
      setUndoArmed(true);
      setTimeout(() => setUndoArmed(false), 2500);
      return;
    }
    live.undoLastSet();
    setUndoArmed(false);
  };

  if (!state) return null;

  const canLog = exercise.trim().length > 0;

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* Header */}
      <header className="shrink-0 px-4 pt-4 pb-3 bg-surface border-b border-surface-light/50">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Link
              href="/lifting"
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-white transition-colors mb-1"
            >
              ← Lifting
            </Link>
            <p className="text-3xl font-bold text-white tabular-nums leading-none">
              {formatClock(elapsedSeconds)}
            </p>
            <p className="text-xs text-muted mt-1">
              {Math.round(live.totalVolume)}kg ·{' '}
              {state.sets.filter((s) => !s.is_warmup).length} working sets
              {state.focus ? ` · ${state.focus}` : ''}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {/* Count-up since last set — informational only */}
            {sinceLastSetSeconds !== null ? (
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium tabular-nums ${
                  sinceLastSetSeconds >= 120
                    ? 'bg-positive/15 text-positive'
                    : 'bg-surface-light text-muted'
                }`}
                title="Time since your last set"
              >
                ⏱ {formatClock(sinceLastSetSeconds)} since last
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full text-sm bg-surface-light text-muted">First set</span>
            )}
            {live.syncError ? (
              <button
                onClick={live.retrySync}
                className="px-3 py-1 rounded-full text-xs bg-warning/15 text-warning"
              >
                Offline — will retry ↻
              </button>
            ) : (
              <span className="px-3 py-1 rounded-full text-xs bg-positive/10 text-positive">
                ✓ Synced
              </span>
            )}
            <button
              type="button"
              onClick={onRequestFinish}
              className="px-4 py-1.5 rounded-full text-sm font-semibold bg-accent/20 text-accent border border-accent/30 active:bg-accent/30"
            >
              Finish
            </button>
          </div>
        </div>
      </header>

      {/* PR toasts */}
      {live.prEvents.length > 0 && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-30 space-y-2 w-max max-w-[90vw]">
          {live.prEvents.map((evt) => (
            <div
              key={evt.id}
              className="animate-bounce bg-positive text-background font-bold px-5 py-3 rounded-xl shadow-lg text-center"
            >
              🎉 {evt.exercise_name}: {evt.text}
            </div>
          ))}
        </div>
      )}

      {/* Body */}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Exercise selection */}
        <section className="space-y-2">
          <ExerciseAutocomplete
            value={exercise}
            onChange={selectExercise}
            placeholder="Exercise name…"
            className="w-full bg-surface-light border border-surface-light/50 text-white text-lg font-semibold rounded-xl px-4 py-3.5 focus:outline-none focus:ring-2 focus:ring-accent"
          />
          {(live.exercises.length > 0 || Object.keys(referenceMap).length > 0) && (
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {Array.from(new Set([...live.exercises, ...Object.keys(referenceMap)])).map(
                (name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => selectExercise(name)}
                    className={`shrink-0 px-3 py-2 rounded-full text-sm whitespace-nowrap transition-colors ${
                      exercise === name
                        ? 'bg-accent text-background font-semibold'
                        : 'bg-surface-light text-muted hover:text-white'
                    }`}
                  >
                    {name}
                  </button>
                )
              )}
            </div>
          )}
        </section>

        {/* Reference lines */}
        {canLog && (
          <section className="space-y-1 text-sm">
            {reference && (
              <p className="text-muted">
                Last session ({reference.date}):{' '}
                <span className="text-white">
                  {reference.sets.map((s) => `${s.weight_kg}×${s.reps}`).join(', ')}
                </span>
              </p>
            )}
            {lastSetToday && (
              <p className="text-muted">
                Today so far:{' '}
                <span className="text-accent">
                  {currentSets.map((s) => `${s.weight_kg}×${s.reps}`).join(', ')}
                </span>
              </p>
            )}
          </section>
        )}

        {/* Entry */}
        <section className="space-y-3">
          <Stepper
            label="Weight (kg)"
            value={weight}
            onChange={setWeight}
            step={stepSize}
            min={0}
          />
          <Stepper label="Reps" value={reps} onChange={(v) => setReps(Math.max(1, Math.round(v)))} step={1} min={1} />

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowRpe((v) => !v)}
              className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                showRpe ? 'bg-accent/20 text-accent' : 'bg-surface-light text-muted'
              }`}
            >
              RPE {rpe !== null ? `· ${rpe}` : ''}
            </button>
            <button
              type="button"
              onClick={() => setIsWarmup((v) => !v)}
              className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                isWarmup ? 'bg-warning/20 text-warning' : 'bg-surface-light text-muted'
              }`}
            >
              Warm-up set
            </button>
            <button
              type="button"
              onClick={cycleStepSize}
              className="px-3 py-2 rounded-lg text-sm bg-surface-light text-muted"
              title="Weight stepper increment"
            >
              ±{stepSize}kg
            </button>
          </div>

          {showRpe && (
            <div className="flex justify-between gap-1" role="group" aria-label="RPE">
              {[6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setRpe(rpe === val ? null : val)}
                  className={`flex-1 min-h-[44px] rounded-lg text-sm font-medium transition-colors ${
                    rpe === val ? 'bg-accent text-background' : 'bg-surface-light text-white'
                  }`}
                >
                  {val}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* This-exercise set log with undo */}
        {currentSets.length > 0 && (
          <section>
            <p className="text-xs uppercase tracking-wider text-muted mb-1.5">
              {exercise} · tap last set twice to undo
            </p>
            <div className="flex flex-wrap gap-2">
              {currentSets.map((s, idx) => {
                const isLast = idx === currentSets.length - 1;
                return (
                  <button
                    key={s.clientId}
                    type="button"
                    onClick={isLast ? handleUndo : undefined}
                    disabled={!isLast}
                    className={`px-3 py-1.5 rounded-lg text-sm tabular-nums ${
                      isLast
                        ? undoArmed
                          ? 'bg-warning/25 text-warning ring-1 ring-warning'
                          : 'bg-positive/10 text-positive'
                        : 'bg-surface-light/60 text-muted'
                    } ${s.is_warmup ? 'opacity-50 italic' : ''}`}
                    title={
                      isLast
                        ? undoArmed
                          ? 'Tap again to delete this set'
                          : 'Tap twice to undo'
                        : undefined
                    }
                  >
                    {s.is_warmup ? 'W· ' : ''}
                    {s.weight_kg}×{s.reps}
                    {s.rpe ? ` @${s.rpe}` : ''}
                    {!s.remoteId && ' ⟳'}
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </main>

      {/* Bottom action bar */}
      <footer className="shrink-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] bg-surface border-t border-surface-light/50">
        <button
          type="button"
          onClick={handleLogSet}
          disabled={!canLog || logLocked}
          className={`w-full min-h-[64px] rounded-2xl text-xl font-bold transition-all ${
            canLog
              ? 'bg-accent text-background active:scale-[0.98]'
              : 'bg-surface-light text-muted cursor-not-allowed'
          }`}
        >
          {isWarmup ? 'LOG WARM-UP SET' : 'LOG SET'}
        </button>
      </footer>
    </div>
  );
}
