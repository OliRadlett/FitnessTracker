'use client';

/**
 * ZoneFlow pure helpers — "I have 1 hour, Z2" on-demand flow (ui-redesign-v2 §4.3).
 *
 * No hooks, no fetches: zone/duration option lists, match-score tone, TSS
 * estimation fallback, and the honest-empty copy for the no-match state.
 */

import type { RouteMatchItem, WorkoutPlanResponse } from '@/lib/api';

export interface ZoneOption {
  value: string;
  label: string;
  short: string;
}

export const ZONE_OPTIONS: ZoneOption[] = [
  { value: 'z1', label: 'Z1 · Recovery', short: 'Z1' },
  { value: 'z2', label: 'Z2 · Endurance', short: 'Z2' },
  { value: 'z3', label: 'Z3 · Tempo', short: 'Z3' },
  { value: 'z4', label: 'Z4 · Threshold', short: 'Z4' },
  { value: 'z5', label: 'Z5 · VO2max', short: 'Z5' },
];

export interface DurationOption {
  value: number;
  label: string;
}

export const DURATION_OPTIONS: DurationOption[] = [
  { value: 30, label: '30m' },
  { value: 45, label: '45m' },
  { value: 60, label: '1h' },
  { value: 90, label: '1h 30m' },
  { value: 120, label: '2h' },
  { value: 150, label: '2h 30m' },
  { value: 180, label: '3h' },
];

/** "POST /api/v1/workout-planner/match-routes" takes at most this many. */
export const ZONE_FLOW_MAX_RESULTS = 3;

export function zoneLabel(zone: string): string {
  return ZONE_OPTIONS.find((z) => z.value === zone)?.label ?? zone.toUpperCase();
}

export function durationLabel(minutes: number): string {
  return DURATION_OPTIONS.find((d) => d.value === minutes)?.label ?? `${minutes}m`;
}

/**
 * Estimated TSS for a route row (data maximalism: never blank).
 * Prefers the matcher's historical average, else scales the workout target's
 * mid-TSS by duration fit, else null (row shows "—" with an explanation).
 */
export function estimateTss(
  match: RouteMatchItem,
  plan: WorkoutPlanResponse | null,
): number | null {
  if (match.avg_tss != null) return Math.round(match.avg_tss);
  if (plan && match.avg_duration_min != null && match.avg_duration_min > 0) {
    const midTss = (plan.target_tss_low + plan.target_tss_high) / 2;
    return Math.round((midTss * match.avg_duration_min) / plan.duration_minutes);
  }
  return null;
}

/** Match-score tone: ≥80% positive, ≥50% caution, else muted. */
export function matchScoreClass(score: number): string {
  if (score >= 0.8) return 'text-positive';
  if (score >= 0.5) return 'text-yellow-400';
  return 'text-muted';
}

export function matchCardClass(score: number, expanded: boolean): string {
  if (expanded) {
    if (score >= 0.8) return 'bg-green-500/10 border-green-500/30';
    if (score >= 0.5) return 'bg-yellow-500/10 border-yellow-500/30';
  }
  return 'bg-surface-light/30 border-surface-light/60 hover:bg-surface-light/50';
}

/** Honest-empty copy (moment 4 template): what + how + CTA target. */
export function noMatchCopy(zone: string, durationMinutes: number): {
  title: string;
  body: string;
  ctaLabel: string;
} {
  return {
    title: `No ${zoneLabel(zone)} routes near ${durationLabel(durationMinutes)}`,
    body:
      'None of your saved routes fit this workout yet. ' +
      'Ride a matching route (or sync Komoot/Strava) and it will show up here automatically.',
    ctaLabel: 'Browse route library',
  };
}
