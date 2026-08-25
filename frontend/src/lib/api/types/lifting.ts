// ─── Lifting ─────────────────────────────────────────────────────────────────

import type { LinkedActivity } from './activity';

export interface LiftingSession {
  id: string;
  user_id: string;
  activity_id?: string;
  session_date: string;
  program_name?: string;
  focus?: string;
  duration_seconds?: number;
  total_volume_kg?: number;
  rpe_session?: number;
  notes?: string;
  sets: LiftingSet[];
  linked_activity?: LinkedActivity | null;
  started_at?: string | null;
  ended_at?: string | null;
  whoop_strain?: number | null;
  whoop_avg_hr?: number | null;
  whoop_max_hr?: number | null;
  whoop_kilojoules?: number | null;
  created_at: string;
  updated_at: string;
}

export interface LiftingSet {
  id: string;
  session_id: string;
  exercise_name: string;
  set_number: number;
  weight_kg: number;
  reps: number;
  rpe?: number;
  is_warmup: boolean;
  is_amrap: boolean;
  notes?: string;
  client_id?: string | null;
}

export interface PersonalRecord {
  id: string;
  user_id: string;
  exercise_name: string;
  record_type: string;
  weight_kg: number;
  reps: number;
  estimated_1rm?: number;
  achieved_date: string;
  session_id?: string;
  notes?: string;
  created_at: string;
}

export interface CreatePRPayload {
  exercise_name: string;
  record_type?: string;
  weight_kg: number;
  reps: number;
  achieved_date: string;
  notes?: string;
}

export interface UpdateSessionPayload {
  session_date?: string;
  program_name?: string;
  focus?: string;
  duration_seconds?: number;
  rpe_session?: number;
  notes?: string;
  started_at?: string | null;
  ended_at?: string | null;
}

export interface ExerciseSuggestion {
  name: string;
  category: string;  // "big3" | "compound" | "accessory"
}

export interface WarmupTemplateStep {
  id: string;
  warmup_template_id: string;
  step_number: number;
  weight_kg: number;
  reps: number;
  notes?: string;
}

export interface WarmupTemplate {
  id: string;
  user_id: string;
  name: string;
  exercise_name?: string;
  steps: WarmupTemplateStep[];
  created_at: string;
  updated_at: string;
}

export interface CreateWarmupTemplatePayload {
  name: string;
  exercise_name?: string;
  steps: { step_number: number; weight_kg: number; reps: number; notes?: string }[];
}

export interface UpdateWarmupTemplatePayload {
  name?: string;
  exercise_name?: string;
  steps?: { step_number: number; weight_kg: number; reps: number; notes?: string }[];
}

export interface VolumeTrendPoint {
  week_start: string;
  total_volume_kg: number;
  session_count: number;
}

export interface VolumeTrendResponse {
  exercise_name?: string;
  data: VolumeTrendPoint[];
}

export interface LinkSessionPayload {
  activity_id: string | null;
}

export interface CreateSessionPayload {
  session_date: string;
  program_name?: string;
  focus?: string;
  duration_seconds?: number;
  rpe_session?: number;
  notes?: string;
  started_at?: string;
  live_key?: string;
  sets?: AddSetPayload[];
}

export interface AddSetPayload {
  exercise_name: string;
  set_number: number;
  weight_kg: number;
  reps: number;
  rpe?: number;
  is_warmup?: boolean;
  is_amrap?: boolean;
  notes?: string;
  client_id?: string;
}

// ─── Session Analysis ──────────────────────────────────────────────────────

export interface ExerciseVolume {
  exercise_name: string;
  volume_kg: number;
}

export interface SetProgressionPoint {
  set_number: number;
  weight_kg: number;
  reps: number;
  estimated_1rm?: number;
}

export interface RepDropoff {
  exercise_name: string;
  first_set_reps: number;
  last_set_reps: number;
  dropoff_pct: number;
}

export interface PrProximity {
  exercise_name: string;
  top_set_1rm: number;
  pr_1rm: number;
  proximity_pct: number;
}

export interface LiftingAnalysis {
  volume_breakdown: ExerciseVolume[];
  set_progression: Record<string, SetProgressionPoint[]>;
  rep_dropoff: RepDropoff[];
  pr_proximity: PrProximity[];
  rpe_analysis: {
    session_rpe?: number;
    avg_set_rpe?: number;
    rpe_vs_volume_correlation?: number;
  };
  fatigue_index: number;
  session_density?: number;
  exercise_count: number;
  working_sets_count: number;
}
