// ─── LLM Analysis ──────────────────────────────────────────────────────────

export interface LlmAnalysis {
  id: string;
  analysis_date: string;
  stats_json: Record<string, unknown>;
  analysis_text: string;
  model_used: string;
  created_at: string;
}

export interface LlmAnalysisSummary {
  id: string;
  analysis_date: string;
  analysis_text: string;
  model_used: string;
  created_at: string;
}
