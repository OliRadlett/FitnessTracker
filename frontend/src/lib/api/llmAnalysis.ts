import { apiFetch } from './fetch';
import type { LlmAnalysis, LlmAnalysisSummary } from './types';

export async function getLatestLlmAnalysis(): Promise<LlmAnalysis | null> {
  return apiFetch<LlmAnalysis | null>('/api/v1/cycling/llm-analysis/latest');
}

export async function triggerLlmAnalysis(): Promise<LlmAnalysis> {
  return apiFetch<LlmAnalysis>('/api/v1/cycling/llm-analysis/on-demand', {
    method: 'POST',
  });
}

export async function getLlmAnalysisHistory(limit: number = 10, analysisType?: string): Promise<LlmAnalysisSummary[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (analysisType) query.append('analysis_type', analysisType);
  return apiFetch<LlmAnalysisSummary[]>(`/api/v1/cycling/llm-analysis/history?${query.toString()}`);
}

// ── Health AI Analysis ──────────────────────────────────────────────────────

export async function getHealthAiAnalysis(): Promise<LlmAnalysis | null> {
  return apiFetch<LlmAnalysis | null>('/api/v1/metrics/health-ai-analysis');
}

export async function triggerHealthAiAnalysis(): Promise<LlmAnalysis> {
  return apiFetch<LlmAnalysis>('/api/v1/metrics/health-ai-analysis', {
    method: 'POST',
  });
}

// ── Event AI Analysis ───────────────────────────────────────────────────────

export async function getEventAiAnalysis(eventId: string): Promise<LlmAnalysis | null> {
  return apiFetch<LlmAnalysis | null>(`/api/v1/events/${eventId}/ai-analysis`);
}

export async function triggerEventAiAnalysis(eventId: string): Promise<LlmAnalysis> {
  return apiFetch<LlmAnalysis>(`/api/v1/events/${eventId}/ai-analysis`, {
    method: 'POST',
  });
}
