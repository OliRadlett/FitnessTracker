'use client';

/**
 * DayEditor — the single editing surface for one plan day.
 *
 * Extracted from WeeklyView's `ExpandedPanel` so Plan mode can render the same
 * editor wherever a day appears (the "one editor" model). Field edits commit
 * through `useInstantDayEdit` — an optimistic, targeted day PATCH — rather than
 * a callback, so the editor owns its own save.
 *
 * Rendered inline below the week strip (desktop and mobile); the bottom-sheet
 * refinement is the mobile pass.
 */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { MapPin, Target, Upload } from 'lucide-react';

import type { Goal, TrainingWeekDay, UpdateTrainingPlanDayPayload } from '@/lib/api';
import { getActiveLocale } from '@/lib/utils';
import { useInstantDayEdit } from '@/lib/training/useInstantDayEdit';
import { goalProgressPct } from '@/components/ui/GoalCard';
import { goalsForPlanDay, goalShortLabel } from '@/components/goals/goalPlanLinks';
import { useAutoregulationMap } from '@/components/lifting/AutoregulationCard';
import { DayConformityPanel } from '../DayConformityPanel';

export interface DayEditorProps {
  planId: string;
  /** The visible week — so the optimistic patch hits the right cache entry. */
  week: number;
  day: TrainingWeekDay;
  /** Active goals (plan → goal cross-links). */
  goals: Goal[];
  /** Route assign/unassign in flight (owned by the host). */
  routeBusy?: boolean;
  onUnassignRoute: () => void;
  onOpenRoutePicker: () => void;
  onOpenWahooPush: () => void;
}

export function DayEditor({
  planId,
  week,
  day,
  goals,
  routeBusy,
  onUnassignRoute,
  onOpenRoutePicker,
  onOpenWahooPush,
}: DayEditorProps) {
  const [duration, setDuration] = useState(day.planned_duration_min?.toString() ?? '');
  const [tss, setTss] = useState(day.planned_tss?.toString() ?? '');
  const [notes, setNotes] = useState(day.notes ?? '');
  // B-17: autoregulated suggestions for planned strength exercises.
  const autoMap = useAutoregulationMap();
  // Phase 2: active goals this day's training supports (display-only match).
  const dayGoals = useMemo(() => goalsForPlanDay(goals, day), [goals, day]);

  const instantEdit = useInstantDayEdit(planId, week);
  const busy = instantEdit.isPending || !!routeBusy;

  const handleSave = () => {
    const payload: UpdateTrainingPlanDayPayload = {};
    if (duration !== '') payload.planned_duration_min = parseInt(duration, 10) || null;
    if (tss !== '') payload.planned_tss = parseFloat(tss) || null;
    payload.notes = notes;
    instantEdit.mutate({ dayId: day.id, payload });
  };

  return (
    <div
      className="pt-2 mt-1 border-t border-surface-light/50 space-y-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      {day.workout_description && (
        <p className="text-[11px] text-foreground/80 whitespace-pre-wrap">{day.workout_description}</p>
      )}

      {/* Strength exercise table */}
      {day.sport === 'strength' && day.planned_exercises && day.planned_exercises.length > 0 && (
        <div className="overflow-x-auto -mx-1">
        <table className="w-full text-[9px] text-muted">
          <thead>
            <tr className="text-left">
              <th className="font-medium">Exercise</th>
              <th className="font-medium">Sets×Reps</th>
              <th className="font-medium">kg</th>
              <th className="font-medium">RPE</th>
            </tr>
          </thead>
          <tbody>
            {day.planned_exercises.map((ex, i) => (
              <tr key={`${ex.exercise}-${i}`} className="border-t border-surface-light/30">
                <td className="py-0.5 text-foreground/90 truncate max-w-[80px]" title={ex.exercise}>
                  {ex.exercise}
                </td>
                <td className="py-0.5">
                  {ex.sets}×{ex.reps}
                </td>
                <td className="py-0.5">
                  {ex.weight_kg != null ? ex.weight_kg : '—'}
                  {(() => {
                    const hint = autoMap.get((ex.exercise ?? '').toLowerCase());
                    if (!hint || hint.suggestedWeightKg == null || hint.deltaKg === 0) return null;
                    return (
                      <span className="text-accent" title={hint.reason}>
                        {' '}→{hint.suggestedWeightKg}
                      </span>
                    );
                  })()}
                </td>
                <td className="py-0.5">{ex.rpe != null ? ex.rpe : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {/* Cycle power targets */}
      {day.sport === 'cycle' && (day.planned_power_watts != null || day.planned_zone) && (
        <p className="text-[10px] text-muted">
          Targets:{' '}
          {[
            day.planned_power_watts != null && `${Math.round(day.planned_power_watts)}W`,
            day.planned_zone && day.planned_zone.toUpperCase(),
          ]
            .filter(Boolean)
            .join(' · ') || '—'}
        </p>
      )}

      {/* Route assignment (cycle days only) */}
      {day.sport === 'cycle' && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-muted uppercase tracking-wide">
            Route
          </p>
          {day.actual_activity?.route_id ? (
            <div className="flex items-center gap-2">
              <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-positive/15 text-positive border border-positive/30 truncate">
                {day.actual_activity.route_name || 'Linked route'}
              </span>
            </div>
          ) : day.planned_route_id ? (
            <div className="flex items-center gap-2">
              <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-positive/15 text-positive border border-positive/30 truncate">
                {day.route_matches?.find(m => m.route_id === day.planned_route_id)?.name || 'Route assigned'}
              </span>
              <button
                onClick={onOpenRoutePicker}
                className="text-[10px] text-accent hover:text-accent/80 shrink-0"
              >
                Change
              </button>
              <button
                onClick={onUnassignRoute}
                disabled={busy}
                className="text-[10px] text-warning hover:text-warning/80 disabled:opacity-50 shrink-0"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenRoutePicker}
              className="text-[10px] text-accent hover:text-accent/80"
            >
              <MapPin className="w-3 h-3 mr-1" /> Pick a route...
            </button>
          )}
        </div>
      )}

      {/* Wahoo push (cycle days only) */}
      {day.sport === 'cycle' && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-muted uppercase tracking-wide">
            Wahoo
          </p>
          {day.wahoo_pushed_at ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30">
                Pushed {new Date(day.wahoo_pushed_at).toLocaleDateString(getActiveLocale())}
                {day.wahoo_push_workout ? ' · workout' : ''}
                {day.wahoo_route_id ? ' · route' : ''}
              </span>
              <button
                onClick={onOpenWahooPush}
                className="text-[10px] text-accent hover:text-accent/80 shrink-0"
              >
                Manage
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenWahooPush}
              className="text-[10px] text-accent hover:text-accent/80"
            >
              <Upload className="w-3 h-3 inline mr-1" /> Push to Wahoo
            </button>
          )}
        </div>
      )}

      {/* Phase 2 plan → goal cross-links: active goals this day supports. */}
      {dayGoals.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted uppercase tracking-wide">
            Supports goals
          </p>
          {dayGoals.map((g) => {
            const progress = goalProgressPct(g);
            return (
              <Link
                key={g.id}
                href="/goals"
                title={`View ${goalShortLabel(g)} in goals`}
                className="flex min-h-[44px] items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-surface-light/40 transition-colors"
              >
                <Target className="w-3 h-3 text-accent" aria-hidden="true" />
                <span className="text-xs text-foreground truncate">{goalShortLabel(g)}</span>
                <span className="text-xs text-muted tabular-nums shrink-0">{progress.toFixed(0)}%</span>
                <span className="ml-auto text-accent text-xs shrink-0" aria-hidden="true">→</span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Notes */}
      {day.notes && !notes && <p className="text-[11px] text-muted italic">{day.notes}</p>}

       {/* Quick edit (cycle days only — strength/week view is read-only for metrics) */}
      {day.sport === 'cycle' && (
        <div className="flex gap-1">
          <label className="block flex-1">
            <span className="block text-[9px] text-muted mb-0.5">Min</span>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-full px-1 py-0.5 bg-background border border-surface-light rounded text-foreground text-[10px] focus:outline-none focus:border-accent"
            />
          </label>
          <label className="block flex-1">
            <span className="block text-[9px] text-muted mb-0.5">TSS</span>
            <input
              type="number"
              value={tss}
              onChange={(e) => setTss(e.target.value)}
              className="w-full px-1 py-0.5 bg-background border border-surface-light rounded text-foreground text-[10px] focus:outline-none focus:border-accent"
            />
          </label>
        </div>
      )}
       {/* Notes (all sport types) */}
       <input
        type="text"
        placeholder="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="w-full px-1 py-0.5 bg-background border border-surface-light rounded text-foreground text-[10px] focus:outline-none focus:border-accent"
      />
      <button
        onClick={handleSave}
        disabled={busy}
        className="w-full px-2 py-1 bg-accent/20 text-accent rounded text-[10px] font-medium hover:bg-accent/30 disabled:opacity-50"
      >
        {instantEdit.isPending ? 'Saving…' : 'Save'}
      </button>

      {/* Phase 5C — plan-vs-actual conformity scoring for this day.
          Mounted only while expanded → lazy query runs on open. */}
      <DayConformityPanel planId={planId} day={day} />
    </div>
  );
}
