'use client';

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import {
  createWeightEntry,
  deleteWeightEntry,
  getWeightHistory,
  updateWeightEntry,
} from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { formatDateDMY } from '@/lib/utils';

const WEIGHT_QUERY_KEY = ['weight-history'] as const;

interface WeightPanelProps {
  /** Days of history to load. Defaults to 90 (matches the weight_trend chart). */
  days?: number;
  /** Compact mode — just the quick-add form (dashboard strip). */
  compact?: boolean;
}

export function WeightPanel({ days = 90, compact = false }: WeightPanelProps) {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();

  const [weightInput, setWeightInput] = useState('');
  const [dateInput, setDateInput] = useState(() => new Date().toISOString().slice(0, 10));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: history, isLoading } = useQuery({
    queryKey: WEIGHT_QUERY_KEY,
    queryFn: () => getWeightHistory(authFetch, days),
    enabled: !!token,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: WEIGHT_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: ['chart-weight-trend'] });
    queryClient.invalidateQueries({ queryKey: ['cycling-profile'] });
    queryClient.invalidateQueries({ queryKey: ['chart-wkg'] });
  };

  const addMutation = useMutation({
    mutationFn: (kg: number) =>
      createWeightEntry(authFetch, {
        date: dateInput || undefined,
        weight_kg: kg,
      }),
    onSuccess: () => {
      setWeightInput('');
      setError(null);
      invalidate();
    },
    onError: () => setError('Failed to log weight — check the value and try again.'),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, kg }: { id: string; kg: number }) =>
      updateWeightEntry(authFetch, id, kg),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
    onError: () => setError('Failed to update weight.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteWeightEntry(authFetch, id),
    onSuccess: invalidate,
    onError: () => setError('Failed to delete weight entry.'),
  });

  const submitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const kg = parseFloat(weightInput);
    if (!Number.isFinite(kg) || kg <= 0) {
      setError('Enter a valid weight in kg.');
      return;
    }
    addMutation.mutate(kg);
  };

  // Latest rolling average for a summary line.
  const rolling = history?.rolling_avg ?? [];
  const latestAvg = rolling.length ? rolling[rolling.length - 1] : null;
  const prevAvg = rolling.length > 1 ? rolling[rolling.length - 2] : null;
  const avgDelta = latestAvg && prevAvg ? latestAvg.weight_kg - prevAvg.weight_kg : null;

  const manualEntries = (history?.entries ?? []).filter((e) => e.source === 'manual');
  const entries = [...(history?.entries ?? [])].sort((a, b) =>
    b.date.localeCompare(a.date),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Body Weight</CardTitle>
      </CardHeader>

      <form onSubmit={submitAdd} className="flex flex-wrap items-end gap-2 px-4 py-3 border-b border-surface-light/50">
        <div>
          <label htmlFor="weight-panel-kg" className="block text-xs text-muted mb-1">
            Weight (kg)
          </label>
          <input
            id="weight-panel-kg"
            type="number"
            inputMode="decimal"
            step="0.1"
            min="20"
            max="300"
            value={weightInput}
            onChange={(e) => setWeightInput(e.target.value)}
            placeholder="e.g. 75.5"
            className="w-32 bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div>
          <label htmlFor="weight-panel-date" className="block text-xs text-muted mb-1">
            Date
          </label>
          <input
            id="weight-panel-date"
            type="date"
            value={dateInput}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDateInput(e.target.value)}
            className="bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <button
          type="submit"
          disabled={addMutation.isPending}
          className="px-4 py-2 text-sm bg-accent/20 text-accent border border-accent/30 rounded-lg hover:bg-accent/30 transition-colors disabled:opacity-50 font-medium"
        >
          {addMutation.isPending ? 'Saving…' : 'Log weigh-in'}
        </button>
      </form>

      {error && (
        <p className="px-4 py-2 text-xs text-warning" role="alert">{error}</p>
      )}

      {latestAvg && (
        <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-light/50">
          <div>
            <p className="text-[11px] text-muted">7-day average</p>
            <p className="text-lg font-semibold text-white">{latestAvg.weight_kg.toFixed(1)} kg</p>
          </div>
          {avgDelta !== null && avgDelta !== 0 && (
            <span className={`text-xs font-medium ${avgDelta > 0 ? 'text-warning' : 'text-positive'}`}>
              {avgDelta > 0 ? '+' : ''}{avgDelta.toFixed(1)} kg
            </span>
          )}
        </div>
      )}

      {!compact && (
        <div className="max-h-72 overflow-y-auto">
          {isLoading && entries.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted text-center">Loading…</p>
          )}
          {!isLoading && entries.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted text-center">
              No weight entries yet — log your first weigh-in above.
            </p>
          )}
          {entries.map((entry) => {
            const isEditing = editingId === entry.id;
            const isWhoop = entry.source === 'whoop';
            return (
              <div
                key={entry.id}
                className="flex items-center gap-2 px-4 py-2.5 border-b border-surface-light/30 text-sm"
              >
                <span className="w-28 shrink-0 text-white">{formatDateDMY(entry.date)}</span>
                {isEditing ? (
                  <>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      className="w-24 bg-surface-light border border-surface-light text-white text-sm rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent"
                      autoFocus
                    />
                    <button
                      onClick={() => {
                        const kg = parseFloat(editingValue);
                        if (Number.isFinite(kg) && kg > 0) {
                          editMutation.mutate({ id: entry.id, kg });
                        }
                      }}
                      className="text-xs text-positive hover:text-positive/80 font-medium"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-xs text-muted hover:text-white"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="font-medium text-white">
                      {entry.weight_kg.toFixed(1)} kg
                    </span>
                    {isWhoop ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/15 text-purple-400 uppercase font-medium">
                        Whoop
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-surface-light/60 text-muted uppercase font-medium">
                        Manual
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-2">
                      {!isWhoop && (
                        <>
                          <button
                            onClick={() => {
                              setEditingId(entry.id);
                              setEditingValue(entry.weight_kg.toString());
                            }}
                            aria-label={`Edit weight for ${entry.date}`}
                            className="text-xs text-accent hover:text-accent/80"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteMutation.mutate(entry.id)}
                            disabled={deleteMutation.isPending}
                            aria-label={`Delete weight for ${entry.date}`}
                            className="text-xs text-warning hover:text-warning/80 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      {compact && (
        <p className="px-4 py-3 text-xs text-muted">
          {manualEntries.length}/{entries.length} entries are manual. Manage all entries on the{' '}
          <a href="/cycling" className="text-accent hover:text-accent/80">Cycling page</a>.
        </p>
      )}
    </Card>
  );
}