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
}

export interface SegmentEffort {
  id: string;
  segment_id: string;
  activity_id: string;
  activity_name: string | null;
  started_at: string | null;
  elapsed_seconds: number;
  avg_power_watts: number | null;
  avg_hr: number | null;
  avg_speed_mps: number;
  effort_vam: number | null;
  is_pr: boolean;
}

export interface SegmentDetail {
  segment: Segment;
  efforts: SegmentEffort[];
}

export interface SegmentRecomputeResponse {
  route_id: string;
  recomputed: number;
}