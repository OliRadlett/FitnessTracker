'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { LiftingSet, AddSetPayload, WarmupTemplate } from '@/lib/api';
import { ExerciseAutocomplete } from '@/components/ui/ExerciseAutocomplete';

interface SetRow {
  weight_kg: number;
  reps: number;
  rpe?: number;
  is_warmup: boolean;
  is_amrap: boolean;
  notes: string;
}

export function AddExerciseForm({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();

  const [exerciseName, setExerciseName] = useState('');
  const [sets, setSets] = useState<SetRow[]>([
    { weight_kg: 0, reps: 0, rpe: undefined, is_warmup: false, is_amrap: false, notes: '' },
  ]);
  const [error, setError] = useState('');
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  // Fetch all warmup templates
  const { data: warmupTemplates } = useQuery<WarmupTemplate[]>({
    queryKey: ['warmup-templates'],
    queryFn: () => authFetch<WarmupTemplate[]>('/api/v1/lifting/warmup-templates'),
  });

  // Filter templates that match the current exercise name or are generic (no exercise_name)
  const matchingTemplates = useMemo(() => {
    if (!warmupTemplates) return [];
    const name = exerciseName.trim().toLowerCase();
    if (!name) return warmupTemplates; // show all if no name typed yet
    return warmupTemplates.filter(
      (t) => !t.exercise_name || t.exercise_name.toLowerCase().includes(name)
    );
  }, [warmupTemplates, exerciseName]);

  function applyWarmupTemplate(template: WarmupTemplate) {
    const warmupSets: SetRow[] = template.steps.map((step) => ({
      weight_kg: step.weight_kg,
      reps: step.reps,
      rpe: undefined,
      is_warmup: true,
      is_amrap: false,
      notes: step.notes || '',
    }));
    // Prepend warmup sets before existing working sets
    setSets((prev) => [...warmupSets, ...prev]);
    setShowTemplatePicker(false);
  }

  function updateSet(index: number, updates: Partial<SetRow>) {
    setSets((prev) => prev.map((s, i) => (i === index ? { ...s, ...updates } : s)));
  }

  function addSetRow() {
    setSets((prev) => [...prev, { weight_kg: 0, reps: 0, rpe: undefined, is_warmup: false, is_amrap: false, notes: '' }]);
  }

  function copyLastSet() {
    setSets((prev) => {
      const last = prev[prev.length - 1];
      return [...prev, { ...last }];
    });
  }

  function removeSetRow(index: number) {
    if (sets.length <= 1) return;
    setSets((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!exerciseName.trim()) {
      setError('Exercise name is required');
      return;
    }
    if (sets.length === 0) {
      setError('Add at least one set');
      return;
    }

    setError('');
    try {
      // Submit all sets sequentially
      for (let i = 0; i < sets.length; i++) {
        const s = sets[i];
        const payload: AddSetPayload = {
          exercise_name: exerciseName.trim(),
          set_number: i + 1,
          weight_kg: s.weight_kg,
          reps: s.reps,
          rpe: s.rpe,
          is_warmup: s.is_warmup,
          is_amrap: s.is_amrap,
          notes: s.notes || undefined,
        };
        await authFetch<LiftingSet>(`/api/v1/lifting/sessions/${sessionId}/sets`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      queryClient.invalidateQueries({ queryKey: ['lifting-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['lifting-session', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['personal-records'] });
      queryClient.invalidateQueries({ queryKey: ['lifting-volume'] });
      onDone();
    } catch {
      setError('Failed to save sets. Some may have been saved.');
      queryClient.invalidateQueries({ queryKey: ['lifting-session', sessionId] });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 bg-surface-light/30 rounded-lg space-y-4">
      <div>
        <label className="block text-xs text-muted mb-1">Exercise *</label>
        <ExerciseAutocomplete
          value={exerciseName}
          onChange={setExerciseName}
          placeholder="e.g. Bench Press"
          required
          autoFocus
        />
      </div>

      {/* Warmup Template Picker */}
      {matchingTemplates.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowTemplatePicker(!showTemplatePicker)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent text-sm font-medium rounded-lg transition-colors border border-accent/30"
          >
            🔥 Apply Warmup
          </button>
          {showTemplatePicker && (
            <div className="absolute z-10 mt-1 w-72 bg-surface border border-surface-light rounded-lg shadow-lg max-h-60 overflow-y-auto">
              {matchingTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => applyWarmupTemplate(template)}
                  className="w-full text-left p-3 hover:bg-surface-light/40 transition-colors border-b border-surface-light/20 last:border-b-0"
                >
                  <p className="text-sm font-medium text-white">{template.name}</p>
                  {template.exercise_name && (
                    <p className="text-xs text-accent">{template.exercise_name}</p>
                  )}
                  <div className="flex flex-wrap gap-1 mt-1">
                    {template.steps.map((step) => (
                      <span key={step.id} className="text-[10px] bg-surface-light px-1.5 py-0.5 rounded text-muted">
                        {step.weight_kg}kg × {step.reps}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Set rows */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 sm:grid-cols-12 gap-2 text-xs text-muted font-medium px-1">
          <div className="col-span-2 sm:col-span-1">Set</div>
          <div className="sm:col-span-3">Weight (kg)</div>
          <div className="sm:col-span-2">Reps</div>
          <div className="sm:col-span-2">RPE</div>
          <div className="sm:col-span-3">Flags</div>
          <div className="col-span-2 sm:col-span-1"></div>
        </div>

        {sets.map((set, index) => (
          <div key={index} className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-center">
            <div className="col-span-2 sm:col-span-1 text-sm text-muted text-center">{index + 1}</div>
            <div className="sm:col-span-3">
              <input
                type="number"
                step="0.5"
                min="0"
                value={set.weight_kg || ''}
                onChange={(e) => updateSet(index, { weight_kg: parseFloat(e.target.value) || 0 })}
                placeholder="0"
                className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div className="sm:col-span-2">
              <input
                type="number"
                min="0"
                value={set.reps || ''}
                onChange={(e) => updateSet(index, { reps: parseInt(e.target.value) || 0 })}
                placeholder="0"
                className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div className="sm:col-span-2">
              <input
                type="number"
                step="0.5"
                min="1"
                max="10"
                value={set.rpe ?? ''}
                onChange={(e) => updateSet(index, { rpe: e.target.value ? parseFloat(e.target.value) : undefined })}
                placeholder="—"
                className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div className="sm:col-span-3 flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={set.is_warmup}
                  onChange={(e) => updateSet(index, { is_warmup: e.target.checked })}
                  className="rounded border-surface-light"
                />
                W
              </label>
              <label className="flex items-center gap-1 text-xs text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={set.is_amrap}
                  onChange={(e) => updateSet(index, { is_amrap: e.target.checked })}
                  className="rounded border-surface-light"
                />
                AMRAP
              </label>
            </div>
            <div className="col-span-2 sm:col-span-1 flex justify-center">
              {sets.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSetRow(index)}
                  className="text-muted hover:text-warning text-sm"
                  title="Remove set"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={addSetRow}
          className="px-3 py-1.5 bg-surface-light hover:bg-surface text-muted hover:text-white text-sm font-medium rounded-lg transition-colors border border-surface-light"
        >
          + Add Set
        </button>
        <button
          type="button"
          onClick={copyLastSet}
          disabled={sets.length === 0}
          className="px-3 py-1.5 bg-surface-light hover:bg-surface text-muted hover:text-white text-sm font-medium rounded-lg transition-colors border border-surface-light disabled:opacity-50"
        >
          📋 Copy Last Set
        </button>
        <button
          type="submit"
          className="px-4 py-1.5 bg-positive hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Save Exercise
        </button>
        <button
          type="button"
          onClick={onDone}
          className="px-3 py-1.5 text-muted hover:text-white text-sm transition-colors"
        >
          Cancel
        </button>
      </div>

      {error && <p className="text-warning text-sm">{error}</p>}
    </form>
  );
}
