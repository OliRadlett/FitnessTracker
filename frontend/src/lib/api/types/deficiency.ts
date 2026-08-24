// ─── Weakness / Deficiency Analysis ──────────────────────────────────────────

export type DeficiencyCategory = 'lifting' | 'cycling';

export type DeficiencyType =
  | 'strength_standard'
  | 'ratio'
  | 'volume_balance'
  | 'vo2max_ftp_mismatch'
  | 'decoupling'
  | 'zone_distribution';

/** Severity of a weakness. `strength` marks a positive (balanced) metric. */
export type DeficiencySeverity = 'critical' | 'high' | 'medium' | 'low' | 'strength';

export interface WeaknessItem {
  category: DeficiencyCategory;
  type: DeficiencyType;
  /** Machine key for the metric, e.g. "bench_squat_ratio" */
  metric: string;
  value: number | null;
  unit: string | null;
  bodyweight: number | null;
  /** e.g. strength standard level reached ("intermediate") */
  level: string | null;
  next_level_target: number | null;
  severity: DeficiencySeverity;
  /** Human-readable sentence with numbers */
  detail: string;
  /** Actionable suggestion */
  recommendation: string;
}

export interface DeficiencySummary {
  total_weaknesses: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  strengths: number;
}

export interface DeficiencyResponse {
  weaknesses: WeaknessItem[];
  summary: DeficiencySummary;
  computed_at: string;
}
