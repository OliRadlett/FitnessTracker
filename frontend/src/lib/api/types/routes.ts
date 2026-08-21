// ─── Routes ──────────────────────────────────────────────────────────────────

export interface RouteSource {
  id: string;
  provider: string;
  provider_route_id: string;
  provider_name: string;
  synced_at: string;
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
  sources: RouteSource[];
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
  sources: RouteSource[];
  surface_profile?: Record<string, number>;
  ride_count: number;
  is_ridden: boolean;
  last_ridden_date?: string;
  created_at: string;
  updated_at: string;
}

export interface RouteFilters {
  sport_type?: string;
  source?: string;
  is_loop?: boolean;
  is_ridden?: boolean;
  min_distance?: number;
  max_distance?: number;
  min_elevation?: number;
  max_elevation?: number;
  q?: string;
  sort_by?: string;
  sort_order?: string;
  limit?: number;
  offset?: number;
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
