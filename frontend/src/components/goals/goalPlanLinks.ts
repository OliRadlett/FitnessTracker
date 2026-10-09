'use client';

// ─── Goal ↔ plan-day cross-links (ui-redesign-v2 Phase 2) ────────────────────
// Links only: no data-model / API / computation changes. These pure helpers
// match already-fetched Goal + TrainingPlanDay objects (display-only
// relevance, same spirit as the sport cross-links on GoalCard) and build the
// deep-link URLs the training page + goal surfaces navigate with:
//
//   goal card  →  /training?plan=<planId>&day=<YYYY-MM-DD>  (plan day)
//   plan day   →  /goals                                     (goal list)
//
// The `?plan=` / `?day=` params are read by `training/page.tsx` (plan select +
// week view) and `WeeklyView` (week jump + highlight/scroll). They extend the
// existing `useDeepLink` fabric (`?activity=` / `?session=` / `?route=` /
// `?tab=`) — those params are never written here, only preserved.

import type { Goal, TrainingPlanDay } from '@/lib/api';

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();

function tokens(s: string): string[] {
  return norm(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

/** Exercise filter from `filter_json.exercise` (e.g. "Back Squat"), if any. */
export function goalExerciseFilter(goal: Goal): string | null {
  const ex = goal.filter_json?.exercise?.trim();
  return ex ? ex : null;
}

/** Sport filter from `filter_json.sport` (e.g. "strength"), if any. */
export function goalSportFilter(goal: Goal): string | null {
  const sport = goal.filter_json?.sport?.trim().toLowerCase();
  return sport ? sport : null;
}

function isLiftingMetric(metric: string): boolean {
  const m = norm(metric);
  if (m.includes('1rm') || m.includes('volume') || m.includes('big3') || m.includes('bw_ratio')) {
    return true;
  }
  return false;
}

function isCyclingMetric(metric: string): boolean {
  const m = norm(metric);
  if (m.includes('ftp') || m.includes('power') || m.includes('vo2max')) return true;
  return false;
}

/**
 * Whether a plan day is relevant to a goal (display-only relevance for
 * linking — never a training prescription):
 * - exercise-scoped goal → strength days programming that exercise
 *   (case-insensitive substring either way, so "Squat" finds "Back Squat"
 *   and vice versa) or sharing a focus word with it;
 * - strength-scoped / lifting-metric goal → any strength day;
 * - cycling-scoped / cycling-metric goal → any cycle day;
 * - anything else (e.g. generic weekly-sessions) → any training day.
 * Rest days never match.
 */
export function dayMatchesGoal(goal: Goal, day: TrainingPlanDay): boolean {
  if (day.sport === 'rest') return false;
  const exercise = goalExerciseFilter(goal);
  const sport = goalSportFilter(goal);

  if (exercise) {
    if (day.sport !== 'strength') return false;
    const needle = norm(exercise);
    const hit = (day.planned_exercises ?? []).some((e) => {
      const name = norm(e.exercise);
      return !!name && (name.includes(needle) || needle.includes(name));
    });
    if (hit) return true;
    const focusWords = tokens(day.planned_focus ?? '');
    if (focusWords.length > 0 && tokens(needle).some((w) => focusWords.includes(w))) {
      return true;
    }
    return false;
  }

  if (sport === 'strength' || (!sport && isLiftingMetric(goal.metric))) {
    return day.sport === 'strength';
  }
  if (sport === 'cycling' || (!sport && isCyclingMetric(goal.metric))) {
    return day.sport === 'cycle';
  }
  return day.sport === 'strength' || day.sport === 'cycle';
}

/**
 * Upcoming (today onward) plan days relevant to the goal, earliest first.
 * Past days are excluded — the link answers "what is scheduled", not history.
 */
export function matchGoalPlanDays(
  goal: Goal,
  days: TrainingPlanDay[],
  todayStr: string,
): TrainingPlanDay[] {
  return days
    .filter((d) => (d.day_date ?? '').slice(0, 10) >= todayStr && dayMatchesGoal(goal, d))
    .sort((a, b) => a.day_date.localeCompare(b.day_date));
}

/** Short human label for a goal — exercise name wins over the metric label. */
export function goalShortLabel(goal: Goal): string {
  return goal.filter_json?.exercise || goal.metric_label || goal.metric;
}

/**
 * Card copy for a goal's scheduled plan days, e.g. "3 push days",
 * "2 Back Squat sessions", "4 rides", "5 sessions". Strength matches dominated
 * (≥ half) by one focus read as "<focus> days" — the plan's own vocabulary.
 */
export function describePlanMatch(goal: Goal, matched: TrainingPlanDay[]): string {
  const count = matched.length;
  const noun = count === 1 ? '' : 's';
  const exercise = goalExerciseFilter(goal);
  const sport = goalSportFilter(goal);

  if (matched.every((d) => d.sport === 'cycle') && (sport === 'cycling' || isCyclingMetric(goal.metric))) {
    return `${count} ride${noun}`;
  }
  if (matched.some((d) => d.sport === 'strength')) {
    const focuses = matched
      .map((d) => norm(d.planned_focus))
      .filter((f) => f && f !== 'rest');
    if (focuses.length > 0) {
      const counts = new Map<string, number>();
      for (const f of focuses) counts.set(f, (counts.get(f) ?? 0) + 1);
      const [top, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      // Strict majority — a tied split falls back to the exercise name below
      // instead of naming the wrong focus.
      if (topCount > matched.length / 2) {
        return `${count} ${top.replace(/_/g, ' ')} day${noun}`;
      }
    }
    if (exercise) return `${count} ${exercise} session${noun}`;
    return `${count} strength day${noun}`;
  }
  if (exercise) return `${count} ${exercise} session${noun}`;
  return `${count} session${noun}`;
}

/** Deep link to one plan day: selects the plan, opens the week view there. */
export function buildPlanDayHref(planId: string, dayDate: string): string {
  return `/training?plan=${encodeURIComponent(planId)}&day=${encodeURIComponent(dayDate.slice(0, 10))}`;
}

/** Deep link to a plan (no day): selects the plan, keeps the current view. */
export function buildPlanHref(planId: string): string {
  return `/training?plan=${encodeURIComponent(planId)}`;
}

/** Active goals relevant to one plan day, for the plan → goal direction. */
export function goalsForPlanDay(goals: Goal[], day: TrainingPlanDay): Goal[] {
  return goals.filter((g) => g.status === 'active' && dayMatchesGoal(g, day));
}
