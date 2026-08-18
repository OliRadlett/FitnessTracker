// ─── Common ──────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
}

export interface Connection {
  id: string;
  provider: string;
  provider_user_id: string;
  created_at: string;
}

export interface ChartSeries {
  name: string;
  data: (number | null)[];
  color?: string;
}

export interface ReferenceArea {
  y1: number;
  y2: number;
  color?: string;
  opacity?: number;
  label?: string;
}

export interface ChartData {
  chart_type: 'line' | 'bar' | 'scatter' | 'area' | 'pie';
  title: string;
  labels: string[];
  series: ChartSeries[];
  x_label?: string;
  y_label?: string;
  insights?: string[];
  reference_areas?: ReferenceArea[];
}

export interface ChartParams {
  days?: number;
  weeks?: number;
  exercise_name?: string;
  days_b?: number;
}

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

// ─── Activity ────────────────────────────────────────────────────────────────

export interface ActivitySource {
  id: string;
  provider: string;
  provider_activity_id: string;
  provider_name?: string;
  synced_at: string;
}

export interface Activity {
  id: string;
  user_id: string;
  connection_id?: string;
  route_id?: string;
  route_name?: string;
  source: string;
  provider_activity_id?: string;
  sport_type: string;
  name: string;
  start_date: string;
  duration_seconds?: number;
  distance_meters?: number;
  elevation_gain_meters?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_power?: number;
  normalized_power?: number;
  average_speed?: number;
  average_cadence?: number;
  tss?: number;
  calories?: number;
  rpe?: number;
  linked_lifting_session?: LinkedLiftingSessionSummary;
  encoded_polyline?: string;
  sources?: ActivitySource[];
  synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface ActivityCalendarEntry {
  id: string;
  date: string;
  sport_type: string;
  name: string;
  duration_seconds?: number;
  distance_meters?: number;
  tss?: number;
  focus?: string;
}

export interface DailyMetricSummary {
  date: string;
  recovery_score?: number;
  hrv_ms?: number;
  strain?: number;
  sleep_duration_minutes?: number;
  sleep_efficiency?: number;
}

export interface CalendarDayData {
  activities: ActivityCalendarEntry[];
  daily_metrics: DailyMetricSummary[];
}

export interface ActivityDetail extends Activity {
  streams?: ActivityStream[];
}

export interface ActivityStream {
  id: string;
  activity_id: string;
  stream_type: string;
  data: Record<string, unknown>;
  resolution?: number;
}

export interface ActivityFilters {
  sport_type?: string;
  start_date_after?: string;
  start_date_before?: string;
  source?: string;
  limit?: number;
  offset?: number;
}

export interface LinkedActivity {
  id: string;
  source: string;
  sport_type: string;
  name: string;
  start_date: string;
  duration_seconds?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  calories?: number;
}

// ─── Lifting ─────────────────────────────────────────────────────────────────

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
}

export interface ExerciseSuggestion {
  name: string;
  category: string;  // "big3" | "compound" | "accessory"
}

export interface LinkedLiftingSessionSummary {
  id: string;
  session_date: string;
  focus?: string;
  set_count: number;
  total_volume_kg?: number;
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
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export interface RouteSource {
  id: string;
  provider: string;
  provider_route_id: string;
  provider_name: string;
  synced_at: string;
}

export interface RouteData {
  id: string;
  name: string;
  sport_type: string;
  distance_meters: number;
  elevation_gain_meters?: number;
  estimated_time_seconds?: number;
  encoded_polyline: string;
  elevation_profile?: { elevations: (number | null)[] };
  surface_profile?: Record<string, number>;
  start_lat: number;
  start_lng: number;
  end_lat: number;
  end_lng: number;
  country?: string;
  locality?: string;
  is_loop: boolean;
  sources: RouteSource[];
  created_at: string;
  updated_at: string;
}

export interface RouteSummary {
  id: string;
  name: string;
  sport_type: string;
  distance_meters: number;
  elevation_gain_meters?: number;
  estimated_time_seconds?: number;
  start_lat: number;
  start_lng: number;
  end_lat: number;
  end_lng: number;
  country?: string;
  locality?: string;
  is_loop: boolean;
  sources: RouteSource[];
  surface_profile?: Record<string, number>;
  ride_count: number;
  is_ridden: boolean;
  last_ridden_date?: string;
  created_at: string;
  updated_at: string;
}

export interface RouteFilters {
  sport_type?: string;
  source?: string;
  is_loop?: boolean;
  is_ridden?: boolean;
  min_distance?: number;
  max_distance?: number;
  min_elevation?: number;
  max_elevation?: number;
  q?: string;
  sort_by?: string;
  sort_order?: string;
  limit?: number;
  offset?: number;
}

export interface RouteSyncResult {
  provider: string;
  synced_count: number;
  merged_count: number;
  new_count: number;
}

export interface DuplicatePair {
  route_a: RouteData;
  route_b: RouteData;
  score: number;
}

// ─── Cycling ─────────────────────────────────────────────────────────────────

export interface CyclingProfile {
  id: string;
  user_id: string;
  ftp_watts?: number;
  weight_kg?: number;
  lactate_threshold_hr?: number;
  auto_estimate_ftp: boolean;
  created_at: string;
  updated_at: string;
}

export interface CyclingProfileUpdate {
  ftp_watts?: number;
  weight_kg?: number;
  lactate_threshold_hr?: number;
  auto_estimate_ftp?: boolean;
}

export interface FtpHistoryEntry {
  id: string;
  user_id: string;
  ftp_watts: number;
  effective_date: string;
  source: string;
  notes?: string;
  created_at: string;
}

export interface FtpHistoryCreate {
  ftp_watts: number;
  effective_date: string;
  source?: string;
  notes?: string;
}

export interface DailyLoadPoint {
  date: string;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number;
}

export interface TrainingLoadResponse {
  data: DailyLoadPoint[];
  current_ctl: number;
  current_atl: number;
  current_tsb: number;
}

export interface PowerDurationPoint {
  duration_label: string;
  duration_seconds: number;
  best_power_watts?: number;
  date_achieved?: string;
}

export interface PowerCurveResponse {
  data: PowerDurationPoint[];
  ftp_watts?: number;
}

export interface PowerZoneDistribution {
  zone: string;
  zone_name: string;
  lower_bound_watts: number;
  upper_bound_watts: number;
  time_seconds: number;
  percentage: number;
}

export interface PowerZonesResponse {
  ftp_watts: number;
  zones: PowerZoneDistribution[];
  total_time_seconds: number;
}

export interface MetricTrend {
  current_value: number | null;
  baseline_value: number | null;
  direction: 'up' | 'down' | 'stable';
}

export interface MetricBenchmark {
  label: string;  // e.g. "Trained", "Good", "Excellent"
  range: string;  // e.g. "3.0–4.0"
  raw_label: string;
}

export interface CyclingMetricsSummary {
  recent_tss: number;
  recent_distance_km: number;
  recent_time_hours: number;
  recent_elevation_m: number;
  recent_rides: number;
  avg_intensity_factor?: number;
  avg_variability_index?: number;
  best_20min_power?: number;
  estimated_ftp?: number;
  ftp_watts?: number;
  weight_kg?: number;
  power_to_weight?: number;
  // Trend indicators (current 7d vs 28-day rolling average)
  tss_trend?: MetricTrend;
  distance_trend?: MetricTrend;
  time_trend?: MetricTrend;
  elevation_trend?: MetricTrend;
  rides_trend?: MetricTrend;
  if_trend?: MetricTrend;
  vi_trend?: MetricTrend;
  // Benchmark classifications
  ftp_wkg_benchmark?: MetricBenchmark;
  ctl_benchmark?: MetricBenchmark;
  vi_benchmark?: MetricBenchmark;
}

export interface PowerVsHrPoint {
  power: number;
  heart_rate: number;
  date: string;
}

export interface PowerVsHrResponse {
  data: PowerVsHrPoint[];
}

export interface FtpEstimateDetail {
  ftp: number;
  confidence: number;
  source_duration: number;
  method: string;
}

export interface FtpEstimate {
  estimated_ftp: number;
  confidence: number;
  method: string;
  source_duration: number;
  all_estimates: FtpEstimateDetail[];
  source_method?: string;
  best_power_available: Record<string, number | null>;
  days_analyzed: number;
  accepted: boolean;
  previous_ftp?: number;
}

export interface HrZoneDistribution {
  zone: string;
  zone_name: string;
  lower_bound_hr: number;
  upper_bound_hr: number;
  time_seconds: number;
  percentage: number;
}

export interface HrZonesResponse {
  lthr: number;
  zones: HrZoneDistribution[];
  total_time_seconds: number;
}

export interface BackfillStreamsResult {
  backfilled: number;
  total_checked: number;
  remaining?: number;
  message?: string;
}

export interface LifetimePB {
  duration_label: string;
  duration_seconds: number;
  best_power_watts: number | null;
  pct_ftp: number | null;
}

export interface LifetimePBsResponse {
  pbs: LifetimePB[];
  ftp_watts?: number;
  weight_kg?: number;
}

export interface BackfillFtpEntry {
  effective_date: string;
  ftp_watts: number;
  source_method: string | null;
}

export interface BackfillFtpResult {
  created: number;
  entries: BackfillFtpEntry[];
  months_analyzed: number;
}

// ─── VO2max Estimation ────────────────────────────────────────────────────

export interface Vo2maxDetail {
  vo2max: number;
  confidence: number;
  method: string;
}

export interface Vo2maxResponse {
  vo2max: number;
  confidence: number;
  method: string;
  classification: string;
  all_estimates: Vo2maxDetail[];
}

export interface Vo2maxHistoryPoint {
  date: string;
  vo2max: number;
  method: string;
}

export interface Vo2maxHistoryResponse {
  data: Vo2maxHistoryPoint[];
  current_vo2max?: number;
  current_classification?: string;
}

// ─── Decoupling Analysis ──────────────────────────────────────────────────

export interface DecouplingActivityPoint {
  date: string;
  activity_id: string;
  decoupling_pct: number;
  first_half_ratio: number;
  second_half_ratio: number;
  classification: string;
  duration_seconds: number;
}

export interface DecouplingHistoryResponse {
  data: DecouplingActivityPoint[];
  avg_decoupling_pct?: number;
  classification?: string;
}

export interface DecouplingSingleResponse {
  decoupling_pct: number;
  first_half_ratio: number;
  second_half_ratio: number;
  classification: string;
  duration_seconds: number;
  activity_id?: string;
}

// ─── Phase 5.2 — Whoop Intelligence ───────────────────────────────────────

export interface ReadinessResponse {
  recovery_score: number | null;
  readiness: 'green' | 'yellow' | 'red' | 'unknown';
  hrv_ms: number | null;
  resting_hr: number | null;
  message: string;
  date?: string;
}

export interface SleepConsistencyResponse {
  consistency_score: number;
  avg_bedtime: string | null;
  std_minutes: number;
  days_analyzed: number;
  window_days: number;
}

export interface SleepDebtResponse {
  debt_hours: number;
  avg_sleep_hours: number;
  days_below_target: number;
  target_hours: number;
  window_days: number;
}

export interface OptimalBedtimeResponse {
  suggested_bedtime: string | null;
  confidence: 'high' | 'medium' | 'low';
  message: string;
  best_recovery_bedtimes: { date: string; bedtime: string; recovery_score: number }[];
}

export interface RespiratoryRateResponse {
  current_rr: number | null;
  recent_avg_rr: number | null;
  baseline_avg_rr: number | null;
  trend: 'stable' | 'elevated' | 'low';
  date: string | null;
}

export interface WhoopWeeklySummary {
  week_start: string;
  week_end: string;
  avg_recovery: number | null;
  avg_recovery_trend: 'up' | 'down' | 'stable' | null;
  total_strain: number | null;
  total_strain_trend: 'up' | 'down' | 'stable' | null;
  avg_sleep_hours: number | null;
  avg_sleep_trend: 'up' | 'down' | 'stable' | null;
  sleep_consistency: number;
  best_recovery_day: { date: string; score: number } | null;
  worst_recovery_day: { date: string; score: number } | null;
  days_with_data: number;
}

export interface WeightEntry {
  date: string;
  weight_kg: number;
  source: string;
}

export interface WeightHistoryResponse {
  entries: WeightEntry[];
  rolling_avg: { date: string; weight_kg: number }[];
}

export interface HealthAlert {
  id: string;
  alert_type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  evidence?: Record<string, unknown>;
  detected_date: string;
  status: string;
  created_at?: string;
}

export interface HealthAnalysisResult {
  type: string;
  label: string;
  result?: {
    score: number;
    severity: 'none' | 'info' | 'warning' | 'critical';
    title: string;
    description: string;
    evidence?: Record<string, unknown>;
  };
  error?: string;
}

// ─── Merge Analysis ─────────────────────────────────────────────────────

export interface MergePairScore {
  activity_a_id: string;
  activity_a_name: string;
  activity_a_source: string;
  activity_a_sport: string;
  activity_a_date: string;
  activity_b_id: string;
  activity_b_name: string;
  activity_b_source: string;
  activity_b_sport: string;
  activity_b_date: string;
  score: number;
  date_score: number;
  sport_score: number;
  duration_score: number;
  distance_score: number;
  likely_false_positive: boolean;
}

export interface MergeThresholdResult {
  threshold: number;
  total_activities: number;
  total_pairs_scored: number;
  pairs_above_threshold: number;
  likely_merges: number;
  potential_false_positives: number;
  pairs: MergePairScore[];
}

// ─── Training Streaks ────────────────────────────────────────────────────

export interface TrainingStreaks {
  current_streak_days: number;
  longest_streak_days: number;
  weekly_consistency_pct: number;
  monthly_sessions: { month: string; sessions: number }[];
}

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
