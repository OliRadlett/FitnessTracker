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
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { useUnits } from '@/lib/units';
import {
  displayWeightToKg,
  formatDateDMY,
  formatWeight,
  kgToDisplayWeight,
} from '@/lib/utils';

const WEIGHT_QUERY_KEY = ['weight-history'] as const;

interface WeightPanelProps {
  /** Days of history to load. Defaults to 90 (matches the weight_trend chart). */
  days?: number;
  /** Compact mode — just the quick-add form (dashboard strip). */
  compact?: boolean;
}

export function WeightPanel({ days = 90, compact = false }: WeightPanelProps) {
  const { authFetch, token } = useAuthFetch();
  const { isImperial } = useUnits();
  const queryClient = useQueryClient();

  const [weightInput, setWeightInput] = useState('');
  const [dateInput, setDateInput] = useState(() => new Date().toISOString().slice(0, 10));
  const [bodyFatInput, setBodyFatInput] = useState('');
  const [muscleInput, setMuscleInput] = useState('');
  const [showCompInputs, setShowCompInputs] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; date: string; weight: string } | null>(null);
  const toast = useToast();

  const { data: history, isLoading } = useQuery({
    queryKey: WEIGHT_QUERY_KEY,
    queryFn: () => getWeightHistory(authFetch, days),
    enabled: !!token,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: WEIGHT_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: ['chart-weight-trend'] });
    queryClient.invalidateQueries({ queryKey: ['chart-body-comp'] });
    queryClient.invalidateQueries({ queryKey: ['cycling-profile'] });
    queryClient.invalidateQueries({ queryKey: ['chart-wkg'] });
  };

  const addMutation = useMutation({
    mutationFn: (payload: { kg: number; body_fat?: number; muscle?: number }) =>
      createWeightEntry(authFetch, {
        date: dateInput || undefined,
        weight_kg: payload.kg,
        ...(payload.body_fat !== undefined ? { body_fat_percent: payload.body_fat } : {}),
        ...(payload.muscle !== undefined ? { muscle_mass_kg: payload.muscle } : {}),
      }),
    onSuccess: () => {
      setWeightInput('');
      setBodyFatInput('');
      setMuscleInput('');
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
    onSuccess: () => {
      setDeleteTarget(null);
      toast.success('Weight entry deleted');
      invalidate();
    },
    onError: () => {
      setDeleteTarget(null);
      setError('Failed to delete weight entry.');
    },
  });

  const submitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const value = parseFloat(weightInput);
    if (!Number.isFinite(value) || value <= 0) {
      setError(`Enter a valid weight in ${isImperial ? 'lb' : 'kg'}.`);
      return;
    }
    const bodyFat = bodyFatInput.trim() === '' ? undefined : parseFloat(bodyFatInput);
    const muscle = muscleInput.trim() === '' ? undefined : parseFloat(muscleInput);
    if (bodyFat !== undefined && (!Number.isFinite(bodyFat) || bodyFat < 3 || bodyFat > 60)) {
      setError('Body fat must be between 3 and 60%.');
      return;
    }
    if (muscle !== undefined && (!Number.isFinite(muscle) || muscle <= 0)) {
      setError(`Enter a valid muscle mass in ${isImperial ? 'lb' : 'kg'}.`);
      return;
    }
    addMutation.mutate({
      kg: displayWeightToKg(value),
      body_fat: bodyFat,
      muscle: muscle !== undefined ? displayWeightToKg(muscle) : undefined,
    });
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
    <>
    <Card>
      <CardHeader>
        <CardTitle>Body Weight</CardTitle>
      </CardHeader>

      <form onSubmit={submitAdd} className="flex flex-wrap items-end gap-2 px-4 py-3 border-b border-surface-light/50">
        <div>
          <label htmlFor="weight-panel-kg" className="block text-xs text-muted mb-1">
            Weight ({isImperial ? 'lb' : 'kg'})
          </label>
          <input
            id="weight-panel-kg"
            type="number"
            inputMode="decimal"
            step="0.1"
            min={isImperial ? 45 : 20}
            max={isImperial ? 660 : 300}
            value={weightInput}
            onChange={(e) => setWeightInput(e.target.value)}
            placeholder={isImperial ? 'e.g. 166.5' : 'e.g. 75.5'}
            className="w-32 bg-surface-light border border-surface-light text-foreground text-base rounded-lg px-3 py-2 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-accent"
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
            className="bg-surface-light border border-surface-light text-foreground text-base rounded-lg px-3 py-2 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <button
          type="submit"
          disabled={addMutation.isPending}
          className="px-4 py-2 min-h-[44px] text-sm bg-accent/20 text-accent border border-accent/30 rounded-lg hover:bg-accent/30 transition-colors disabled:opacity-50 font-medium"
        >
          {addMutation.isPending ? 'Saving…' : 'Log weigh-in'}
        </button>
        <button
          type="button"
          onClick={() => setShowCompInputs((v) => !v)}
          className="px-3 py-2 min-h-[44px] text-xs text-muted hover:text-foreground"
          aria-expanded={showCompInputs}
        >
          {showCompInputs ? '− Composition' : '+ Composition'}
        </button>
      </form>
      {showCompInputs && (
        <div className="flex flex-wrap items-end gap-2 px-4 py-2 border-b border-surface-light/50">
          <div>
            <label htmlFor="weight-panel-bodyfat" className="block text-xs text-muted mb-1">
              Body fat (%)
            </label>
            <input
              id="weight-panel-bodyfat"
              type="number"
              inputMode="decimal"
              step="0.1"
              min={3}
              max={60}
              value={bodyFatInput}
              onChange={(e) => setBodyFatInput(e.target.value)}
              placeholder="e.g. 18.5"
              className="w-28 bg-surface-light border border-surface-light text-foreground text-base rounded-lg px-3 py-2 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label htmlFor="weight-panel-muscle" className="block text-xs text-muted mb-1">
              Muscle ({isImperial ? 'lb' : 'kg'})
            </label>
            <input
              id="weight-panel-muscle"
              type="number"
              inputMode="decimal"
              step="0.1"
              min={0}
              value={muscleInput}
              onChange={(e) => setMuscleInput(e.target.value)}
              placeholder={isImperial ? 'e.g. 70' : 'e.g. 32'}
              className="w-28 bg-surface-light border border-surface-light text-foreground text-base rounded-lg px-3 py-2 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>
      )}

      {error && (
        <p className="px-4 py-2 text-xs text-warning" role="alert">{error}</p>
      )}

      {latestAvg && (
        <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-light/50">
          <div>
            <p className="text-[11px] text-muted">7-day average</p>
            <p className="text-lg font-semibold text-foreground">{formatWeight(latestAvg.weight_kg)}</p>
          </div>
          {avgDelta !== null && avgDelta !== 0 && (
            <span className={`text-xs font-medium ${avgDelta > 0 ? 'text-warning' : 'text-positive'}`}>
              {avgDelta > 0 ? '+' : ''}{formatWeight(Math.abs(avgDelta))}
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
            const isReadOnly = entry.source === 'whoop' || entry.source === 'withings';
            const compRows: [string, string][] = [];
            if (entry.body_fat_percent != null) compRows.push(['Body fat', `${entry.body_fat_percent.toFixed(1)}%`]);
            if (entry.fat_mass_kg != null) compRows.push(['Fat mass', formatWeight(entry.fat_mass_kg)]);
            if (entry.lean_mass_kg != null) compRows.push(['Lean mass', formatWeight(entry.lean_mass_kg)]);
            if (entry.muscle_mass_kg != null) compRows.push(['Muscle', formatWeight(entry.muscle_mass_kg)]);
            if (entry.bone_mass_kg != null) compRows.push(['Bone', formatWeight(entry.bone_mass_kg)]);
            if (entry.hydration_percent != null) compRows.push(['Hydration', `${entry.hydration_percent.toFixed(1)}%`]);
            if (entry.visceral_fat_index != null) compRows.push(['Visceral fat', entry.visceral_fat_index.toFixed(0)]);
            if (entry.bmi != null) compRows.push(['BMI', entry.bmi.toFixed(1)]);
            const isExpanded = expandedId === entry.id;
            return (
              <div
                key={entry.id}
                className="px-4 py-2.5 border-b border-surface-light/30 text-sm"
              >
              <div className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-foreground">{formatDateDMY(entry.date)}</span>
                {isEditing ? (
                  <>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      className="w-24 bg-surface-light border border-surface-light text-foreground text-base rounded-lg px-2 py-1 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-accent"
                      autoFocus
                    />
                    <button
                      onClick={() => {
                        const value = parseFloat(editingValue);
                        if (Number.isFinite(value) && value > 0) {
                          editMutation.mutate({ id: entry.id, kg: displayWeightToKg(value) });
                        }
                      }}
                      className="min-h-[44px] flex items-center text-xs text-positive hover:text-positive/80 font-medium"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="min-h-[44px] flex items-center text-xs text-muted hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="font-medium text-foreground">
                      {formatWeight(entry.weight_kg)}
                    </span>
                    {entry.source === 'withings' ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-teal-500/15 text-teal-400 uppercase font-medium">
                        Withings
                      </span>
                    ) : entry.source === 'whoop' ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/15 text-purple-400 uppercase font-medium">
                        Whoop
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-surface-light/60 text-muted uppercase font-medium">
                        Manual
                      </span>
                    )}
                    {compRows.length > 0 && (
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                        className="min-h-[44px] flex items-center text-xs text-muted hover:text-foreground"
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? 'Hide' : 'Show'} body composition for ${entry.date}`}
                      >
                        {isExpanded ? '▾' : '▸'} comp
                      </button>
                    )}
                    <span className="ml-auto flex items-center gap-2">
                      {!isReadOnly && (
                        <>
                          <button
                            onClick={() => {
                              setEditingId(entry.id);
                              setEditingValue(kgToDisplayWeight(entry.weight_kg).toFixed(1));
                            }}
                            aria-label={`Edit weight for ${entry.date}`}
                            className="min-h-[44px] flex items-center text-xs text-accent hover:text-accent/80"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() =>
                              setDeleteTarget({
                                id: entry.id,
                                date: formatDateDMY(entry.date),
                                weight: formatWeight(entry.weight_kg),
                              })
                            }
                            aria-label={`Delete weight for ${entry.date}`}
                            className="min-h-[44px] flex items-center text-xs text-warning hover:text-warning/80 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </span>
                  </>
                )}
              </div>
              {isExpanded && compRows.length > 0 && (
                <dl className="mt-1 ml-28 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs">
                  {compRows.map(([label, value]) => (
                    <div key={label} className="flex gap-1">
                      <dt className="text-muted">{label}:</dt>
                      <dd className="text-foreground font-medium">{value}</dd>
                    </div>
                  ))}
                </dl>
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
    <ConfirmDialog
      open={deleteTarget !== null}
      title="Delete weight entry?"
      description={
        deleteTarget
          ? `Delete the ${deleteTarget.date} entry (${deleteTarget.weight})? This cannot be undone.`
          : undefined
      }
      confirmLabel="Delete"
      danger
      pending={deleteMutation.isPending}
      onConfirm={() => {
        if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
      }}
      onCancel={() => {
        if (!deleteMutation.isPending) setDeleteTarget(null);
      }}
    />
    </>
  );
}