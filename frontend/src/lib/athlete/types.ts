/**
 * Phase 1 (plans/ui-redesign-v2.md §1) — the `AthleteState` view-model.
 *
 * One composed athlete-state every surface reads from. Frontend composition
 * first (zero migration risk); promote to `GET /api/v1/athlete-state` only if
 * waterfall latency hurts (Walkthrough decision §1).
 *
 * These types only *reference* existing domain types — no new backend models,
 * no computation changes (docs/algorithms.md stays authoritative).
 */

import type {
  Connection,
  DailyLoadPoint,
  EngineConsensus,
  Goal,
  GoalProjectionResponse,
  PlanConformityResponse,
  ReadinessResponse,
  SleepDebtResponse,
  TodayVerdict,
  TrainingLoadResponse,
  TrainingPlanDay,
  TrainingPlanSummary,
  TrainingWeekDay,
  TrainingWeekResponse,
  WeightHistoryResponse,
} from '@/lib/api';

export type {
  Connection,
  DailyLoadPoint,
  EngineConsensus,
  Goal,
  GoalProjectionResponse,
  PlanConformityResponse,
  ReadinessResponse,
  SleepDebtResponse,
  TodayVerdict,
  TrainingLoadResponse,
  TrainingPlanDay,
  TrainingPlanSummary,
  TrainingWeekDay,
  TrainingWeekResponse,
  WeightHistoryResponse,
};

/** Wave-4 consensus verdict slice — from `GET /api/v1/dashboard/today`. */
export interface AthleteVerdict {
  /** The unified five-engine verdict, or null when composition failed outright. */
  verdict: TodayVerdict | null;
  /** Server headline when present; pages fall back to plan-relative copy. */
  headline: string | null;
  shouldRest: boolean;
  reasons: string[];
  /** All consensus rows, INCLUDING silent/degraded ones (pitfall 42). */
  engines: EngineConsensus[];
  /** Subset of engines with `available: false` — shown, never averaged away. */
  degradedEngines: EngineConsensus[];
  isLoading: boolean;
  isError: boolean;
}

/** Single home for every CTL/ATL/TSB number — from the training-load endpoint. */
export interface AthleteLoad {
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  /** Presentational delta of the server-computed TSB series (NOT a recompute). */
  tsbDelta7d: number | null;
  trend: 'up' | 'down' | 'flat' | null;
  weekTss: number | null;
  ftpWatts: number | null;
  isLoading: boolean;
  isError: boolean;
}

export interface AthleteBody {
  weightKg: number | null;
  weightSource: string | null;
  weightDate: string | null;
  rollingAvgKg: number | null;
  hrvMs: number | null;
  restingHr: number | null;
  recoveryScore: number | null;
  sleepDebtHours: number | null;
  readiness: ReadinessResponse['readiness'] | null;
  isLoading: boolean;
  isError: boolean;
}

export interface AthletePlan {
  activePlan: TrainingPlanSummary | null;
  /** Today's slice of the active plan week, or null on rest days / no plan. */
  today: TrainingWeekDay | null;
  conformityPct: number | null;
  conformity: PlanConformityResponse | null;
  isLoading: boolean;
  isError: boolean;
}

/** One goal + its trajectory verdict (projection badge + projected date). */
export interface GoalTrajectory {
  goal: Goal;
  badge: GoalProjectionResponse['badge'];
  projectedDate: string | null;
  daysRemaining: number | null;
}

export interface AthleteGoals {
  atRisk: GoalTrajectory[];
  onTrack: GoalTrajectory[];
  /** Active dated goals with no projection yet — honest, never force-ranked. */
  unclassified: Goal[];
  isLoading: boolean;
  isError: boolean;
}

export interface AthleteSync {
  /** needs_reauth OR last sync older than the stale threshold — all shown. */
  staleProviders: Connection[];
  /** Verdict engines that stayed silent — surfaced here as well as in Why. */
  degradedEngines: EngineConsensus[];
  lastSyncedAt: string | null;
  isLoading: boolean;
  isError: boolean;
}

export interface AthleteState {
  verdict: AthleteVerdict;
  load: AthleteLoad;
  body: AthleteBody;
  plan: AthletePlan;
  goals: AthleteGoals;
  sync: AthleteSync;
  /** True while ANY slice is still loading. */
  isLoading: boolean;
  /** True when ANY slice errored (slices degrade independently — pitfall 43). */
  isError: boolean;
}
