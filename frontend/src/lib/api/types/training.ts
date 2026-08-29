// ─── Goals (Phase 6 — semantic metrics) ──────────────────────────────────

export type GoalStatus = 'active' | 'achieved' | 'expired' | 'abandoned';

/**
 * Enriched goal from GET /goals — semantic metric + service-layer computed
 * fields (direction / alignment / progress / display metadata).
 */
export interface Goal {
  id: string;
  user_id: string;
  metric: string;
  /** e.g. {"exercise": "Back Squat"} or {"sport": "cycling"} */
  filter_json?: Record<string, string> | null;
  starting_value?: number | null;
  target_value: number;
  current_value?: number | null;
  target_date?: string | null;
  status: GoalStatus;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  // ── Enrichment (GoalEnriched) ──
  direction?: 'increase' | 'decrease' | null;
  alignment_pct?: number | null;
  progress_pct?: number | null;
  metric_label?: string | null;
  metric_unit?: string | null;
}

export interface CreateGoalPayload {
  metric: string;
  target_value: number;
  filter_json?: Record<string, string> | null;
  target_date?: string | null;
  notes?: string | null;
}

export interface UpdateGoalPayload {
  metric?: string;
  target_value?: number;
  filter_json?: Record<string, string> | null;
  target_date?: string | null;
  status?: GoalStatus;
  notes?: string | null;
}

export interface GoalCheckIn {
  id: string;
  goal_id: string;
  check_in_date: string;
  value: number;
  alignment_pct?: number | null;
  note?: string | null;
  source: 'auto' | 'manual';
  created_at: string;
}

export interface GoalCheckInPayload {
  value: number;
  note?: string | null;
}

/** Registry entry from GET /goals/metrics — drives dynamic goal forms. */
export interface MetricInfo {
  key: string;
  label: string;
  unit: string;
  requires_filter?: string[] | null;
  optional_filter?: string[] | null;
  default_direction: 'increase' | 'decrease';
}

export interface ReactivateResponse {
  id: string;
  status: string;
  message: string;
}

// ─── Training Plans ───────────────────────────────────────────────────────

/** A single planned exercise in a strength day's workout list. */
export interface PlannedExercise {
  exercise: string;
  sets: number;
  reps: number;
  weight_kg?: number | null;
  rpe?: number | null;
}

export type PlanSport = 'cycle' | 'strength' | 'rest';
export type PlanDayType = 'rest' | 'easy' | 'moderate' | 'hard' | 'race';
export type PlanFocus =
  | 'squat'
  | 'bench'
  | 'deadlift'
  | 'overhead_press'
  | 'accessories'
  | 'full_body'
  | 'push'
  | 'pull'
  | 'legs'
  | 'upper'
  | 'lower';

export interface TrainingPlanDay {
  id: string;
  plan_id: string;
  day_date: string;
  sport: PlanSport;
  planned_tss?: number | null;
  planned_duration_min?: number | null;
  planned_type: PlanDayType;
  workout_description?: string | null;
  planned_focus?: PlanFocus | string | null;
  planned_exercises?: PlannedExercise[] | null;
  planned_volume_kg?: number | null;
  planned_rpe?: number | null;
  planned_power_watts?: number | null;
  planned_zone?: string | null;
  planned_route_id?: string | null;
  lifting_session_id?: string | null;
  warmup_template_id?: string | null;
  notes?: string | null;
  activity_id?: string | null;
  completed: boolean;
  created_at?: string;
}

export interface TrainingPlan {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  start_date: string;
  end_date: string;
  plan_type: 'custom' | 'build' | 'base' | 'peak' | 'taper' | 'recovery';
  status: 'draft' | 'active' | 'completed' | 'archived';
  event_id?: string | null;
  created_at: string;
  updated_at: string;
  days: TrainingPlanDay[];
}

export interface TrainingPlanSummary {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  plan_type: string;
  status: string;
  event_id?: string | null;
  day_count: number;
  completed_days: number;
  updated_at?: string;
}

export interface CreateTrainingPlanPayload {
  name: string;
  description?: string;
  start_date: string;
  end_date: string;
  plan_type?: string;
  status?: string;
  event_id?: string | null;
  days?: CreateTrainingPlanDayPayload[];
}

export interface CreateTrainingPlanDayPayload {
  day_date: string;
  sport?: PlanSport;
  planned_tss?: number | null;
  planned_duration_min?: number | null;
  planned_type?: string;
  workout_description?: string | null;
  planned_focus?: string | null;
  planned_exercises?: PlannedExercise[] | null;
  planned_volume_kg?: number | null;
  planned_rpe?: number | null;
  planned_power_watts?: number | null;
  planned_zone?: string | null;
  warmup_template_id?: string | null;
  notes?: string | null;
  completed?: boolean;
  /** Link fields — included so drag-to-reassign preserves them on moved days. */
  lifting_session_id?: string | null;
  planned_route_id?: string | null;
}

export interface UpdateTrainingPlanPayload {
  name?: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  plan_type?: string;
  status?: string;
  event_id?: string | null;
  days?: CreateTrainingPlanDayPayload[];
}

export interface GeneratePlanPayload {
  name: string;
  template_type: string;
  weeks?: number;
  start_date: string;
  base_tss?: number;
  event_id?: string | null;
}

// ─── Weekly View (Phase 5B) ──────────────────────────────────────────────

/** Normalized daily forecast entry attached to cycle days. */
export interface DayWeather {
  date: string;
  conditions?: string | null;
  temp_min?: number | null;
  temp_max?: number | null;
  precipitation_probability?: number | null;
  precipitation_sum?: number | null;
  wind_speed_max?: number | null;
}

/** Bad-riding-weather flag (backend `is_bad_weather`). */
export interface BadWeather {
  reason: string;
  level: 'warning' | 'danger';
}

/** Summary of the activity linked to a plan day. */
export interface WeekActualActivity {
  id: string;
  name: string;
  sport_type: string;
  start_date: string;
  duration_seconds?: number | null;
  distance_meters?: number | null;
  tss?: number | null;
  average_power?: number | null;
  route_id?: string | null;
  route_name?: string | null;
}

/** Summary of the lifting session linked to a plan day. */
export interface WeekActualLiftingSession {
  id: string;
  session_date: string;
  focus?: string | null;
  total_volume_kg?: number | null;
}

/** Compact route match shown on cycle days with a duration target only. */
export interface WeekRouteMatchEntry {
  route_id: string;
  name: string;
  score: number;
  confidence: number;
  estimated_tss?: number | null;
  ride_count: number;
}

export interface WarmupStepRead {
  step_number: number;
  weight_kg: number;
  reps: number;
  notes?: string | null;
}

export interface WarmupTemplateRead {
  id: string;
  name: string;
  exercise_name?: string | null;
  steps: WarmupStepRead[];
}

/** CTL/ATL/TSB snapshot with a recommended intensity ceiling for the week. */
export interface WeekReadiness {
  tsb: number;
  ctl: number;
  atl: number;
  recommended_max_zone: string;
}

/** A TrainingPlanDay enriched with weather, actuals, and route matches. */
export interface TrainingWeekDay extends TrainingPlanDay {
  weather?: DayWeather | null;
  bad_weather?: BadWeather | null;
  actual_activity?: WeekActualActivity | null;
  actual_lifting_session?: WeekActualLiftingSession | null;
  route_matches?: WeekRouteMatchEntry[] | null;
  warmup_template?: WarmupTemplateRead | null;
  day_status?: 'pending' | 'completed' | 'partial' | 'missed' | 'rest';
}

/** One Monday-based week of a plan — GET /training-plans/{id}/week/{n}. */
export interface TrainingWeekResponse {
  plan_id: string;
  week_number: number;
  week_start: string;
  week_end: string;
  readiness?: WeekReadiness | null;
  days: TrainingWeekDay[];
}

/** Partial single-day PATCH body — only provided fields are applied. */
export interface UpdateTrainingPlanDayPayload {
  sport?: PlanSport;
  planned_tss?: number | null;
  planned_duration_min?: number | null;
  planned_type?: string;
  workout_description?: string | null;
  planned_focus?: string | null;
  planned_exercises?: PlannedExercise[] | null;
  planned_rpe?: number | null;
  planned_power_watts?: number | null;
  planned_zone?: string | null;
  planned_route_id?: string | null;
  warmup_template_id?: string | null;
  notes?: string | null;
  completed?: boolean;
}

// ─── Events ──────────────────────────────────────────────────────────────

export interface Event {
  id: string;
  user_id: string;
  name: string;
  event_date: string;
  event_type: 'race' | 'ride' | 'lift' | 'other';
  target_tss?: number;
  taper_days: number;
  notes?: string;
  created_at: string;
  updated_at: string;
  days_until: number;
  taper_start_date?: string;
  days_until_taper?: number;
  is_in_taper: boolean;
}

export interface CreateEventPayload {
  name: string;
  event_date: string;
  event_type?: string;
  target_tss?: number;
  taper_days?: number;
  notes?: string;
}

export interface UpdateEventPayload {
  name?: string;
  event_date?: string;
  event_type?: string;
  target_tss?: number;
  taper_days?: number;
  notes?: string;
}

// ─── Workout Planner ─────────────────────────────────────────────────────

export interface WorkoutZone {
  zone: string;
  name: string;
  color: string;
  if_low: number;
  if_high: number;
  power_low: number;
  power_high: number;
  hr_low: number;
  hr_high: number;
  tss_per_hour_low: number;
  tss_per_hour_high: number;
}

export interface ReadinessInfo {
  current_ctl: number;
  current_atl: number;
  current_tsb: number;
  recommended_max_zone: string;
  readiness_note: string;
  is_fatigued: boolean;
}

export interface WorkoutZonesResponse {
  zones: WorkoutZone[];
  readiness: ReadinessInfo;
  ftp_watts?: number;
  lthr?: number;
}

export interface WorkoutPlanRequest {
  difficulty: string;
  duration_minutes: number;
}

export interface WorkoutPlanResponse {
  difficulty: string;
  zone_id: string;
  zone_name: string;
  duration_minutes: number;
  target_power_low: number;
  target_power_high: number;
  target_if_low: number;
  target_if_high: number;
  target_hr_low: number;
  target_hr_high: number;
  target_tss_low: number;
  target_tss_high: number;
  estimated_calories_low: number;
  estimated_calories_high: number;
}

export interface RouteMatchItem {
  route_id: string;
  route_name: string;
  distance_meters: number;
  elevation_gain_meters?: number;
  is_loop: boolean;
  match_score: number;
  avg_tss?: number;
  avg_power?: number;
  avg_hr?: number;
  avg_duration_min?: number;
  ride_count: number;
  is_estimated: boolean;
  confidence: number;
}

export interface RouteMatchResponse {
  matches: RouteMatchItem[];
  workout_target?: WorkoutPlanResponse;
}
