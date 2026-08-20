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

export async function getLlmAnalysisHistory(limit: number = 10): Promise<LlmAnalysisSummary[]> {
  return apiFetch<LlmAnalysisSummary[]>(`/api/v1/cycling/llm-analysis/history?limit=${limit}`);
}
