// Global search API client — powers the ⌘K command palette.

export interface ActivityHit {
  id: string;
  name: string;
  date: string | null;
  sport_type: string;
}

export interface RouteHit {
  id: string;
  name: string;
  sport_type: string;
}

export interface LiftingSessionHit {
  id: string;
  program_name: string | null;
  focus: string | null;
  session_date: string;
}

export interface ExerciseHit {
  id: string;
  name: string;
  category: string | null;
}

export interface GoalHit {
  id: string;
  label: string;
  metric: string;
  target_value: number;
  status: string;
}

export interface EventHit {
  id: string;
  name: string;
  event_date: string;
  event_type: string;
}

export interface SearchResponse {
  query: string;
  activities: ActivityHit[];
  routes: RouteHit[];
  lifting_sessions: LiftingSessionHit[];
  exercises: ExerciseHit[];
  goals: GoalHit[];
  events: EventHit[];
}

type AuthFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export async function globalSearch(
  authFetch: AuthFetch,
  q: string,
  limit = 5,
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  return authFetch<SearchResponse>(`/api/v1/search?${params.toString()}`);
}