// ─── Routes ──────────────────────────────────────────────────────────────────

export interface RouteSource {
  id: string;
  provider: string;
  provider_route_id: string;
  provider_name: string;
  synced_at: string;
}

export interface RouteTag {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export interface RouteCollection {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  is_smart: boolean;
  rules: Record<string, unknown> | null;
  sort_order: number;
  created_at: string;
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
  surface_profile?: Record<string, number>;
  start_lat: number;
  start_lng: number;
  end_lat: number;
  end_lng: number;
  country?: string;
  locality?: string;
  is_loop: boolean;
  is_favorite: boolean;
  quality_score?: number;
  sources: RouteSource[];
  tags: RouteTag[];
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
  is_favorite: boolean;
  quality_score?: number;
  sources: RouteSource[];
  surface_profile?: Record<string, number>;
  tags: RouteTag[];
  ride_count: number;
  is_ridden: boolean;
  last_ridden_date?: string;
  created_at: string;
  updated_at: string;
}

export interface RouteFilters {
  sport_type?: string;
  source?: string;
  surface_type?: string;
  is_loop?: boolean;
  is_ridden?: boolean;
  is_favorite?: boolean;
  tag_ids?: string[];
  collection_id?: string;
  min_distance?: number;
  max_distance?: number;
  min_elevation?: number;
  max_elevation?: number;
  min_quality_score?: number;
  q?: string;
  sort_by?: string;
  sort_order?: string;
  limit?: number;
  offset?: number;
}

export interface RouteTagCreate {
  name: string;
  color?: string | null;
}

export interface RouteTagUpdate {
  name?: string;
  color?: string | null;
}

export interface RouteCollectionCreate {
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  is_smart?: boolean;
  rules?: Record<string, unknown> | null;
}

export interface RouteCollectionUpdate {
  name?: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  rules?: Record<string, unknown> | null;
  sort_order?: number;
}

// ── Route History ────────────────────────────────────────────────────────────

export interface RouteHistoryRide {
  activity_id: string;
  date: string;
  duration_seconds: number | null;
  distance_meters: number | null;
  average_power: number | null;
  tss: number | null;
}

export interface RouteHistoryPersonalBest {
  activity_id: string;
  date: string;
  duration_seconds: number;
  average_power: number | null;
}

export interface RouteHistoryResponse {
  route_id: string;
  route_name: string;
  total_rides: number;
  personal_best: RouteHistoryPersonalBest | null;
  rides: RouteHistoryRide[];
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

// ── Quality ──────────────────────────────────────────────────────────────────

export interface RouteQualityScore {
  id: string;
  route_id: string;
  user_id: string;
  completeness_score: number | null;
  popularity_score: number | null;
  surface_quality_score: number | null;
  effort_match_score: number | null;
  overall_score: number | null;
  computed_at: string;
}

// ── Effort Estimation ─────────────────────────────────────────────────────────

export interface EffortEstimateResponse {
  estimated_time_seconds: number;
  estimated_tss: number;
  intensity_factor: number;
  normalized_power: number;
  estimated_kcal: number;
  zone_name: string | null;
  description: string | null;
}

export interface EffortEstimateRequest {
  ftp_watts: number;
  weight_kg: number;
  bike_type?: string;
  target_intensity?: string;
}
