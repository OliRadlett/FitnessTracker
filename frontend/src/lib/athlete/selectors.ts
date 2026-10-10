/**
 * Phase 1 (plans/ui-redesign-v2.md §1) — pure derivation helpers for
 * `useAthleteState`. Presentation-only: nothing here recomputes CTL/ATL/TSB,
 * Brzycki, or FTP (docs/algorithms.md authoritative). Degradation is SHOWN
 * (returned as data), never averaged away.
 */

import type {
  Connection,
  DailyLoadPoint,
  EngineConsensus,
  Goal,
  GoalProjectionResponse,
  TrainingPlanSummary,
} from '@/lib/api';
import type { GoalTrajectory } from './types';
import { toDateStr } from '@/lib/training/week';

/** Mirrors `SyncHealthBanner`'s threshold — connections sync on a 30-min
 *  schedule, so 12h of silence is worth flagging even with a valid token. */
export const STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000;

/**
 * Providers needing attention: `needs_reauth` first, then stale-but-valid.
 * Connections that never synced carry no timestamp — they are surfaced as
 * "never", not dropped (data maximalism).
 */
export function deriveStaleProviders(
  connections: Connection[] | null | undefined,
  nowMs: number = Date.now(),
): Connection[] {
  if (!connections || connections.length === 0) return [];
  return connections.filter((c) => {
    if (c.status === 'needs_reauth') return true;
    if (!c.last_synced_at) return false;
    const then = new Date(c.last_synced_at).getTime();
    if (Number.isNaN(then)) return false;
    return nowMs - then > STALE_THRESHOLD_MS;
  });
}

/** Freshest `last_synced_at` across connections, or null when none synced. */
export function deriveLastSyncedAt(
  connections: Connection[] | null | undefined,
): string | null {
  if (!connections) return null;
  let best: { time: number; raw: string } | null = null;
  for (const c of connections) {
    if (!c.last_synced_at) continue;
    const t = new Date(c.last_synced_at).getTime();
    if (Number.isNaN(t)) continue;
    if (!best || t > best.time) best = { time: t, raw: c.last_synced_at };
  }
  return best?.raw ?? null;
}

/**
 * Engines that stayed silent (pitfall 42). A silent row is a finding, not an
 * error — callers render it as "not run yet", never as agreement.
 */
export function deriveDegradedEngines(
  consensus: EngineConsensus[] | null | undefined,
): EngineConsensus[] {
  if (!consensus) return [];
  return consensus.filter((c) => !c.available);
}

/**
 * Split active dated goals into trajectory buckets by projection badge.
 * Goals without a projection stay in `unclassified` — never force-ranked.
 */
export function classifyGoalTrajectories(
  goals: Goal[] | null | undefined,
  projections: Map<string, GoalProjectionResponse> | Record<string, GoalProjectionResponse>,
): { atRisk: GoalTrajectory[]; onTrack: GoalTrajectory[]; unclassified: Goal[] } {
  const atRisk: GoalTrajectory[] = [];
  const onTrack: GoalTrajectory[] = [];
  const unclassified: Goal[] = [];
  if (!goals) return { atRisk, onTrack, unclassified };

  const get = (id: string): GoalProjectionResponse | undefined =>
    projections instanceof Map ? projections.get(id) : projections[id];

  for (const goal of goals) {
    if (goal.status !== 'active' || !goal.target_date) continue;
    const p = get(goal.id);
    if (!p) {
      unclassified.push(goal);
      continue;
    }
    const trajectory: GoalTrajectory = {
      goal,
      badge: p.badge,
      projectedDate: p.projection?.projected_date ?? null,
      daysRemaining: p.projection?.days_remaining ?? null,
    };
    if (p.badge === 'On Track') onTrack.push(trajectory);
    else if (p.badge === 'At Risk' || p.badge === 'Unlikely') atRisk.push(trajectory);
    else unclassified.push(goal);
  }
  return { atRisk, onTrack, unclassified };
}

/**
 * Presentational 7-day TSB direction from the server-computed load series.
 * Compares two already-computed points — this is a display delta, not a
 * training-load recomputation.
 */
export function deriveLoadTrend(
  points: DailyLoadPoint[] | null | undefined,
  lookbackDays = 7,
): { delta: number | null; direction: 'up' | 'down' | 'flat' | null } {
  if (!points || points.length === 0) return { delta: null, direction: null };
  const current = points[points.length - 1]?.tsb;
  const past = points[Math.max(0, points.length - 1 - lookbackDays)]?.tsb;
  if (current == null || past == null || !Number.isFinite(current) || !Number.isFinite(past)) {
    return { delta: null, direction: null };
  }
  const delta = current - past;
  return {
    delta,
    direction: delta > 1 ? 'up' : delta < -1 ? 'down' : 'flat',
  };
}

/** Sum of TSS over the trailing 7 days of the server-computed load series. */
export function deriveWeekTss(
  points: DailyLoadPoint[] | null | undefined,
): number | null {
  if (!points || points.length === 0) return null;
  const tail = points.slice(-7);
  let sum = 0;
  for (const p of tail) {
    if (typeof p.tss !== 'number' || !Number.isFinite(p.tss)) return null;
    sum += p.tss;
  }
  return sum;
}

/**
 * The plan covering today, or null. Mirrors `useTodaysStrengthDay`: an
 * in-range plan wins; with no in-range plan there is no affirmable session,
 * so there is no fallback guess.
 */
export function pickActivePlan(
  plans: TrainingPlanSummary[] | null | undefined,
  todayStr: string = toDateStr(new Date()),
): TrainingPlanSummary | null {
  if (!plans || plans.length === 0) return null;
  return plans.find((p) => p.start_date <= todayStr && todayStr <= p.end_date) ?? null;
}
