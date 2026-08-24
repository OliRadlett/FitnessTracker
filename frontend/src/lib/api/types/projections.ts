// ─── Projections (Phase 7) ─────────────────────────────────────────────────

/** Regression trend metadata. */
export interface TrendInfo {
  slope_per_day: number;
  slope_per_week: number;
  r_squared: number;
  data_points: number;
}

/** A single date+value pair for projection lines. */
export interface ProjectionPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

/** Full projection for a single goal — GET /projections/goal/{goalId}. */
export interface GoalProjectionResponse {
  goal_id: string;
  metric: string;
  current_value: number | null;
  target_value: number;
  target_date: string | null;
  direction: string | null; // "increase" | "decrease"
  trend: TrendInfo | null;
  projection: { projected_date: string; days_remaining: number } | null;
  badge: 'On Track' | 'At Risk' | 'Unlikely' | 'Not enough data';
  history: ProjectionPoint[];
  projection_line: ProjectionPoint[];
}

/** A single day in the TSB projection. */
export interface TsbProjectionPoint {
  date: string;
  ctl: number;
  atl: number;
  tsb: number;
}

/** TSB projection for an event-linked plan — GET /projections/tsb/{planId}. */
export interface TsbProjectionResponse {
  plan_id: string;
  event_date: string | null;
  current_tsb: number | null;
  race_day_tsb: number | null;
  freshness_assessment: string | null;
  projection: TsbProjectionPoint[];
}
