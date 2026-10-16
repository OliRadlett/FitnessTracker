import type {
  TrainingPlanSummary,
  TrainingPlanBlock,
  TrainingPlanBlockPayload,
  TrainingWeekResponse,
  UpdateTrainingPlanDayPayload,
  TrainingPlanDay,
  AdaptiveSuggestionsResponse,
  StrengthPlanSuggestionsResponse,
  RefreshTargetsResponse,
  WahooPushRequest,
  WahooPushResponse,
  CreateTrainingPlanDayPayload,
  SubstituteDayPayload,
  UnplannedActualsResponse,
  ExerciseRule,
  ProgressionApplyTarget,
  StrengthProgressionApplyResponse,
  StrengthProgressionSuggestResponse,
  MaterialiseResponse,
  PlanReviewResponse,
} from './types';

type AuthFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export async function getTrainingPlans(authFetch: AuthFetch, statusFilter?: string): Promise<TrainingPlanSummary[]> {
  const query = statusFilter ? `?status_filter=${encodeURIComponent(statusFilter)}` : '';
  return authFetch<TrainingPlanSummary[]>(`/api/v1/training-plans${query}`);
}

/** Phase 5B — one Monday-based week of a plan with weather/actuals/route matches. */
export async function getPlanWeek(
  authFetch: AuthFetch,
  planId: string,
  weekNumber: number,
  options: { includeWeather?: boolean } = {}
): Promise<TrainingWeekResponse> {
  const { includeWeather = true } = options;
  return authFetch<TrainingWeekResponse>(
    `/api/v1/training-plans/${planId}/week/${weekNumber}?include_weather=${includeWeather}`
  );
}

/** Phase 5B — targeted partial update of a single plan day. */
export async function updatePlanDay(
  authFetch: AuthFetch,
  planId: string,
  dayId: string,
  payload: UpdateTrainingPlanDayPayload
): Promise<TrainingPlanDay> {
  return authFetch<TrainingPlanDay>(
    `/api/v1/training-plans/${planId}/days/${dayId}`,
    { method: 'PATCH', body: JSON.stringify(payload) }
  );
}

/** §3.11 — adaptive weekly suggestions with optional one-tap apply actions. */
export async function getAdaptiveSuggestions(
  authFetch: AuthFetch, planId: string
): Promise<AdaptiveSuggestionsResponse> {
  return authFetch<AdaptiveSuggestionsResponse>(
    `/api/v1/training-plans/${planId}/suggestions`
  );
}

/** Smart strength suggestions — weight updates based on prior-week conformity. */
export async function getStrengthSuggestions(
  authFetch: AuthFetch, planId: string
): Promise<StrengthPlanSuggestionsResponse> {
  return authFetch<StrengthPlanSuggestionsResponse>(
    `/api/v1/training-plans/${planId}/strength-suggestions`
  );
}

/** FL1 — recompute upcoming cycle (+%e1RM strength) targets from current FTP/PRs. */
export async function refreshTargets(
  authFetch: AuthFetch,
  planId: string,
): Promise<RefreshTargetsResponse> {
  return authFetch<RefreshTargetsResponse>(
    `/api/v1/training-plans/${planId}/refresh-targets`,
    { method: 'POST' },
  );
}

/** Push a cycle day to Wahoo as a scheduled structured workout and/or route. */
export async function pushPlanDayToWahoo(
  authFetch: AuthFetch,
  planId: string,
  dayId: string,
  payload: WahooPushRequest
): Promise<WahooPushResponse> {
  return authFetch<WahooPushResponse>(
    `/api/v1/training-plans/${planId}/days/${dayId}/push-to-wahoo`,
    { method: 'POST', body: JSON.stringify(payload) }
  );
}

/** Remove a day's scheduled Wahoo workout/plan (route stays in the library). */
export async function removePlanDayFromWahoo(
  authFetch: AuthFetch,
  planId: string,
  dayId: string
): Promise<WahooPushResponse> {
  return authFetch<WahooPushResponse>(
    `/api/v1/training-plans/${planId}/days/${dayId}/push-to-wahoo`,
    { method: 'DELETE' }
  );
}

export async function copySessionToPlanDay(
  authFetch: AuthFetch,
  planId: string,
  dayId: string,
  sessionId: string
): Promise<TrainingPlanDay> {
  return authFetch<TrainingPlanDay>(
    `/api/v1/training-plans/${planId}/days/${dayId}/copy-from-session/${sessionId}`,
    { method: 'POST' }
  );
}

export async function copyPlanDayToDate(
  authFetch: AuthFetch,
  planId: string,
  sourceDayId: string,
  targetDate: string
): Promise<TrainingPlanDay> {
  return authFetch<TrainingPlanDay>(
    `/api/v1/training-plans/${planId}/days/${sourceDayId}/copy-to-date/${targetDate}`,
    { method: 'POST' }
  );
}

// ── Workout preview (Feature 2) ──────────────────────────────────────────

export interface WorkoutPreviewTargets {
  difficulty: string;
  zone_id: string;
  zone_name: string;
  duration_minutes: number;
  target_power_low: number;
  target_power_high: number;
  target_if_low: number;
  target_if_high: number;
  target_tss_low: number;
  target_tss_high: number;
  estimated_calories_low: number;
  estimated_calories_high: number;
}

export interface WorkoutPreviewResponse {
  targets: WorkoutPreviewTargets | null;
  ftp: number | null;
  message: string | null;
}

export async function previewWorkout(
  authFetch: AuthFetch,
  workoutType: string,
  durationMinutes: number
): Promise<WorkoutPreviewResponse> {
  const params = new URLSearchParams({
    duration_minutes: String(durationMinutes),
    workout_type: workoutType,
  });
  return authFetch<WorkoutPreviewResponse>(
    `/api/v1/training-plans/preview-workout?${params}`,
    { method: 'POST' }
  );
}

// ── Editor primitives — targeted single-day operations ──────────────────────
//
// The non-destructive counterparts to the full-array `PATCH /{id}` (which
// upserts by date and DELETES dates missing from the payload). The editor uses
// these instead, so one day can change without rewriting the plan's day set.

/** Add one day to a plan. Rejects (409) when the date already holds a day. */
export async function addDay(
  authFetch: AuthFetch,
  planId: string,
  payload: CreateTrainingPlanDayPayload
): Promise<TrainingPlanDay> {
  return authFetch<TrainingPlanDay>(`/api/v1/training-plans/${planId}/days`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Delete one day. Completed days are refused (400). */
export async function deleteDay(
  authFetch: AuthFetch,
  planId: string,
  dayId: string
): Promise<void> {
  return authFetch<void>(`/api/v1/training-plans/${planId}/days/${dayId}`, {
    method: 'DELETE',
  });
}

/** Atomically exchange two days' dates. Returns both days. */
export async function swapDays(
  authFetch: AuthFetch,
  planId: string,
  dayId: string,
  targetDayId: string
): Promise<TrainingPlanDay[]> {
  return authFetch<TrainingPlanDay[]>(
    `/api/v1/training-plans/${planId}/days/${dayId}/swap`,
    { method: 'POST', body: JSON.stringify({ target_day_id: targetDayId }) }
  );
}

/** Move an uncompleted day to another date (409 when the target is occupied). */
export async function rescheduleDay(
  authFetch: AuthFetch,
  planId: string,
  dayId: string,
  targetDate: string
): Promise<TrainingPlanDay> {
  return authFetch<TrainingPlanDay>(
    `/api/v1/training-plans/${planId}/days/${dayId}/reschedule`,
    { method: 'POST', body: JSON.stringify({ target_date: targetDate }) }
  );
}

/** Convert a missed day into an alternate session on the same date. */
export async function substituteDay(
  authFetch: AuthFetch,
  planId: string,
  dayId: string,
  payload: SubstituteDayPayload
): Promise<TrainingPlanDay> {
  return authFetch<TrainingPlanDay>(
    `/api/v1/training-plans/${planId}/days/${dayId}/substitute`,
    { method: 'POST', body: JSON.stringify(payload) }
  );
}

/** Activities + lifting sessions in the last N days linked to no plan day. */
export async function getUnplannedActuals(
  authFetch: AuthFetch,
  planId: string,
  days = 14
): Promise<UnplannedActualsResponse> {
  return authFetch<UnplannedActualsResponse>(
    `/api/v1/training-plans/${planId}/unplanned?days=${days}`
  );
}

// ── S1: strength progression ────────────────────────────────────────────────

/** Propose a working weight per planned exercise (writes nothing). */
export async function suggestStrengthProgression(
  authFetch: AuthFetch,
  planId: string,
  body: {
    scope?: 'day' | 'week' | 'plan';
    day_id?: string;
    week?: number;
    force?: boolean;
  } = {}
): Promise<StrengthProgressionSuggestResponse> {
  return authFetch<StrengthProgressionSuggestResponse>(
    `/api/v1/training-plans/${planId}/strength-progression/suggest`,
    { method: 'POST', body: JSON.stringify(body) }
  );
}

/** Write accepted suggestions into day entries. */
export async function applyStrengthProgression(
  authFetch: AuthFetch,
  planId: string,
  body: { targets: ProgressionApplyTarget[]; force?: boolean }
): Promise<StrengthProgressionApplyResponse> {
  return authFetch<StrengthProgressionApplyResponse>(
    `/api/v1/training-plans/${planId}/strength-progression/apply`,
    { method: 'POST', body: JSON.stringify(body) }
  );
}

/** Fill per-week sets/reps/RPE cells from the plan's progression rules. */
export async function materialiseProgression(
  authFetch: AuthFetch,
  planId: string,
  body: { rules?: ExerciseRule[]; weeks?: number[]; mode?: 'replace' | 'fill-empty' } = {}
): Promise<MaterialiseResponse> {
  return authFetch<MaterialiseResponse>(
    `/api/v1/training-plans/${planId}/strength-progression/materialise`,
    { method: 'POST', body: JSON.stringify(body) }
  );
}

// ── C1: plan blocks (the stored block/phase model) ──────────────────────────

/** This plan's blocks, in date order. */
export async function getPlanBlocks(
  authFetch: AuthFetch,
  planId: string
): Promise<TrainingPlanBlock[]> {
  return authFetch<TrainingPlanBlock[]>(`/api/v1/training-plans/${planId}/blocks`);
}

/** Add a block. Rejects (409) when it would overlap a sibling. */
export async function createPlanBlock(
  authFetch: AuthFetch,
  planId: string,
  payload: TrainingPlanBlockPayload
): Promise<TrainingPlanBlock> {
  return authFetch<TrainingPlanBlock>(`/api/v1/training-plans/${planId}/blocks`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Edit a block. Only the fields sent are changed. */
export async function updatePlanBlock(
  authFetch: AuthFetch,
  planId: string,
  blockId: string,
  payload: TrainingPlanBlockPayload
): Promise<TrainingPlanBlock> {
  return authFetch<TrainingPlanBlock>(
    `/api/v1/training-plans/${planId}/blocks/${blockId}`,
    { method: 'PATCH', body: JSON.stringify(payload) }
  );
}

/** Remove a block. Its days are untouched — a block labels a range, it owns nothing. */
export async function deletePlanBlock(
  authFetch: AuthFetch,
  planId: string,
  blockId: string
): Promise<void> {
  return authFetch<void>(`/api/v1/training-plans/${planId}/blocks/${blockId}`, {
    method: 'DELETE',
  });
}

// ── C3: weekly plan review ──────────────────────────────────────────────────

/** The latest weekly review snapshot (C3). A plain call is a read. */
export async function getPlanReview(
  authFetch: AuthFetch,
  planId: string
): Promise<PlanReviewResponse> {
  return authFetch<PlanReviewResponse>(
    `/api/v1/training-plans/${planId}/review`
  );
}
