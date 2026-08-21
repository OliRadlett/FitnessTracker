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
