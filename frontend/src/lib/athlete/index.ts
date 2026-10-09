/**
 * Phase 1 athlete-state module (plans/ui-redesign-v2.md §1).
 * Frontend composition first — zero new backend endpoints.
 */
export { useAthleteState } from './useAthleteState';
export type {
  AthleteBody,
  AthleteGoals,
  AthleteLoad,
  AthletePlan,
  AthleteState,
  AthleteSync,
  AthleteVerdict,
  GoalTrajectory,
} from './types';
export {
  STALE_THRESHOLD_MS,
  classifyGoalTrajectories,
  deriveLastSyncedAt,
  deriveLoadTrend,
  deriveStaleProviders,
  deriveDegradedEngines,
  deriveWeekTss,
  pickActivePlan,
} from './selectors';
