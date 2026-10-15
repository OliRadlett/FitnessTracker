'use client';

/**
 * ProgramMatrix — exercises × weeks for the plan's strength work (S2).
 *
 * The primary surface for multi-week strength targets: rows are exercises
 * (union across the plan's weeks), columns are weeks, each cell the prescribed
 * sets×reps@RPE and weight. Editing a cell writes that week's day entry through
 * `useInstantDayEdit`; "Suggest weights" (S1) shows ghost proposals that
 * "Apply" writes, and "Materialise" fills cells from the plan's stored
 * progression rules. Manual entries are never overwritten by a suggestion.
 */

import React, { useMemo, useState } from 'react';
import { Check, Wand2 } from 'lucide-react';

import type {
  PlannedExercise,
  ProgressionApplyTarget,
  ProgressionTarget,
  TrainingPlan,
  TrainingPlanDay,
} from '@/lib/api';
import {
  applyStrengthProgression,
  materialiseProgression,
  suggestStrengthProgression,
  useAuthFetch,
} from '@/lib/api';
import { diffDays, getTotalWeeks, getWeek1Start } from '@/lib/training/week';
import { useInstantDayEdit } from '@/lib/training/useInstantDayEdit';
import { useToast } from '@/components/ui/Toast';

interface Cell {
  day: TrainingPlanDay;
  index: number;
  entry: PlannedExercise;
}

export interface ProgramMatrixProps {
  plan: TrainingPlan;
}

export function ProgramMatrix({ plan }: ProgramMatrixProps) {
  const { authFetch, token } = useAuthFetch();
  const edit = useInstantDayEdit(plan.id, null);
  const { error: toastError, success } = useToast();

  const [suggestions, setSuggestions] = useState<Map<string, ProgressionTarget>>(new Map());
  const [selected, setSelected] = useState<{ exercise: string; week: number } | null>(null);
  const [busy, setBusy] = useState<null | 'suggest' | 'apply' | 'materialise'>(null);

  const totalWeeks = getTotalWeeks(plan.start_date, plan.end_date);
  const week1 = getWeek1Start(plan.start_date);

  // exercise → weekIndex → cell
  const grid = useMemo(() => {
    const m = new Map<string, Map<number, Cell>>();
    for (const day of plan.days ?? []) {
      if (day.sport !== 'strength') continue;
      const wi = Math.floor(diffDays(week1, day.day_date.slice(0, 10)) / 7);
      (day.planned_exercises ?? []).forEach((entry, index) => {
        if (!entry.exercise) return;
        if (!m.has(entry.exercise)) m.set(entry.exercise, new Map());
        m.get(entry.exercise)!.set(wi, { day, index, entry });
      });
    }
    return m;
  }, [plan.days, week1]);

  const exercises = useMemo(() => [...grid.keys()].sort(), [grid]);

  const cellKey = (dayId: string, index: number) => `${dayId}:${index}`;

  const runSuggest = async () => {
    if (!token) return;
    setBusy('suggest');
    try {
      const res = await suggestStrengthProgression(authFetch, plan.id, { scope: 'plan' });
      const m = new Map<string, ProgressionTarget>();
      for (const t of res.targets) m.set(cellKey(t.day_id, t.exercise_index), t);
      setSuggestions(m);
      const proposed = res.targets.filter((t) => t.weight_kg != null).length;
      success?.(`${proposed} suggestion${proposed === 1 ? '' : 's'}`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Could not suggest weights');
    } finally {
      setBusy(null);
    }
  };

  const runApply = async () => {
    const targets: ProgressionApplyTarget[] = [];
    for (const t of suggestions.values()) {
      if (t.weight_kg != null && !t.skipped_reason) {
        targets.push({
          day_id: t.day_id,
          exercise_index: t.exercise_index,
          weight_kg: t.weight_kg,
          pct_1rm: t.pct_1rm ?? null,
        });
      }
    }
    if (targets.length === 0) {
      toastError('Nothing to apply — run “Suggest weights” first.');
      return;
    }
    setBusy('apply');
    try {
      const res = await applyStrengthProgression(authFetch, plan.id, { targets });
      success?.(`Applied ${res.applied.length} weight${res.applied.length === 1 ? '' : 's'}`);
      setSuggestions(new Map());
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Could not apply weights');
    } finally {
      setBusy(null);
    }
  };

  const runMaterialise = async () => {
    setBusy('materialise');
    try {
      const res = await materialiseProgression(authFetch, plan.id, { mode: 'fill-empty' });
      success?.(
        res.entries_updated.length > 0
          ? `Filled ${res.entries_updated.length} cell${res.entries_updated.length === 1 ? '' : 's'}`
          : 'No cells to fill (no rules, or all set)',
      );
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Could not materialise targets');
    } finally {
      setBusy(null);
    }
  };

  const patchCell = (cell: Cell, patch: Partial<PlannedExercise>) => {
    const list = [...(cell.day.planned_exercises ?? [])];
    list[cell.index] = { ...list[cell.index], ...patch };
    edit.mutate({ dayId: cell.day.id, payload: { planned_exercises: list } });
  };

  if (exercises.length === 0) {
    return (
      <p className="text-sm text-muted italic">
        No strength work in this plan — the Program matrix shows exercises across weeks.
      </p>
    );
  }

  const sel = selected ? grid.get(selected.exercise)?.get(selected.week) ?? null : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={runSuggest}
          disabled={busy !== null}
          className="px-3 py-1.5 text-xs rounded-lg bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 disabled:opacity-50 inline-flex items-center gap-1"
        >
          <Wand2 className="w-3 h-3" /> {busy === 'suggest' ? 'Suggesting…' : 'Suggest weights'}
        </button>
        <button
          onClick={runApply}
          disabled={busy !== null || suggestions.size === 0}
          className="px-3 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent/80 disabled:opacity-40 inline-flex items-center gap-1"
        >
          <Check className="w-3 h-3" /> Apply suggestions
        </button>
        <button
          onClick={runMaterialise}
          disabled={busy !== null}
          className="px-3 py-1.5 text-xs rounded-lg bg-surface-light/50 text-muted hover:text-foreground disabled:opacity-40"
        >
          {busy === 'materialise' ? 'Filling…' : 'Fill from rules'}
        </button>
        <span className="text-[10px] text-muted ml-auto">
          Ghost values are suggestions; manual weights are never overwritten.
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1.5 pr-3 font-medium sticky left-0 bg-background">Exercise</th>
              {Array.from({ length: totalWeeks }, (_, i) => (
                <th key={i} className="py-1.5 px-2 font-medium whitespace-nowrap">
                  W{i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {exercises.map((ex) => (
              <tr key={ex} className="border-t border-surface-light/40">
                <td className="py-1.5 pr-3 text-foreground truncate max-w-[10rem] sticky left-0 bg-background" title={ex}>
                  {ex}
                </td>
                {Array.from({ length: totalWeeks }, (_, wi) => {
                  const cell = grid.get(ex)?.get(wi);
                  if (!cell) return <td key={wi} className="py-1.5 px-2 text-muted/40">·</td>;
                  const sug = suggestions.get(cellKey(cell.day.id, cell.index));
                  const isSel = selected?.exercise === ex && selected.week === wi;
                  return (
                    <td key={wi} className="py-1.5 px-2">
                      <button
                        onClick={() => setSelected(isSel ? null : { exercise: ex, week: wi })}
                        className={`text-left rounded px-1.5 py-0.5 transition-colors ${
                          isSel ? 'bg-accent/15 ring-1 ring-accent/40' : 'hover:bg-surface-light/40'
                        }`}
                        title={`${cell.day.day_date.slice(0, 10)} · ${cell.entry.exercise}`}
                      >
                        <span className="block text-foreground whitespace-nowrap">
                          {cell.entry.sets}×{cell.entry.reps}
                          {cell.entry.rpe != null && ` @${cell.entry.rpe}`}
                        </span>
                        <span className="block text-muted whitespace-nowrap">
                          {cell.entry.weight_kg != null ? `${cell.entry.weight_kg}kg` : '—'}
                          {cell.entry.weight_source === 'manual' && (
                            <span className="text-[9px] text-accent ml-1">manual</span>
                          )}
                          {sug?.weight_kg != null && !sug.skipped_reason && (
                            <span className="text-[9px] text-accent ml-1">→{sug.weight_kg}</span>
                          )}
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cell editor */}
      {sel && selected && (
        <div className="rounded-lg border border-accent/30 bg-surface-light/20 p-3 space-y-2">
          <p className="text-xs text-foreground font-medium">
            {selected.exercise} · {sel.day.day_date.slice(0, 10)}
            {(() => {
              const sug = suggestions.get(cellKey(sel.day.id, sel.index));
              if (!sug) return null;
              const why = sug.skipped_reason
                ? `skipped: ${sug.skipped_reason}`
                : `${sug.basis_source ?? '—'}${sug.basis_date ? ` · ${sug.basis_date}` : ''}${
                    sug.basis_1rm_kg != null ? ` · e1RM ${sug.basis_1rm_kg}kg` : ''
                  }`;
              return <span className="ml-2 text-[10px] text-muted">suggestion basis: {why}</span>;
            })()}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            {(
              [
                ['sets', sel.entry.sets, 1],
                ['reps', sel.entry.reps, 1],
                ['rpe', sel.entry.rpe ?? '', 0.5],
                ['weight_kg', sel.entry.weight_kg ?? '', 2.5],
              ] as const
            ).map(([field, value, step]) => (
              <label key={field} className="text-[10px] text-muted">
                <span className="block mb-0.5">{field === 'weight_kg' ? 'kg' : field}</span>
                <input
                  type="number"
                  step={step}
                  min={field === 'weight_kg' || field === 'sets' || field === 'reps' ? 0 : 1}
                  value={value as number | string}
                  onChange={(e) => {
                    const v = e.target.value === '' ? null : parseFloat(e.target.value);
                    patchCell(
                      sel,
                      field === 'weight_kg'
                        ? { weight_kg: v, weight_source: v != null ? 'manual' : null }
                        : ({ [field]: v } as Partial<PlannedExercise>),
                    );
                  }}
                  className="w-20 px-2 py-1 bg-background border border-surface-light rounded text-foreground text-xs focus:outline-none focus:border-accent"
                  aria-label={`${selected.exercise} ${field}`}
                />
              </label>
            ))}
            <button
              onClick={() => setSelected(null)}
              className="ml-auto text-xs text-muted hover:text-foreground px-2 py-1"
            >
              Close
            </button>
          </div>
          <p className="text-[10px] text-muted">
            Editing kg marks the entry <span className="text-accent">manual</span> — suggestions and refresh-targets
            will leave it alone.
          </p>
        </div>
      )}
    </div>
  );
}
