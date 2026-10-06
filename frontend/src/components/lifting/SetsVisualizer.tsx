'use client';

import React, { useMemo } from 'react';
import type { LiftingSet } from '@/lib/api';
import { brzycki1rm } from '@/lib/lifting/reference';
import { SectionLabel } from '@/components/ui/SectionLabel';

/** Bar colour for a set's RPE — green on-target, amber grinding, red maximal. */
export function rpeBarColor(rpe: number | undefined): string {
  if (rpe == null) return 'bg-muted/40';
  if (rpe <= 7) return 'bg-positive/70';
  if (rpe < 9) return 'bg-warning/70';
  return 'bg-red-500/80';
}

export interface VizSet {
  set: LiftingSet;
  /** This set's Brzycki e1RM as a % of the stored 1RM basis, if known. */
  pctOfBasis: number | null;
}

export interface VizGroup {
  name: string;
  sets: VizSet[];
  maxWeight: number;
  /** Best set e1RM in the group, if computable. */
  bestE1rm: number | null;
}

/** Group sets by exercise, preserving first-appearance order. */
export function groupForViz(
  sets: LiftingSet[],
  e1rmByExercise: Map<string, number>,
): VizGroup[] {
  const order: string[] = [];
  const byName = new Map<string, LiftingSet[]>();
  for (const s of sets) {
    if (!byName.has(s.exercise_name)) {
      byName.set(s.exercise_name, []);
      order.push(s.exercise_name);
    }
    byName.get(s.exercise_name)!.push(s);
  }
  return order.map((name) => {
    const groupSets = byName.get(name)!;
    const basis = e1rmByExercise.get(name);
    let bestE1rm: number | null = null;
    const vizSets = groupSets.map((set) => {
      const e1rm = brzycki1rm(set.weight_kg, set.reps);
      if (e1rm != null && (bestE1rm == null || e1rm > bestE1rm)) bestE1rm = e1rm;
      return {
        set,
        pctOfBasis: e1rm != null && basis != null && basis > 0 ? (e1rm / basis) * 100 : null,
      };
    });
    return {
      name,
      sets: vizSets,
      maxWeight: Math.max(...groupSets.map((s) => s.weight_kg), 0),
      bestE1rm,
    };
  });
}

/**
 * Set review — the data-porn layer of the session detail. Per-exercise bar
 * chart of working loads with RPE colours and % of stored-1RM markers.
 * Read-only: all logging/editing lives in the table below and the floating
 * quick-add bar, deliberately separated from this review zone.
 */
export function SetsVisualizer({
  sets,
  e1rmByExercise,
}: {
  sets: LiftingSet[];
  e1rmByExercise: Map<string, number>;
}) {
  const groups = useMemo(() => groupForViz(sets, e1rmByExercise), [sets, e1rmByExercise]);
  if (groups.length === 0) return null;

  return (
    <div>
      <SectionLabel count={groups.length}>Set review</SectionLabel>
      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.name} className="p-3 bg-surface-light/20 rounded-lg">
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <p className="text-sm font-medium text-foreground truncate">{group.name}</p>
              {group.bestE1rm != null && (
                <p className="text-xs text-muted shrink-0">
                  best ~{group.bestE1rm.toFixed(1)} kg e1RM
                </p>
              )}
            </div>
            <div className="flex items-end gap-1.5" role="img" aria-label={`${group.name} set chart`}>
              {group.sets.map(({ set, pctOfBasis }) => {
                const heightPct =
                  group.maxWeight > 0 ? Math.max(8, (set.weight_kg / group.maxWeight) * 100) : 8;
                return (
                  <div key={set.id} className="flex-1 min-w-0 flex flex-col items-center gap-1">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${rpeBarColor(set.rpe)}`}
                      title={set.rpe != null ? `RPE ${set.rpe}` : 'No RPE logged'}
                    />
                    <div
                      className={`w-full rounded-t ${set.is_warmup ? 'bg-muted/30' : 'bg-accent/60'}`}
                      style={{ height: `${(heightPct / 100) * 96}px` }}
                      title={`${set.weight_kg} kg × ${set.reps}${set.rpe != null ? ` @${set.rpe}` : ''}${pctOfBasis != null ? ` · ${pctOfBasis.toFixed(0)}% of 1RM` : ''}`}
                    />
                    <span className="text-[10px] text-muted tabular-nums">{set.reps}</span>
                    {set.is_amrap && (
                      <span className="-mt-0.5 text-[9px] font-medium text-accent">AMRAP</span>
                    )}
                    {pctOfBasis != null ? (
                      <span
                        className={`text-[10px] tabular-nums ${
                          pctOfBasis >= 100 ? 'text-positive font-medium' : 'text-muted/70'
                        }`}
                      >
                        {pctOfBasis.toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted/70 tabular-nums">{set.weight_kg}</span>
                    )}
                  </div>
                );
              })}
            </div>
            {group.sets.some((s) => s.set.is_warmup) && (
              <p className="text-[11px] text-muted/70 mt-1.5">Faded bars are warm-up sets.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
