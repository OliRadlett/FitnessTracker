'use client';

import React, { useState } from 'react';
import type { Goal, CreateGoalPayload } from '@/lib/api';
import { ExerciseAutocomplete } from '@/components/ui/ExerciseAutocomplete';

// ── Goal Type Config ─────────────────────────────────────────────────────

const GOAL_TYPE_LABELS: Record<string, string> = {
  ftp_target: 'FTP Target (W)',
  weight_target: 'Body Weight (kg)',
  weekly_sessions: 'Weekly Sessions',
  '1rm_target': '1RM Target (kg)',
  distance_target: 'Monthly Distance (km)',
};

const GOAL_TYPE_ICONS: Record<string, string> = {
  ftp_target: '⚡',
  weight_target: '⚖️',
  weekly_sessions: '📅',
  '1rm_target': '🏋️',
  distance_target: '🚴',
};

// ── Goal Card ────────────────────────────────────────────────────────────

export function GoalCard({
  goal,
  onAchieve,
  onDelete,
}: {
  goal: Goal;
  onAchieve?: () => void;
  onDelete?: () => void;
}) {
  const progress = goal.target_value > 0 && goal.current_value !== undefined && goal.current_value !== null
    ? Math.min(100, (goal.current_value / goal.target_value) * 100)
    : 0;

  const isAchieved = goal.status === 'achieved';
  const isExpired = goal.status === 'expired';
  const icon = GOAL_TYPE_ICONS[goal.goal_type] || '🎯';
  const label = GOAL_TYPE_LABELS[goal.goal_type] || goal.goal_type;

  const statusColor = isAchieved
    ? 'border-green-500/30 bg-green-500/5'
    : isExpired
    ? 'border-red-500/20 bg-red-500/5'
    : 'border-surface-light/50 bg-surface-light/10';

  const progressColor = isAchieved
    ? 'bg-green-500'
    : isExpired
    ? 'bg-red-500/60'
    : 'bg-accent';

  return (
    <div className={`rounded-xl border p-4 ${statusColor} transition-colors`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <div>
            <p className="text-sm font-medium text-white">{label}</p>
            {goal.notes && goal.goal_type === '1rm_target' && (
              <p className="text-xs text-accent">{goal.notes}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAchieved && (
            <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400 font-medium">
              ✅ Achieved
            </span>
          )}
          {isExpired && (
            <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-medium">
              Expired
            </span>
          )}
          {goal.status === 'active' && (
            <span className="text-xs px-2 py-0.5 rounded bg-accent/20 text-accent font-medium">
              Active
            </span>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              className="text-muted hover:text-warning transition-colors text-xs"
              aria-label="Delete goal"
              title="Delete goal"
            >
              🗑️
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-2">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted">
            {goal.current_value !== undefined && goal.current_value !== null
              ? `${goal.current_value.toFixed(1)} / ${goal.target_value.toFixed(1)}`
              : `Target: ${goal.target_value.toFixed(1)}`}
          </span>
          <span className="text-muted font-medium">{progress.toFixed(0)}%</span>
        </div>
        <div className="h-2 bg-surface-light/40 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${progressColor}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Target date */}
      {goal.target_date && (
        <p className="text-xs text-muted">
          {isExpired ? 'Expired' : 'Due'}: {new Date(goal.target_date).toLocaleDateString()}
        </p>
      )}

      {/* Manual achieve button for active goals */}
      {goal.status === 'active' && onAchieve && progress >= 100 && (
        <button
          onClick={onAchieve}
          className="mt-2 w-full text-xs bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30 rounded-lg py-1.5 transition-colors font-medium"
        >
          🎉 Mark as Achieved
        </button>
      )}
    </div>
  );
}

// ── Goal Form ────────────────────────────────────────────────────────────

export function GoalForm({
  onSubmit,
  onCancel,
  isPending,
}: {
  onSubmit: (data: CreateGoalPayload) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [goalType, setGoalType] = useState('weekly_sessions');
  const [targetValue, setTargetValue] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetValue) return;
    onSubmit({
      goal_type: goalType,
      target_value: parseFloat(targetValue),
      target_date: targetDate || undefined,
      notes: notes || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 bg-surface-light/20 rounded-lg space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-muted mb-1">Goal Type *</label>
          <select
            value={goalType}
            onChange={(e) => setGoalType(e.target.value)}
            className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {Object.entries(GOAL_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Target Value *</label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
            placeholder={
              goalType === 'weekly_sessions' ? 'e.g. 5'
              : goalType === 'ftp_target' ? 'e.g. 250'
              : goalType === 'weight_target' ? 'e.g. 80'
              : goalType === '1rm_target' ? 'e.g. 140'
              : 'e.g. 500'
            }
            required
            className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-muted mb-1">Target Date (optional)</label>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        {goalType === '1rm_target' && (
          <div>
            <label className="block text-xs text-muted mb-1">Exercise Name *</label>
            <ExerciseAutocomplete
              value={notes}
              onChange={setNotes}
              placeholder="e.g. Bench Press"
            />
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {isPending ? 'Creating...' : 'Create Goal'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-muted hover:text-white text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
