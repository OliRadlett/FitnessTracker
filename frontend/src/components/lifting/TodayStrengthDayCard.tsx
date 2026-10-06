'use client';

import React from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useTodaysStrengthDay } from '@/lib/training/useTodaysStrengthDay';
import { CalendarCheck, Dumbbell } from 'lucide-react';

/**
 * "Today's Strength Day" — the active plan's uncompleted strength day for
 * today, with programmed sets/reps/loads. Read-only: tapping through to
 * Live Lift offers the "Load from today's plan" chip there.
 * Renders nothing when there is no strength day today.
 */
export function TodayStrengthDayCard() {
  const { data, isLoading } = useTodaysStrengthDay();
  if (isLoading || !data) return null;
  const { planName, planDay } = data;
  const exercises = planDay.planned_exercises ?? [];
  if (exercises.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle>
            <span className="inline-flex items-center gap-1.5">
              <CalendarCheck className="w-4 h-4" aria-hidden />
              Today&apos;s Strength Day
            </span>
          </CardTitle>
          <Badge variant="lifting" className="text-[11px]">
            {planName}
          </Badge>
        </div>
      </CardHeader>
      {planDay.planned_focus && (
        <p className="text-xs text-muted mb-3">
          Focus: <span className="text-foreground font-medium">{planDay.planned_focus}</span>
          {planDay.planned_rpe != null && (
            <span> · target RPE {planDay.planned_rpe}</span>
          )}
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-3">
        {exercises.map((ex, i) => (
          <div key={`${ex.exercise}-${i}`} className="p-3 bg-surface-light/30 rounded-lg">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-foreground truncate flex items-center gap-1.5">
                <Dumbbell className="w-3.5 h-3.5 text-muted shrink-0" aria-hidden />
                {ex.exercise}
              </p>
              <p className="text-sm font-mono font-bold text-foreground shrink-0">
                {ex.weight_kg != null ? `${ex.weight_kg}kg` : `${ex.sets}×${ex.reps}`}
              </p>
            </div>
            <p className="text-xs text-muted mt-0.5">
              {ex.weight_kg != null
                ? `${ex.sets} sets × ${ex.reps} reps`
                : 'Load TBD'}
              {ex.target_rpe != null && ` · RPE ${ex.target_rpe}`}
              {ex.pct_1rm != null && ` · ${Math.round(ex.pct_1rm * 100)}% 1RM`}
            </p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/lifting/live"
          className="px-4 py-2 min-h-[44px] inline-flex items-center bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
        >
          Start Live Session →
        </Link>
        <Link
          href="/training"
          className="px-4 py-2 min-h-[44px] inline-flex items-center text-muted hover:text-foreground text-sm transition-colors"
        >
          View plan
        </Link>
      </div>
    </Card>
  );
}
