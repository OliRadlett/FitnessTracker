'use client';

/**
 * BlockTools — macro operations over a week (S3).
 *
 *   - Duplicate this week to a range (copy-to-date per day; no full-array save)
 *   - Deload this week (−1 RPE, −10% load on strength entries, marked manual)
 *   - Bulk-edit the week (all cycle days → type; all strength days → target RPE)
 *
 * Every write goes through `useInstantDayEdit` (targeted PATCH) or the existing
 * copy-to-date endpoint, so nothing touches the destructive full-array path.
 */

import React, { useState } from 'react';
import { Copy, Layers, TrendingDown } from 'lucide-react';

import type { TrainingWeekDay } from '@/lib/api';
import { copyPlanDayToDate, useAuthFetch } from '@/lib/api';
import { addDays, getWeek1Start } from '@/lib/training/week';
import { useInstantDayEdit } from '@/lib/training/useInstantDayEdit';
import { useToast } from '@/components/ui/Toast';
import { DAY_TYPES } from '../dayCellShared';

/** Parse "3-6" / "3,5" / "4" into week numbers (deduped, 1-based). */
export function parseWeekRange(input: string): number[] {
  const out = new Set<number>();
  for (const part of input.split(',')) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1) out.add(i);
    } else if (/^\d+$/.test(p)) {
      const n = parseInt(p, 10);
      if (n >= 1) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

export interface BlockToolsProps {
  planId: string;
  /** Visible week (1-based) — the source for duplicate, the target for deload/bulk. */
  week: number;
  planStart: string;
  weekDays: TrainingWeekDay[];
  onDone?: () => void;
}

export function BlockTools({ planId, week, planStart, weekDays, onDone }: BlockToolsProps) {
  const { authFetch } = useAuthFetch();
  const edit = useInstantDayEdit(planId, week);
  const { error: toastError, success } = useToast();

  const [open, setOpen] = useState(false);
  const [range, setRange] = useState('');
  const [bulkType, setBulkType] = useState('easy');
  const [bulkRpe, setBulkRpe] = useState('7');
  const [busy, setBusy] = useState(false);

  const week1 = getWeek1Start(planStart);
  const srcStart = addDays(week1, (week - 1) * 7);

  const duplicate = async () => {
    const weeks = parseWeekRange(range).filter((w) => w !== week);
    if (weeks.length === 0) {
      toastError('Enter target weeks, e.g. 3-6');
      return;
    }
    setBusy(true);
    try {
      for (const w of weeks) {
        const tgtStart = addDays(week1, (w - 1) * 7);
        for (let i = 0; i < 7; i++) {
          const srcDate = addDays(srcStart, i);
          const srcs = weekDays.filter((d) => d.day_date.slice(0, 10) === srcDate);
          for (const src of srcs) {
            await copyPlanDayToDate(authFetch, planId, src.id, addDays(tgtStart, i));
          }
        }
      }
      success?.(`Copied week ${week} to ${weeks.length} week${weeks.length === 1 ? '' : 's'}`);
      onDone?.();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Could not copy the week');
    } finally {
      setBusy(false);
    }
  };

  const deload = () => {
    let touched = 0;
    for (const d of weekDays) {
      if (d.sport !== 'strength' || !d.planned_exercises?.length) continue;
      const list = d.planned_exercises.map((ex) => ({
        ...ex,
        rpe: ex.rpe != null ? Math.max(5, ex.rpe - 1) : ex.rpe,
        weight_kg: ex.weight_kg != null ? Math.round(ex.weight_kg * 0.9 * 2) / 2 : ex.weight_kg,
        // A deload is a deliberate reduction — keep it out of auto-refresh.
        weight_source: ex.weight_kg != null ? ('manual' as const) : ex.weight_source,
      }));
      edit.mutate({ dayId: d.id, payload: { planned_exercises: list } });
      touched += 1;
    }
    success?.(touched > 0 ? `Deload applied to ${touched} strength day${touched === 1 ? '' : 's'}` : 'No strength days this week');
  };

  const bulkCycleType = () => {
    for (const d of weekDays) {
      if (d.sport === 'cycle') edit.mutate({ dayId: d.id, payload: { planned_type: bulkType } });
    }
    success?.(`Cycle days set to ${bulkType}`);
  };

  const bulkStrengthRpe = () => {
    const rpe = parseFloat(bulkRpe);
    if (Number.isNaN(rpe)) {
      toastError('Enter a target RPE');
      return;
    }
    for (const d of weekDays) {
      if (d.sport === 'strength') edit.mutate({ dayId: d.id, payload: { planned_rpe: rpe } });
    }
    success?.(`Strength days set to RPE ${rpe}`);
  };

  return (
    <div className="rounded-lg border border-surface-light/50 bg-surface-light/20">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted hover:text-foreground"
      >
        <Layers className="w-3.5 h-3.5" />
        Block tools
        <span className="ml-auto">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          {/* Duplicate week → range */}
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[10px] text-muted">
              <span className="block mb-0.5">Copy week {week} to (e.g. 3-6)</span>
              <input
                type="text"
                value={range}
                onChange={(e) => setRange(e.target.value)}
                placeholder="3-6"
                className="w-28 px-2 py-1 bg-background border border-surface-light rounded text-foreground text-xs focus:outline-none focus:border-accent"
                aria-label="Target weeks"
              />
            </label>
            <button
              onClick={duplicate}
              disabled={busy}
              className="px-3 py-1.5 text-xs rounded-lg bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 disabled:opacity-50 inline-flex items-center gap-1"
            >
              <Copy className="w-3 h-3" /> {busy ? 'Copying…' : 'Copy week'}
            </button>
          </div>

          {/* Deload */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={deload}
              className="px-3 py-1.5 text-xs rounded-lg bg-warning/15 text-warning border border-warning/30 hover:bg-warning/25 inline-flex items-center gap-1"
            >
              <TrendingDown className="w-3 h-3" /> Make this week a deload
            </button>
            <span className="text-[10px] text-muted">−1 RPE, −10% load (kept manual)</span>
          </div>

          {/* Bulk edit */}
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[10px] text-muted">
              <span className="block mb-0.5">All cycle days → type</span>
              <select
                value={bulkType}
                onChange={(e) => setBulkType(e.target.value)}
                className="px-2 py-1 bg-background border border-surface-light rounded text-foreground text-xs"
                aria-label="Bulk cycle type"
              >
                {DAY_TYPES.filter((t) => t !== 'rest').map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={bulkCycleType}
              className="px-3 py-1.5 text-xs rounded-lg bg-surface-light/50 text-muted hover:text-foreground"
            >
              Apply to rides
            </button>
            <label className="text-[10px] text-muted">
              <span className="block mb-0.5">All strength days → RPE</span>
              <input
                type="number"
                min={1}
                max={10}
                step={0.5}
                value={bulkRpe}
                onChange={(e) => setBulkRpe(e.target.value)}
                className="w-20 px-2 py-1 bg-background border border-surface-light rounded text-foreground text-xs"
                aria-label="Bulk strength RPE"
              />
            </label>
            <button
              onClick={bulkStrengthRpe}
              className="px-3 py-1.5 text-xs rounded-lg bg-surface-light/50 text-muted hover:text-foreground"
            >
              Apply to lifts
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
