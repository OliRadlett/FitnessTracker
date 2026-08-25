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
  weather_temperature?: number | null;
  weather_conditions?: string | null;
  weather_wind_speed_kmh?: number | null;
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
  resting_hr?: number;
  respiratory_rate?: number;
}

export interface SleepLogSummary {
  id: string;
  sleep_date: string;
  source: string;
  total_sleep_seconds?: number;
  deep_sleep_seconds?: number;
  rem_sleep_seconds?: number;
  light_sleep_seconds?: number;
  awake_seconds?: number;
  sleep_efficiency?: number;
  sleep_start?: string;
  sleep_end?: string;
}

export interface CalendarDayData {
  activities: ActivityCalendarEntry[];
  daily_metrics: DailyMetricSummary[];
  sleep_logs: SleepLogSummary[];
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
  q?: string;
  min_distance?: number;
  max_distance?: number;
  min_duration?: number;
  max_duration?: number;
  min_tss?: number;
  max_tss?: number;
  sort_by?: string;
  sort_order?: string;
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

// Forward reference for lifting link
export interface LinkedLiftingSessionSummary {
  id: string;
  session_date: string;
  focus?: string;
  set_count: number;
  total_volume_kg?: number;
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
