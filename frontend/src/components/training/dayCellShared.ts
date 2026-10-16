'use client';

/**
 * Shared constants + helpers for rendering a plan day cell (V3).
 *
 * Extracted from WeeklyView so both the weekly grid (WeekMasterBar) and the
 * day cell (DayCell) can share one source of truth for sport icons, day-type
 * badges, status derivation and small formatters.
 */

import React from 'react';
import { Dumbbell, Bike, Bed } from 'lucide-react';
import type { PlanDayType, TrainingWeekDay } from '@/lib/api';

// ─── Constants ────────────────────────────────────────────────────────────

export const SPORT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  cycle: Bike,
  strength: Dumbbell,
  rest: Bed,
};

export const DAY_TYPE_BADGES: Record<string, string> = {
  rest: 'bg-surface-light/20 text-muted border-muted/30',
  easy: 'bg-green-500/15 text-green-300 border-green-500/30',
  moderate: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  hard: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  race: 'bg-red-500/15 text-red-300 border-red-500/30',
};

export const FOCUS_LABELS: Record<string, string> = {
  squat: 'Squat',
  bench: 'Bench',
  deadlift: 'Deadlift',
  overhead_press: 'Overhead Press',
  accessories: 'Accessories',
  full_body: 'Full Body',
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  upper: 'Upper',
  lower: 'Lower',
};

/** Day-type options for the editor's type select. */
export const DAY_TYPES: PlanDayType[] = ['rest', 'easy', 'moderate', 'hard', 'race'];

/** Strength-focus options for the editor's session-type select. */
export const FOCUS_OPTIONS = [
  { value: 'squat', label: 'Squat' },
  { value: 'bench', label: 'Bench' },
  { value: 'deadlift', label: 'Deadlift' },
  { value: 'overhead_press', label: 'Overhead Press' },
  { value: 'accessories', label: 'Accessories' },
  { value: 'full_body', label: 'Full Body' },
  { value: 'push', label: 'Push' },
  { value: 'pull', label: 'Pull' },
  { value: 'legs', label: 'Legs' },
  { value: 'upper', label: 'Upper' },
  { value: 'lower', label: 'Lower' },
] as const;

// ─── Status ───────────────────────────────────────────────────────────────

export type DayStatus = 'done' | 'planned' | 'missed' | 'neutral' | 'partial';

/** Status from backend day_status field, falling back to local heuristic. */
export function getStatus(day: TrainingWeekDay, todayStr: string): DayStatus {
  // Prefer backend-computed day_status when available
  if (day.day_status) {
    switch (day.day_status) {
      case 'completed': return 'done';
      case 'partial': return 'partial';
      case 'missed': return 'missed';
      case 'rest': return day.day_date >= todayStr ? 'planned' : 'neutral';
      case 'pending': return 'planned';
    }
  }
  // Fallback to local heuristic
  if (day.actual_activity || day.actual_lifting_session || day.completed) return 'done';
  if (day.sport === 'rest') return day.day_date >= todayStr ? 'planned' : 'neutral';
  if (day.day_date >= todayStr) return 'planned';
  return 'missed';
}

export const STATUS_LABEL: Record<DayStatus, string> = {
  done: 'Done',
  planned: 'Planned',
  missed: 'Missed',
  neutral: '—',
  partial: 'Partial',
};

/** Short sport label for a session header ("Ride", "Strength"). */
export const SPORT_LABEL: Record<string, string> = {
  cycle: 'Ride',
  strength: 'Strength',
  rest: 'Rest',
};

/**
 * Card status for a date holding 1..N sessions — the worst session wins.
 *
 * A single session is the degenerate case and returns exactly what
 * ``getStatus`` gives it, so one-session cards are unchanged by the
 * multi-sport model.
 */
export function getCellStatus(sessions: TrainingWeekDay[], todayStr: string): DayStatus {
  if (sessions.length === 0) return 'neutral';
  const statuses = sessions.map((s) => getStatus(s, todayStr));
  const worstFirst: DayStatus[] = ['missed', 'partial', 'planned', 'done', 'neutral'];
  return worstFirst.find((s) => statuses.includes(s)) ?? 'neutral';
}

/**
 * Phase 5C — map the card heuristic onto conformity badge statuses.
 * Rest days render nothing; future days are "pending"; past unlogged days
 * "missed"; logged/completed days "done" (score appears once the backend
 * has scored them via the expanded panel).
 */
export function getBadgeStatus(day: TrainingWeekDay | undefined, status: DayStatus): string {
  if (!day || day.sport === 'rest') return 'rest';
  if (status === 'done') return 'done';
  if (status === 'partial') return 'partial';
  if (status === 'missed') return 'missed';
  return 'pending';
}

// ─── Small formatters ─────────────────────────────────────────────────────

/** Weight with a tonne rollover above 1000 kg. */
export function fmtKg(v: number | null | undefined): string {
  if (v == null) return '—';
  return v >= 1000 ? `${(v / 1000).toFixed(1)}t` : `${Math.round(v)}kg`;
}
