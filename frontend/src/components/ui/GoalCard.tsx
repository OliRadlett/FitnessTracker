'use client';

import React from 'react';
import type { Goal } from '@/lib/api';

// ── Helpers ──────────────────────────────────────────────────────────────

/** Icon per metric keyword — best-effort visual hint. */
function metricIcon(goal: Goal): string {
  const m = goal.metric;
  if (m.includes('ftp')) return '⚡';
  if (m === 'body_weight') return '⚖️';
  if (m.includes('1rm')) return '🏋️';
  if (m.includes('sessions')) return '📅';
  if (m.includes('distance')) return '🚴';
  if (m.includes('tss')) return '📈';
  if (m.includes('vo2max')) return '🫁';
  if (m.includes('bw_ratio')) return '💪';
  if (m.includes('big3')) return '🏆';
  if (m === 'resting_hr') return '❤️';
  if (m === 'hrv_ms') return '🫀';
  return '🎯';
}

/** Human-readable filter context, e.g. "Back Squat" or "cycling". */
export function goalFilterLabel(goal: Goal): string | null {
  const f = goal.filter_json;
  if (!f) return null;
  return f.exercise || f.sport || null;
}

/**
 * Direction-aware progress fill (%):
 * - increase: how far current has moved from start toward target
 * - decrease: distance covered from start DOWN toward target
 * Prefers backend-computed `progress_pct`; falls back to local computation.
 */
export function goalProgressPct(goal: Goal): number {
  if (goal.progress_pct !== undefined && goal.progress_pct !== null) {
    return Math.max(0, Math.min(100, goal.progress_pct));
  }
  const start = goal.starting_value;
  const current = goal.current_value;
  if (start === undefined || start === null || current === undefined || current === null) {
    return 0;
  }
  const span = goal.target_value - start;
  if (span === 0) return 0;
  const raw = ((current - start) / span) * 100;
  return Math.max(0, Math.min(100, raw));
}

export interface AlignmentBadgeInfo {
  label: string;
  className: string;
}

/**
 * Alignment badge when the goal has a target_date and an alignment score.
 * ≥100 ahead · ≥85 on track · >0 behind · negative regressing.
 * Returns null when there is no target_date/alignment — plain % is shown instead.
 */
export function goalAlignmentBadge(goal: Goal): AlignmentBadgeInfo | null {
  if (!goal.target_date || goal.alignment_pct === undefined || goal.alignment_pct === null) {
    return null;
  }
  const a = goal.alignment_pct;
  if (a >= 100) return { label: 'Ahead', className: 'bg-green-500/20 text-green-400' };
  if (a >= 85) return { label: 'On track', className: 'bg-accent/20 text-accent' };
  if (a > 0) return { label: 'Behind', className: 'bg-warning/20 text-warning' };
  return { label: 'Regressing', className: 'bg-red-500/20 text-red-400' };
}

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-accent/20 text-accent' },
  achieved: { label: '✅ Achieved', className: 'bg-green-500/20 text-green-400' },
  expired: { label: 'Expired', className: 'bg-red-500/20 text-red-400' },
  abandoned: { label: 'Abandoned', className: 'bg-muted/30 text-muted' },
};

// ── Goal Card ────────────────────────────────────────────────────────────

export function GoalCard({
  goal,
  onClick,
}: {
  goal: Goal;
  onClick?: () => void;
}) {
  const progress = goalProgressPct(goal);
  const isAchieved = goal.status === 'achieved';
  const isExpired = goal.status === 'expired';
  const statusBadge = STATUS_BADGES[goal.status] ?? STATUS_BADGES.active;
  const alignmentBadge = goalAlignmentBadge(goal);
  const icon = metricIcon(goal);
  const label = goal.metric_label || goal.metric;
  const filterLabel = goalFilterLabel(goal);
  const unit = goal.metric_unit ? ` ${goal.metric_unit}` : '';

  const cardColor = isAchieved
    ? 'border-green-500/30 bg-green-500/5'
    : isExpired
    ? 'border-red-500/20 bg-red-500/5'
    : 'border-surface-light/50 bg-surface-light/10';

  const progressColor = isAchieved
    ? 'bg-green-500'
    : isExpired
    ? 'bg-red-500/60'
    : 'bg-accent';

  const hasCurrentValue = goal.current_value !== undefined && goal.current_value !== null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-xl border p-4 ${cardColor} transition-colors hover:border-accent/40 w-full`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg" aria-hidden="true">{icon}</span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{label}</p>
            {filterLabel && <p className="text-xs text-accent truncate">{filterLabel}</p>}
            {!filterLabel && goal.notes && (
              <p className="text-xs text-muted truncate">{goal.notes}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {alignmentBadge && (
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${alignmentBadge.className}`}>
              {alignmentBadge.label}
            </span>
          )}
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusBadge.className}`}>
            {statusBadge.label}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-2">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted">
            {hasCurrentValue
              ? `${goal.current_value!.toFixed(1)}${unit} / ${goal.target_value.toFixed(1)}${unit}`
              : `Target: ${goal.target_value.toFixed(1)}${unit}`}
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
          {isExpired ? 'Expired' : 'Due'}:{' '}
          {new Date(goal.target_date).toLocaleDateString()}
          {alignmentBadge && goal.alignment_pct !== null && goal.alignment_pct !== undefined && (
            <span className="ml-1">· {Math.round(goal.alignment_pct)}% aligned</span>
          )}
          {!alignmentBadge && (
            <span className="ml-1">· {progress.toFixed(0)}%</span>
          )}
        </p>
      )}
    </button>
  );
}
