// Course → Route → Ride types.

export interface CourseRoute {
  id: string;
  name: string;
  sport_type: string;
  distance_meters: number;
  elevation_gain_meters: number | null;
  is_loop: boolean;
  preview_polyline: string | null;
  ride_count: number;
  confirmed_ride_count: number;
  suggested_ride_count: number;
  is_canonical: boolean;
  created_at: string;
}

export interface CourseActivity {
  id: string;
  name: string;
  start_date: string;
  distance_meters: number | null;
  route_id: string | null;
  route_name: string | null;
  route_link_status: 'suggested' | 'confirmed' | 'rejected' | null;
}

export interface CourseSummary {
  id: string;
  name: string;
  sport_type: string;
  route_count: number;
  confirmed_ride_count: number;
  suggested_ride_count: number;
  canonical_route_id: string | null;
  canonical_name: string | null;
  preview_polyline: string | null;
  identity_source: string;
  identity_confidence: number | null;
  last_ridden_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface CourseDetail extends CourseSummary {
  routes: CourseRoute[];
  activities: CourseActivity[];
}

export interface CourseSuggestion {
  route_a_id: string;
  route_a_name: string;
  route_a_course_id: string | null;
  route_a_distance_meters: number;
  route_a_preview_polyline: string | null;
  route_b_id: string;
  route_b_name: string;
  route_b_course_id: string | null;
  route_b_distance_meters: number;
  route_b_preview_polyline: string | null;
  score: number;
  tier: string;
  breakdown: Record<string, unknown> | null;
}

export interface DismissedCourseSuggestion {
  route_a_id: string;
  route_a_name: string;
  route_a_distance_meters: number;
  route_a_preview_polyline: string | null;
  route_b_id: string;
  route_b_name: string;
  route_b_distance_meters: number;
  route_b_preview_polyline: string | null;
  dismissed_at: string;
}

export interface CourseCreatePayload {
  name: string;
  sport_type?: string;
  route_ids?: string[];
}

export interface RideLinkResult {
  activity_id: string;
  route_id: string;
  status: string;
}
