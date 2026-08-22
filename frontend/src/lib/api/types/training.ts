// ─── Goals ───────────────────────────────────────────────────────────────

export interface Goal {
  id: string;
  user_id: string;
  goal_type: string;
  target_value: number;
  current_value?: number;
  target_date?: string;
  status: 'active' | 'achieved' | 'expired';
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateGoalPayload {
  goal_type: string;
  target_value: number;
  current_value?: number;
  target_date?: string;
  notes?: string;
}

export interface UpdateGoalPayload {
  goal_type?: string;
  target_value?: number;
  current_value?: number;
  target_date?: string;
  status?: string;
  notes?: string;
}

// ─── Training Plans ───────────────────────────────────────────────────────

export interface TrainingPlanDay {
  id: string;
  plan_id: string;
  day_date: string;
  planned_tss?: number;
  planned_duration_min?: number;
  planned_type: 'rest' | 'easy' | 'moderate' | 'hard' | 'race';
  notes?: string;
  activity_id?: string;
  completed: boolean;
  created_at: string;
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
  day_count: number;
  completed_days: number;
}

export interface CreateTrainingPlanPayload {
  name: string;
  description?: string;
  start_date: string;
  end_date: string;
  plan_type?: string;
  status?: string;
  days?: CreateTrainingPlanDayPayload[];
}

export interface CreateTrainingPlanDayPayload {
  day_date: string;
  planned_tss?: number;
  planned_duration_min?: number;
  planned_type?: string;
  notes?: string;
}

export interface UpdateTrainingPlanPayload {
  name?: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  plan_type?: string;
  status?: string;
  days?: CreateTrainingPlanDayPayload[];
}

export interface GeneratePlanPayload {
  name: string;
  template_type: string;
  weeks?: number;
  start_date: string;
  base_tss?: number;
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
