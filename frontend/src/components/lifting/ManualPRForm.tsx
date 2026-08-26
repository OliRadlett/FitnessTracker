'use client';

import React, { useState } from 'react';
import type { CreatePRPayload } from '@/lib/api';
import { ExerciseAutocomplete } from '@/components/ui/ExerciseAutocomplete';

export function ManualPRForm({ onSubmit, onCancel, isPending }: { onSubmit: (data: CreatePRPayload) => void; onCancel: () => void; isPending: boolean }) {
  const [exerciseName, setExerciseName] = useState('');
  const [weight, setWeight] = useState(0);
  const [reps, setReps] = useState(1);
  const [achievedDate, setAchievedDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!exerciseName.trim() || weight <= 0 || reps <= 0) return;
    onSubmit({
      exercise_name: exerciseName.trim(),
      weight_kg: weight,
      reps,
      achieved_date: achievedDate,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 bg-surface-light/30 rounded-lg space-y-4 mb-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className="block text-xs text-muted mb-1">Exercise *</label>
          <ExerciseAutocomplete value={exerciseName} onChange={setExerciseName} placeholder="e.g. Bench Press" required />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Weight (kg) *</label>
          <input type="number" step="0.5" min="0" value={weight || ''} onChange={(e) => setWeight(parseFloat(e.target.value) || 0)} placeholder="0" className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" required />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Reps *</label>
          <input type="number" min="1" value={reps || ''} onChange={(e) => setReps(parseInt(e.target.value) || 1)} placeholder="1" className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" required />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Date *</label>
          <input type="date" value={achievedDate} onChange={(e) => setAchievedDate(e.target.value)} className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" required />
        </div>
      </div>
      <div>
        <label className="block text-xs text-muted mb-1">Notes</label>
        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Hit this at a commercial gym" className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={isPending} className="px-4 py-1.5 bg-positive hover:bg-positive/80 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
          {isPending ? 'Saving...' : 'Save PR'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-muted hover:text-white text-sm transition-colors">Cancel</button>
      </div>
    </form>
  );
}
