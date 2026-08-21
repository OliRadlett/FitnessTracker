// ─── Health & Whoop ──────────────────────────────────────────────────────────

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
