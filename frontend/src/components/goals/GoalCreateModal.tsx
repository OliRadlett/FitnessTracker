'use client';

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import { getGoalMetrics, createGoal } from '@/lib/api';
import type { CreateGoalPayload } from '@/lib/api';
import { ExerciseAutocomplete } from '@/components/ui/ExerciseAutocomplete';
import { Modal, ModalHeader } from '@/components/ui/Modal';

const SPORT_OPTIONS = [
  { value: '', label: 'All sports' },
  { value: 'cycling', label: 'Cycling' },
  { value: 'strength', label: 'Strength' },
];

/**
 * Create-goal modal driven by GET /goals/metrics — the metric registry
 * decides which filter inputs appear (exercise autocomplete for
 * estimated_1rm, sport select for activity-count/distance/TSS metrics).
 */
export function GoalCreateModal({ onClose }: { onClose: () => void }) {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();

  const { data: metrics } = useQuery({
    queryKey: ['goal-metrics'],
    queryFn: () => getGoalMetrics(authFetch),
    staleTime: Infinity,
    enabled: !!token,
  });

  const [metricKey, setMetricKey] = useState('');
  const [exercise, setExercise] = useState('');
  const [sport, setSport] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [notes, setNotes] = useState('');

  const selectedMetric = useMemo(
    () => metrics?.find((m) => m.key === metricKey) ?? null,
    [metrics, metricKey],
  );

  const needsExercise = !!selectedMetric?.requires_filter?.includes('exercise');
  const hasSportFilter = !!selectedMetric?.optional_filter?.includes('sport');

  const createMutation = useMutation({
    mutationFn: (payload: CreateGoalPayload) => createGoal(authFetch, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      onClose();
    },
    onError: (err: Error) => {
      console.error('[GoalCreateModal] Create failed:', err);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMetric || !targetValue) return;

    const filter_json: Record<string, string> = {};
    if (needsExercise && exercise.trim()) filter_json.exercise = exercise.trim();
    if (hasSportFilter && sport) filter_json.sport = sport;

    createMutation.mutate({
      metric: selectedMetric.key,
      target_value: parseFloat(targetValue),
      filter_json: Object.keys(filter_json).length > 0 ? filter_json : undefined,
      target_date: targetDate || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Modal open onClose={onClose} size="sm" aria-label="Create goal">
      <ModalHeader title="🎯 New Goal" onClose={onClose} />

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Metric */}
          <div>
            <label className="block text-xs text-muted mb-1">Metric *</label>
            <select
              value={metricKey}
              onChange={(e) => setMetricKey(e.target.value)}
              required
              className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="" disabled>Select a metric…</option>
              {(metrics ?? []).map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label} ({m.unit})
                </option>
              ))}
            </select>
            {selectedMetric && (
              <p className="text-xs text-muted mt-1">
                Direction: {selectedMetric.default_direction === 'decrease' ? 'decrease toward target ↓' : 'increase toward target ↑'}
              </p>
            )}
          </div>

          {/* Dynamic filters */}
          {needsExercise && (
            <div>
              <label className="block text-xs text-muted mb-1">Exercise *</label>
              <ExerciseAutocomplete
                value={exercise}
                onChange={setExercise}
                placeholder="e.g. Back Squat"
                required
              />
            </div>
          )}
          {hasSportFilter && (
            <div>
              <label className="block text-xs text-muted mb-1">Sport</label>
              <select
                value={sport}
                onChange={(e) => setSport(e.target.value)}
                className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {SPORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Target */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1">
                Target Value *{selectedMetric ? ` (${selectedMetric.unit})` : ''}
              </label>
              <input
                type="number"
                step="any"
                min="0"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                required
                placeholder={
                  selectedMetric?.default_direction === 'decrease'
                    ? 'lower is better'
                    : 'higher is better'
                }
                className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Target Date (optional)</label>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs text-muted mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Why this goal?"
              className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent resize-y"
            />
          </div>

          {createMutation.isError && (
            <p className="text-warning text-sm">
              ⚠️ {createMutation.error instanceof Error ? createMutation.error.message : 'Failed to create goal'}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating…' : 'Create Goal'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-muted hover:text-white text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
    </Modal>
  );
}
