// Calendar view — mirrors backend app/schemas/calendar.py.

export interface CalendarRange {
  start: string;
  end: string;
}

export interface CalendarPlan {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
}

export interface CalendarCoverage {
  planned_sessions: number;
  target_sessions: number;
  planned_tss: number;
  strength_targets_missing: number;
}

export interface CalendarPlanDay {
  id: string;
  date: string;
  sport: string;
  planned_type: string;
  planned_tss: number | null;
  planned_duration_min: number | null;
  planned_focus: string | null;
  planned_exercises: Record<string, unknown>[] | null;
  planned_volume_kg: number | null;
  planned_rpe: number | null;
  planned_power_watts: number | null;
  planned_zone: string | null;
  workout_description: string | null;
  completed: boolean;
  actual_activity_id: string | null;
  actual_lifting_session_id: string | null;
}

export interface CalendarRideContext {
  intensity_factor?: number | null;
  variability_index?: number | null;
  efficiency_factor?: number | null;
  vam?: number | null;
  decoupling_pct?: number | null;
  decoupling_class?: string | null;
  tss?: number | null;
  tss_source?: string | null;
  tss_per_hour?: number | null;
  climbing_meters?: number | null;
  top_speed_kmh?: number | null;
}

export interface CalendarActivity {
  id: string;
  date: string;
  start_date: string | null;
  sport_type: string;
  name: string;
  duration_seconds: number | null;
  distance_meters: number | null;
  tss: number | null;
  tss_source: string | null;
  average_power: number | null;
  normalized_power: number | null;
  average_heartrate: number | null;
  max_heartrate: number | null;
  elevation_gain_meters: number | null;
  calories: number | null;
  source: string | null;
  ride_context: CalendarRideContext | null;
}

export interface CalendarLiftSet {
  exercise_name: string;
  set_number: number;
  weight_kg: number;
  reps: number;
  rpe: number | null;
  is_warmup: boolean;
  is_amrap: boolean;
}

export interface CalendarLift {
  id: string;
  date: string;
  focus: string | null;
  program_name: string | null;
  duration_seconds: number | null;
  total_volume_kg: number | null;
  estimated_tss: number | null;
  rpe_session: number | null;
  set_count: number;
  session_split: string | null;
  session_class: string | null;
  sets: CalendarLiftSet[];
}

export interface CalendarMetric {
  date: string;
  recovery_score: number | null;
  hrv_ms: number | null;
  strain: number | null;
  sleep_duration_minutes: number | null;
  sleep_efficiency: number | null;
  resting_hr: number | null;
  respiratory_rate: number | null;
}

export interface CalendarSleep {
  date: string;
  source: string | null;
  total_sleep_seconds: number | null;
  deep_sleep_seconds: number | null;
  rem_sleep_seconds: number | null;
  light_sleep_seconds: number | null;
  awake_seconds: number | null;
  sleep_efficiency: number | null;
  sleep_start: string | null;
  sleep_end: string | null;
}

export interface CalendarDay {
  date: string;
  plan: CalendarPlanDay[];
  activities: CalendarActivity[];
  lifts: CalendarLift[];
  metric: CalendarMetric | null;
  sleep: CalendarSleep | null;
}

export interface CalendarWeek {
  week_start: string;
  week_end: string;
  iso_week: number;
  planned_sessions: number;
  completed_sessions: number;
  target_sessions: number;
  planned_tss: number;
  actual_tss: number;
  unplanned_actuals: number;
}

export interface CalendarEvent {
  id: string;
  date: string;
  name: string;
  event_type: string;
  target_tss: number | null;
}

export interface CalendarGoal {
  id: string;
  metric: string;
  target_value: number;
  target_date: string;
  status: string;
}

export interface CalendarCurrent {
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  recovery: number | null;
  strain: number | null;
  sleep_hours: number | null;
}

export interface CalendarResponse {
  range: CalendarRange;
  today: string;
  plan: CalendarPlan | null;
  coverage: CalendarCoverage;
  days: CalendarDay[];
  weeks: CalendarWeek[];
  events: CalendarEvent[];
  goals: CalendarGoal[];
  current: CalendarCurrent | null;
  unavailable: Record<string, string>;
}
