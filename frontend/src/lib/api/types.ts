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

export interface ChartData {
  chart_type: 'line' | 'bar' | 'scatter' | 'area' | 'pie';
  title: string;
  labels: string[];
  series: ChartSeries[];
  x_label?: string;
  y_label?: string;
}

export interface ChartParams {
  days?: number;
  weeks?: number;
  exercise_name?: string;
}

export interface DashboardSummary {
  weekly_volume_kg: number;
  weekly_sessions: number;
  weekly_tss: number;
  weekly_distance_meters: number;
  latest_recovery?: number;
  latest_hrv_ms?: number;
  active_alerts_count: number;
  current_week_start: string;
  current_week_end: string;
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
  ride_count: number;
  last_ridden_date?: string;
  created_at: string;
  updated_at: string;
}

export interface RouteFilters {
  sport_type?: string;
  source?: string;
  is_loop?: boolean;
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
  auto_estimate_ftp: boolean;
  created_at: string;
  updated_at: string;
}

export interface CyclingProfileUpdate {
  ftp_watts?: number;
  weight_kg?: number;
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
}

export interface PowerVsHrPoint {
  power: number;
  heart_rate: number;
  date: string;
}

export interface PowerVsHrResponse {
  data: PowerVsHrPoint[];
}

export interface FtpEstimate {
  estimated_ftp: number;
  source_method: string;
  best_power_available: Record<string, number | null>;
  days_analyzed: number;
  accepted: boolean;
  previous_ftp?: number;
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
