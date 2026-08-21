// ─── Dashboard ───────────────────────────────────────────────────────────────

export interface RestDaySuggestion {
  should_rest: boolean;
  reasons: string[];
  current_tsb?: number;
  latest_recovery?: number;
  consecutive_training_days: number;
}

export interface DashboardSummary {
  weekly_volume_kg: number;
  weekly_sessions: number;
  weekly_tss: number;
  weekly_distance_meters: number;
  latest_recovery?: number;
  latest_hrv_ms?: number;
  latest_strain?: number;
  active_alerts_count: number;
  current_week_start: string;
  current_week_end: string;
  rest_day_suggestion?: RestDaySuggestion;
}

export interface WeeklyReport {
  week_start: string;
  week_end: string;
  lifting_sessions: number;
  lifting_volume_kg: number;
  cardio_sessions: number;
  total_tss: number;
  avg_recovery?: number;
  avg_hrv_ms?: number;
  avg_sleep_hours?: number;
  new_prs: number;
}

export interface MonthlySummaryItem {
  month: string;
  total_tss: number;
  lifting_volume_kg: number;
  total_distance_meters: number;
  total_time_seconds: number;
  lifting_sessions: number;
  cardio_sessions: number;
  pr_count: number;
  avg_recovery?: number;
}

// ─── Yearly Summary ─────────────────────────────────────────────────────────

export interface PRHighlight {
  exercise_name: string;
  record_type: string;
  weight_kg: number;
  reps: number;
  estimated_1rm?: number;
  achieved_date: string;
  improvement_pct?: number;
}

export interface BestActivity {
  id?: string;
  name: string;
  sport_type: string;
  start_date: string;
  value: number;
  unit: string;
}

export interface YearlyHighlights {
  best_month_tss?: string;
  best_month_tss_value: number;
  longest_ride?: BestActivity;
  heaviest_lift?: BestActivity;
  total_prs: number;
  pr_highlights: PRHighlight[];
}

export interface YearOverYearComparison {
  activities_delta: number;
  distance_delta_m: number;
  time_delta_s: number;
  tss_delta: number;
  lifting_volume_delta_kg: number;
  lifting_sessions_delta: number;
  prs_delta: number;
  avg_recovery_delta?: number;
  activities_pct?: number;
  distance_pct?: number;
  time_pct?: number;
  tss_pct?: number;
  lifting_volume_pct?: number;
}

export interface YearlySummary {
  year: number;
  total_activities: number;
  total_distance_m: number;
  total_time_s: number;
  total_tss: number;
  total_lifting_sessions: number;
  total_lifting_volume_kg: number;
  avg_recovery?: number;
  avg_hrv_ms?: number;
  months: MonthlySummaryItem[];
  highlights: YearlyHighlights;
  year_over_year?: YearOverYearComparison;
}

// ─── Training Streaks ────────────────────────────────────────────────────

export interface TrainingStreaks {
  current_streak_days: number;
  longest_streak_days: number;
  weekly_consistency_pct: number;
  monthly_sessions: { month: string; sessions: number }[];
}

// ─── Today Summary ────────────────────────────────────────────────────────

export interface TodayActivitySummary {
  id: string;
  name: string;
  sport_type: string;
  start_date: string;
  duration_seconds?: number;
  distance_meters?: number;
  average_power?: number;
  normalized_power?: number;
  average_heartrate?: number;
  tss?: number;
  calories?: number;
}

export interface TodayLiftingSummary {
  id: string;
  session_date: string;
  focus?: string;
  duration_seconds?: number;
  rpe_session?: number;
  total_volume_kg: number;
  sets_count: number;
}

export interface TodaySummary {
  today_activities: TodayActivitySummary[];
  today_lifting_sessions: TodayLiftingSummary[];
  today_tss: number;
  today_volume_kg: number;
  today_distance_meters: number;
  today_duration_seconds: number;
  latest_recovery?: number;
  latest_hrv_ms?: number;
  latest_strain?: number;
  latest_sleep_hours?: number;
  current_ctl: number;
  current_atl: number;
  current_tsb: number;
  active_alerts: number;
}
