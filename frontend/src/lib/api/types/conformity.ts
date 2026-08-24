// ─── Plan Conformity (Phase 5C) ──────────────────────────────────────────

/** One weighted scoring component of a plan day (duration/power/TSS/…). */
export interface ConformityComponent {
  metric: string;
  planned: number | null;
  actual: number | null;
  deviation_pct: number | null;
  /** Weight applied to this component within the overall score (0–1). */
  weight_used: number;
  /** Per-component score (0–1). */
  component_score: number | null;
}

export type DayConformityStatus =
  | 'done'
  | 'partial'
  | 'missed'
  | 'extra'
  | 'pending'
  | 'rest';

/** GET /training-plans/{id}/days/{day_id}/conformity */
export interface DayConformityResponse {
  plan_id: string;
  day_id: string;
  day_date: string;
  sport: string;
  planned_type: string;
  conformity_pct: number | null;
  classification: string | null;
  components: ConformityComponent[];
  status: DayConformityStatus;
  deviations: string[];
}

/** One week's aggregate adherence inside a plan-conformity response. */
export interface WeekConformity {
  week_number: number;
  week_start: string;
  week_end: string;
  days_scored: number;
  days_total: number;
  pct: number | null;
  by_sport: Record<string, number>;
}

/** GET /training-plans/{id}/conformity */
export interface PlanConformityResponse {
  plan_id: string;
  overall_pct: number | null;
  trend: 'improving' | 'declining' | 'stable' | null;
  weeks: WeekConformity[];
  patterns: string[];
}

/** POST /training-plans/{id}/link-activities */
export interface LinkActivitiesResponse {
  linked: number;
}
