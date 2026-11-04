/**
 * Backend replay contract (`GET /api/v1/activities/{id}/replay`).
 *
 * Kept separate from the viewer's camelCase `Ride`; `replayToRide()` adapts it.
 */

export interface ReplayStreams {
  t: number[];
  d: number[];
  lat: number[];
  lng: number[];
  alt: number[];
  v: number[];
  hr: number[];
  grade: number[];
  watts?: number[];
  cadence?: number[];
}

export interface ReplayStats {
  distance_m: number;
  moving_s: number;
  elapsed_s: number;
  elevation_gain_m: number;
  ascent_m: number;
  descent_m: number;
  avg_speed_mps: number;
  avg_hr: number;
  avg_power_w: number | null;
  calories: number;
  pause_count: number;
  pause_s: number;
}

export interface ReplayWeather {
  temperature_c: number | null;
  conditions: string | null;
  wind_speed_kmh: number | null;
  wind_direction_deg: number | null;
  precipitation_mm: number | null;
}

export interface ReplayBounds {
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
}

export interface ReplayHighlight {
  startIdx?: number | null;
  endIdx?: number | null;
  idx?: number | null;
  startD?: number | null;
  endD?: number | null;
  gainM?: number | null;
  dropM?: number | null;
  gradePct?: number | null;
  speedKmh?: number | null;
  altM?: number | null;
  place?: string | null;
}

export interface ReplayHighlights {
  climb: ReplayHighlight;
  descent: ReplayHighlight;
  fastestKm: ReplayHighlight;
  highest: ReplayHighlight;
  lowest: ReplayHighlight;
}

export interface ReplayRide {
  id: string;
  activity_id: string;
  name: string;
  date: string;
  timezone: string;
  pose_labels: Record<string, string> | null;
  stats: ReplayStats;
  weather: ReplayWeather;
  bounds: ReplayBounds;
  streams: ReplayStreams;
  key_points: Record<string, number>;
  highlights: ReplayHighlights;
  encoded_polyline: string | null;
}

export interface ReplayActivity {
  id: string;
  name: string;
  start_date: string;
  timezone: string;
  sport_type: string;
  source: string;
  route_id: string | null;
}

export interface ReplayRoute {
  id: string;
  name: string;
}

export interface ReplayResponse {
  activity: ReplayActivity;
  ride: ReplayRide;
  route: ReplayRoute | null;
  map_allowed: boolean;
  map_used: number;
  map_limit: number;
}

/** `GET /api/v1/activities/{id}/ghosts` — past rides on the same route. */
export interface GhostCandidate {
  activity_id: string;
  name: string;
  start_date: string;
  timezone: string;
  distance_m: number;
  moving_s: number;
  avg_speed_mps: number | null;
}

export interface GhostListResponse {
  route_id: string | null;
  route_name: string | null;
  candidates: GhostCandidate[];
  /** Set when `candidates` is empty, so the viewer can explain why. */
  reason: string | null;
  /** Fastest ride on the route (may be the current activity itself). */
  pb_activity_id: string | null;
}

