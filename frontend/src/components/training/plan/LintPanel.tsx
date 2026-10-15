'use client';

/**
 * LintPanel — non-blocking programming notes over the plan (S4).
 *
 * Surfaces `lintPlan` findings (back-to-back hard days, lower-body strength
 * before a long ride, a too-steep weekly TSS ramp, long training streaks) as a
 * quiet warnings list. Renders nothing when the plan is clean.
 */

import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';

import type { TrainingPlan } from '@/lib/api';
import { lintPlan } from '@/lib/training/coaching';

export function LintPanel({ plan }: { plan: TrainingPlan }) {
  const findings = lintPlan(plan);
  if (findings.length === 0) return null;

  return (
    <div className="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 space-y-1">
      <p className="text-[10px] font-medium text-warning uppercase tracking-wide">Programming notes</p>
      {findings.map((f, i) => (
        <p key={i} className="text-[11px] text-warning/90 flex gap-1.5">
          {f.level === 'warning' ? (
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
          ) : (
            <Info className="w-3 h-3 shrink-0 mt-0.5" />
          )}
          <span>{f.message}</span>
        </p>
      ))}
    </div>
  );
}
