'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { useAuthFetch } from '@/lib/api';
import { getGoalMetrics, getCheckIns, addCheckIn, updateGoal, deleteGoal, reactivateGoal, getGoalProjection } from '@/lib/api';
import type { Goal, UpdateGoalPayload, GoalProjectionResponse } from '@/lib/api';
import { goalProgressPct, goalAlignmentBadge } from '@/components/ui/GoalCard';
import { Modal, ModalHeader } from '@/components/ui/Modal';

const SPORT_OPTIONS = [
  { value: '', label: 'All sports' },
  { value: 'cycling', label: 'Cycling' },
  { value: 'strength', label: 'Strength' },
];

/**
 * Full goal detail — check-in history chart (with target reference line),
 * manual check-in form, edit/delete/reactivate lifecycle actions.
 */
export function GoalDetailModal({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Check-in form — prefilled with the goal's current value
  const [checkValue, setCheckValue] = useState(
    goal.current_value !== undefined && goal.current_value !== null ? String(goal.current_value) : '',
  );
  const [checkNote, setCheckNote] = useState('');

  // Edit form state (initialised lazily on first edit toggle)
  const [editTarget, setEditTarget] = useState(String(goal.target_value));
  const [editDate, setEditDate] = useState(goal.target_date ?? '');
  const [editNotes, setEditNotes] = useState(goal.notes ?? '');
  const [editExercise, setEditExercise] = useState(goal.filter_json?.exercise ?? '');
  const [editSport, setEditSport] = useState(goal.filter_json?.sport ?? '');

  const { data: metrics } = useQuery({
    queryKey: ['goal-metrics'],
    queryFn: () => getGoalMetrics(authFetch),
    staleTime: Infinity,
  });

  const { data: checkIns, isLoading: checkInsLoading } = useQuery({
    queryKey: ['goal-checkins', goal.id],
    queryFn: () => getCheckIns(authFetch, goal.id),
  });

  const { data: projection } = useQuery({
    queryKey: ['goal-projection', goal.id],
    queryFn: () => getGoalProjection(authFetch, goal.id),
    staleTime: 5 * 60_000,
    enabled: goal.status === 'active',
  });

  const metricDef = useMemo(
    () => metrics?.find((m) => m.key === goal.metric) ?? null,
    [metrics, goal.metric],
  );
  const needsExercise = !!metricDef?.requires_filter?.includes('exercise');
  const hasSportFilter = !!metricDef?.optional_filter?.includes('sport');
  const unit = metricDef?.unit ?? goal.metric_unit ?? '';

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['goals'] });
    queryClient.invalidateQueries({ queryKey: ['goal-checkins'] });
  };

  const checkInMutation = useMutation({
    mutationFn: () =>
      addCheckIn(authFetch, goal.id, {
        value: parseFloat(checkValue),
        note: checkNote.trim() || undefined,
      }),
    onSuccess: () => {
      setCheckNote('');
      invalidate();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (patch: UpdateGoalPayload) => updateGoal(authFetch, goal.id, patch),
    onSuccess: () => {
      setEditing(false);
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteGoal(authFetch, goal.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      onClose();
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: () => reactivateGoal(authFetch, goal.id),
    onSuccess: invalidate,
  });

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // ── Chart data ────────────────────────────────────────────────────────────
  // Merge check-in history with projection line into a unified dataset.
  // Each point has: date, value (from check-ins), projected (from projection line).
  const { chartData, hasProjectionLine } = useMemo(() => {
    const historyPoints = (checkIns ?? [])
      .slice()
      .sort((a, b) => a.check_in_date.localeCompare(b.check_in_date))
      .map((c) => ({ date: c.check_in_date, value: c.value, note: c.note }));

    const projLine = projection?.projection_line ?? [];
    if (projLine.length === 0 || historyPoints.length === 0) {
      return { chartData: historyPoints, hasProjectionLine: false };
    }

    // Build a map of projection values by date
    const projMap = new Map<string, number>();
    for (const p of projLine) {
      projMap.set(p.date, p.value);
    }

    // Merge: all history dates + projection-only dates
    const allDates = new Set<string>(historyPoints.map((h) => h.date));
    for (const d of projMap.keys()) {
      allDates.add(d);
    }

    const merged = [...allDates]
      .sort()
      .map((date) => {
        const hist = historyPoints.find((h) => h.date === date);
        return {
          date,
          value: hist?.value ?? null,
          projected: projMap.get(date) ?? null,
          note: hist?.note,
        };
      });

    return { chartData: merged, hasProjectionLine: true };
  }, [checkIns, projection]);

  const progress = goalProgressPct(goal);
  const alignmentBadge = goalAlignmentBadge(goal);

  const handleEditSave = (e: React.FormEvent) => {
    e.preventDefault();
    const patch: UpdateGoalPayload = {
      target_value: parseFloat(editTarget),
      target_date: editDate || null,
      notes: editNotes.trim() || null,
    };
    if (needsExercise && editExercise.trim()) {
      patch.filter_json = { ...goal.filter_json, exercise: editExercise.trim() };
    } else if (hasSportFilter) {
      patch.filter_json = {
        ...goal.filter_json,
        ...(editSport ? { sport: editSport } : {}),
      };
      if (!editSport) delete patch.filter_json!.sport;
    }
    updateMutation.mutate(patch);
  };

  return (
    <Modal open onClose={onClose} size="lg" aria-label="Goal detail">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <span aria-hidden="true">🎯</span>
            <span className="truncate">{goal.metric_label || goal.metric}</span>
          </h3>
          {(goal.filter_json?.exercise || goal.filter_json?.sport) && (
            <p className="text-xs text-accent">{goal.filter_json.exercise || goal.filter_json.sport}</p>
          )}
        </div>
        <button onClick={onClose} className="text-muted hover:text-white text-xl" aria-label="Close">
          ×
        </button>
      </div>

        {/* Summary strip */}
        <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
          {alignmentBadge && (
            <span className={`px-2 py-0.5 rounded font-medium ${alignmentBadge.className}`}>
              {alignmentBadge.label} · {Math.round(goal.alignment_pct ?? 0)}%
            </span>
          )}
          <span className={`px-2 py-0.5 rounded font-medium ${goal.status === 'achieved' ? 'bg-green-500/20 text-green-400' : 'bg-accent/20 text-accent'}`}>
            {progress.toFixed(0)}% progress
          </span>
          <span className="text-muted">
            Current:{' '}
            {goal.current_value !== undefined && goal.current_value !== null
              ? `${goal.current_value.toFixed(1)}${unit ? ` ${unit}` : ''}`
              : 'no data yet'}
            {' · '}Target: {goal.target_value.toFixed(1)}{unit ? ` ${unit}` : ''}
            {' · '}{goal.direction === 'decrease' ? '↓ decrease' : '↑ increase'}
          </span>
          {goal.target_date && (
            <span className="text-muted">
              Due {new Date(goal.target_date).toLocaleDateString()}
            </span>
          )}
        </div>

        {/* Check-in history chart */}
        <div className="mb-5">
          <h4 className="text-sm font-medium text-muted uppercase tracking-wider mb-2">Check-in History</h4>
          {checkInsLoading ? (
            <div className="h-48 animate-pulse bg-surface-light/40 rounded-lg" />
          ) : chartData.length > 0 ? (
            <div className="h-48 bg-surface-light/20 rounded-lg p-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.4} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickFormatter={(d: string) =>
                      new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                    }
                  />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                      color: '#fff',
                    }}
                    labelFormatter={(d) => new Date(String(d)).toLocaleDateString()}
                    formatter={(value: number | string, name: string) => [
                      `${Number(value).toFixed(1)}${unit ? ` ${unit}` : ''}`,
                      name === 'projected' ? 'Projection' : 'Value',
                    ]}
                  />
                  <ReferenceLine
                    y={goal.target_value}
                    stroke="#22c55e"
                    strokeDasharray="6 4"
                    label={{
                      value: `Target ${goal.target_value}`,
                      fill: '#22c55e',
                      fontSize: 11,
                      position: 'insideBottomRight',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#38bdf8' }}
                    connectNulls={false}
                  />
                  {hasProjectionLine && (
                    <Line
                      type="monotone"
                      dataKey="projected"
                      stroke="#38bdf8"
                      strokeOpacity={0.5}
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={false}
                      connectNulls={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-muted text-sm py-6 text-center bg-surface-light/10 rounded-lg">
              No check-ins yet — record one below or wait for the weekly auto snapshot.
            </p>
          )}
        </div>

        {/* Projection section (Phase 7) */}
        {projection && (
          <ProjectionSection projection={projection} />
        )}

        {/* Manual check-in form */}
        {!editing && goal.status === 'active' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (checkValue) checkInMutation.mutate();
            }}
            className="mb-5 p-3 bg-surface-light/20 rounded-lg space-y-2"
          >
            <h4 className="text-sm font-medium text-muted uppercase tracking-wider">Log Check-in</h4>
            <div className="flex gap-2 items-start">
              <input
                type="number"
                step="any"
                value={checkValue}
                onChange={(e) => setCheckValue(e.target.value)}
                required
                placeholder={`Current${unit ? ` (${unit})` : ''}`}
                className="w-32 bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <textarea
                value={checkNote}
                onChange={(e) => setCheckNote(e.target.value)}
                rows={1}
                maxLength={500}
                placeholder="Note (optional)"
                className="flex-1 bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent resize-y"
              />
              <button
                type="submit"
                disabled={checkInMutation.isPending}
                className="px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 shrink-0"
              >
                {checkInMutation.isPending ? '…' : 'Log'}
              </button>
            </div>
            {checkInMutation.isError && (
              <p className="text-warning text-xs">⚠️ Failed to record check-in</p>
            )}
          </form>
        )}

        {/* Edit form */}
        {editing ? (
          <form onSubmit={handleEditSave} className="mb-5 p-3 bg-surface-light/20 rounded-lg space-y-3">
            <h4 className="text-sm font-medium text-muted uppercase tracking-wider">Edit Goal</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">
                  Target Value{unit ? ` (${unit})` : ''}
                </label>
                <input
                  type="number"
                  step="any"
                  value={editTarget}
                  onChange={(e) => setEditTarget(e.target.value)}
                  required
                  className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Target Date</label>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            </div>
            {needsExercise && (
              <div>
                <label className="block text-xs text-muted mb-1">Exercise</label>
                <input
                  type="text"
                  value={editExercise}
                  onChange={(e) => setEditExercise(e.target.value)}
                  placeholder="e.g. Back Squat"
                  className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            )}
            {hasSportFilter && (
              <div>
                <label className="block text-xs text-muted mb-1">Sport</label>
                <select
                  value={editSport}
                  onChange={(e) => setEditSport(e.target.value)}
                  className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  {SPORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs text-muted mb-1">Notes</label>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={2}
                maxLength={500}
                className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent resize-y"
              />
            </div>
            {updateMutation.isError && (
              <p className="text-warning text-xs">
                ⚠️ {updateMutation.error instanceof Error ? updateMutation.error.message : 'Failed to update goal'}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={updateMutation.isPending}
                className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {updateMutation.isPending ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="px-4 py-2 text-muted hover:text-white text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          goal.notes && (
            <p className="text-sm text-muted mb-5 italic">{goal.notes}</p>
          )
        )}

        {/* Lifecycle actions */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-surface-light/40">
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="px-3 py-1.5 text-sm text-muted hover:text-white bg-surface-light/40 hover:bg-surface-light/60 rounded-lg transition-colors"
            >
              ✏️ Edit
            </button>
          )}
          {(goal.status === 'expired' || goal.status === 'abandoned') && (
            <button
              onClick={() => reactivateMutation.mutate()}
              disabled={reactivateMutation.isPending}
              className="px-3 py-1.5 text-sm bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30 rounded-lg transition-colors disabled:opacity-50 font-medium"
            >
              🔄 Reactivate
            </button>
          )}
          <div className="flex-1" />
          {confirmingDelete ? (
            <>
              <span className="text-xs text-warning">Delete this goal and its check-ins?</span>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="px-3 py-1.5 text-sm bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded-lg transition-colors disabled:opacity-50 font-medium"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Confirm Delete'}
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                className="px-3 py-1.5 text-sm text-muted hover:text-white transition-colors"
              >
                Keep
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="px-3 py-1.5 text-sm text-muted hover:text-warning rounded-lg transition-colors"
              title="Delete goal"
            >
              🗑️ Delete
            </button>
          )}
        </div>
        {(reactivateMutation.isError || deleteMutation.isError) && (
          <p className="text-warning text-xs mt-2">
            ⚠️ {reactivateMutation.isError ? 'Failed to reactivate goal' : 'Failed to delete goal'}
          </p>
        )}
    </Modal>
  );
}

// ── Projection section (Phase 7) ──────────────────────────────────────────

const BADGE_STYLES: Record<string, string> = {
  'On Track': 'bg-green-500/20 text-green-400 border-green-500/30',
  'At Risk': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'Unlikely': 'bg-red-500/20 text-red-400 border-red-500/30',
  'Not enough data': 'bg-muted/20 text-muted border-muted/30',
};

function ProjectionSection({ projection }: { projection: GoalProjectionResponse }) {
  const { badge, projection: proj, target_date } = projection;
  const badgeStyle = BADGE_STYLES[badge] ?? BADGE_STYLES['Not enough data'];

  // Determine if projected date overshoots target
  let missDays: number | null = null;
  if (proj?.projected_date && target_date) {
    const projTime = new Date(proj.projected_date).getTime();
    const targetTime = new Date(target_date).getTime();
    if (projTime > targetTime) {
      missDays = Math.ceil((projTime - targetTime) / 86_400_000);
    }
  }

  return (
    <div className="mb-5 p-3 bg-surface-light/20 rounded-lg space-y-2">
      <h4 className="text-sm font-medium text-muted uppercase tracking-wider">Projection</h4>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${badgeStyle}`}>
          {badge}
        </span>
        {proj ? (
          missDays !== null ? (
            <span className="text-xs text-warning">
              At current pace, target missed by {missDays} day{missDays === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="text-xs text-muted">
              Projected to reach target:{' '}
              <span className="text-white font-medium">
                {new Date(proj.projected_date).toLocaleDateString()}
              </span>{' '}
              ({proj.days_remaining} day{proj.days_remaining === 1 ? '' : 's'} remaining)
            </span>
          )
        ) : (
          <span className="text-xs text-muted italic">Not enough data to project</span>
        )}
      </div>
      {projection.trend && (
        <p className="text-[11px] text-muted">
          Trend: {(projection.trend.slope_per_week >= 0 ? '+' : '')}
          {projection.trend.slope_per_week.toFixed(2)}/week
          {' · '}R² = {projection.trend.r_squared.toFixed(2)}
          {' · '}{projection.trend.data_points} data points
        </p>
      )}
    </div>
  );
}
