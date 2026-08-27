'use client';

import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { useAuthFetch } from '@/lib/api';
import type { LlmAnalysis } from '@/lib/api';
import { renderAnalysisText, relativeTime } from '@/lib/analysisRenderer';

/* ── Component ─────────────────────────────────────────────────────────── */

export function HealthAiAnalysisCard() {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();
  const queryKey = ['health-ai-analysis'];

  const { data: cachedAnalysis, isLoading, isError, error } = useQuery<LlmAnalysis | null>({
    queryKey,
    queryFn: () => authFetch<LlmAnalysis | null>('/api/v1/metrics/health-ai-analysis'),
    staleTime: 1000 * 60 * 30,
  });

  const mutation = useMutation({
    mutationFn: () => authFetch<LlmAnalysis>('/api/v1/metrics/health-ai-analysis', { method: 'POST' }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
    },
    onError: (err: Error) => {
      console.error('[HealthAiAnalysisCard] Analysis failed:', err);
    },
  });

  const analysis = mutation.data ?? cachedAnalysis ?? null;
  const isAnalyzing = mutation.isPending;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between w-full">
          <CardTitle>🏥 AI Health Analysis</CardTitle>
          <button
            onClick={() => mutation.mutate()}
            disabled={isAnalyzing}
            aria-label={analysis ? 'Re-analyze health data' : 'Analyze health data with AI'}
            className="px-3 py-1.5 text-xs bg-accent/20 text-accent border border-accent/30 rounded-lg hover:bg-accent/30 transition-colors disabled:opacity-50"
          >
            {isAnalyzing ? '⏳ Analyzing...' : analysis ? '🔄 Re-analyze' : '✨ Analyze Health'}
          </button>
        </div>
      </CardHeader>

      {/* Error state */}
      {mutation.isError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4">
          <p className="text-sm text-warning">
            {mutation.error instanceof Error
              ? mutation.error.message.includes('GEMINI_API_KEY')
                ? 'AI analysis is not available — GEMINI_API_KEY is not configured.'
                : `Analysis failed: ${mutation.error.message}`
              : 'Analysis failed. Please try again.'}
          </p>
        </div>
      )}
      {isError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300 text-sm mb-4">
          Failed to load: {error?.message}
        </div>
      )}

      {/* Loading state */}
      {isLoading && !analysis && (
        <div className="space-y-3 animate-pulse">
          <div className="h-4 bg-surface-light/50 rounded w-3/4" />
          <div className="h-4 bg-surface-light/50 rounded w-full" />
          <div className="h-4 bg-surface-light/50 rounded w-5/6" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !analysis && !isAnalyzing && !mutation.isError && (
        <div className="text-center py-6">
          <p className="text-3xl mb-2">🩺</p>
          <p className="text-muted text-sm">No health analysis yet</p>
          <p className="text-muted text-xs mt-1">
            Click "Analyze Health" to get AI-powered insights on your HRV, sleep, recovery, and more
          </p>
        </div>
      )}

      {/* Analyzing spinner */}
      {isAnalyzing && (
        <div className="flex items-center gap-3 py-4">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted">
            Analyzing health data with Gemini... This may take 10-20 seconds.
          </p>
        </div>
      )}

      {/* Analysis content */}
      {analysis && (
        <div>
          <div className="flex items-center gap-3 mb-4 text-xs text-muted">
            <span>Model: <span className="text-muted font-mono">{analysis.model_used}</span></span>
            <span className="text-surface-light">|</span>
            <span>Generated {relativeTime(analysis.created_at)}</span>
          </div>

          <div className="bg-surface-light/30 rounded-lg p-4 border border-surface-light/50">
            {renderAnalysisText(analysis.analysis_text)}
          </div>
        </div>
      )}
    </Card>
  );
}
