'use client';

import React from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import type { LlmAnalysis } from '@/lib/api';
import { renderAnalysisText, relativeTime } from '@/lib/analysisRenderer';

/* ── Component ──────────────────────────────────────────────────────────── */

interface LlmAnalysisCardProps {
  analysis: LlmAnalysis | null;
  isLoading: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function LlmAnalysisCard({ analysis, isLoading, onRefresh, isRefreshing }: LlmAnalysisCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between w-full">
          <CardTitle>🤖 AI Performance Analysis</CardTitle>
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label={analysis ? 'Refresh analysis' : 'Generate analysis'}
            className="px-3 py-1.5 text-xs bg-accent/20 text-accent border border-accent/30 rounded-lg hover:bg-accent/30 transition-colors disabled:opacity-50"
          >
            {isRefreshing ? '⏳ Analyzing...' : analysis ? '🔄 Refresh' : '✨ Generate Analysis'}
          </button>
        </div>
      </CardHeader>

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-3 animate-pulse">
          <div className="h-4 bg-surface-light/50 rounded w-3/4" />
          <div className="h-4 bg-surface-light/50 rounded w-full" />
          <div className="h-4 bg-surface-light/50 rounded w-5/6" />
          <div className="h-4 bg-surface-light/50 rounded w-2/3" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !analysis && (
        <div className="text-center py-8">
          <p className="text-3xl mb-2">🧠</p>
          <p className="text-muted text-sm">No analysis generated yet</p>
          <p className="text-muted text-xs mt-1">
            Click "Generate Analysis" to get AI-powered insights on your cycling performance
          </p>
        </div>
      )}

      {/* Analysis content */}
      {!isLoading && analysis && (
        <div>
          {/* Subtitle */}
          <div className="flex items-center gap-3 mb-4 text-xs text-muted">
            <span>
              📅 {new Date(analysis.analysis_date).toLocaleDateString(undefined, {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
            <span className="text-surface-light">|</span>
            <span>Model: <span className="text-muted font-mono">{analysis.model_used}</span></span>
          </div>

          {/* Rendered analysis */}
          <div className="bg-surface-light/30 rounded-lg p-4 border border-surface-light/50">
            {renderAnalysisText(analysis.analysis_text)}
          </div>

          {/* Footer */}
          <p className="text-xs text-muted mt-3 text-right">
            Last updated: {relativeTime(analysis.created_at)}
          </p>
        </div>
      )}
    </Card>
  );
}
