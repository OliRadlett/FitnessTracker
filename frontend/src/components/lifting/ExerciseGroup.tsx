'use client';

import React, { useState } from 'react';
import type { LiftingSet } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';

export function ExerciseGroup({
  exerciseName,
  sets,
  onUpdateSet,
  onDeleteSet,
  isUpdating,
  isDeleting,
}: {
  exerciseName: string;
  sets: LiftingSet[];
  onUpdateSet: (setId: string, data: { weight_kg?: number; reps?: number; rpe?: number | null; is_warmup?: boolean; is_amrap?: boolean }) => void;
  onDeleteSet: (setId: string) => void;
  isUpdating: boolean;
  isDeleting: boolean;
}) {
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ weight_kg: number; reps: number; rpe: string; is_warmup: boolean; is_amrap: boolean }>({
    weight_kg: 0, reps: 0, rpe: '', is_warmup: false, is_amrap: false,
  });

  const workingSets = sets.filter((s) => !s.is_warmup);
  const warmupSets = sets.filter((s) => s.is_warmup);
  const totalVolume = workingSets.reduce((acc, s) => acc + s.weight_kg * s.reps, 0);

  function startEdit(set: LiftingSet) {
    setEditingSetId(set.id);
    setEditValues({
      weight_kg: set.weight_kg,
      reps: set.reps,
      rpe: set.rpe?.toString() ?? '',
      is_warmup: set.is_warmup,
      is_amrap: set.is_amrap,
    });
  }

  function cancelEdit() {
    setEditingSetId(null);
  }

  function saveEdit(setId: string) {
    const rpeVal = editValues.rpe === '' ? null : parseFloat(editValues.rpe);
    onUpdateSet(setId, {
      weight_kg: editValues.weight_kg,
      reps: editValues.reps,
      rpe: rpeVal,
      is_warmup: editValues.is_warmup,
      is_amrap: editValues.is_amrap,
    });
    setEditingSetId(null);
  }

  return (
    <div className="border border-surface-light/30 rounded-lg overflow-hidden">
      {/* Exercise header */}
      <div className="flex items-center justify-between px-4 py-3 bg-surface-light/20">
        <div>
          <p className="text-sm font-semibold text-white">{exerciseName}</p>
          <p className="text-xs text-muted">
            {workingSets.length} working set{workingSets.length !== 1 ? 's' : ''}
            {warmupSets.length > 0 && ` · ${warmupSets.length} warmup`}
          </p>
        </div>
        {totalVolume > 0 && (
          <p className="text-xs text-purple-400">{totalVolume.toLocaleString()} kg vol</p>
        )}
      </div>

      {/* Sets table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-light/20">
              <th className="text-left py-2 px-3 text-muted font-medium text-xs">Set</th>
              <th className="text-right py-2 px-3 text-muted font-medium text-xs">Weight</th>
              <th className="text-right py-2 px-3 text-muted font-medium text-xs">Reps</th>
              <th className="text-right py-2 px-3 text-muted font-medium text-xs">RPE</th>
              <th className="text-center py-2 px-3 text-muted font-medium text-xs">Flags</th>
              <th className="text-center py-2 px-3 text-muted font-medium text-xs">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sets.map((set) => {
              const isEditing = editingSetId === set.id;
              return (
                <tr key={set.id} className={`border-b border-surface-light/10 ${set.is_warmup && !isEditing ? 'opacity-60' : ''}`}>
                  <td className="py-2 px-3 text-muted">{set.set_number}</td>
                  {isEditing ? (
                    <>
                      <td className="py-1 px-2 text-right">
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          value={editValues.weight_kg || ''}
                          onChange={(e) => setEditValues({ ...editValues, weight_kg: parseFloat(e.target.value) || 0 })}
                          className="w-20 bg-surface-light border border-surface-light text-white text-sm rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-accent"
                          autoFocus
                        />
                      </td>
                      <td className="py-1 px-2 text-right">
                        <input
                          type="number"
                          min="0"
                          value={editValues.reps || ''}
                          onChange={(e) => setEditValues({ ...editValues, reps: parseInt(e.target.value) || 0 })}
                          className="w-16 bg-surface-light border border-surface-light text-white text-sm rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-accent"
                        />
                      </td>
                      <td className="py-1 px-2 text-right">
                        <input
                          type="number"
                          step="0.5"
                          min="1"
                          max="10"
                          value={editValues.rpe}
                          onChange={(e) => setEditValues({ ...editValues, rpe: e.target.value })}
                          placeholder="—"
                          className="w-16 bg-surface-light border border-surface-light text-white text-sm rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-accent"
                        />
                      </td>
                      <td className="py-1 px-2 text-center">
                        <div className="flex justify-center gap-2">
                          <label className="flex items-center gap-1 text-xs text-muted cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editValues.is_warmup}
                              onChange={(e) => setEditValues({ ...editValues, is_warmup: e.target.checked })}
                              className="rounded border-surface-light"
                            />
                            W
                          </label>
                          <label className="flex items-center gap-1 text-xs text-muted cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editValues.is_amrap}
                              onChange={(e) => setEditValues({ ...editValues, is_amrap: e.target.checked })}
                              className="rounded border-surface-light"
                            />
                            AMRAP
                          </label>
                        </div>
                      </td>
                      <td className="py-1 px-2 text-center">
                        <div className="flex justify-center gap-1">
                          <button
                            onClick={() => saveEdit(set.id)}
                            disabled={isUpdating}
                            className="text-positive hover:text-positive text-xs font-medium px-2 py-0.5 rounded bg-positive/10 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="text-muted hover:text-white text-xs px-2 py-0.5"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-2 px-3 text-right text-blue-400">{set.weight_kg} kg</td>
                      <td className="py-2 px-3 text-right text-positive">{set.reps}</td>
                      <td className="py-2 px-3 text-right text-yellow-400">{set.rpe ?? '—'}</td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex justify-center gap-1">
                          {set.is_warmup && <Badge variant="muted">W</Badge>}
                          {set.is_amrap && <Badge variant="warning">AMRAP</Badge>}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-center">
                        {confirmDeleteId === set.id ? (
                          <div className="flex justify-center gap-1">
                            <button
                              onClick={() => { onDeleteSet(set.id); setConfirmDeleteId(null); }}
                              disabled={isDeleting}
                              className="text-xs text-white bg-warning/80 hover:bg-warning px-2 py-0.5 rounded disabled:opacity-50"
                            >
                              Delete
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-xs text-muted hover:text-white px-2 py-0.5"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex justify-center gap-2">
                            <button
                              onClick={() => startEdit(set)}
                              className="text-muted hover:text-accent text-xs transition-colors"
                              title="Edit set"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(set.id)}
                              className="text-muted hover:text-warning text-xs transition-colors"
                              title="Delete set"
                            >
                              🗑️
                            </button>
                          </div>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
