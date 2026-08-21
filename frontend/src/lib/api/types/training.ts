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
