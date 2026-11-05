// Ride segment types (§3.13) — climb segments + leaderboard-of-self.

export interface Segment {
  id: string;
  route_id: string;
  route_name: string | null;
  name: string;
  start_dist_m: number;
  end_dist_m: number;
  distance_m: number;
  elevation_gain_m: number;
  avg_gradient_pct: number;
  max_gradient_pct: number;
  peak_elevation_m: number | null;
  start_lat: number;
  start_lng: number;
  end_lat: number;
  end_lng: number;
  climb_category: string | null;
  pr_seconds: number | null;
  best_avg_power_watts: number | null;
  times_ridden: number;
  has_pr: boolean;
  effort_count: number;
  // Intelligence fields (fitted by Modal weekly task)
  cluster_id: number | null;
  // Cross-route hill identity (plan §3). `null` until the weekly intelligence
  // task has run at least once — "not clustered yet", not "no identity".
  // `geo_cluster_size` > 1 means this row is one detection of a hill that also
  // appears on other routes, which is what makes the merged leaderboard worth
  // opening.
  geo_cluster_id: string | null;
  geo_cluster_size: number;
  climb_type: string | null;
  sustainedness: number | null;
  difficulty_score: number | null;
  predicted_vam: number | null;
  predicted_time_seconds: number | null;
  predicted_power_watts: number | null;
  prediction_confidence: number | null;
  intelligence_analyzed_at: string | null;
}

export interface SegmentEffort {
  id: string;
  segment_id: string;
  activity_id: string;
  activity_name: string | null;
  started_at: string | null;
  elapsed_seconds: number;
  moving_seconds?: number | null;
  avg_power_watts: number | null;
  avg_hr: number | null;
  avg_speed_mps: number;
  effort_vam: number | null;
  assisted?: boolean | null;
  is_pr: boolean;
  line_id?: string | null;
  line_km?: number[] | null;
}

export interface SegmentDetail {
  segment: Segment;
  efforts: SegmentEffort[];
}

/**
 * One physical hill, merged across every route it appears on (plan §3).
 *
 * `efforts` arrives ranked by **VAM**, not elapsed seconds. Different routes
 * detect the same hill with slightly different windows (900 m vs 950 m
 * depending on elevation sampling), so seconds are not comparable across
 * members and ranking by them would report a "best" nobody rode. VAM is
 * window-robust.
 */
export interface ClimbDetail {
  geo_cluster_id: string;
  /** Canonical: the most-ridden member's name. */
  name: string;
  route_count: number;
  segments: Segment[];
  efforts: SegmentEffort[];
}

export interface SegmentRecomputeResponse {
  route_id: string;
  recomputed: number;
}

// ── Stable segment groups (migration 106/107) ───────────────────────────────

export interface SegmentGroupBest {
  seconds: number;
  moving_seconds: number | null;
  power_watts: number | null;
  vam: number | null;
  date: string | null;
}

export interface SegmentGroupPrediction {
  seconds: number;
  vam: number | null;
  power_watts: number | null;
  confidence: number | null;
}

/**
 * One physical/defined segment, merged across every route line. `kind` is
 * `climb` today; sprints/descents/custom reuse this shape.
 */
export interface SegmentGroup {
  id: string;
  kind: string;
  name: string;
  canonical_name: string;
  display_name: string | null;
  name_source: string;
  area: string | null;
  region: string | null;
  country: string | null;
  route_name: string | null;
  distance_m: number;
  gain_m: number;
  avg_gradient_pct: number;
  max_gradient_pct: number;
  steepest_200m_pct: number;
  sustained_share: number;
  /** 49 × [distance_m, elevation_m, gradient_pct] */
  profile: number[][];
  category: string | null;
  difficulty: number | null;
  attempts: number;
  best: SegmentGroupBest | null;
  last_ridden: string | null;
  route_count: number;
  prediction: SegmentGroupPrediction | null;
}

export interface SegmentGroupDetail {
  group: SegmentGroup;
  segments: Segment[];
  efforts: SegmentEffort[];
  route_names: string[];
}

export interface SegmentGroupList {
  items: SegmentGroup[];
  total: number;
  counts: { ridden: number; to_ride: number; all: number };
}
