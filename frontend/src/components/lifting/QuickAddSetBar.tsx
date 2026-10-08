'use client';

import React, { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { AddSetPayload, LiftingSession, LiftingSet } from '@/lib/api';
import { ExerciseAutocomplete } from '@/components/ui/ExerciseAutocomplete';
import { Plus } from 'lucide-react';

function lastSetForExercise(sets: LiftingSet[], exerciseName: string): LiftingSet | undefined {
  const matches = sets.filter(
    (s) => s.exercise_name.toLowerCase() === exerciseName.trim().toLowerCase(),
  );
  if (matches.length === 0) return undefined;
  return matches.reduce((a, b) => (b.set_number > a.set_number ? b : a));
}

export function QuickAddSetBar({ session }: { session: LiftingSession }) {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const sets = session.sets ?? [];

  // Default to the session's last-touched exercise so repeat logging is one tap.
  const defaultExercise = useMemo(() => {
    if (sets.length === 0) return '';
    const ordered = [...sets].sort((a, b) => b.set_number - a.set_number);
    return ordered[0].exercise_name;
  }, [sets]);

  const [exerciseName, setExerciseName] = useState(defaultExercise);
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [rpe, setRpe] = useState('');
  const [isWarmup, setIsWarmup] = useState(false);
  const [error, setError] = useState('');
  const [justAdded, setJustAdded] = useState(false);

  // Prefill weight/reps when the exercise changes to one already logged.
  function handleExerciseChange(name: string) {
    setExerciseName(name);
    const last = lastSetForExercise(sets, name);
    if (last) {
      setWeight(String(last.weight_kg));
      setReps(String(last.reps));
    }
  }

  const mutation = useMutation({
    mutationFn: (payload: AddSetPayload) =>
      authFetch<LiftingSet>(`/api/v1/lifting/sessions/${session.id}/sets`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lifting-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['lifting-session', session.id] });
      queryClient.invalidateQueries({ queryKey: ['personal-records'] });
      queryClient.invalidateQueries({ queryKey: ['lifting-analysis', session.id] });
      setError('');
      setJustAdded(true);
      setTimeout(() => setJustAdded(false), 2000);
    },
    onError: (err: Error) => setError(err.message || 'Failed to add set'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = exerciseName.trim();
    const weightKg = parseFloat(weight);
    const repsNum = parseInt(reps, 10);
    if (!name) {
      setError('Exercise name is required');
      return;
    }
    if (!Number.isFinite(weightKg) || weightKg < 0) {
      setError('Enter a valid weight');
      return;
    }
    if (!Number.isInteger(repsNum) || repsNum < 1) {
      setError('Enter a valid rep count');
      return;
    }
    const rpeNum = rpe === '' ? undefined : parseFloat(rpe);
    if (rpeNum !== undefined && (!Number.isFinite(rpeNum) || rpeNum < 1 || rpeNum > 10)) {
      setError('RPE must be between 1 and 10');
      return;
    }
    setError('');
    const last = lastSetForExercise(sets, name);
    mutation.mutate({
      exercise_name: name,
      set_number: (last?.set_number ?? 0) + 1,
      weight_kg: weightKg,
      reps: repsNum,
      rpe: rpeNum,
      is_warmup: isWarmup,
    });
  }

  return (
    <div className="sticky bottom-4 z-10 rounded-xl border border-surface-light bg-surface/95 p-3 shadow-lg backdrop-blur">
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2" aria-label="Quick-add a set">
        <div className="min-w-[140px] flex-1">
          <label htmlFor="quick-add-exercise" className="block text-[11px] text-muted mb-1">Exercise</label>
          <ExerciseAutocomplete
            id="quick-add-exercise"
            value={exerciseName}
            onChange={handleExerciseChange}
            placeholder="e.g. Bench Press"
          />
        </div>
        <div className="w-20">
          <label htmlFor="quick-add-kg" className="block text-[11px] text-muted mb-1">kg</label>
          <input
            id="quick-add-kg"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.5"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="80"
            className="w-full bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div className="w-16">
          <label htmlFor="quick-add-reps" className="block text-[11px] text-muted mb-1">Reps</label>
          <input
            id="quick-add-reps"
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            placeholder="5"
            className="w-full bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div className="w-16">
          <label htmlFor="quick-add-rpe" className="block text-[11px] text-muted mb-1">RPE</label>
          <input
            id="quick-add-rpe"
            type="number"
            inputMode="decimal"
            min="1"
            max="10"
            step="0.5"
            value={rpe}
            onChange={(e) => setRpe(e.target.value)}
            placeholder="8"
            className="w-full bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted min-h-[44px] px-1 cursor-pointer">
          <input
            type="checkbox"
            checked={isWarmup}
            onChange={(e) => setIsWarmup(e.target.checked)}
            className="accent-purple-400"
          />
          Warm-up
        </label>
        <button
          type="submit"
          disabled={mutation.isPending || !token}
          className="min-h-[44px] px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
        >
          <Plus className="w-4 h-4" />
          {mutation.isPending ? 'Adding…' : justAdded ? 'Added ✓' : 'Add set'}
        </button>
      </form>
      {error && (
        <p className="text-warning text-xs mt-2" role="alert">
          {error}
        </p>
      )}
      {/* Consistent live-region feedback: screen readers announce success. */}
      <span className="sr-only" aria-live="polite">
        {justAdded ? 'Set added' : mutation.isPending ? 'Adding set…' : ''}
      </span>
    </div>
  );
}
