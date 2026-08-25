'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import { searchExercises, createExercise, deleteExercise } from '@/lib/api/exercises';
import type { ExerciseEntry } from '@/lib/api/exercises';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';

const CATEGORIES = [
  { value: 'big3', label: 'Big 3' },
  { value: 'compound', label: 'Compound' },
  { value: 'accessory', label: 'Accessory' },
];

const CATEGORY_COLORS: Record<string, string> = {
  big3: 'bg-red-500/20 text-red-300 border-red-500/30',
  compound: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  accessory: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
};

export function ExerciseManager() {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('accessory');
  const [newAliases, setNewAliases] = useState('');

  const { data: exercises, isLoading } = useQuery<ExerciseEntry[]>({
    queryKey: ['exercises-list', search],
    queryFn: () => searchExercises(authFetch, search, 200),
    staleTime: 30_000,
  });

  const createMut = useMutation({
    mutationFn: (data: { name: string; category: string; aliases?: string[] }) =>
      createExercise(authFetch, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exercises-list'] });
      setNewName('');
      setNewAliases('');
      setShowAdd(false);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (exerciseId: string) => deleteExercise(authFetch, exerciseId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exercises-list'] }),
  });

  const handleAdd = () => {
    if (!newName.trim()) return;
    const aliases = newAliases
      .split(',')
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean);
    createMut.mutate({ name: newName.trim(), category: newCategory, aliases });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>🏋️ Exercise Library</CardTitle>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="text-xs text-accent hover:text-accent/80"
          >
            {showAdd ? 'Cancel' : '+ Add Exercise'}
          </button>
        </div>
      </CardHeader>
      <div className="px-6 pb-6 space-y-4">
        <p className="text-xs text-muted">
          Manage the exercise list used by autocomplete, PRs, and training plans.
          Global exercises are shown alongside your custom ones.
        </p>

        {/* Search */}
        <input
          type="text"
          placeholder="Search exercises..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 bg-background border border-surface-light rounded-lg text-white text-sm focus:outline-none focus:border-accent"
        />

        {/* Add form */}
        {showAdd && (
          <div className="p-3 bg-surface-light/30 rounded-lg border border-surface-light/50 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Exercise name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="px-2 py-1.5 bg-background border border-surface-light rounded text-white text-sm focus:outline-none focus:border-accent"
              />
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="px-2 py-1.5 bg-background border border-surface-light rounded text-white text-sm focus:outline-none focus:border-accent"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <input
              type="text"
              placeholder="Aliases (comma-separated, e.g. back ext, hyperextension)"
              value={newAliases}
              onChange={(e) => setNewAliases(e.target.value)}
              className="w-full px-2 py-1.5 bg-background border border-surface-light rounded text-white text-sm focus:outline-none focus:border-accent"
            />
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                disabled={!newName.trim() || createMut.isPending}
                className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium hover:bg-accent/80 disabled:opacity-50"
              >
                {createMut.isPending ? 'Adding...' : 'Add'}
              </button>
              {createMut.isError && (
                <span className="text-xs text-red-400 self-center">
                  {(createMut.error as Error).message || 'Already exists'}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Exercise list */}
        {isLoading ? (
          <p className="text-sm text-muted">Loading...</p>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {(exercises ?? []).map((ex) => (
              <div
                key={ex.id}
                className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-surface-light/30 group"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm text-white truncate">{ex.name}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                      CATEGORY_COLORS[ex.category] ?? CATEGORY_COLORS.accessory
                    }`}
                  >
                    {ex.category}
                  </span>
                </div>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${ex.name}"?`)) deleteMut.mutate(ex.id);
                  }}
                  className="text-xs text-red-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-300"
                >
                  Delete
                </button>
              </div>
            ))}
            {exercises && exercises.length === 0 && (
              <p className="text-sm text-muted text-center py-4">No exercises found</p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
