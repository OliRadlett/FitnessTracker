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

// ─── Ride Analysis ────────────────────────────────────────────────────────

export interface RidePowerZoneDistribution {
  zone_name: string;
  zone_label: string;
  seconds: number;
  pct: number;
}

export interface PowerHistogramBucket {
  range_label: string;
  count: number;
  pct: number;
}

export interface PacingSegment {
  pct_start: number;
  pct_end: number;
  avg_power?: number;
  avg_hr?: number;
}

export interface RideAnalysis {
  power_zones: RidePowerZoneDistribution[];
  power_distribution: PowerHistogramBucket[];
  pacing_analysis: {
    segments: PacingSegment[];
    power_variability?: number;
  };
  variability_index?: number;
  intensity_factor?: number;
  decoupling?: {
    first_half_ef?: number;
    second_half_ef?: number;
    decoupling_pct?: number;
    classification?: string;
  };
  efficiency_factor?: number;
  vam?: number;
  tss_breakdown: {
    total_tss?: number;
    tss_per_hour?: number;
  };
  climbing_analysis?: {
    total_climbing_m?: number;
    avg_gradient_pct?: number;
    max_gradient_pct?: number;
    time_climbing_s?: number;
    time_flat_s?: number;
    time_descending_s?: number;
  };
}
