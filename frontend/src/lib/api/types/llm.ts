// ─── LLM Analysis ──────────────────────────────────────────────────────────

export interface LlmAnalysis {
  id: string;
  activity_id?: string | null;
  lifting_session_id?: string | null;
  event_id?: string | null;
  analysis_type: 'cycling' | 'activity' | 'lifting_session' | 'health' | 'event';
  analysis_date: string;
  stats_json: Record<string, unknown>;
  analysis_text: string;
  model_used: string;
  created_at: string;
}

export interface LlmAnalysisSummary {
  id: string;
  activity_id?: string | null;
  lifting_session_id?: string | null;
  event_id?: string | null;
  analysis_type: 'cycling' | 'activity' | 'lifting_session' | 'health' | 'event';
  analysis_date: string;
  analysis_text: string;
  model_used: string;
  created_at: string;
}
